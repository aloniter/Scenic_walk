require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const CATEGORY_MAP = {
  sea: {
    label: 'Sea',
    types: ['beach', 'marina', 'tourist_attraction', 'park'],
    keyword: 'promenade',
    keywords: ['promenade', 'waterfront', 'coast', 'beach'],
  },
  instagram: {
    label: 'Instagram & Art',
    types: ['tourist_attraction', 'point_of_interest', 'cafe', 'art_gallery', 'museum'],
    keyword: 'street art',
    keywords: ['street art', 'mural', 'viewpoint', 'photography', 'gallery', 'public art'],
  },
  history: {
    label: 'History & Architecture',
    types: ['museum', 'point_of_interest', 'tourist_attraction', 'art_gallery', 'church'],
    keyword: 'historic',
    keywords: ['historic', 'heritage', 'museum', 'old city', 'architecture', 'design', 'landmark', 'building'],
  },
  main_streets: {
    label: 'Main Streets',
    types: ['shopping_mall', 'store', 'point_of_interest', 'tourist_attraction'],
    keyword: 'boulevard',
    keywords: ['boulevard', 'avenue', 'market street', 'shopping'],
  },
  food: {
    label: 'Food & Markets',
    types: ['restaurant', 'cafe', 'bakery', 'meal_takeaway', 'shopping_mall', 'store', 'grocery_or_supermarket'],
    keyword: 'market',
    keywords: ['market', 'restaurant', 'cafe', 'bakery', 'food', 'bazaar', 'food market', 'shopping street'],
  },
  chill: {
    label: 'Chill',
    types: ['park', 'cafe', 'point_of_interest'],
    keyword: 'garden',
    keywords: ['garden', 'park', 'quiet', 'relax'],
  },
};

const CATEGORY_ALIASES = {
  art_street_art: 'instagram',
  markets: 'food',
  architecture: 'history',
};

const config = {
  PORT: process.env.PORT || 3000,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GOOGLE_MAPS_BROWSER_KEY: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_API_KEY,

  // Category → Google Places hints used for intent-mix routing.
  CATEGORY_MAP,
  CATEGORY_ALIASES,
  // Backward-compatible alias used by older frontend payloads (`preference`).
  PREFERENCE_MAP: CATEGORY_MAP,

  // Detour search radius in meters
  DETOUR_RADIUS: {
    low: 200,
    medium: 400,
    high: 700,
  },

  // User budget for scenic detour time (minutes above fastest route)
  MAX_EXTRA_MINUTES_DEFAULT: 15,
  MAX_EXTRA_MINUTES_MIN: 0,
  MAX_EXTRA_MINUTES_MAX: 45,

  // Polyline sampling
  SAMPLE_INTERVAL_M: 400,
  MAX_SAMPLE_POINTS: 8,
  MAX_CATEGORY_QUERIES: 4,

  // Waypoint limits
  MAX_WAYPOINTS: 4,
  SCENIC_WAYPOINTS: 3,
  SCENIC_PLUS_WAYPOINTS: 4,
  SCENIC_PLUS_RADIUS_MULTIPLIER: 1.5,

  // Cache
  CACHE_TTL_MS: 5 * 60 * 1000,
  CACHE_MAX_ENTRIES: 100,

  // Scoring weights
  SCORING: {
    MATCH_STRENGTH_THRESHOLD: 0.45,
    POPULARITY_REVIEWS_LOG_BASE: 5000,
    ANCHOR_TARGET_PROGRESS: 0.33,
    ANCHOR_PROGRESS_WINDOW: 0.22,
    MIN_PROJECTION_GAP_SCENIC: 0.07,
    MIN_PROJECTION_GAP_SCENIC_PLUS: 0.05,
    MAX_SAME_CATEGORY_MULTI: 2,
    SAME_CATEGORY_PENALTY: 0.4,
    EXCLUDED_ID_PENALTY: 0.55,
    SPACING_WEIGHT: 0.35,
    COVERAGE_GAIN_WEIGHT_SCENIC: 0.9,
    COVERAGE_GAIN_WEIGHT_SCENIC_PLUS: 1.2,
    SCORE_WEIGHTS: {
      POPULARITY: 1.0,
      BEST_MATCH: 1.2,
      MATCH_COUNT_BONUS: 0.6,
      DETOUR_PENALTY: 0.8,
      CROWDING_PENALTY: 0.7,
      NOVELTY_BONUS: 0.25,
    },
    MIN_RATING: 4.2,
    MIN_REVIEWS: 50,
    HARD_MIN_RATING: 4.0,
    MIN_POOL_SIZE: 3,
    EMERGENCY_MIN_POOL_SIZE: 1,
    QUALITY_SCORE_MAX: 18.5,
    QUALITY_FALLBACK_TIERS: [
      { minRating: 4.0, minReviews: 20 },
      { minRating: 3.8, minReviews: 10 },
    ],
  },

  // Low-value POI types to exclude from scenic highlights
  EXCLUDED_POI_TYPES: [
    'gas_station', 'atm', 'parking', 'convenience_store',
    'pharmacy', 'bank', 'post_office', 'transit_station',
  ],

  // Open-now fallback: if scored pool is smaller than this, retry without opennow
  OPEN_NOW_FALLBACK_MIN_POOL: 3,
  OPEN_NOW_FALLBACK_RADIUS_MULTIPLIER: 1.2,

  // Places API
  PLACES_MAX_RESULTS: 5,
  PLACES_OPEN_NOW_ONLY: true,

  // Route sanity limit
  MAX_WALKING_DURATION_MIN: 120,
};

module.exports = config;
