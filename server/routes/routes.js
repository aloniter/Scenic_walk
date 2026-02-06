const { Router } = require('express');
const config = require('../config');
const cache = require('../services/cache');
const { geocode, getDirections, nearbySearch, GoogleApiError } = require('../services/google');
const { decodePolyline, samplePoints } = require('../services/polyline');
const { scorePOIs, selectWaypoints, generateReason } = require('../services/scoring');

const router = Router();

const VALID_PREFERENCES = Object.keys(config.PREFERENCE_MAP);
const VALID_DETOURS = Object.keys(config.DETOUR_RADIUS);

function parseMaxExtraMinutes(input) {
  if (input === undefined || input === null || input === '') {
    return config.MAX_EXTRA_MINUTES_DEFAULT;
  }

  const value = Number(input);
  if (!Number.isInteger(value)) return null;
  if (value < config.MAX_EXTRA_MINUTES_MIN || value > config.MAX_EXTRA_MINUTES_MAX) {
    return null;
  }
  return value;
}

/**
 * Build a Google Maps deep link for walking directions with optional waypoints.
 */
function buildDeepLink(origin, destination, waypoints) {
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'walking',
  });

  if (waypoints && waypoints.length > 0) {
    const wpStr = waypoints.map((wp) => `${wp.location.lat},${wp.location.lng}`).join('|');
    params.set('waypoints', wpStr);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Drop the least useful waypoint (lowest score, then highest detour distance).
 */
function removeLeastUsefulWaypoint(waypoints) {
  if (waypoints.length === 0) return [];

  let worstIndex = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const curr = waypoints[i];
    const worst = waypoints[worstIndex];
    if (curr.score < worst.score) {
      worstIndex = i;
      continue;
    }
    if (curr.score === worst.score && curr.distFromBaseline > worst.distFromBaseline) {
      worstIndex = i;
    }
  }

  return waypoints.filter((_, idx) => idx !== worstIndex);
}

/**
 * Ensure scenic route stays within the user's extra-time budget.
 * If needed, iteratively drops low-value waypoints and recalculates directions.
 */
async function fitRouteToBudget({
  label,
  originGeo,
  destGeo,
  baselineDuration,
  initialWaypoints,
  maxExtraMinutes,
}) {
  if (initialWaypoints.length === 0) {
    return { waypoints: [], directions: null, adjustedToBudget: false };
  }

  let waypoints = [...initialWaypoints];
  let adjustedToBudget = false;

  while (waypoints.length > 0) {
    const directions = await getDirections(
      originGeo,
      destGeo,
      waypoints.map((w) => w.location)
    ).catch((err) => {
      console.warn(`[directions] ${label} route failed:`, err.message);
      return null;
    });

    if (!directions) {
      adjustedToBudget = true;
      waypoints = removeLeastUsefulWaypoint(waypoints);
      continue;
    }

    const extraMinutes = Math.max(0, directions.durationMinutes - baselineDuration);
    if (extraMinutes <= maxExtraMinutes) {
      return { waypoints, directions, adjustedToBudget };
    }

    adjustedToBudget = true;
    waypoints = removeLeastUsefulWaypoint(waypoints);
  }

  return { waypoints: [], directions: null, adjustedToBudget };
}

/**
 * POST /api/routes
 * Generate 3 walking route options: Fastest, Scenic, Scenic+
 */
router.post('/', async (req, res, next) => {
  try {
    const { origin, destination, preference, detour, maxExtraMinutes: rawMaxExtraMinutes } = req.body;
    const maxExtraMinutes = parseMaxExtraMinutes(rawMaxExtraMinutes);
    const originText = typeof origin === 'string' ? origin.trim() : '';
    const destinationText = typeof destination === 'string' ? destination.trim() : '';

    // --- Step 1: Validate input ---
    if (!originText || !destinationText) {
      return res.status(400).json({ error: 'Origin and destination are required' });
    }
    if (!preference || !VALID_PREFERENCES.includes(preference)) {
      return res.status(400).json({
        error: `Invalid preference. Must be one of: ${VALID_PREFERENCES.join(', ')}`,
      });
    }
    if (!detour || !VALID_DETOURS.includes(detour)) {
      return res.status(400).json({
        error: `Invalid detour. Must be one of: ${VALID_DETOURS.join(', ')}`,
      });
    }
    if (maxExtraMinutes === null) {
      return res.status(400).json({
        error: `Invalid maxExtraMinutes. Must be an integer between ${config.MAX_EXTRA_MINUTES_MIN} and ${config.MAX_EXTRA_MINUTES_MAX}.`,
      });
    }

    const requestParams = {
      origin: originText,
      destination: destinationText,
      preference,
      detour,
      maxExtraMinutes,
    };

    // --- Step 2: Check cache ---
    const cacheKey = cache.generateKey(requestParams);
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[cache] HIT for', cacheKey);
      return res.json(cached);
    }
    console.log('[cache] MISS for', cacheKey);

    // --- Step 3: Geocode origin and destination in parallel ---
    const [originGeo, destGeo] = await Promise.all([
      geocode(requestParams.origin),
      geocode(requestParams.destination),
    ]);
    console.log('[geocode] origin:', originGeo.formattedAddress);
    console.log('[geocode] destination:', destGeo.formattedAddress);

    // --- Step 4: Get baseline (fastest) walking route ---
    const baseline = await getDirections(originGeo, destGeo);
    console.log('[directions] baseline:', baseline.durationMinutes, 'min');

    // Sanity check: route too long?
    if (baseline.durationMinutes > config.MAX_WALKING_DURATION_MIN) {
      return res.status(400).json({
        error: `Route too long for walking (${baseline.durationMinutes} min, max ${config.MAX_WALKING_DURATION_MIN}). Try closer locations.`,
      });
    }

    // --- Step 5: Decode polyline and sample points ---
    const pathPoints = decodePolyline(baseline.polyline);
    const samples = samplePoints(pathPoints, config.SAMPLE_INTERVAL_M, config.MAX_SAMPLE_POINTS);
    console.log('[polyline] sampled', samples.length, 'points from', pathPoints.length, 'total');

    // --- Step 6: Query Places for each sample point ---
    const prefConfig = config.PREFERENCE_MAP[preference];
    const baseRadius = config.DETOUR_RADIUS[detour];
    const searchRadius = Math.round(baseRadius * config.SCENIC_PLUS_RADIUS_MULTIPLIER);

    // Run all Places queries in parallel
    const placesResults = await Promise.all(
      samples.map((point) =>
        nearbySearch(point, searchRadius, prefConfig.types, prefConfig.keyword)
          .catch((err) => {
            // Don't fail the whole request if one Places call fails
            console.warn('[places] query failed for point:', point, err.message);
            return [];
          })
      )
    );

    // Flatten and deduplicate by placeId
    const seenIds = new Set();
    const allPOIs = [];
    for (const results of placesResults) {
      for (const poi of results) {
        if (!seenIds.has(poi.placeId)) {
          seenIds.add(poi.placeId);
          allPOIs.push(poi);
        }
      }
    }
    console.log('[places] found', allPOIs.length, 'unique POIs from', samples.length, 'queries');

    // --- Step 7: Score POIs ---
    const scoredPOIs = scorePOIs(allPOIs, preference, pathPoints);
    console.log('[scoring]', scoredPOIs.length, 'POIs after filtering and scoring');

    // --- Step 8: Select waypoints for Scenic (within base radius) ---
    const scenicCandidates = scoredPOIs.filter((p) => p.distFromBaseline <= baseRadius);
    const scenicWaypoints = selectWaypoints(
      scenicCandidates,
      config.SCENIC_WAYPOINTS,
      pathPoints
    );
    console.log('[scenic] selected', scenicWaypoints.length, 'waypoints');

    const scenicFit = await fitRouteToBudget({
      label: 'scenic',
      originGeo,
      destGeo,
      baselineDuration: baseline.durationMinutes,
      initialWaypoints: scenicWaypoints,
      maxExtraMinutes,
    });
    console.log('[scenic] final', scenicFit.waypoints.length, 'waypoints after budget fit');

    // --- Step 9: Select waypoints for Scenic+ (wider radius, prefer different POIs) ---
    const scenicIds = new Set(scenicFit.waypoints.map((w) => w.placeId));
    const scenicPlusWaypoints = selectWaypoints(
      scoredPOIs,
      config.SCENIC_PLUS_WAYPOINTS,
      pathPoints,
      scenicIds
    );
    console.log('[scenic+] selected', scenicPlusWaypoints.length, 'waypoints');

    const scenicPlusFit = await fitRouteToBudget({
      label: 'scenic+',
      originGeo,
      destGeo,
      baselineDuration: baseline.durationMinutes,
      initialWaypoints: scenicPlusWaypoints,
      maxExtraMinutes,
    });
    console.log('[scenic+] final', scenicPlusFit.waypoints.length, 'waypoints after budget fit');

    // --- Step 11: Build response ---
    const fastestRoute = {
      id: 'fastest',
      title: 'Fastest',
      durationMinutes: baseline.durationMinutes,
      extraMinutes: 0,
      adjustedToBudget: false,
      withinBudget: true,
      waypointCount: 0,
      highlights: [],
      deepLink: buildDeepLink(originGeo, destGeo),
    };

    const scenicDuration = scenicFit.directions
      ? scenicFit.directions.durationMinutes
      : baseline.durationMinutes;
    const scenicExtraMinutes = Math.max(0, scenicDuration - baseline.durationMinutes);
    const scenicRoute = {
      id: 'scenic',
      title: 'Scenic',
      durationMinutes: scenicDuration,
      extraMinutes: scenicExtraMinutes,
      adjustedToBudget: scenicFit.adjustedToBudget,
      withinBudget: scenicExtraMinutes <= maxExtraMinutes,
      waypointCount: scenicFit.waypoints.length,
      highlights: scenicFit.waypoints.map((wp) => ({
        name: wp.name,
        reason: generateReason(wp, preference),
      })),
      deepLink: buildDeepLink(
        originGeo,
        destGeo,
        scenicFit.waypoints.length > 0 ? scenicFit.waypoints : undefined
      ),
    };

    const scenicPlusDuration = scenicPlusFit.directions
      ? scenicPlusFit.directions.durationMinutes
      : baseline.durationMinutes;
    const scenicPlusExtraMinutes = Math.max(0, scenicPlusDuration - baseline.durationMinutes);
    const scenicPlusRoute = {
      id: 'scenic_plus',
      title: 'Scenic+',
      durationMinutes: scenicPlusDuration,
      extraMinutes: scenicPlusExtraMinutes,
      adjustedToBudget: scenicPlusFit.adjustedToBudget,
      withinBudget: scenicPlusExtraMinutes <= maxExtraMinutes,
      waypointCount: scenicPlusFit.waypoints.length,
      highlights: scenicPlusFit.waypoints.map((wp) => ({
        name: wp.name,
        reason: generateReason(wp, preference),
      })),
      deepLink: buildDeepLink(
        originGeo,
        destGeo,
        scenicPlusFit.waypoints.length > 0 ? scenicPlusFit.waypoints : undefined
      ),
    };

    const response = {
      origin: originGeo.formattedAddress,
      destination: destGeo.formattedAddress,
      maxExtraMinutes,
      routes: [fastestRoute, scenicRoute, scenicPlusRoute],
    };

    // --- Step 12: Cache and return ---
    cache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    if (err instanceof GoogleApiError) {
      return res.status(err.code).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
