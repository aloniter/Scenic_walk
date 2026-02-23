const config = require('../config');
const { haversineDistance } = require('./polyline');

const { SCORING } = config;
const CATEGORY_MAP = config.CATEGORY_MAP || config.PREFERENCE_MAP;
const CATEGORY_ALIASES = config.CATEGORY_ALIASES || {};

const GENERIC_CHAIN_PATTERNS = [
  /\bstarbucks\b/i,
  /\bmcdonald'?s\b/i,
  /\bburger king\b/i,
  /\bsubway\b/i,
  /\bkfc\b/i,
  /\bpizza hut\b/i,
  /\bdomino'?s\b/i,
  /\bcosta coffee\b/i,
  /\bdunkin\b/i,
  /\b(7-eleven|am\s*pm)\b/i,
  /\btim horton'?s\b/i,
  /\bpret a manger\b/i,
  /\bpapa john'?s\b/i,
  /\bchick-fil-a\b/i,
  /\bwendy'?s\b/i,
  /\btaco bell\b/i,
  /\bfive guys\b/i,
  /\bpanera\s*bread\b/i,
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeCategories(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const normalizedList = [];

  for (const raw of list) {
    const normalizedValue = String(raw || '').trim().toLowerCase();
    const key = CATEGORY_ALIASES[normalizedValue] || normalizedValue;
    if (!key || !CATEGORY_MAP[key] || seen.has(key)) continue;
    seen.add(key);
    normalizedList.push(key);
  }

  return normalizedList;
}

function categoryLabel(category) {
  return (CATEGORY_MAP[category] && CATEGORY_MAP[category].label) || category;
}

function toSentenceList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

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

function getKeywords(categoryConfig) {
  if (!categoryConfig) return [];
  if (Array.isArray(categoryConfig.keywords) && categoryConfig.keywords.length > 0) {
    return categoryConfig.keywords.map((k) => String(k).toLowerCase()).filter(Boolean);
  }
  if (categoryConfig.keyword) {
    return [String(categoryConfig.keyword).toLowerCase()];
  }
  return [];
}

function isGenericChain(name) {
  if (!name) return false;
  return GENERIC_CHAIN_PATTERNS.some((re) => re.test(name));
}

function isExcludedPOIType(poi) {
  const excludedTypes = config.EXCLUDED_POI_TYPES || [];
  if (excludedTypes.length === 0) return false;
  return (poi.types || []).some((t) => excludedTypes.includes(t));
}

function computeQualityScore(poi) {
  const rating = clamp(Number(poi.rating) || 0, 0, 5);
  const reviews = Math.max(0, Number(poi.userRatingsTotal) || 0);
  const raw = rating * Math.log10(reviews + 1);
  const maxVal = SCORING.QUALITY_SCORE_MAX || 18.5;
  return clamp(raw / maxVal, 0, 1);
}

/**
 * Filter POIs by quality with stepwise fallback.
 * Returns { filtered, fallbackLevel } where fallbackLevel 0 = primary thresholds met.
 */
function filterByQualityWithFallback(pois, selectedCategories) {
  const minRating = SCORING.MIN_RATING;
  const minReviews = SCORING.MIN_REVIEWS;
  const hardMinRating = SCORING.HARD_MIN_RATING || 4.0;
  const minPool = SCORING.MIN_POOL_SIZE || 3;
  const emergencyMinPool = SCORING.EMERGENCY_MIN_POOL_SIZE || 1;
  const tiers = SCORING.QUALITY_FALLBACK_TIERS || [];

  const hasFoodOrStreets = (selectedCategories || []).some(
    (c) => c === 'food' || c === 'main_streets'
  );

  // Pre-filter: exclude low-value types and chains
  const candidates = (pois || []).filter((poi) => {
    if (isExcludedPOIType(poi)) return false;
    if (isGenericChain(poi.name) && !hasFoodOrStreets) return false;
    return true;
  });

  // Try primary thresholds
  let passed = candidates.filter(
    (p) => Number(p.rating) >= minRating && Number(p.userRatingsTotal) >= minReviews
  );
  if (passed.length >= minPool) {
    return { filtered: passed, fallbackLevel: 0 };
  }

  // Try fallback tiers
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    passed = candidates.filter(
      (p) => Number(p.rating) >= tier.minRating && Number(p.userRatingsTotal) >= tier.minReviews
    );
    if (passed.length >= minPool) {
      return { filtered: passed, fallbackLevel: i + 1 };
    }
  }

  // Emergency: anything at or above hardMinRating
  passed = candidates.filter((p) => Number(p.rating) >= hardMinRating);
  if (passed.length >= emergencyMinPool) {
    return { filtered: passed, fallbackLevel: tiers.length + 1 };
  }

  // Last resort: return whatever passed type exclusions
  return { filtered: candidates, fallbackLevel: tiers.length + 2 };
}

function computePopularityScore(poi) {
  const rating = clamp(Number(poi.rating) || 0, 0, 5);
  const reviews = Math.max(0, Number(poi.userRatingsTotal) || 0);

  // Legacy normalized components
  const ratingNorm = rating / 5;
  const reviewNorm = clamp(
    Math.log10(reviews + 1) / Math.log10((SCORING.POPULARITY_REVIEWS_LOG_BASE || 5000) + 1),
    0,
    1
  );
  const legacyScore = 0.7 * ratingNorm + 0.3 * reviewNorm;

  // Quality-weighted score (rating * log10(reviews+1), normalized)
  const qualityScore = computeQualityScore(poi);

  // Blend: 60% quality, 40% legacy — quality dominates but review count still matters
  return 0.6 * qualityScore + 0.4 * legacyScore;
}

function computeCategoryMatchVector(poi, selectedCategories) {
  const nameText = String(poi.name || '').toLowerCase();
  const vicinityText = String(poi.vicinity || '').toLowerCase();
  const combinedText = `${nameText} ${vicinityText}`;

  const matchVector = {};
  const matchedDetails = [];

  for (const category of selectedCategories) {
    const cfg = CATEGORY_MAP[category];
    if (!cfg) continue;

    const typeHit = (poi.types || []).find((t) => cfg.types.includes(t));
    const keywordHit = getKeywords(cfg).find((keyword) => combinedText.includes(keyword));

    if (!typeHit && !keywordHit) {
      matchVector[category] = 0;
      continue;
    }

    const typeStrength = typeHit ? 0.8 : 0;
    const keywordStrength = keywordHit ? 0.45 : 0;
    const strength = clamp(typeStrength + keywordStrength, 0, 1.35);

    matchVector[category] = strength;
    matchedDetails.push({
      category,
      strength,
      typeHit: typeHit || null,
      keywordHit: keywordHit || null,
    });
  }

  matchedDetails.sort((a, b) => b.strength - a.strength || a.category.localeCompare(b.category));

  const bestCategoryMatchScore = matchedDetails.length > 0 ? matchedDetails[0].strength : 0;
  const matchCount = matchedDetails.filter((m) => m.strength >= SCORING.MATCH_STRENGTH_THRESHOLD).length;
  const topMatchedCategories = matchedDetails
    .filter((m) => m.strength >= SCORING.MATCH_STRENGTH_THRESHOLD)
    .map((m) => m.category);

  return {
    matchVector,
    matchedDetails,
    bestCategoryMatchScore,
    matchCount,
    topMatchedCategories,
    dominantCategory: matchedDetails.length > 0 ? matchedDetails[0].category : null,
  };
}

function spacingMetric(waypoints, minGap) {
  if (!waypoints || waypoints.length < 2) return 0;

  const sorted = [...waypoints].sort((a, b) => a.projection - b.projection);
  let total = 0;

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].projection - sorted[i - 1].projection;
    total += Math.min(gap, 0.35);
    if (gap < minGap) {
      total -= (minGap - gap) * 2;
    }
  }

  return total;
}

function getCoveredCategories(waypoints) {
  const covered = new Set();
  for (const wp of waypoints) {
    const categories = wp.topMatchedCategories || [];
    for (const c of categories) {
      covered.add(c);
    }
  }
  return covered;
}

function countCategoryCoverage(waypoints) {
  return getCoveredCategories(waypoints).size;
}

function hasTooManySameCategory(waypoints, selectedCategories) {
  if ((selectedCategories || []).length <= 1) return false;

  const counts = new Map();
  for (const wp of waypoints) {
    if (!wp.dominantCategory) continue;
    counts.set(wp.dominantCategory, (counts.get(wp.dominantCategory) || 0) + 1);
  }

  for (const count of counts.values()) {
    if (count > SCORING.MAX_SAME_CATEGORY_MULTI) {
      return true;
    }
  }

  return false;
}

function sortSelectedByProjection(waypoints) {
  return [...waypoints].sort((a, b) => a.projection - b.projection || b.score - a.score);
}

function hasInvalidSpacing(waypoints, minGap) {
  if (waypoints.length < 2) return false;
  const sorted = sortSelectedByProjection(waypoints);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].projection - sorted[i - 1].projection;
    if (gap < minGap) return true;
  }
  return false;
}

function inferCoverageTarget(selectedCategories) {
  if (selectedCategories.length >= 3) return 3;
  if (selectedCategories.length >= 2) return 2;
  return selectedCategories.length > 0 ? 1 : 0;
}

/**
 * Score all candidate POIs using intent mix, quality, and detour constraints.
 */
function scorePOIs(pois, selectedCategoriesInput, baselinePoints, options = {}) {
  if (!baselinePoints || baselinePoints.length < 2) return [];

  const selectedCategories = normalizeCategories(selectedCategoriesInput);
  if (selectedCategories.length === 0) return [];

  const detourRadiusM = Math.max(1, Number(options.detourRadiusM) || 400);
  const staged = [];

  // Apply tiered quality filter with fallback
  const { filtered: qualityPOIs, fallbackLevel } = filterByQualityWithFallback(pois, selectedCategories);

  for (const poi of qualityPOIs) {
    const matchMeta = computeCategoryMatchVector(poi, selectedCategories);
    if (matchMeta.bestCategoryMatchScore <= 0) {
      continue;
    }

    const { minDist: distFromBaseline, nearestBaselineIndex } = minDistanceToBaseline(poi, baselinePoints);
    const popularityScore = computePopularityScore(poi);
    const detourPenalty = distFromBaseline / detourRadiusM;

    staged.push({
      ...poi,
      popularityScore,
      detourPenalty,
      distFromBaseline,
      nearestBaselineIndex,
      matchVector: matchMeta.matchVector,
      matchedDetails: matchMeta.matchedDetails,
      topMatchedCategories: matchMeta.topMatchedCategories,
      dominantCategory: matchMeta.dominantCategory,
      bestCategoryMatchScore: matchMeta.bestCategoryMatchScore,
      matchCount: matchMeta.matchCount,
      primaryType: (poi.types || [])[0] || 'point_of_interest',
      noveltyBonus: isGenericChain(poi.name) ? 0 : 1,
      qualityScore: computeQualityScore(poi),
      qualityFallbackLevel: fallbackLevel,
    });
  }

  if (staged.length === 0) return [];

  const categoryFreq = new Map();
  const typeFreq = new Map();
  for (const poi of staged) {
    if (poi.dominantCategory) {
      categoryFreq.set(poi.dominantCategory, (categoryFreq.get(poi.dominantCategory) || 0) + 1);
    }
    typeFreq.set(poi.primaryType, (typeFreq.get(poi.primaryType) || 0) + 1);
  }

  const maxCategoryFreq = Math.max(1, ...categoryFreq.values(), 1);
  const maxTypeFreq = Math.max(1, ...typeFreq.values(), 1);
  const weights = SCORING.SCORE_WEIGHTS;

  const scored = staged.map((poi) => {
    const catFreq = poi.dominantCategory ? (categoryFreq.get(poi.dominantCategory) || 1) : 1;
    const typeFreqCount = typeFreq.get(poi.primaryType) || 1;

    const categoryCrowding = maxCategoryFreq > 1 ? (catFreq - 1) / (maxCategoryFreq - 1) : 0;
    const typeCrowding = maxTypeFreq > 1 ? (typeFreqCount - 1) / (maxTypeFreq - 1) : 0;
    const crowdingPenalty = (categoryCrowding + typeCrowding) / 2;

    const matchCountBonus = poi.matchCount <= 1
      ? 0
      : clamp((poi.matchCount - 1) / Math.max(1, selectedCategories.length - 1), 0, 1);

    const score =
      weights.POPULARITY * poi.popularityScore +
      weights.BEST_MATCH * poi.bestCategoryMatchScore +
      weights.MATCH_COUNT_BONUS * matchCountBonus -
      weights.DETOUR_PENALTY * poi.detourPenalty -
      weights.CROWDING_PENALTY * crowdingPenalty +
      weights.NOVELTY_BONUS * poi.noveltyBonus;

    const explainCategories = poi.matchedDetails.map((m) => {
      const reasons = [];
      if (m.typeHit) reasons.push(`type:${m.typeHit}`);
      if (m.keywordHit) reasons.push(`keyword:${m.keywordHit}`);
      return { category: m.category, strength: Number(m.strength.toFixed(3)), reasons };
    });

    return {
      ...poi,
      matchCountBonus,
      crowdingPenalty,
      score,
      explain: {
        matchedCategories: poi.topMatchedCategories,
        details: explainCategories,
      },
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.detourPenalty !== b.detourPenalty) return a.detourPenalty - b.detourPenalty;
    if ((b.userRatingsTotal || 0) !== (a.userRatingsTotal || 0)) {
      return (b.userRatingsTotal || 0) - (a.userRatingsTotal || 0);
    }
    return String(a.placeId).localeCompare(String(b.placeId));
  });

  return scored;
}

function annotateWithProjection(scoredPOIs, baselinePoints) {
  const cumulative = buildCumulativeDistances(baselinePoints);
  const totalDistance = cumulative[cumulative.length - 1] || 1;

  return scoredPOIs.map((poi) => {
    const idx = Math.min(poi.nearestBaselineIndex || 0, cumulative.length - 1);
    return {
      ...poi,
      projection: cumulative[idx] / totalDistance,
    };
  });
}

function pickAnchor(candidates) {
  if (candidates.length === 0) return null;

  const target = SCORING.ANCHOR_TARGET_PROGRESS;
  const window = SCORING.ANCHOR_PROGRESS_WINDOW;
  const inWindow = candidates.filter((c) => Math.abs(c.projection - target) <= window);
  const pool = inWindow.length > 0 ? inWindow : candidates;

  const ranked = [...pool].sort((a, b) => {
    const aAnchorScore = a.score - Math.abs(a.projection - target) * 0.8 + a.matchCountBonus * 0.2;
    const bAnchorScore = b.score - Math.abs(b.projection - target) * 0.8 + b.matchCountBonus * 0.2;

    if (bAnchorScore !== aAnchorScore) return bAnchorScore - aAnchorScore;
    if (b.score !== a.score) return b.score - a.score;
    return String(a.placeId).localeCompare(String(b.placeId));
  });

  return ranked[0] || null;
}

function selectionObjective(waypoints, targetCoverage, minGap) {
  const scoreSum = waypoints.reduce((sum, w) => sum + w.score, 0);
  const coverage = countCategoryCoverage(waypoints);
  const spacing = spacingMetric(waypoints, minGap);
  return scoreSum + coverage * 1.1 + Math.min(coverage, targetCoverage) * 0.8 + spacing * SCORING.SPACING_WEIGHT;
}

/**
 * Select waypoints with deterministic anchor+greedy+swap strategy.
 */
function selectWaypoints(scoredPOIs, maxWaypoints, baselinePoints, options = {}) {
  if (!scoredPOIs || scoredPOIs.length === 0) return [];
  if (!baselinePoints || baselinePoints.length < 2) return [];

  const selectedCategories = normalizeCategories(options.selectedCategories || []);
  if (selectedCategories.length === 0) return [];

  const mode = options.mode === 'scenic_plus' ? 'scenic_plus' : 'scenic';
  const minGap = mode === 'scenic_plus'
    ? SCORING.MIN_PROJECTION_GAP_SCENIC_PLUS
    : SCORING.MIN_PROJECTION_GAP_SCENIC;

  const hardMaxWaypoints = Math.max(1, Math.min(maxWaypoints, config.MAX_WAYPOINTS));
  const minWaypoints = Math.max(
    1,
    Math.min(
      options.minWaypoints || (mode === 'scenic_plus' ? 3 : 2),
      hardMaxWaypoints
    )
  );
  const targetCoverage = Math.max(1, Math.min(
    options.targetCoverage || inferCoverageTarget(selectedCategories),
    selectedCategories.length
  ));

  const coverageWeight = mode === 'scenic_plus'
    ? SCORING.COVERAGE_GAIN_WEIGHT_SCENIC_PLUS
    : SCORING.COVERAGE_GAIN_WEIGHT_SCENIC;

  const excludeIds = options.excludeIds instanceof Set ? options.excludeIds : new Set();

  const annotated = annotateWithProjection(scoredPOIs, baselinePoints)
    .filter((p) => p.projection > 0.03 && p.projection < 0.97)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.projection !== b.projection) return a.projection - b.projection;
      return String(a.placeId).localeCompare(String(b.placeId));
    });

  if (annotated.length === 0) return [];

  const selected = [];

  // Step A: pick deterministic anchor near the first third of the route.
  const anchor = pickAnchor(annotated);
  if (anchor) {
    selected.push(anchor);
  }

  // Step B: greedily add POIs that improve coverage and flow.
  while (selected.length < hardMaxWaypoints) {
    const coverageBefore = countCategoryCoverage(selected);
    let best = null;
    let bestMarginal = -Infinity;

    for (const candidate of annotated) {
      if (selected.some((w) => w.placeId === candidate.placeId)) continue;

      const maybe = sortSelectedByProjection([...selected, candidate]);
      if (hasInvalidSpacing(maybe, minGap)) continue;
      if (hasTooManySameCategory(maybe, selectedCategories)) continue;

      const coverageAfter = countCategoryCoverage(maybe);
      const coverageGain = Math.max(0, coverageAfter - coverageBefore);
      const duplicateCategoryPenalty = selected.some((w) => w.dominantCategory === candidate.dominantCategory)
        ? SCORING.SAME_CATEGORY_PENALTY
        : 0;
      const excludedPenalty = excludeIds.has(candidate.placeId) ? SCORING.EXCLUDED_ID_PENALTY : 0;
      const flowGain = spacingMetric(maybe, minGap) - spacingMetric(selected, minGap);

      const marginal =
        candidate.score +
        coverageGain * coverageWeight +
        flowGain * SCORING.SPACING_WEIGHT -
        duplicateCategoryPenalty -
        excludedPenalty;

      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        best = candidate;
      }
    }

    if (!best) break;
    selected.push(best);
    selected.sort((a, b) => a.projection - b.projection);
  }

  // Fill to min waypoints if possible with relaxed spacing.
  if (selected.length < minWaypoints) {
    for (const candidate of annotated) {
      if (selected.length >= minWaypoints) break;
      if (selected.some((w) => w.placeId === candidate.placeId)) continue;

      const maybe = sortSelectedByProjection([...selected, candidate]);
      if (hasInvalidSpacing(maybe, minGap * 0.65)) continue;
      if (hasTooManySameCategory(maybe, selectedCategories)) continue;
      selected.push(candidate);
      selected.sort((a, b) => a.projection - b.projection);
    }
  }

  // Step C: one coverage swap if required categories are still missing.
  const coverageNow = countCategoryCoverage(selected);
  if (selected.length > 0 && coverageNow < targetCoverage) {
    const coveredSet = getCoveredCategories(selected);
    const missing = selectedCategories.filter((c) => !coveredSet.has(c));

    if (missing.length > 0) {
      const alternatives = annotated.filter(
        (c) =>
          !selected.some((s) => s.placeId === c.placeId) &&
          missing.some((m) => c.topMatchedCategories.includes(m))
      );

      let bestSwap = null;
      let bestSwapObjective = -Infinity;

      for (const alt of alternatives) {
        for (let i = 0; i < selected.length; i++) {
          const swapped = [...selected];
          swapped[i] = alt;
          const ordered = sortSelectedByProjection(swapped);
          if (hasInvalidSpacing(ordered, minGap * 0.75)) continue;
          if (hasTooManySameCategory(ordered, selectedCategories)) continue;

          const coverageAfter = countCategoryCoverage(ordered);
          if (coverageAfter <= coverageNow) continue;

          const objective = selectionObjective(ordered, targetCoverage, minGap);
          if (objective > bestSwapObjective) {
            bestSwapObjective = objective;
            bestSwap = ordered;
          }
        }
      }

      if (bestSwap) {
        selected.length = 0;
        selected.push(...bestSwap);
      }
    }
  }

  selected.sort((a, b) => a.projection - b.projection);
  return selected.slice(0, hardMaxWaypoints);
}

function scoreWaypointMarginalValue(waypoint, waypoints, selectedCategories) {
  const selectedSet = new Set(selectedCategories);
  const waypointCategories = new Set((waypoint.topMatchedCategories || []).filter((c) => selectedSet.has(c)));

  let uniqueCoverage = 0;
  for (const category of waypointCategories) {
    const providedElsewhere = waypoints.some(
      (other) =>
        other.placeId !== waypoint.placeId &&
        (other.topMatchedCategories || []).includes(category)
    );
    if (!providedElsewhere) uniqueCoverage += 1;
  }

  return waypoint.score + uniqueCoverage * 1.25 + (waypoint.matchCountBonus || 0) * 0.5;
}

/**
 * Drop the waypoint with the lowest marginal value while preserving key coverage when possible.
 */
function removeLowestMarginalWaypoint(waypoints, selectedCategoriesInput) {
  if (!waypoints || waypoints.length === 0) return [];

  const selectedCategories = normalizeCategories(selectedCategoriesInput);
  if (waypoints.length === 1) return [];

  let worstIndex = 0;
  let worstValue = Infinity;

  for (let i = 0; i < waypoints.length; i++) {
    const value = scoreWaypointMarginalValue(waypoints[i], waypoints, selectedCategories);
    if (value < worstValue) {
      worstValue = value;
      worstIndex = i;
      continue;
    }

    if (value === worstValue && waypoints[i].distFromBaseline > waypoints[worstIndex].distFromBaseline) {
      worstIndex = i;
    }
  }

  return waypoints.filter((_, idx) => idx !== worstIndex);
}

function matchedCategoriesForOutput(poi, max = 2) {
  return (poi.topMatchedCategories || []).slice(0, max);
}

function detourDescriptor(distMeters) {
  if (distMeters <= 150) return 'minimal detour';
  if (distMeters <= 350) return 'small detour';
  return 'moderate detour';
}

/**
 * Generate a one-line reason for why a POI was selected.
 */
function generateReason(poi) {
  const matched = matchedCategoriesForOutput(poi, 2).map(categoryLabel);
  const categoryText = matched.length > 0 ? toSentenceList(matched) : 'your selected intent';
  const rating = Number(poi.rating) > 0 ? `${Number(poi.rating).toFixed(1)}★` : 'well-rated';
  const detourText = detourDescriptor(Math.round(poi.distFromBaseline || 0));
  let reason = `Matches ${categoryText} (${rating}) with ${detourText}.`;
  if (poi.qualityFallbackLevel && poi.qualityFallbackLevel > 0) {
    reason += ' Limited options nearby, relaxed filters slightly.';
  }
  if (poi.openNowFallback) {
    reason += ' May be closed right now.';
  }
  return reason;
}

function buildHighlight(poi) {
  return {
    name: poi.name,
    matched_categories: matchedCategoriesForOutput(poi, 2),
    reason: generateReason(poi),
    rating: poi.rating > 0 ? poi.rating : null,
    reviewCount: poi.userRatingsTotal || null,
    photoReference: poi.photoReference || null,
  };
}

function buildRouteSummary({
  routeId,
  extraMinutes,
  maxExtraMinutes,
  waypoints,
  selectedCategories,
}) {
  const selectedLabels = normalizeCategories(selectedCategories).map(categoryLabel);

  if (routeId === 'fastest') {
    return 'Direct fastest walk with no scenic detours.';
  }

  const covered = Array.from(getCoveredCategories(waypoints || []));
  const coveredLabels = covered.map(categoryLabel);

  if (!waypoints || waypoints.length === 0) {
    return `Stays close to the baseline route within +${maxExtraMinutes} min; not enough high-value stops to balance ${toSentenceList(selectedLabels)}.`;
  }

  const headline = coveredLabels.length > 1
    ? `Balances ${toSentenceList(coveredLabels)}`
    : `Prioritizes ${coveredLabels[0] || toSentenceList(selectedLabels)}`;

  const detourNote = `adds +${extraMinutes} min`;
  const flowNote = waypoints.length > 1
    ? `${waypoints.length} coherent stops with minimal backtracking`
    : 'one focused stop with minimal backtracking';

  return `${headline}; ${detourNote} via ${flowNote}.`;
}

module.exports = {
  scorePOIs,
  selectWaypoints,
  removeLowestMarginalWaypoint,
  inferCoverageTarget,
  buildHighlight,
  generateReason,
  buildRouteSummary,
  categoryLabel,
  normalizeCategories,
  filterByQualityWithFallback,
  computeQualityScore,
  isExcludedPOIType,
};
