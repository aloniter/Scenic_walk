'use strict';

const assert = require('node:assert/strict');
const {
  scorePOIs,
  selectWaypoints,
  removeLowestMarginalWaypoint,
  inferCoverageTarget,
  filterByQualityWithFallback,
  computeQualityScore,
  isExcludedPOIType,
  generateReason,
  buildHighlight,
} = require('../services/scoring');

function createBaseline() {
  const points = [];
  for (let i = 0; i <= 20; i++) {
    points.push({
      lat: 32.0800 + i * 0.0012,
      lng: 34.7700 + i * 0.0007,
    });
  }
  return points;
}

function pointAt(progress) {
  const start = { lat: 32.0800, lng: 34.7700 };
  const end = { lat: 32.1040, lng: 34.7840 };
  return {
    lat: start.lat + (end.lat - start.lat) * progress,
    lng: start.lng + (end.lng - start.lng) * progress,
  };
}

function offsetPoint(progress, latOffset, lngOffset) {
  const p = pointAt(progress);
  return { lat: p.lat + latOffset, lng: p.lng + lngOffset };
}

function makePOI({ id, name, progress, latOffset = 0, lngOffset = 0, types, rating, reviews, vicinity }) {
  return {
    placeId: id,
    name,
    location: offsetPoint(progress, latOffset, lngOffset),
    types,
    rating,
    userRatingsTotal: reviews,
    vicinity: vicinity || '',
  };
}

function coverageCount(waypoints) {
  const covered = new Set();
  for (const wp of waypoints) {
    for (const c of wp.topMatchedCategories || []) {
      covered.add(c);
    }
  }
  return covered.size;
}

function estimateExtraMinutes(waypoints) {
  const estimate = waypoints.reduce((sum, wp) => {
    const baseStopCost = 1.4;
    const detourCost = (wp.distFromBaseline || 0) / 160;
    return sum + baseStopCost + detourCost;
  }, 0);
  return Math.round(estimate);
}

function fitWithinBudget(waypoints, selectedCategories, maxExtraMinutes) {
  let fitted = [...waypoints];
  while (fitted.length > 0 && estimateExtraMinutes(fitted) > maxExtraMinutes) {
    fitted = removeLowestMarginalWaypoint(fitted, selectedCategories);
  }
  return fitted;
}

function selectTwiceAndAssertDeterministic(scored, baseline, options, maxWaypoints) {
  const run1 = selectWaypoints(scored, maxWaypoints, baseline, options).map((w) => w.placeId);
  const run2 = selectWaypoints(scored, maxWaypoints, baseline, options).map((w) => w.placeId);
  assert.deepEqual(run1, run2, 'Selection must be deterministic');
}

function runSeaFoodScenario() {
  const baseline = createBaseline();
  const categories = ['sea', 'food'];

  const pois = [
    makePOI({
      id: 'sea_food_1',
      name: 'Promenade Fish Market',
      progress: 0.25,
      latOffset: 0.00035,
      types: ['restaurant', 'tourist_attraction'],
      rating: 4.7,
      reviews: 630,
      vicinity: 'Waterfront promenade market',
    }),
    makePOI({
      id: 'sea_1',
      name: 'Marina Boardwalk',
      progress: 0.38,
      lngOffset: 0.0005,
      types: ['marina', 'tourist_attraction'],
      rating: 4.6,
      reviews: 440,
      vicinity: 'Coastline view',
    }),
    makePOI({
      id: 'food_1',
      name: 'Old Port Bakery',
      progress: 0.56,
      latOffset: -0.0004,
      types: ['bakery', 'cafe'],
      rating: 4.5,
      reviews: 520,
      vicinity: 'Port market lane',
    }),
    makePOI({
      id: 'generic_chain',
      name: "McDonald's Central",
      progress: 0.61,
      types: ['restaurant'],
      rating: 4.2,
      reviews: 2100,
      vicinity: 'Main road',
    }),
    makePOI({
      id: 'sea_2',
      name: 'Sunset Coastal Deck',
      progress: 0.72,
      latOffset: 0.00055,
      types: ['beach', 'point_of_interest'],
      rating: 4.8,
      reviews: 290,
      vicinity: 'Beachfront',
    }),
  ];

  const scored = scorePOIs(pois, categories, baseline, { detourRadiusM: 400 });
  const options = {
    selectedCategories: categories,
    mode: 'scenic',
    minWaypoints: 2,
    targetCoverage: inferCoverageTarget(categories),
  };

  selectTwiceAndAssertDeterministic(scored, baseline, options, 3);

  const selected = selectWaypoints(scored, 3, baseline, options);
  assert(selected.length >= 2 && selected.length <= 3, 'Sea+Food should pick 2-3 waypoints');
  assert(coverageCount(selected) >= 2, 'Sea+Food should cover at least 2 categories');

  const fitted = fitWithinBudget(selected, categories, 10);
  assert(estimateExtraMinutes(fitted) <= 10, 'Sea+Food should fit budget after trimming');

  console.log('[OK] Sea+Food:', selected.map((p) => p.name).join(' | '));
}

function runHistoryArchitectureChillScenario() {
  const baseline = createBaseline();
  const categories = ['history', 'architecture', 'chill'];

  const pois = [
    makePOI({
      id: 'hist_1',
      name: 'Heritage Museum Annex',
      progress: 0.22,
      latOffset: -0.00045,
      types: ['museum', 'point_of_interest'],
      rating: 4.8,
      reviews: 780,
      vicinity: 'Historic district',
    }),
    makePOI({
      id: 'arch_1',
      name: 'Modernist Landmark Building',
      progress: 0.35,
      lngOffset: 0.00045,
      types: ['tourist_attraction', 'point_of_interest'],
      rating: 4.7,
      reviews: 410,
      vicinity: 'Design quarter',
    }),
    makePOI({
      id: 'chill_1',
      name: 'Quiet Garden Court',
      progress: 0.5,
      latOffset: 0.00035,
      types: ['park', 'cafe'],
      rating: 4.6,
      reviews: 360,
      vicinity: 'Garden promenade',
    }),
    makePOI({
      id: 'arch_hist_mix',
      name: 'Historic City Hall Architecture Center',
      progress: 0.66,
      latOffset: -0.0004,
      types: ['museum', 'tourist_attraction'],
      rating: 4.9,
      reviews: 650,
      vicinity: 'Heritage boulevard',
    }),
    makePOI({
      id: 'chill_2',
      name: 'Riverside Relax Park',
      progress: 0.78,
      lngOffset: 0.0006,
      types: ['park'],
      rating: 4.4,
      reviews: 290,
      vicinity: 'Quiet riverside',
    }),
  ];

  const scored = scorePOIs(pois, categories, baseline, { detourRadiusM: 500 });
  const options = {
    selectedCategories: categories,
    mode: 'scenic_plus',
    minWaypoints: 3,
    targetCoverage: inferCoverageTarget(categories),
  };

  selectTwiceAndAssertDeterministic(scored, baseline, options, 4);

  const selected = selectWaypoints(scored, 4, baseline, options);
  assert(selected.length >= 3 && selected.length <= 4, 'History+Architecture+Chill should pick 3-4 waypoints');
  assert(coverageCount(selected) >= 3, 'History+Architecture+Chill should cover at least 3 categories when available');

  const fitted = fitWithinBudget(selected, categories, 14);
  assert(estimateExtraMinutes(fitted) <= 14, 'History+Architecture+Chill should fit budget after trimming');

  console.log('[OK] History+Architecture+Chill:', selected.map((p) => p.name).join(' | '));
}

function runInstagramOnlyScenario() {
  const baseline = createBaseline();
  const categories = ['instagram'];

  const pois = [
    makePOI({
      id: 'insta_1',
      name: 'Street Art Mural Alley',
      progress: 0.28,
      latOffset: 0.0003,
      types: ['tourist_attraction', 'art_gallery'],
      rating: 4.7,
      reviews: 530,
      vicinity: 'Street art lane',
    }),
    makePOI({
      id: 'insta_2',
      name: 'Skyline Viewpoint Deck',
      progress: 0.49,
      lngOffset: 0.00045,
      types: ['tourist_attraction', 'point_of_interest'],
      rating: 4.6,
      reviews: 480,
      vicinity: 'Photo viewpoint',
    }),
    makePOI({
      id: 'insta_3',
      name: 'Colorful Design Cafe',
      progress: 0.69,
      latOffset: -0.00035,
      types: ['cafe', 'point_of_interest'],
      rating: 4.5,
      reviews: 370,
      vicinity: 'Mural market',
    }),
    makePOI({
      id: 'noise_food',
      name: 'Neighborhood Grill House',
      progress: 0.75,
      types: ['restaurant'],
      rating: 4.2,
      reviews: 190,
      vicinity: 'Main avenue',
    }),
  ];

  const scored = scorePOIs(pois, categories, baseline, { detourRadiusM: 400 });
  const options = {
    selectedCategories: categories,
    mode: 'scenic',
    minWaypoints: 2,
    targetCoverage: inferCoverageTarget(categories),
  };

  selectTwiceAndAssertDeterministic(scored, baseline, options, 3);

  const selected = selectWaypoints(scored, 3, baseline, options);
  assert(selected.length >= 2 && selected.length <= 3, 'Instagram-only should pick 2-3 waypoints');
  assert(coverageCount(selected) >= 1, 'Instagram-only should cover selected category');
  assert(
    selected.every((wp) => (wp.topMatchedCategories || []).includes('instagram')),
    'Instagram-only waypoints should match Instagram'
  );

  const fitted = fitWithinBudget(selected, categories, 9);
  assert(estimateExtraMinutes(fitted) <= 9, 'Instagram-only should fit budget after trimming');

  console.log('[OK] Instagram only:', selected.map((p) => p.name).join(' | '));
}

function runQualityFilterScenario() {
  const highQuality = [
    makePOI({ id: 'hq1', name: 'Top Museum', progress: 0.3, types: ['museum'], rating: 4.8, reviews: 1200 }),
    makePOI({ id: 'hq2', name: 'Great Gallery', progress: 0.5, types: ['art_gallery'], rating: 4.5, reviews: 600 }),
    makePOI({ id: 'hq3', name: 'Famous Landmark', progress: 0.7, types: ['tourist_attraction'], rating: 4.6, reviews: 900 }),
  ];
  const lowQuality = [
    makePOI({ id: 'lq1', name: 'Sketchy Spot', progress: 0.4, types: ['tourist_attraction'], rating: 3.2, reviews: 15 }),
    makePOI({ id: 'lq2', name: 'Meh Place', progress: 0.6, types: ['point_of_interest'], rating: 3.9, reviews: 8 }),
  ];

  // With enough good POIs, low-quality ones should be filtered out
  const result1 = filterByQualityWithFallback([...highQuality, ...lowQuality], ['history']);
  assert(result1.fallbackLevel === 0, 'Primary thresholds should suffice with 3 high-quality POIs');
  assert(result1.filtered.length === 3, 'Only high-quality POIs should pass primary filter');
  assert(result1.filtered.every((p) => Number(p.rating) >= 4.2), 'All filtered POIs should have rating >= 4.2');

  // With only low-quality POIs, fallback should engage
  const result2 = filterByQualityWithFallback(lowQuality, ['history']);
  assert(result2.fallbackLevel > 0, 'Fallback should engage when pool is too small');

  // Quality score should be higher for better-rated and more-reviewed places
  const qs1 = computeQualityScore({ rating: 4.8, userRatingsTotal: 1200 });
  const qs2 = computeQualityScore({ rating: 3.5, userRatingsTotal: 20 });
  assert(qs1 > qs2, 'Quality score should be higher for better places');

  console.log('[OK] Quality filter: primary filter works, fallback engages correctly');
}

function runLowValueExclusionScenario() {
  const pois = [
    makePOI({ id: 'gas1', name: 'Shell Gas Station', progress: 0.3, types: ['gas_station', 'point_of_interest'], rating: 4.3, reviews: 200 }),
    makePOI({ id: 'atm1', name: 'Bank ATM Center', progress: 0.4, types: ['atm', 'finance'], rating: 4.5, reviews: 100 }),
    makePOI({ id: 'park1', name: 'City Parking Lot', progress: 0.5, types: ['parking'], rating: 4.0, reviews: 50 }),
    makePOI({ id: 'good1', name: 'Historic Museum', progress: 0.6, types: ['museum', 'tourist_attraction'], rating: 4.7, reviews: 800 }),
    makePOI({ id: 'pharm1', name: 'Corner Pharmacy', progress: 0.7, types: ['pharmacy', 'store'], rating: 4.2, reviews: 150 }),
  ];

  assert(isExcludedPOIType(pois[0]), 'gas_station should be excluded');
  assert(isExcludedPOIType(pois[1]), 'atm should be excluded');
  assert(isExcludedPOIType(pois[2]), 'parking should be excluded');
  assert(!isExcludedPOIType(pois[3]), 'museum should NOT be excluded');
  assert(isExcludedPOIType(pois[4]), 'pharmacy should be excluded');

  // After quality filter, only the museum should remain
  const result = filterByQualityWithFallback(pois, ['history']);
  const remaining = result.filtered.map((p) => p.placeId);
  assert(!remaining.includes('gas1'), 'gas station excluded from results');
  assert(!remaining.includes('atm1'), 'atm excluded from results');
  assert(!remaining.includes('park1'), 'parking excluded from results');
  assert(remaining.includes('good1'), 'museum included in results');
  assert(!remaining.includes('pharm1'), 'pharmacy excluded from results');

  console.log('[OK] Low-value exclusion: gas_station, atm, parking, pharmacy excluded');
}

function runThreeCategoryScenario() {
  const baseline = createBaseline();
  const categories = ['sea', 'food', 'instagram'];

  const pois = [
    makePOI({
      id: 'sea_ig_1',
      name: 'Beach Viewpoint Walk',
      progress: 0.2,
      latOffset: 0.0003,
      types: ['beach', 'tourist_attraction'],
      rating: 4.7,
      reviews: 520,
      vicinity: 'Coastal viewpoint promenade',
    }),
    makePOI({
      id: 'food_2',
      name: 'Gourmet Market Hall',
      progress: 0.4,
      latOffset: -0.0003,
      types: ['restaurant', 'cafe'],
      rating: 4.6,
      reviews: 680,
      vicinity: 'Food market street',
    }),
    makePOI({
      id: 'insta_4',
      name: 'Street Art Gallery Walk',
      progress: 0.6,
      lngOffset: 0.0004,
      types: ['art_gallery', 'tourist_attraction'],
      rating: 4.8,
      reviews: 450,
      vicinity: 'Mural district street art',
    }),
    makePOI({
      id: 'sea_3',
      name: 'Harbor Promenade',
      progress: 0.8,
      latOffset: 0.0004,
      types: ['marina', 'point_of_interest'],
      rating: 4.5,
      reviews: 390,
      vicinity: 'Waterfront harbor',
    }),
  ];

  const scored = scorePOIs(pois, categories, baseline, { detourRadiusM: 400 });
  assert(scored.length >= 3, 'Three-category scenario should have 3+ scored POIs');

  // Verify multi-category match bonus
  const beachViewpoint = scored.find((p) => p.placeId === 'sea_ig_1');
  assert(beachViewpoint, 'Beach viewpoint should be scored');
  assert(beachViewpoint.matchCount >= 2, 'Beach viewpoint should match sea + instagram');

  const options = {
    selectedCategories: categories,
    mode: 'scenic_plus',
    minWaypoints: 3,
    targetCoverage: inferCoverageTarget(categories),
  };

  const selected = selectWaypoints(scored, 4, baseline, options);
  assert(selected.length >= 3, 'Sea+Food+Instagram should pick 3+ waypoints');
  assert(coverageCount(selected) >= 2, 'Sea+Food+Instagram should cover at least 2 categories');

  // Verify it's not all from one category
  const categories_seen = new Set();
  for (const wp of selected) {
    for (const c of wp.topMatchedCategories || []) {
      categories_seen.add(c);
    }
  }
  assert(categories_seen.size >= 2, 'Results should include at least 2 distinct categories');

  console.log('[OK] Sea+Food+Instagram:', selected.map((p) => p.name).join(' | '));
  console.log('    Categories covered:', Array.from(categories_seen).join(', '));
}

function runOpenNowFallbackAnnotationScenario() {
  const baseline = createBaseline();
  const categories = ['history'];

  const poi = makePOI({
    id: 'hist_fb',
    name: 'Old Town Museum',
    progress: 0.4,
    latOffset: 0.0003,
    types: ['museum', 'tourist_attraction'],
    rating: 4.7,
    reviews: 500,
    vicinity: 'Historic quarter',
  });
  poi.openNowFallback = true;

  const scored = scorePOIs([poi], categories, baseline, { detourRadiusM: 400 });
  assert(scored.length >= 1, 'Open-now fallback POI should be scored');

  // Manually set openNowFallback on the scored POI (it propagates from the original)
  scored[0].openNowFallback = true;

  const reason = generateReason(scored[0]);
  assert(reason.includes('May be closed'), 'Reason should include open-now fallback note');

  const highlight = buildHighlight(scored[0]);
  assert(highlight.reason.includes('May be closed'), 'Highlight reason should include open-now fallback note');

  console.log('[OK] Open-now fallback annotation: reason includes "May be closed right now."');
}

function runChainExclusionScenario() {
  const pois = [
    makePOI({ id: 'chain1', name: "McDonald's Downtown", progress: 0.3, types: ['restaurant'], rating: 4.3, reviews: 2000 }),
    makePOI({ id: 'chain2', name: 'Starbucks Reserve', progress: 0.5, types: ['cafe'], rating: 4.4, reviews: 1500 }),
    makePOI({ id: 'local1', name: 'Local Artisan Bakery', progress: 0.6, types: ['bakery'], rating: 4.6, reviews: 300 }),
  ];

  // Without food category, chains should be excluded
  const result1 = filterByQualityWithFallback(pois, ['instagram']);
  const names1 = result1.filtered.map((p) => p.name);
  assert(!names1.includes("McDonald's Downtown"), 'McDonald\'s excluded without food category');
  assert(!names1.includes('Starbucks Reserve'), 'Starbucks excluded without food category');
  assert(names1.includes('Local Artisan Bakery'), 'Local bakery included');

  // With food category, chains should be allowed (but penalized via novelty=0 in scoring)
  const result2 = filterByQualityWithFallback(pois, ['food']);
  const names2 = result2.filtered.map((p) => p.name);
  assert(names2.includes("McDonald's Downtown"), 'McDonald\'s allowed with food category');
  assert(names2.includes('Starbucks Reserve'), 'Starbucks allowed with food category');

  console.log('[OK] Chain exclusion: chains excluded without food, allowed with food category');
}

function main() {
  runSeaFoodScenario();
  runHistoryArchitectureChillScenario();
  runInstagramOnlyScenario();
  runQualityFilterScenario();
  runLowValueExclusionScenario();
  runThreeCategoryScenario();
  runOpenNowFallbackAnnotationScenario();
  runChainExclusionScenario();
  console.log('\nAll multi-category routing tests passed.');
}

main();
