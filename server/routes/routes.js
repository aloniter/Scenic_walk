const { Router } = require('express');
const config = require('../config');
const cache = require('../services/cache');
const { geocode, getDirections, nearbySearch, GoogleApiError } = require('../services/google');
const { decodePolyline, samplePoints } = require('../services/polyline');
const {
  scorePOIs,
  selectWaypoints,
  removeLowestMarginalWaypoint,
  inferCoverageTarget,
  buildHighlight,
  generateReason,
  buildRouteSummary,
  normalizeCategories,
} = require('../services/scoring');

const router = Router();

const CATEGORY_MAP = config.CATEGORY_MAP || config.PREFERENCE_MAP;
const VALID_CATEGORIES = Object.keys(CATEGORY_MAP);
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

function parseOpenNow(input) {
  if (input === undefined || input === null || input === '') {
    return config.PLACES_OPEN_NOW_ONLY !== false;
  }
  if (typeof input === 'boolean') return input;
  if (typeof input === 'number') return input !== 0;
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (['true', '1', 'yes', 'open', 'open_now'].includes(normalized)) return true;
    if (['false', '0', 'no', 'any', 'all'].includes(normalized)) return false;
  }
  return null;
}

function parseSelectedCategories({ categories, preference }) {
  const rawInput = Array.isArray(categories) && categories.length > 0
    ? categories
    : (preference ? [preference] : []);

  const normalized = rawInput
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  const invalid = normalized.filter((value) => !VALID_CATEGORIES.includes(value));
  const selected = normalizeCategories(normalized);

  return { selected, invalid };
}

function buildQueryVariants(selectedCategories) {
  const cappedCategories = selectedCategories.slice(0, config.MAX_CATEGORY_QUERIES);
  const variants = [];
  const seen = new Set();

  for (const category of cappedCategories) {
    const cfg = CATEGORY_MAP[category];
    if (!cfg) continue;

    const type = (cfg.types || [])[0];
    const keyword = cfg.keyword || (Array.isArray(cfg.keywords) ? cfg.keywords[0] : undefined);
    const cacheKey = `${type || ''}|${keyword || ''}`;
    if (seen.has(cacheKey)) continue;

    seen.add(cacheKey);
    variants.push({ category, type, keyword });
  }

  return variants;
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

function formatWaypoint(wp) {
  return {
    name: wp.name,
    location: wp.location,
    matched_categories: (wp.topMatchedCategories || []).slice(0, 2),
    reason: generateReason(wp),
  };
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
  selectedCategories,
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
      waypoints = removeLowestMarginalWaypoint(waypoints, selectedCategories);
      continue;
    }

    const extraMinutes = Math.max(0, directions.durationMinutes - baselineDuration);
    if (extraMinutes <= maxExtraMinutes) {
      return { waypoints, directions, adjustedToBudget };
    }

    adjustedToBudget = true;
    waypoints = removeLowestMarginalWaypoint(waypoints, selectedCategories);
  }

  return { waypoints: [], directions: null, adjustedToBudget };
}

function buildRoutePayload({
  id,
  title,
  baselineDuration,
  maxExtraMinutes,
  fit,
  originGeo,
  destGeo,
  selectedCategories,
}) {
  const duration = fit.directions ? fit.directions.durationMinutes : baselineDuration;
  const extraMinutes = Math.max(0, duration - baselineDuration);
  const waypoints = fit.waypoints.map(formatWaypoint).slice(0, config.MAX_WAYPOINTS);

  return {
    id,
    title,
    durationMinutes: duration,
    extraMinutes,
    adjustedToBudget: fit.adjustedToBudget,
    withinBudget: extraMinutes <= maxExtraMinutes,
    waypointCount: fit.waypoints.length,
    waypoints,
    highlights: fit.waypoints.map((wp) => buildHighlight(wp)),
    route_summary: buildRouteSummary({
      routeId: id,
      extraMinutes,
      maxExtraMinutes,
      waypoints: fit.waypoints,
      selectedCategories,
    }),
    deepLink: buildDeepLink(
      originGeo,
      destGeo,
      fit.waypoints.length > 0 ? fit.waypoints : undefined
    ),
  };
}

/**
 * POST /api/routes
 * Generate 3 walking route options: Fastest, Scenic, Scenic+
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      origin,
      destination,
      preference,
      categories,
      detour,
      maxExtraMinutes: rawMaxExtraMinutes,
      openNow: rawOpenNow,
    } = req.body;

    const maxExtraMinutes = parseMaxExtraMinutes(rawMaxExtraMinutes);
    const openNow = parseOpenNow(rawOpenNow);
    const originText = typeof origin === 'string' ? origin.trim() : '';
    const destinationText = typeof destination === 'string' ? destination.trim() : '';
    const { selected: selectedCategories, invalid: invalidCategories } = parseSelectedCategories({
      categories,
      preference,
    });

    // --- Step 1: Validate input ---
    if (!originText || !destinationText) {
      return res.status(400).json({ error: 'Origin and destination are required' });
    }
    if (selectedCategories.length === 0 || invalidCategories.length > 0) {
      return res.status(400).json({
        error: `Invalid categories. Use one or more of: ${VALID_CATEGORIES.join(', ')}`,
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
    if (openNow === null) {
      return res.status(400).json({
        error: 'Invalid openNow. Must be a boolean.',
      });
    }

    const requestParams = {
      origin: originText,
      destination: destinationText,
      categories: selectedCategories,
      preference: selectedCategories[0],
      detour,
      maxExtraMinutes,
      openNow,
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
    let samples = samplePoints(pathPoints, config.SAMPLE_INTERVAL_M, config.MAX_SAMPLE_POINTS);

    if (samples.length === 0 && pathPoints.length > 2) {
      samples = [pathPoints[Math.floor(pathPoints.length / 2)]];
    }

    console.log('[polyline] sampled', samples.length, 'points from', pathPoints.length, 'total');

    // --- Step 6: Query Places for each sample point and category variant ---
    const baseRadius = config.DETOUR_RADIUS[detour];
    const searchRadius = Math.round(baseRadius * config.SCENIC_PLUS_RADIUS_MULTIPLIER);
    const queryVariants = buildQueryVariants(selectedCategories);

    const placesRequestCache = new Map();
    const placesPromises = samples.flatMap((point) =>
      queryVariants.map((variant) => {
        const cacheKeyForQuery = [
          point.lat.toFixed(5),
          point.lng.toFixed(5),
          searchRadius,
          variant.type || '',
          variant.keyword || '',
        ].join('|');

        if (!placesRequestCache.has(cacheKeyForQuery)) {
          const promise = nearbySearch(point, searchRadius, {
            type: variant.type,
            keyword: variant.keyword,
            openNow: requestParams.openNow,
          }).catch((err) => {
            console.warn('[places] query failed:', variant.category, err.message);
            return [];
          });

          placesRequestCache.set(cacheKeyForQuery, promise);
        }

        return placesRequestCache.get(cacheKeyForQuery);
      })
    );

    const placesResults = await Promise.all(placesPromises);

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

    console.log(
      '[places] found',
      allPOIs.length,
      'unique POIs from',
      samples.length,
      'samples and',
      queryVariants.length,
      'query variants'
    );

    // --- Step 7: Score POIs for multi-category intent mix ---
    const scoredPOIs = scorePOIs(allPOIs, selectedCategories, pathPoints, {
      detourRadiusM: searchRadius,
    });
    console.log('[scoring]', scoredPOIs.length, 'POIs after filtering and scoring');

    // --- Step 8: Select waypoints for Scenic (2-3 waypoints, low detour emphasis) ---
    const coverageTarget = inferCoverageTarget(selectedCategories);
    const scenicCandidates = scoredPOIs.filter((p) => p.distFromBaseline <= baseRadius);

    let scenicWaypoints = selectWaypoints(
      scenicCandidates,
      config.SCENIC_WAYPOINTS,
      pathPoints,
      {
        selectedCategories,
        mode: 'scenic',
        minWaypoints: 2,
        targetCoverage: coverageTarget,
      }
    );

    // Fallback: if narrow-radius candidates are too sparse, relax to all scored candidates.
    if (scenicWaypoints.length === 0 && scoredPOIs.length > 0) {
      scenicWaypoints = selectWaypoints(
        scoredPOIs,
        Math.max(2, Math.min(config.SCENIC_WAYPOINTS, 3)),
        pathPoints,
        {
          selectedCategories,
          mode: 'scenic',
          minWaypoints: 1,
          targetCoverage: Math.max(1, Math.min(2, coverageTarget)),
        }
      );
    }

    console.log('[scenic] selected', scenicWaypoints.length, 'waypoints');

    const scenicFit = await fitRouteToBudget({
      label: 'scenic',
      originGeo,
      destGeo,
      baselineDuration: baseline.durationMinutes,
      initialWaypoints: scenicWaypoints,
      maxExtraMinutes,
      selectedCategories,
    });
    console.log('[scenic] final', scenicFit.waypoints.length, 'waypoints after budget fit');

    // --- Step 9: Select waypoints for Scenic+ (3-4 waypoints, broader coverage) ---
    const scenicIds = new Set(scenicFit.waypoints.map((w) => w.placeId));
    let scenicPlusWaypoints = selectWaypoints(
      scoredPOIs,
      config.SCENIC_PLUS_WAYPOINTS,
      pathPoints,
      {
        selectedCategories,
        mode: 'scenic_plus',
        minWaypoints: 3,
        targetCoverage: coverageTarget,
        excludeIds: scenicIds,
      }
    );

    if (scenicPlusWaypoints.length === 0 && scenicCandidates.length > 0) {
      scenicPlusWaypoints = selectWaypoints(
        scenicCandidates,
        config.SCENIC_PLUS_WAYPOINTS,
        pathPoints,
        {
          selectedCategories,
          mode: 'scenic_plus',
          minWaypoints: 1,
          targetCoverage: Math.max(1, Math.min(coverageTarget, 2)),
        }
      );
    }

    console.log('[scenic+] selected', scenicPlusWaypoints.length, 'waypoints');

    const scenicPlusFit = await fitRouteToBudget({
      label: 'scenic+',
      originGeo,
      destGeo,
      baselineDuration: baseline.durationMinutes,
      initialWaypoints: scenicPlusWaypoints,
      maxExtraMinutes,
      selectedCategories,
    });
    console.log('[scenic+] final', scenicPlusFit.waypoints.length, 'waypoints after budget fit');

    // --- Step 10: Build response ---
    const fastestRoute = {
      id: 'fastest',
      title: 'Fastest',
      durationMinutes: baseline.durationMinutes,
      extraMinutes: 0,
      adjustedToBudget: false,
      withinBudget: true,
      waypointCount: 0,
      waypoints: [],
      highlights: [],
      route_summary: buildRouteSummary({
        routeId: 'fastest',
        extraMinutes: 0,
        maxExtraMinutes,
        waypoints: [],
        selectedCategories,
      }),
      deepLink: buildDeepLink(originGeo, destGeo),
    };

    const scenicRoute = buildRoutePayload({
      id: 'scenic',
      title: 'Scenic',
      baselineDuration: baseline.durationMinutes,
      maxExtraMinutes,
      fit: scenicFit,
      originGeo,
      destGeo,
      selectedCategories,
    });

    const scenicPlusRoute = buildRoutePayload({
      id: 'scenic_plus',
      title: 'Scenic+',
      baselineDuration: baseline.durationMinutes,
      maxExtraMinutes,
      fit: scenicPlusFit,
      originGeo,
      destGeo,
      selectedCategories,
    });

    const response = {
      origin: originGeo.formattedAddress,
      destination: destGeo.formattedAddress,
      categories: selectedCategories,
      maxExtraMinutes,
      openNow: requestParams.openNow,
      routes: [fastestRoute, scenicRoute, scenicPlusRoute],
    };

    // --- Step 11: Cache and return ---
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
