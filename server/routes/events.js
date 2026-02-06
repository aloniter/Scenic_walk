const { Router } = require('express');
const fs = require('fs');
const path = require('path');

const router = Router();

// In-memory telemetry store (capped at 1000 entries)
const events = [];
const MAX_EVENTS = 1000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.ndjson');

const VALID_EVENTS = ['route_generated', 'maps_opened', 'route_rated'];

function initStorage() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(EVENTS_FILE)) {
      fs.writeFileSync(EVENTS_FILE, '', 'utf8');
    }
  } catch (err) {
    console.warn('[telemetry] failed to initialize storage:', err.message);
  }
}

function loadEventsFromDisk() {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return;

    const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
    const recent = lines.slice(-MAX_EVENTS);

    for (const line of recent) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore malformed lines to keep telemetry robust.
      }
    }
  } catch (err) {
    console.warn('[telemetry] failed to load existing events:', err.message);
  }
}

function persistEvent(entry) {
  try {
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn('[telemetry] failed to persist event:', err.message);
  }
}

initStorage();
loadEventsFromDisk();

/**
 * POST /api/events
 * Log a telemetry event.
 * Body: { event, routeId?, rating?, metadata? }
 */
router.post('/', (req, res) => {
  const { event, routeId, rating, metadata } = req.body;
  const metadataRating = metadata && typeof metadata.rating === 'number'
    ? metadata.rating
    : null;
  const resolvedRating = typeof rating === 'number' ? rating : metadataRating;

  if (!event || !VALID_EVENTS.includes(event)) {
    return res.status(400).json({
      error: `Invalid event. Must be one of: ${VALID_EVENTS.join(', ')}`,
    });
  }

  const entry = {
    event,
    routeId: routeId || null,
    rating: resolvedRating,
    metadata: metadata || {},
    timestamp: new Date().toISOString(),
  };

  // Log to console
  console.log('[telemetry]', JSON.stringify(entry));

  // Store in memory
  events.push(entry);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
  persistEvent(entry);

  res.json({ ok: true });
});

/**
 * GET /api/events (for debugging)
 */
router.get('/', (_req, res) => {
  res.json({ count: events.length, events });
});

/**
 * GET /api/events/summary
 * Return lightweight aggregates for product iteration.
 */
router.get('/summary', (_req, res) => {
  const byEvent = {};
  const mapsOpenedByRoute = {};
  const ratingTotalsByRoute = {};
  const ratingCountsByRoute = {};

  for (const e of events) {
    byEvent[e.event] = (byEvent[e.event] || 0) + 1;

    if (e.event === 'maps_opened' && e.routeId) {
      mapsOpenedByRoute[e.routeId] = (mapsOpenedByRoute[e.routeId] || 0) + 1;
    }

    if (e.event === 'route_rated' && e.routeId && typeof e.rating === 'number') {
      ratingTotalsByRoute[e.routeId] = (ratingTotalsByRoute[e.routeId] || 0) + e.rating;
      ratingCountsByRoute[e.routeId] = (ratingCountsByRoute[e.routeId] || 0) + 1;
    }
  }

  const avgRatingByRoute = {};
  for (const routeId of Object.keys(ratingTotalsByRoute)) {
    avgRatingByRoute[routeId] = Number(
      (ratingTotalsByRoute[routeId] / ratingCountsByRoute[routeId]).toFixed(2)
    );
  }

  res.json({
    totalEvents: events.length,
    byEvent,
    mapsOpenedByRoute,
    avgRatingByRoute,
    recentEvents: events.slice(-20).reverse(),
  });
});

module.exports = router;
