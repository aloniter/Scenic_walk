'use strict';

const assert = require('node:assert/strict');
const {
  scorePOIs,
  selectWaypoints,
  removeLowestMarginalWaypoint,
  inferCoverageTarget,
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

function main() {
  runSeaFoodScenario();
  runHistoryArchitectureChillScenario();
  runInstagramOnlyScenario();
  console.log('\nAll multi-category routing tests passed.');
}

main();
