/**
 * Scenic Walk — Frontend Application
 * Simple state-driven UI with 3 screens: form, loading, results.
 */

const API_BASE = window.location.origin;
const RECENT_SEARCHES_KEY = 'scenic_walk_recent_searches_v1';
const MAX_RECENT_SEARCHES = 100;
const PREFERENCE_LABELS = {
  sea: 'Sea',
  instagram: 'Instagram',
  history: 'History',
  main_streets: 'Main Streets',
  food: 'Food',
  chill: 'Chill',
};
const DETOUR_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

// ─── State ───────────────────────────────────────────────────────────
const state = {
  screen: 'form',
  origin: '',
  destination: '',
  preference: null,
  detour: 'medium',
  maxExtraMinutes: 15,
  recentSearches: [],
  routes: null,
  pendingRatingRouteId: null,
};

// ─── DOM refs ────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const formScreen = $('#form-screen');
const loadingScreen = $('#loading-screen');
const resultsScreen = $('#results-screen');
const routeForm = $('#route-form');
const originInput = $('#origin');
const destInput = $('#destination');
const submitBtn = $('#submit-btn');
const errorMessage = $('#error-message');
const routeCards = $('#route-cards');
const routeSummary = $('#route-summary');
const ratingModal = $('#rating-modal');
const historyToggleBtn = $('#history-toggle');
const historyCount = $('#history-count');
const historyBackdrop = $('#history-backdrop');
const historyPanel = $('#history-panel');
const historyList = $('#history-list');
const closeHistoryBtn = $('#close-history');
const clearHistoryBtn = $('#clear-history');

// ─── Screen management ──────────────────────────────────────────────
function showScreen(name) {
  state.screen = name;
  formScreen.classList.toggle('active', name === 'form');
  loadingScreen.classList.toggle('active', name === 'loading');
  resultsScreen.classList.toggle('active', name === 'results');
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.classList.remove('hidden');
}

function hideError() {
  errorMessage.classList.add('hidden');
}

function setSelectedChip(containerSelector, value) {
  let selected = false;
  $$(containerSelector).forEach((chip) => {
    const isMatch = chip.dataset.value === String(value);
    chip.classList.toggle('selected', isMatch);
    if (isMatch) selected = true;
  });
  return selected;
}

function setPreference(value) {
  if (setSelectedChip('#preference-chips .chip', value)) {
    state.preference = value;
  }
}

function setDetour(value) {
  if (setSelectedChip('#detour-chips .chip', value)) {
    state.detour = value;
  }
}

function setMaxExtraMinutes(value) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return;

  const selected = setSelectedChip('#budget-chips .chip', parsed);
  if (selected) {
    state.maxExtraMinutes = parsed;
    return;
  }

  // Fallback to default if a stale recent value is not represented in chips.
  setSelectedChip('#budget-chips .chip', 15);
  state.maxExtraMinutes = 15;
}

// ─── Chip selection ─────────────────────────────────────────────────
function setupChips() {
  // Preference chips (single select, required)
  $$('#preference-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setPreference(chip.dataset.value);
    });
  });

  // Detour chips (single select, default: medium)
  $$('#detour-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setDetour(chip.dataset.value);
    });
  });

  // Max extra minutes chips (single select, default: 15)
  $$('#budget-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      setMaxExtraMinutes(chip.dataset.value);
    });
  });
}

// ─── Geolocation ────────────────────────────────────────────────────
function clearOriginOverride() {
  state.origin = '';
  originInput.disabled = false;
  $('#use-location').classList.remove('active');
}

function applyOriginValue(originValue, originDisplay) {
  if (typeof originValue !== 'string') return;

  const trimmed = originValue.trim();
  if (!trimmed) return;

  // Coordinate format: "lat,lng"
  const isCoordinateOrigin = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(trimmed);
  if (isCoordinateOrigin) {
    state.origin = trimmed;
    originInput.value = originDisplay || 'My Location';
    originInput.disabled = true;
    $('#use-location').classList.add('active');
    return;
  }

  clearOriginOverride();
  originInput.value = originDisplay || trimmed;
}

function setupGeolocation() {
  const btn = $('#use-location');
  btn.addEventListener('click', () => {
    if (originInput.disabled) {
      clearOriginOverride();
      originInput.value = '';
      return;
    }

    if (!navigator.geolocation) {
      showError('Geolocation is not supported by your browser');
      return;
    }

    btn.classList.add('active');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.origin = `${pos.coords.latitude},${pos.coords.longitude}`;
        originInput.value = 'My Location';
        originInput.disabled = true;
        hideError();
      },
      () => {
        btn.classList.remove('active');
        showError('Could not get your location. Please enter an address manually.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ─── API calls ──────────────────────────────────────────────────────
async function fetchRoutes(payload) {
  const res = await fetch(`${API_BASE}/api/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

function sendEvent(event, routeId, metadata) {
  fetch(`${API_BASE}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, routeId, metadata }),
  }).catch(() => {
    // Telemetry failures are silent
  });
}

// ─── Recent searches ────────────────────────────────────────────────
function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
}

function persistRecentSearches(items) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function saveRecentSearch({
  originValue,
  originDisplay,
  destinationValue,
  destinationDisplay,
  preference,
  detour,
  maxExtraMinutes,
}) {
  const normalizedOrigin = (originValue || '').trim();
  const normalizedDestination = (destinationValue || '').trim();
  if (!normalizedOrigin || !normalizedDestination || !preference || !detour) {
    return;
  }

  const newItem = {
    originValue: normalizedOrigin,
    originDisplay: (originDisplay || normalizedOrigin).trim(),
    destinationValue: normalizedDestination,
    destinationDisplay: (destinationDisplay || normalizedDestination).trim(),
    preference,
    detour,
    maxExtraMinutes: Number.isInteger(maxExtraMinutes) ? maxExtraMinutes : 15,
    timestamp: Date.now(),
  };

  const deduped = state.recentSearches.filter(
    (item) =>
      !(
        item.originValue === newItem.originValue &&
        item.destinationValue === newItem.destinationValue &&
        item.preference === newItem.preference &&
        item.detour === newItem.detour &&
        item.maxExtraMinutes === newItem.maxExtraMinutes
      )
  );

  state.recentSearches = [newItem, ...deduped].slice(0, MAX_RECENT_SEARCHES);
  persistRecentSearches(state.recentSearches);
  renderRecentSearches();
}

function renderRecentSearches() {
  const total = state.recentSearches.length;
  if (historyCount) {
    if (total > 0) {
      historyCount.textContent = total > 99 ? '99+' : String(total);
      historyCount.classList.remove('hidden');
    } else {
      historyCount.classList.add('hidden');
    }
  }

  if (!historyList) return;

  if (total === 0) {
    historyList.innerHTML = '<p class="history-empty">No history yet. Your searches will appear here.</p>';
    if (clearHistoryBtn) clearHistoryBtn.classList.add('hidden');
    return;
  }

  if (clearHistoryBtn) clearHistoryBtn.classList.remove('hidden');
  historyList.innerHTML = state.recentSearches
    .map((item, index) => {
      const route = `${item.originDisplay} -> ${item.destinationDisplay}`;
      const preferenceLabel = PREFERENCE_LABELS[item.preference] || item.preference || 'Preference';
      const detourLabel = DETOUR_LABELS[item.detour] || item.detour || 'Detour';
      const extraMinutes = Number.isInteger(item.maxExtraMinutes) ? item.maxExtraMinutes : 15;
      const meta = `${preferenceLabel} - ${detourLabel} detour - +${extraMinutes} min`;
      const when = formatHistoryTimestamp(item.timestamp);

      return `
        <button
          type="button"
          class="history-item"
          data-index="${index}"
          title="${escapeAttr(route)}">
          <span class="history-item-route">${escapeHtml(route)}</span>
          <span class="history-item-meta">${escapeHtml(meta)}</span>
          <span class="history-item-time">${escapeHtml(when)}</span>
        </button>
      `;
    })
    .join('');

  historyList.querySelectorAll('.history-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      const selected = state.recentSearches[index];
      if (!selected) return;
      applyRecentSearch(selected);
    });
  });
}

function formatHistoryTimestamp(timestamp) {
  const date = new Date(timestamp || 0);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function openHistoryPanel() {
  if (!historyPanel || !historyBackdrop) return;
  historyPanel.classList.add('open');
  historyBackdrop.classList.add('open');
  historyPanel.setAttribute('aria-hidden', 'false');
  historyBackdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('history-open');
  if (historyToggleBtn) historyToggleBtn.classList.add('active');
}

function closeHistoryPanel() {
  if (!historyPanel || !historyBackdrop) return;
  historyPanel.classList.remove('open');
  historyBackdrop.classList.remove('open');
  historyPanel.setAttribute('aria-hidden', 'true');
  historyBackdrop.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('history-open');
  if (historyToggleBtn) historyToggleBtn.classList.remove('active');
}

function setupHistoryPanel() {
  if (historyToggleBtn) {
    historyToggleBtn.addEventListener('click', () => {
      const isOpen = historyPanel && historyPanel.classList.contains('open');
      if (isOpen) {
        closeHistoryPanel();
      } else {
        openHistoryPanel();
      }
    });
  }

  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', closeHistoryPanel);
  }

  if (historyBackdrop) {
    historyBackdrop.addEventListener('click', closeHistoryPanel);
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      state.recentSearches = [];
      persistRecentSearches(state.recentSearches);
      renderRecentSearches();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const isOpen = historyPanel && historyPanel.classList.contains('open');
    if (isOpen) closeHistoryPanel();
  });
}

function applyRecentSearch(item) {
  applyOriginValue(item.originValue, item.originDisplay);
  destInput.value = item.destinationDisplay || item.destinationValue;
  setPreference(item.preference);
  setDetour(item.detour);
  setMaxExtraMinutes(item.maxExtraMinutes);
  showScreen('form');
  closeHistoryPanel();
  hideError();
}

function setupRecentSearches() {
  state.recentSearches = loadRecentSearches();
  renderRecentSearches();
}

// ─── Places autocomplete ────────────────────────────────────────────
let placesScriptPromise = null;

function loadPlacesScript(apiKey) {
  if (window.google && window.google.maps && window.google.maps.places) {
    return Promise.resolve();
  }
  if (placesScriptPromise) return placesScriptPromise;

  placesScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Places script'));
    document.head.appendChild(script);
  });

  return placesScriptPromise;
}

async function fetchPublicConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/public-config`);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

function getPlaceLabel(place, fallbackValue) {
  return (
    (place && place.formatted_address) ||
    (place && place.name) ||
    fallbackValue ||
    ''
  );
}

async function setupPlacesAutocomplete() {
  const cfg = await fetchPublicConfig();
  if (!cfg.googleMapsBrowserKey) {
    return;
  }

  try {
    await loadPlacesScript(cfg.googleMapsBrowserKey);
  } catch (err) {
    console.warn('[places] autocomplete init failed:', err.message);
    return;
  }

  if (!(window.google && window.google.maps && window.google.maps.places)) {
    return;
  }

  const options = {
    fields: ['formatted_address', 'name', 'geometry'],
  };

  const originAutocomplete = new window.google.maps.places.Autocomplete(originInput, options);
  const destinationAutocomplete = new window.google.maps.places.Autocomplete(destInput, options);

  originAutocomplete.addListener('place_changed', () => {
    const place = originAutocomplete.getPlace();
    clearOriginOverride();
    originInput.value = getPlaceLabel(place, originInput.value.trim());
  });

  destinationAutocomplete.addListener('place_changed', () => {
    const place = destinationAutocomplete.getPlace();
    destInput.value = getPlaceLabel(place, destInput.value.trim());
  });
}

// ─── Form submission ────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  hideError();

  // Read values
  const origin = state.origin || originInput.value.trim();
  const destination = destInput.value.trim();
  const originDisplay = originInput.value.trim() || origin;
  const destinationDisplay = destInput.value.trim() || destination;

  if (!origin) {
    showError('Please enter a starting location');
    return;
  }
  if (!destination) {
    showError('Please enter a destination');
    return;
  }
  if (!state.preference) {
    showError('Please select a preference');
    return;
  }

  // Show loading
  showScreen('loading');
  submitBtn.disabled = true;

  try {
    const data = await fetchRoutes({
      origin,
      destination,
      preference: state.preference,
      detour: state.detour,
      maxExtraMinutes: state.maxExtraMinutes,
    });

    state.routes = data;
    renderResults(data);
    saveRecentSearch({
      originValue: origin,
      originDisplay,
      destinationValue: destination,
      destinationDisplay,
      preference: state.preference,
      detour: state.detour,
      maxExtraMinutes: state.maxExtraMinutes,
    });
    sendEvent('route_generated', null, {
      origin,
      destination,
      preference: state.preference,
      detour: state.detour,
      maxExtraMinutes: state.maxExtraMinutes,
    });
    showScreen('results');
  } catch (err) {
    showScreen('form');
    showError(err.message || 'Failed to find routes. Please try again.');
  } finally {
    submitBtn.disabled = false;
  }
}

// ─── Render results ─────────────────────────────────────────────────
function renderResults(data) {
  const budget = Number.isInteger(data.maxExtraMinutes)
    ? data.maxExtraMinutes
    : state.maxExtraMinutes;
  routeSummary.textContent = `${data.origin} \u2192 ${data.destination} \u00b7 Max extra: +${budget} min`;

  routeCards.innerHTML = data.routes.map((route) => buildRouteCard(route)).join('');

  // Attach click handlers to maps buttons
  routeCards.querySelectorAll('.maps-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const routeId = btn.dataset.routeId;
      const deepLink = btn.dataset.deepLink;
      handleOpenMaps(routeId, deepLink);
    });
  });
}

function buildRouteCard(route) {
  const cardClass = route.id === 'scenic' ? 'scenic' : route.id === 'scenic_plus' ? 'scenic_plus' : '';

  const extraText = route.extraMinutes > 0 ? `<span class="extra-minutes">+${route.extraMinutes} min</span>` : '';

  let highlightsHtml;
  if (route.highlights.length > 0) {
    highlightsHtml = `
      <ul class="highlights">
        ${route.highlights
          .map(
            (h) => `
          <li>
            <span class="highlight-dot">\u2022</span>
            <span><span class="highlight-name">${escapeHtml(h.name)}</span> \u2014 ${escapeHtml(h.reason)}</span>
          </li>`
          )
          .join('')}
      </ul>`;
  } else {
    highlightsHtml = route.id === 'fastest'
      ? '<p class="no-highlights">Direct route, no detours</p>'
      : '<p class="no-highlights">No scenic stops found for this route</p>';
  }

  return `
    <div class="route-card ${cardClass}">
      <div class="card-header">
        <span class="card-title">${escapeHtml(route.title)}</span>
        <div class="card-duration">
          <span class="duration-badge">${route.durationMinutes} min</span>
          ${extraText}
        </div>
      </div>
      ${highlightsHtml}
      ${route.adjustedToBudget ? '<p class="budget-note">Adjusted to fit your extra-time budget</p>' : ''}
      <button class="maps-btn"
        data-route-id="${route.id}"
        data-deep-link="${escapeAttr(route.deepLink)}">
        Open in Google Maps
      </button>
    </div>`;
}

// ─── Open Maps + Rating ─────────────────────────────────────────────
function handleOpenMaps(routeId, deepLink) {
  window.open(deepLink, '_blank');
  sendEvent('maps_opened', routeId);

  // Show rating modal after a short delay
  state.pendingRatingRouteId = routeId;
  setTimeout(() => {
    ratingModal.classList.remove('hidden');
  }, 1000);
}

function setupRating() {
  // Star hover and click
  const stars = $$('#star-rating .star');
  stars.forEach((star) => {
    star.addEventListener('mouseenter', () => {
      const val = parseInt(star.dataset.value);
      stars.forEach((s) => {
        s.classList.toggle('active', parseInt(s.dataset.value) <= val);
      });
    });

    star.addEventListener('click', () => {
      const rating = parseInt(star.dataset.value);
      sendEvent('route_rated', state.pendingRatingRouteId, { rating });
      closeRatingModal();
    });
  });

  // Reset stars on mouse leave
  $('#star-rating').addEventListener('mouseleave', () => {
    stars.forEach((s) => s.classList.remove('active'));
  });

  // Skip button
  $('#skip-rating').addEventListener('click', closeRatingModal);

  // Close on backdrop click
  $('.modal-backdrop').addEventListener('click', closeRatingModal);
}

function closeRatingModal() {
  ratingModal.classList.add('hidden');
  state.pendingRatingRouteId = null;
  // Reset stars
  $$('#star-rating .star').forEach((s) => s.classList.remove('active'));
}

// ─── Back button ────────────────────────────────────────────────────
function setupBack() {
  $('#back-btn').addEventListener('click', () => {
    showScreen('form');
  });
}

// ─── Utilities ──────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Init ───────────────────────────────────────────────────────────
function init() {
  setupChips();
  setupGeolocation();
  setupHistoryPanel();
  setupRecentSearches();
  setupPlacesAutocomplete();
  setupRating();
  setupBack();
  routeForm.addEventListener('submit', handleSubmit);
}

document.addEventListener('DOMContentLoaded', init);
