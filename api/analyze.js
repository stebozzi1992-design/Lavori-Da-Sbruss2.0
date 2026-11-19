// File: api/analyze.js
// Motore Ibrido: Groq per il testo (istantaneo) + Google Gemini per le foto

async function getGroqTextModel(apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!res.ok) return 'llama-3.3-70b-versatile';
  const data = await res.json();
  const excluded = ['whisper', 'tts', 'guard', 'embed', 'playai', 'orpheus', 'moderation'];
  const chatModels = (data.data || [])
    .map(m => m.id)
    .filter(id => id && !excluded.some(ex => id.toLowerCase().includes(ex)));

  const preferred = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen', 'llama-3'];
  for (const pref of preferred) {
    const found = chatModels.find(id => id.toLowerCase().includes(pref));
    if (found) return found;
  }
  return chatModels[0] || 'llama-3.3-70b-versatile';
}

async function analyzeWithGroq(apiKey, systemPrompt, userText) {
  const model = await getGroqTextModel(apiKey);
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_completion_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Errore nella risposta di Groq.');
  }
  let rawText = data?.choices?.[0]?.message?.content || '';
  rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(rawText);
}

async function analyzeWithGemini(apiKey, systemPrompt, userText, imageBase64, mimeType) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{
          role: 'user',
          parts: [
            { text: userText },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Errore nella risposta di Google Gemini.');
    }
    let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(rawText);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Google Gemini è momentaneamente lento per l\'analisi foto. Riprova tra poco o invia solo la descrizione.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });

  try {
    const { imageBase64, mimeType, category, notes } = req.body || {};

    if (!imageBase64 && (!notes || !notes.trim())) {
      return res.status(400).json({
        error: 'Carica una foto oppure descrivi il problema nel campo testo.'
      });
    }

    const systemPrompt = `Sei Lavori da Sbruss 2.0, un artigiano esperto italiano in restauro domestico, pittura, falegnameria, infissi e piccola idraulica.
Analizza la foto e/o la descrizione dell'utente e rispondi ESCLUSIVAMENTE con un oggetto JSON valido in italiano con questa esatta struttura:
{
  "titolo": "Titolo chiaro e breve dell'intervento",
  "diagnosi": "Spiegazione semplice e pratica del problema rilevato e della soluzione consigliata",
  "difficolta": "Facile" oppure "Media" oppure "Difficile",
  "tempo": "Stima realistica del tempo (es. 2-3 ore)",
  "costo": "Stima realistica dei materiali in euro (es. 20 - 35 €)",
  "sicurezza": "Avviso di sicurezza concreto e mirato",
  "materiali": ["Materiale 1 con quantità/tipo", "Materiale 2"],
  "attrezzi": ["Attrezzo 1", "Attrezzo 2"],
  "passaggi": [
    { "titolo": "Nome breve del passaggio", "descrizione": "Istruzione pratica passo passo chiara per un principiante" }
  ],
  "consiglio_pro": "Un trucco pratico da professionista per evitare errori comuni"
}
Se il lavoro comporta rischi elettrici, gas o strutturali gravi, indicalo chiaramente nel campo sicurezza e consiglia un tecnico abilitato.`;

    const userText = `Categoria selezionata: ${category || 'Non specificata'}.
Note dell'utente: ${notes && notes.trim() ? notes.trim() : 'Nessuna nota aggiuntiva, basati sulla foto.'}`;

    // Se c'è una foto usa Google Gemini
    if (imageBase64) {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return res.status(500).json({ error: 'Chiave GEMINI_API_KEY non trovata su Vercel per analizzare le foto.' });
      }
      const parsed = await analyzeWithGemini(geminiKey, systemPrompt, userText, imageBase64, mimeType);
      return res.status(200).json(parsed);
    }

    // Se è solo testo usa Groq (velocissimo)
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return res.status(500).json({ error: 'Chiave GROQ_API_KEY non trovata su Vercel.' });
    }
    const parsed = await analyzeWithGroq(groqKey, systemPrompt, userText);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Errore Lavori da Sbruss 2.0 API:', err);
    return res.status(500).json({ error: err.message || 'Errore durante l\'analisi. Riprova.' });
  }
};
