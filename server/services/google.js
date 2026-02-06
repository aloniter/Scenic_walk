const config = require('../config');

const BASE_URL = 'https://maps.googleapis.com/maps/api';

/**
 * Custom error class for Google API failures.
 */
class GoogleApiError extends Error {
  constructor(message, code, apiStatus) {
    super(message);
    this.name = 'GoogleApiError';
    this.code = code;       // HTTP status to return to the client
    this.apiStatus = apiStatus;
  }
}

/**
 * Check that the API key is configured. Throws if missing.
 */
function requireApiKey() {
  if (!config.GOOGLE_API_KEY) {
    throw new GoogleApiError(
      'Server misconfigured: missing Google API key',
      500,
      'MISSING_KEY'
    );
  }
}

/**
 * Map Google API status codes to appropriate errors.
 */
function handleApiStatus(status, context) {
  switch (status) {
    case 'OK':
    case 'ZERO_RESULTS':
      return; // handled by caller
    case 'OVER_QUERY_LIMIT':
      throw new GoogleApiError(
        'Service temporarily unavailable. Please try again in a moment.',
        503,
        status
      );
    case 'REQUEST_DENIED':
      throw new GoogleApiError('Server configuration error', 500, status);
    case 'INVALID_REQUEST':
      throw new GoogleApiError(`Invalid request: ${context}`, 400, status);
    default:
      throw new GoogleApiError(`Google API error: ${status}`, 500, status);
  }
}

/**
 * Geocode an address string to {lat, lng, formattedAddress}.
 */
async function geocode(address) {
  requireApiKey();

  const params = new URLSearchParams({
    address,
    key: config.GOOGLE_API_KEY,
  });

  const res = await fetch(`${BASE_URL}/geocode/json?${params}`);
  if (!res.ok) {
    throw new GoogleApiError('Failed to connect to geocoding service', 500, 'NETWORK');
  }

  const data = await res.json();
  handleApiStatus(data.status, `geocode "${address}"`);

  if (data.status === 'ZERO_RESULTS' || !data.results || data.results.length === 0) {
    throw new GoogleApiError(`Could not find location: ${address}`, 400, 'ZERO_RESULTS');
  }

  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  };
}

/**
 * Get walking directions between two points, optionally via waypoints.
 * Returns { durationMinutes, polyline, legs }.
 */
async function getDirections(origin, destination, waypoints) {
  requireApiKey();

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode: 'walking',
    key: config.GOOGLE_API_KEY,
  });

  if (waypoints && waypoints.length > 0) {
    const wpStr = waypoints.map((wp) => `${wp.lat},${wp.lng}`).join('|');
    params.set('waypoints', wpStr);
  }

  const res = await fetch(`${BASE_URL}/directions/json?${params}`);
  if (!res.ok) {
    throw new GoogleApiError('Failed to connect to directions service', 500, 'NETWORK');
  }

  const data = await res.json();
  handleApiStatus(data.status, 'directions');

  if (data.status === 'ZERO_RESULTS' || !data.routes || data.routes.length === 0) {
    throw new GoogleApiError(
      'No walking route found between these locations',
      400,
      'ZERO_RESULTS'
    );
  }

  const route = data.routes[0];

  // Sum duration across all legs
  const totalSeconds = route.legs.reduce((sum, leg) => sum + leg.duration.value, 0);

  return {
    durationMinutes: Math.round(totalSeconds / 60),
    polyline: route.overview_polyline.points,
    legs: route.legs,
  };
}

/**
 * Search for nearby places around a location.
 * Uses the legacy Nearby Search endpoint with a single type + keyword.
 * Returns an array of POI objects.
 */
async function nearbySearch(location, radiusM, types, keyword) {
  requireApiKey();

  // Use the first (most specific) type for the API call
  const primaryType = types[0];

  const params = new URLSearchParams({
    location: `${location.lat},${location.lng}`,
    radius: String(Math.round(radiusM)),
    type: primaryType,
    keyword: keyword,
    key: config.GOOGLE_API_KEY,
  });

  const res = await fetch(`${BASE_URL}/place/nearbysearch/json?${params}`);
  if (!res.ok) {
    throw new GoogleApiError('Failed to connect to places service', 500, 'NETWORK');
  }

  const data = await res.json();
  handleApiStatus(data.status, 'nearby search');

  if (data.status === 'ZERO_RESULTS' || !data.results) {
    return [];
  }

  return data.results.slice(0, config.PLACES_MAX_RESULTS).map((place) => ({
    placeId: place.place_id,
    name: place.name,
    location: {
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
    },
    types: place.types || [],
    rating: place.rating || 0,
    userRatingsTotal: place.user_ratings_total || 0,
    vicinity: place.vicinity || '',
  }));
}

module.exports = { geocode, getDirections, nearbySearch, GoogleApiError };
