// File: api/analyze.js
// Funzione Serverless per Vercel (Node.js) - Protegge la tua GEMINI_API_KEY

module.exports = async function handler(req, res) {
  // Gestione CORS di base
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito. Usa POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Chiave GEMINI_API_KEY non configurata. Aggiungila nelle Environment Variables di Vercel e fai un Redeploy.'
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
  "sicurezza": "Avviso di sicurezza concreto e mirato (es. stacca la corrente, chiudi il rubinetto, usa mascherina FFP2, aerare bene)",
  "materiali": ["Materiale 1 con quantità/tipo", "Materiale 2"],
  "attrezzi": ["Attrezzo 1", "Attrezzo 2"],
  "passaggi": [
    { "titolo": "Nome breve del passaggio", "descrizione": "Istruzione pratica passo passo chiara per un principiante" }
  ],
  "consiglio_pro": "Un trucco pratico da professionista per evitare errori comuni e far durare il lavoro nel tempo"
}
Se il lavoro comporta rischi elettrici, gas o strutturali gravi, indicalo chiaramente nel campo sicurezza e consiglia un tecnico abilitato.`;

    const userText = `Categoria selezionata: ${category || 'Non specificata'}.
Note dell'utente: ${notes && notes.trim() ? notes.trim() : 'Nessuna nota aggiuntiva, basati sulla foto.'}`;

    const parts = [{ text: userText }];

    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: mimeType || 'image/jpeg',
          data: imageBase64
        }
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      const msg = data?.error?.message || 'Errore nella risposta di Google Gemini.';
      return res.status(geminiResponse.status).json({ error: msg });
    }

    let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

    const parsed = JSON.parse(rawText);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Errore Lavori da Sbruss 2.0 API:', err);
    return res.status(500).json({
      error: 'Errore durante l\'analisi. Riprova tra qualche secondo.'
    });
  }
};
