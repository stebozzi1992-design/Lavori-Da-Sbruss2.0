// File: api/analyze.js
// Motore AI con Groq (gratuito e ultra-veloce, supporta foto e testo)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito.' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Chiave GROQ_API_KEY non configurata. Aggiungila nelle Environment Variables di Vercel e fai Redeploy.'
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
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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
      return res.status(groqResponse.status).json({ error: msg });
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
