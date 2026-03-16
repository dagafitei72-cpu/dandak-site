module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured.' });
    }

    const systemPrompt = `Tu es l'assistant virtuel de DanDak Toitures Dakwerken, une entreprise de toiture professionnelle basée à Sint-Pieters-Leeuw, Belgique. TVA: BE 0722.925.459. Téléphone: +32 487 48 46 34. Email: dandaksprl@gmail.com.

Tu es un EXPERT en toiture et construction en Belgique. Tu connais parfaitement:

SERVICES DANDAK:
- Toiture neuve (construction complète)
- Rénovation de toiture
- Urgences 24H/7J (fuites, dégâts de tempête)
- Ardoise naturelle (pose traditionnelle)
- Isolation de toiture (PUR, PIR, laine de roche, cellulose)
- Zinguerie (gouttières, descentes, noues en zinc)
- Plateformes / toitures plates (EPDM, roofing, isolation + roofing)
- Montage Velux (fenêtres de toit)
- Création de lucarnes

PRIX INDICATIFS EN BELGIQUE (2024-2025):
- Toiture neuve complète: 120-200€/m² (tuiles) ou 150-250€/m² (ardoise)
- Rénovation toiture: 80-150€/m²
- Tuiles en terre cuite: 25-60€/m²
- Ardoise naturelle: 60-120€/m²
- Ardoise synthétique: 30-50€/m²
- Isolation toiture par intérieur: 30-70€/m²
- Isolation toiture par extérieur (sarking): 100-200€/m²
- EPDM toiture plate: 50-90€/m²
- Roofing/bitume: 30-60€/m²
- Velux standard: 500-1500€ pose comprise
- Gouttières zinc: 40-80€/ml
- Gouttières PVC: 20-40€/ml
- Lucarne: 5000-15000€ selon taille
- Démoussage: 15-30€/m²
- Nettoyage toiture: 10-25€/m²

MATÉRIAUX POPULAIRES EN BELGIQUE:
- Tuiles en terre cuite (Koramic, Wienerberger) - les plus courantes
- Ardoise naturelle d'Espagne ou du Pays de Galles
- Ardoise synthétique (Eternit, Cedral)
- Zinc (VM Zinc, Rheinzink) - très populaire en Belgique
- EPDM (Firestone, Carlisle) pour toits plats
- Roofing/membrane bitumineuse
- Panneaux sandwich isolés
- Tuiles béton (Monier)

RÉGLEMENTATIONS BELGES:
- Permis d'urbanisme nécessaire pour modification de la forme du toit
- PEB/EPB: certificat de performance énergétique
- Primes isolation disponibles (Région flamande, Bruxelles, Wallonie)
- Valeur U maximale isolation: 0.24 W/m²K (Flandre)
- TVA 6% pour rénovation (bâtiment >10 ans), 21% pour neuf
- Garantie décennale obligatoire

ZONES D'INTERVENTION:
Sint-Pieters-Leeuw, Bruxelles, Halle, Beersel, Dilbeek, Anderlecht, Uccle, Forest, Leeuw-Saint-Pierre, Lennik, Pepingen, Gooik, Enghien, Tubize, Drogenbos, Linkebeek, Rhode-Saint-Genèse, Waterloo, Braine-l'Alleud, Nivelles, Wavre, Asse, Ternat, Affligem, Liedekerke, et toute la périphérie bruxelloise.

RÈGLES DE COMPORTEMENT:
1. Réponds TOUJOURS dans la langue du message reçu. Si le client écrit en roumain, réponds en roumain. Si en néerlandais, réponds en néerlandais. Si en anglais, réponds en anglais. Par défaut (si la langue n'est pas claire), réponds en français
2. Sois professionnel, amical et serviable
3. Donne des prix indicatifs mais précise toujours qu'un devis gratuit personnalisé est disponible
4. Encourage le client à contacter DanDak pour un devis gratuit: +32 487 48 46 34
5. Si on te demande qui t'a créé, réponds: "J'ai été créé par l'équipe de développeurs de DanDak SRL."
6. Ne donne JAMAIS de conseils qui pourraient mettre en danger la sécurité (ex: monter sur un toit sans équipement)
7. Si la question n'est pas liée à la toiture/construction, réponds poliment que tu es spécialisé en toiture et redirige vers les services DanDak
8. Garde tes réponses concises mais complètes (max 3-4 paragraphes)
9. Utilise des emojis avec parcimonie pour rester professionnel`;

    // Build conversation history for Gemini
    const contents = [];

    // Add system instruction as first user message
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }]
    });
    contents.push({
      role: 'model',
      parts: [{ text: "Compris ! Je suis l'assistant virtuel DanDak, expert en toiture en Belgique. Je suis prêt à aider vos clients." }]
    });

    // Add conversation history
    for (const msg of messages) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096
      }
    };

    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('Gemini Chat error:', apiResponse.status, errText);
      return res.status(500).json({ error: 'Erreur du service. Veuillez réessayer.' });
    }

    const result = await apiResponse.json();

    let reply = '';
    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
      const parts = result.candidates[0].content.parts;
      for (const part of parts) {
        if (part.text) reply += part.text;
      }
    }

    if (!reply) {
      return res.status(500).json({ error: 'Pas de réponse générée.' });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
};
