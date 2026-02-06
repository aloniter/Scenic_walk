const config = require('../config');

// In-memory cache: Map<string, { data, expiresAt }>
const store = new Map();

/**
 * Build a deterministic cache key from the request body.
 * Normalizes origin/destination to lowercase trimmed strings.
 */
function generateKey(body) {
  const normalized = {
    o: body.origin.trim().toLowerCase(),
    d: body.destination.trim().toLowerCase(),
    p: body.preference,
    t: body.detour,
    m: Number.isInteger(body.maxExtraMinutes) ? body.maxExtraMinutes : config.MAX_EXTRA_MINUTES_DEFAULT,
  };
  return JSON.stringify(normalized);
}

/**
 * Retrieve a cached value. Returns null if missing or expired.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Store a value in the cache with TTL.
 * Runs lazy eviction of expired entries and caps total size.
 */
function set(key, value) {
  // Lazy sweep: remove expired entries
  const now = Date.now();
  for (const [k, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(k);
    }
  }

  // Cap at max entries — remove oldest if full
  if (store.size >= config.CACHE_MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }

  store.set(key, {
    data: value,
    expiresAt: now + config.CACHE_TTL_MS,
  });
}

module.exports = { generateKey, get, set };
