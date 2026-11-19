// File: api/analyze.js
// Motore AI con Groq: rileva in automatico i modelli attivi sul tuo account

async function getGroqModels(apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map(m => m.id).filter(Boolean);
}

function pickModel(models, needsVision) {
  const excluded = ['whisper', 'tts', 'guard', 'embed', 'playai', 'orpheus', 'moderation'];
  const chatModels = models.filter(id => !excluded.some(ex => id.toLowerCase().includes(ex)));

  if (needsVision) {
    const visionKeywords = ['vision', 'llama-4', 'maverick', 'scout', 'pixtral', 'vl', 'multimodal'];
    const visionModel = chatModels.find(id => visionKeywords.some(k => id.toLowerCase().includes(k)));
    if (visionModel) return visionModel;
    return null;
  }

  const preferred = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'qwen',
    'llama-3'
  ];
  for (const pref of preferred) {
    const found = chatModels.find(id => id.toLowerCase().includes(pref));
    if (found) return found;
  }
  return chatModels[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Chiave GROQ_API_KEY non configurata su Vercel.'
    });
  }

  try {
    const { imageBase64, mimeType, category, notes } = req.body || {};

    if (!imageBase64 && (!notes || !notes.trim())) {
      return res.status(400).json({
        error: 'Carica una foto oppure descrivi il problema nel campo testo.'
      });
    }

    const availableModels = await getGroqModels(apiKey);
    const chosenModel = pickModel(availableModels, Boolean(imageBase64));

    if (!chosenModel) {
      return res.status(400).json({
        error: imageBase64
          ? 'Nessun modello per le foto è attivo su Groq al momento. Prova a descrivere il problema a parole senza foto.'
          : 'Nessun modello chat attivo trovato sul tuo account Groq.'
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

    const userContent = imageBase64
      ? [
          { type: 'text', text: userText },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`
            }
          }
        ]
      : userText;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: chosenModel,
        temperature: 0.4,
        max_completion_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      })
    });

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      const msg = data?.error?.message || 'Errore nella risposta di Groq.';
      return res.status(groqResponse.status).json({ error: `${msg} (modello: ${chosenModel})` });
    }

    let rawText = data?.choices?.[0]?.message?.content || '';
    rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

    const parsed = JSON.parse(rawText);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Errore Lavori da Sbruss 2.0 (Groq):', err);
    return res.status(500).json({
      error: 'Errore durante l\'analisi. Riprova tra qualche secondo.'
    });
  }
};
