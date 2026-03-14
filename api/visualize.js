module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, service, customText } = req.body;

    if (!image || !service) {
      return res.status(400).json({
        error: 'missing_params',
        message: 'Image et service sont requis.'
      });
    }

    // Service → prompt mapping
    const servicePrompts = {
      'toiture-neuve': 'Replace the roof on this house with a brand new roof with clean modern clay tiles, straight ridge line, professional roofing installation',
      'renovation': 'Renovate the roof on this house with new tiles, fresh clean look, restored ridge and gutters',
      'velux': 'Add Velux skylight windows to the roof of this house, natural light, professional installation',
      'epdm': 'Replace the roof with a flat roof with smooth black EPDM rubber membrane, clean waterproof surface',
      'isolation': 'Add thermal insulation panels to the roof, visible between rafters, energy efficient roofing',
      'ardoise': 'Replace the roof tiles with elegant dark natural slate tiles (ardoise), premium quality in diamond pattern',
      'zinguerie': 'Add new shiny zinc gutters, zinc downpipes and zinc flashing on the roof edges of this house',
      'plateformes': 'Replace the roof with a modern flat roof platform with dark roofing membrane, neat edges'
    };

    const basePrompt = servicePrompts[service];
    if (!basePrompt) {
      return res.status(400).json({ error: 'invalid_service', message: 'Service non reconnu.' });
    }

    // Build final prompt — user text takes priority, service prompt as fallback
    let userInstruction;
    if (customText && customText.trim()) {
      userInstruction = customText.trim();
    } else {
      userInstruction = basePrompt;
    }

    // Gemini API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'config_error',
        message: 'GEMINI_API_KEY non configuré. Contactez l\'administrateur.'
      });
    }

    // Strip data URI prefix → raw base64
    const imageBase64 = image.replace(/^data:image\/\w+;base64,/, '');
    const imageMime = image.match(/^data:(image\/\w+);/)?.[1] || 'image/png';

    // Build Gemini prompt
    const editPrompt = `Edit this photo of a building/house. Apply the following modification: ${userInstruction}.
IMPORTANT: Follow the instruction EXACTLY as described. If it says "ardoise" or "slate", use natural dark slate tiles - NOT regular ceramic tiles. If it says to change brick color, change the brick/wall color - NOT the roof.
Keep everything else on the image exactly the same - same structure, same perspective, same surroundings. The result must be photorealistic and look like a real photograph.`;

    // Call Gemini 2.5 Flash Image API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          parts: [
            { text: editPrompt },
            {
              inlineData: {
                mimeType: imageMime,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    };

    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('Gemini API error:', apiResponse.status, errText);

      if (apiResponse.status === 429) {
        return res.status(429).json({
          error: 'quota_exceeded',
          message: 'Quota API dépassé. Veuillez réessayer dans quelques instants.'
        });
      }

      return res.status(500).json({
        error: 'api_error',
        message: 'Erreur lors de la génération. Veuillez réessayer.',
        details: errText
      });
    }

    const result = await apiResponse.json();

    // Extract image from Gemini response
    let resultImage = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
      const parts = result.candidates[0].content.parts;
      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/')) {
          resultImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!resultImage) {
      console.error('No image in Gemini response:', JSON.stringify(result).substring(0, 500));
      return res.status(500).json({
        error: 'no_output',
        message: 'Aucune image générée. Veuillez réessayer avec un prompt différent.'
      });
    }

    return res.status(200).json({
      success: true,
      image: resultImage
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({
      error: 'server_error',
      message: 'Erreur serveur inattendue. Veuillez réessayer.'
    });
  }
};
