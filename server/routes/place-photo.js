const { Router } = require('express');
const config = require('../config');

const router = Router();

/**
 * GET /api/place-photo/:ref
 * Proxy Google Place Photos to avoid leaking API key to the frontend.
 */
router.get('/:ref', async (req, res) => {
  const photoReference = req.params.ref;
  if (!photoReference) {
    return res.status(400).json({ error: 'Missing photo reference' });
  }

  if (!config.GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const params = new URLSearchParams({
    maxwidth: String(req.query.maxwidth || 400),
    photo_reference: photoReference,
    key: config.GOOGLE_API_KEY,
  });

  try {
    const url = `https://maps.googleapis.com/maps/api/place/photo?${params}`;
    const response = await fetch(url, { redirect: 'follow' });

    if (!response.ok) {
      return res.status(response.status).end();
    }

    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.warn('[place-photo] proxy failed:', err.message);
    res.status(502).end();
  }
});

module.exports = router;
