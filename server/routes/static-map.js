const { Router } = require('express');
const config = require('../config');

const router = Router();

/**
 * GET /api/static-map
 * Proxy Google Static Maps API to avoid leaking API key.
 * Query params: path (encoded polyline), markers (pipe-separated lat,lng pairs)
 */
router.get('/', async (req, res) => {
  if (!config.GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { path: pathParam, markers, size } = req.query;

  const params = new URLSearchParams({
    size: size || '600x200',
    scale: '2',
    maptype: 'roadmap',
    key: config.GOOGLE_API_KEY,
    style: 'feature:poi|visibility:off',
  });

  if (pathParam) {
    params.append('path', `color:0x0d63ff99|weight:4|enc:${pathParam}`);
  }

  // markers format: color:label:lat,lng|color:label:lat,lng
  if (markers) {
    const markerList = markers.split('||');
    for (const m of markerList) {
      params.append('markers', m);
    }
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/staticmap?${params}`;
    const response = await fetch(url, { redirect: 'follow' });

    if (!response.ok) {
      return res.status(response.status).end();
    }

    res.set('Content-Type', response.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=300');

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.warn('[static-map] proxy failed:', err.message);
    res.status(502).end();
  }
});

module.exports = router;
