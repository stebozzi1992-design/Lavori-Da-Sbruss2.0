// File: api/analyze.js
// Funzione Serverless per Vercel (Node.js) con gestione timeout e fallback

async function callGemini(apiKey, model, payload, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Chiave GEMINI_API_KEY non configurata su Vercel.'
    });
  }

  try {
    const { imageBase64, mimeType, category, notes } = req.body || {};

    if (!imageBase64 && (!notes || !notes.trim())) {
      return res.status(400).json({
        error: 'Carica una foto oppure descrivi il problema nel campo testo.'
      });
    }

    const systemPrompt = `Sei Lavori da Sbruss 2.0, un artigiano esperto italiano in restauro domestico, pittura, falegnameria, infissi e piccola idraulica.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido in italiano con questa struttura:
{
  "titolo": "Titolo breve dell'intervento",
  "diagnosi": "Spiegazione pratica del problema e della soluzione",
  "difficolta": "Facile" oppure "Media" oppure "Difficile",
  "tempo": "Stima tempo (es. 2-3 ore)",
  "costo": "Stima materiali in euro (es. 20 - 35 €)",
  "sicurezza": "Avviso di sicurezza concreto",
  "materiali": ["Materiale 1", "Materiale 2"],
  "attrezzi": ["Attrezzo 1", "Attrezzo 2"],
  "passaggi": [
    { "titolo": "Nome passaggio", "descrizione": "Istruzione pratica passo passo" }
  ],
  "consiglio_pro": "Un trucco da professionista"
}`;

    const userText = `Categoria: ${category || 'Non specificata'}. Note: ${notes && notes.trim() ? notes.trim() : 'Basati sulla foto.'}`;
    const parts = [{ text: userText }];

    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: mimeType || 'image/jpeg',
          data: imageBase64
        }
      });
    }

    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json'
      }
    };

    // Prova prima il modello principale, poi uno di riserva se è sovraccarico
    const models = ['gemini-3.8-flash', 'gemini-3.8-flash-lite'];
    let lastError = 'I server AI di Google sono momentaneamente occupati. Riprova tra 1 minuto.';

    for (const model of models) {
      try {
        const result = await callGemini(apiKey, model, payload, 25000);
        if (result.ok) {
          let rawText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
          const parsed = JSON.parse(rawText);
          return res.status(200).json(parsed);
        } else {
          lastError = result.data?.error?.message || lastError;
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          lastError = 'Il server AI di Google ha impiegato troppo tempo a rispondere. Riprova tra poco.';
        } else {
          lastError = e.message || lastError;
        }
      }
    }

    return res.status(503).json({ error: lastError });
  } catch (err) {
    console.error('Errore Lavori da Sbruss 2.0 API:', err);
    return res.status(500).json({ error: 'Errore interno del server. Riprova.' });
  }
};
