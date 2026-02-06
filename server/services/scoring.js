const config = require('../config');
const { haversineDistance } = require('./polyline');

const { SCORING } = config;

/**
 * Compute the minimum distance from a POI to any point on the baseline path.
 */
function minDistanceToBaseline(poi, baselinePoints) {
  let minDist = Infinity;
  let nearestBaselineIndex = 0;

  for (let i = 0; i < baselinePoints.length; i++) {
    const pt = baselinePoints[i];
    const d = haversineDistance(poi.location, pt);
    if (d < minDist) {
      minDist = d;
      nearestBaselineIndex = i;
    }
  }

  return { minDist, nearestBaselineIndex };
}

/**
 * Build cumulative distance array for baseline points.
 * cumulative[i] = distance from start to point i.
 */
function buildCumulativeDistances(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1] + haversineDistance(points[i - 1], points[i]);
  }
  return cumulative;
}

/**
 * Score all candidate POIs based on preference match, popularity, and detour cost.
 * Filters out low-quality POIs. Returns sorted array (highest score first).
 */
function scorePOIs(pois, preference, baselinePoints) {
  const prefConfig = config.PREFERENCE_MAP[preference];
  if (!prefConfig) return [];

  const scored = [];

  for (const poi of pois) {
    // Filter: skip low-quality POIs
    if (poi.rating < SCORING.MIN_RATING || poi.userRatingsTotal < SCORING.MIN_REVIEWS) {
      continue;
    }

    // Type match: does any POI type intersect with the preference types?
    const typeMatch = poi.types.some((t) => prefConfig.types.includes(t))
      ? SCORING.TYPE_MATCH_WEIGHT
      : 0;

    // Keyword bonus: does the POI name contain the preference keyword?
    const keywordMatch = poi.name.toLowerCase().includes(prefConfig.keyword.toLowerCase())
      ? SCORING.KEYWORD_MATCH_WEIGHT
      : 0;

    // Popularity: normalized rating * log-scaled reviews
    const ratingNorm = poi.rating / 5.0;
    const reviewsNorm = Math.min(Math.log10(poi.userRatingsTotal + 1) / 3, 1.0);
    const popularity = SCORING.POPULARITY_WEIGHT * ratingNorm * reviewsNorm;

    // Detour penalty: distance from baseline per 100m
    const { minDist: distFromBaseline, nearestBaselineIndex } = minDistanceToBaseline(poi, baselinePoints);
    const detourPenalty = SCORING.DETOUR_PENALTY_PER_100M * (distFromBaseline / 100);

    const score = typeMatch + keywordMatch + popularity - detourPenalty;

    scored.push({
      ...poi,
      score,
      distFromBaseline,
      nearestBaselineIndex,
      primaryType: poi.types.find((t) => prefConfig.types.includes(t)) || poi.types[0],
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Select waypoints from scored POIs maintaining monotonic order along the route.
 * Uses greedy selection by score, with duplicate-type penalty.
 *
 * @param {Array} scoredPOIs - POIs sorted by score descending
 * @param {number} maxWaypoints - Max waypoints to select
 * @param {Array} baselinePoints - Decoded baseline polyline points
 * @param {Set} [excludeIds] - PlaceIDs to deprioritize (used for Scenic+ differentiation)
 * @returns {Array} Selected waypoints sorted in route order
 */
function selectWaypoints(scoredPOIs, maxWaypoints, baselinePoints, excludeIds) {
  if (scoredPOIs.length === 0) return [];
  if (!baselinePoints || baselinePoints.length < 2) return [];

  const cumulative = buildCumulativeDistances(baselinePoints);
  const totalDistance = cumulative[cumulative.length - 1] || 1;

  // Annotate each POI with its normalized progress (0..1) along the baseline polyline.
  const annotated = scoredPOIs.map((poi) => ({
    ...poi,
    projection: cumulative[Math.min(poi.nearestBaselineIndex || 0, cumulative.length - 1)] / totalDistance,
  }));

  // Filter to POIs that are between origin and destination (projection 0.03..0.97)
  const valid = annotated.filter((p) => p.projection > 0.03 && p.projection < 0.97);

  // Split into preferred (not excluded) and deprioritized
  let preferred, deprioritized;
  if (excludeIds && excludeIds.size > 0) {
    preferred = valid.filter((p) => !excludeIds.has(p.placeId));
    deprioritized = valid.filter((p) => excludeIds.has(p.placeId));
  } else {
    preferred = valid;
    deprioritized = [];
  }

  // Greedy select maintaining monotonic projection order
  function greedySelect(candidates, selected, maxWP) {
    for (const poi of candidates) {
      if (selected.length >= maxWP) break;

      // Check monotonic order
      const lastProjection = selected.length > 0
        ? selected[selected.length - 1].projection
        : -Infinity;

      if (poi.projection <= lastProjection) continue;

      // Apply duplicate-type penalty check
      const hasDuplicateType = selected.some((s) => s.primaryType === poi.primaryType);
      if (hasDuplicateType) {
        // Still allow it but with an effective score penalty — skip if better options remain
        const remaining = candidates.filter(
          (c) =>
            c.projection > poi.projection &&
            !selected.some((s) => s.primaryType === c.primaryType)
        );
        if (remaining.length > 0 && selected.length < maxWP - 1) {
          continue;
        }
      }

      selected.push(poi);
    }
    return selected;
  }

  // First pass: preferred candidates
  let selected = greedySelect(preferred, [], maxWaypoints);

  // Second pass: if not enough, fill from deprioritized
  if (selected.length < maxWaypoints && deprioritized.length > 0) {
    selected = greedySelect(deprioritized, selected, maxWaypoints);
  }

  // Sort selected by projection (origin → destination order)
  selected.sort((a, b) => a.projection - b.projection);

  return selected;
}

/**
 * Generate a one-line reason for why a POI was selected.
 */
function generateReason(poi, preference) {
  const labels = {
    sea: 'waterfront pick',
    instagram: 'photo-friendly stop',
    history: 'historic stop',
    main_streets: 'main-street highlight',
    food: 'food stop',
    chill: 'relaxing stop',
  };

  const roundedRating = poi.rating ? poi.rating.toFixed(1) : 'N/A';
  const detourMeters = Math.round(poi.distFromBaseline || 0);
  return `${labels[preference] || 'notable stop'} - ${roundedRating}\u2605 - ~${detourMeters}m off route`;
}

module.exports = { scorePOIs, selectWaypoints, generateReason };
