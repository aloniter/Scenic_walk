const { decode } = require('@googlemaps/polyline-codec');

const EARTH_RADIUS_M = 6_371_000;

/**
 * Haversine distance between two {lat, lng} points in meters.
 */
function haversineDistance(p1, p2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Decode a Google encoded polyline string into an array of {lat, lng} points.
 */
function decodePolyline(encoded) {
  const raw = decode(encoded); // returns [[lat, lng], ...]
  return raw.map(([lat, lng]) => ({ lat, lng }));
}

/**
 * Sample points along a path at the given interval.
 * Returns at most maxPoints evenly distributed samples.
 * Excludes points within 200m of the first or last point.
 */
function samplePoints(points, intervalM, maxPoints) {
  if (points.length < 2) return [];

  const origin = points[0];
  const destination = points[points.length - 1];
  const samples = [];
  let accumulated = 0;

  for (let i = 1; i < points.length; i++) {
    accumulated += haversineDistance(points[i - 1], points[i]);

    if (accumulated >= intervalM) {
      // Skip points too close to origin or destination
      const distToOrigin = haversineDistance(points[i], origin);
      const distToDest = haversineDistance(points[i], destination);
      if (distToOrigin > 200 && distToDest > 200) {
        samples.push(points[i]);
      }
      accumulated = 0;
    }
  }

  // If we have more than maxPoints, redistribute evenly
  if (samples.length > maxPoints) {
    const step = samples.length / maxPoints;
    const reduced = [];
    for (let i = 0; i < maxPoints; i++) {
      reduced.push(samples[Math.floor(i * step)]);
    }
    return reduced;
  }

  return samples;
}

module.exports = { haversineDistance, decodePolyline, samplePoints };
