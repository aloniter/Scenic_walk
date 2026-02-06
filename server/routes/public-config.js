const { Router } = require('express');
const config = require('../config');

const router = Router();

/**
 * GET /api/public-config
 * Minimal public runtime config for browser-only integrations.
 */
router.get('/', (_req, res) => {
  res.json({
    googleMapsBrowserKey: config.GOOGLE_MAPS_BROWSER_KEY || null,
  });
});

module.exports = router;
