require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = {
  PORT: process.env.PORT || 3000,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GOOGLE_MAPS_BROWSER_KEY: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_API_KEY,

  // Preference → Google Places types + keyword
  PREFERENCE_MAP: {
    sea: { types: ['beach', 'marina', 'tourist_attraction'], keyword: 'promenade' },
    instagram: { types: ['tourist_attraction', 'point_of_interest', 'cafe', 'art_gallery'], keyword: 'street art' },
    history: { types: ['museum', 'point_of_interest', 'tourist_attraction', 'art_gallery'], keyword: 'historic' },
    main_streets: { types: ['shopping_mall', 'store', 'point_of_interest', 'tourist_attraction'], keyword: 'boulevard' },
    food: { types: ['restaurant', 'cafe', 'bakery', 'meal_takeaway'], keyword: 'market' },
    chill: { types: ['park', 'cafe', 'point_of_interest'], keyword: 'garden' },
  },

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
    TYPE_MATCH_WEIGHT: 5.0,
    KEYWORD_MATCH_WEIGHT: 3.0,
    POPULARITY_WEIGHT: 2.0,
    DETOUR_PENALTY_PER_100M: 1.0,
    DUPLICATE_CATEGORY_PENALTY: 3.0,
    MIN_RATING: 3.5,
    MIN_REVIEWS: 10,
  },

  // Places API
  PLACES_MAX_RESULTS: 5,

  // Route sanity limit
  MAX_WALKING_DURATION_MIN: 120,
};

module.exports = config;
