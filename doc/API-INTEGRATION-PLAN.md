# API Integration Plan — Making Scenic Walk the Best Walking App

## Current State

Scenic Walk currently relies exclusively on **Google APIs** (Geocoding, Directions, Places Nearby Search, Maps JavaScript). The app generates three walking route variants with curated waypoints but has significant gaps:

- **No in-app map** — routes only open as Google Maps deep links
- **No visual preview** — users can't see photos of waypoints before walking
- **No weather awareness** — walking is heavily weather-dependent
- **No cultural context** — POI names with no background story
- **No accessibility/terrain info** — no elevation or difficulty data
- **No health/environment data** — no air quality awareness
- **No social proof beyond ratings** — no tips, reviews, or user-generated content

The integrations below are ranked by **impact-to-effort ratio**. Each one fills a real gap that users of a walking app would expect.

---

## Priority Overview

| # | API | Why It Matters | Effort | Impact |
|---|-----|----------------|--------|--------|
| 1 | OpenWeatherMap | Walking is weather-dependent | Low | Critical |
| 2 | Mapbox GL JS | In-app route visualization | Medium | Critical |
| 3 | Google Street View Static | Visual walk preview | Low | High |
| 4 | Wikipedia / Wikimedia | Free cultural context for landmarks | Low | High |
| 5 | Open-Elevation API | Walk difficulty & accessibility | Low | High |
| 6 | Foursquare Places | Richer POI data, tips, photos | Medium | High |
| 7 | OpenAI / Claude API | AI-narrated walk descriptions | Medium | High |
| 8 | IQAir / OpenAQ | Air quality for health-conscious walkers | Low | Medium |
| 9 | Unsplash API | Beautiful POI photos | Low | Medium |
| 10 | Sunrise-Sunset API | Golden hour & daylight planning | Very Low | Medium |

---

## 1. OpenWeatherMap API

**What it does:** Real-time weather + 3-hour forecast for the walk area.

**Why it makes the app better:**
Walking is one of the most weather-sensitive activities. No serious walking app should ignore it. Users need to know if it's about to rain, if it's dangerously hot, or if conditions are perfect. This is the single highest-impact addition because it directly affects whether a user should walk *at all*.

**Free tier:** 1,000 calls/day (more than enough).

### Step-by-Step Implementation

**Step 1 — Get an API key**
- Sign up at https://openweathermap.org/api
- Get a free API key (activates within a few hours)
- Add `OPENWEATHER_API_KEY` to your `.env` file

**Step 2 — Create the weather service**

Create `server/services/weather.js`:

```javascript
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const BASE = 'https://api.openweathermap.org/data/2.5';

async function getWeatherForRoute(lat, lng) {
  const url = `${BASE}/forecast?lat=${lat}&lon=${lng}&units=metric&cnt=4&appid=${OPENWEATHER_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const current = data.list[0];
  return {
    temp: Math.round(current.main.temp),
    feelsLike: Math.round(current.main.feels_like),
    description: current.weather[0].description,
    icon: current.weather[0].icon,
    windSpeed: current.wind.speed,
    humidity: current.main.humidity,
    rainNext3h: current.rain?.['3h'] || 0,
    walkFriendly: isWalkFriendly(current),
    forecast: data.list.slice(1).map(f => ({
      time: new Date(f.dt * 1000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
      temp: Math.round(f.main.temp),
      description: f.weather[0].description,
      icon: f.weather[0].icon,
    })),
  };
}

function isWalkFriendly(w) {
  const temp = w.main.temp;
  const wind = w.wind.speed;
  const rain = w.rain?.['3h'] || 0;
  const id = w.weather[0].id;

  if (id >= 200 && id < 300) return { ok: false, reason: 'Thunderstorm expected' };
  if (rain > 5) return { ok: false, reason: 'Heavy rain expected' };
  if (rain > 0.5) return { ok: true, reason: 'Light rain — bring an umbrella' };
  if (temp > 38) return { ok: false, reason: 'Extreme heat — avoid walking' };
  if (temp > 32) return { ok: true, reason: 'Hot — stay hydrated and seek shade' };
  if (wind > 15) return { ok: true, reason: 'Very windy — dress accordingly' };
  if (temp < 3) return { ok: true, reason: 'Near freezing — bundle up' };
  return { ok: true, reason: 'Great walking weather' };
}

module.exports = { getWeatherForRoute };
```

**Step 3 — Integrate into the route response**

In `server/routes/routes.js`, after geocoding the origin:

```javascript
const { getWeatherForRoute } = require('../services/weather');

// Inside the route handler, after geocoding:
const weather = await getWeatherForRoute(originGeo.lat, originGeo.lng);

// Add to the response object:
res.json({
  ...existingResponse,
  weather,
});
```

**Step 4 — Display on frontend**

Add a weather banner to the results screen in `web/app.js`:

```javascript
function renderWeatherBanner(weather) {
  if (!weather) return '';
  const icon = `https://openweathermap.org/img/wn/${weather.icon}.png`;
  const advisory = weather.walkFriendly;
  return `
    <div class="weather-banner ${advisory.ok ? 'weather-ok' : 'weather-warn'}">
      <img src="${icon}" alt="${weather.description}" width="40">
      <div>
        <strong>${weather.temp}°C</strong> · ${weather.description}
        <br><small>${advisory.reason}</small>
      </div>
    </div>
  `;
}
```

**Step 5 — Add `.env.example` entry**

```
OPENWEATHER_API_KEY=your_openweathermap_key_here
```

---

## 2. Mapbox GL JS — In-App Route Map

**What it does:** Renders an interactive map directly in the app showing the route, waypoints, and POIs.

**Why it makes the app better:**
Currently the app has **zero visual representation** of the route. Users must click "Open in Google Maps" to see anything. This is the biggest UX gap — every competitor (Komoot, AllTrails, Citymapper) shows the route inline. An embedded map lets users visually compare the 3 route options before committing.

**Free tier:** 50,000 map loads/month.

### Step-by-Step Implementation

**Step 1 — Get a Mapbox access token**
- Sign up at https://account.mapbox.com/
- Copy your default public token
- Add `MAPBOX_TOKEN` to `.env` and expose via `/api/public-config`

**Step 2 — Add Mapbox GL JS to the frontend**

In `web/index.html`, add to `<head>`:

```html
<link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js"></script>
```

**Step 3 — Return decoded polyline coordinates from the backend**

In `server/routes/routes.js`, the backend already decodes polylines internally. Expose the coordinate arrays in the response for each route:

```javascript
// In buildRoutePayload or the response builder:
route.polyline = decodedPolylinePoints; // Array of [lat, lng]
```

**Step 4 — Render the route map on the results screen**

Create a map container in the results section of `web/index.html`:

```html
<div id="route-map" style="width:100%; height:300px; border-radius:12px;"></div>
```

In `web/app.js`, add a map rendering function:

```javascript
function renderRouteMap(routes, mapboxToken) {
  mapboxgl.accessToken = mapboxToken;
  const map = new mapboxgl.Map({
    container: 'route-map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    bounds: getBounds(routes),
    fitBoundsOptions: { padding: 40 },
  });

  const colors = { fastest: '#888', scenic: '#2563eb', scenic_plus: '#7c3aed' };

  map.on('load', () => {
    routes.forEach(route => {
      if (!route.polyline) return;

      // GeoJSON expects [lng, lat] not [lat, lng]
      const coords = route.polyline.map(p => [p[1], p[0]]);

      map.addSource(route.id, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
      });

      map.addLayer({
        id: route.id,
        type: 'line',
        source: route.id,
        paint: {
          'line-color': colors[route.id],
          'line-width': route.id === 'fastest' ? 2 : 4,
          'line-opacity': 0.8,
        },
      });

      // Add waypoint markers
      (route.highlights || []).forEach(h => {
        new mapboxgl.Marker({ color: colors[route.id] })
          .setLngLat([h.lng, h.lat])
          .setPopup(new mapboxgl.Popup().setHTML(`<b>${h.name}</b><br>${h.reason}`))
          .addTo(map);
      });
    });
  });
}
```

**Step 5 — Add route toggle controls**

Let users toggle visibility of each route variant on the map:

```javascript
function addRouteToggle(map, routeId, label, color) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.borderLeft = `4px solid ${color}`;
  btn.onclick = () => {
    const vis = map.getLayoutProperty(routeId, 'visibility');
    map.setLayoutProperty(routeId, 'visibility', vis === 'none' ? 'visible' : 'none');
    btn.classList.toggle('route-hidden');
  };
  document.getElementById('route-toggles').appendChild(btn);
}
```

---

## 3. Google Street View Static API

**What it does:** Returns a photo of what you'd actually see standing at a given location.

**Why it makes the app better:**
This is uniquely powerful for a *walking* app. Users want to know "what will I actually see?" before committing to a 45-minute detour. Street View gives them an honest preview — not a stock photo, but the real view from that exact spot. No other data source provides this.

**Pricing:** Uses your existing Google API key. $7 per 1,000 requests (first $200/month free).

### Step-by-Step Implementation

**Step 1 — Build the Street View URL on the backend**

In `server/routes/routes.js`, when building highlight objects:

```javascript
function streetViewUrl(lat, lng, apiKey) {
  return `https://maps.googleapis.com/maps/api/streetview`
    + `?size=400x200&location=${lat},${lng}`
    + `&fov=100&pitch=5&key=${apiKey}`;
}

// When building each highlight:
highlight.streetViewUrl = streetViewUrl(poi.lat, poi.lng, process.env.GOOGLE_API_KEY);
```

**Step 2 — Display in route cards on the frontend**

In the highlight rendering section of `web/app.js`:

```javascript
function renderHighlight(h) {
  return `
    <div class="highlight-card">
      <img src="${h.streetViewUrl}" alt="${h.name}" class="street-view-img" loading="lazy">
      <div class="highlight-info">
        <strong>${h.name}</strong>
        <span>${h.reason}</span>
      </div>
    </div>
  `;
}
```

**Step 3 — Style the preview cards**

In `web/styles.css`:

```css
.street-view-img {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 8px 8px 0 0;
}

.highlight-card {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  margin-bottom: 8px;
}
```

**Why Street View beats stock photos:** It's location-accurate, always available (Google's coverage is massive), and gives users genuine expectations — they see the actual street, not an idealized image.

---

## 4. Wikipedia / Wikimedia API

**What it does:** Fetches a short summary and link for landmarks, neighborhoods, and historical sites.

**Why it makes the app better:**
The History & Architecture category currently shows POI names and Google ratings — but no actual *history*. Wikipedia provides free, rich cultural context. When a user sees "Jaffa Clock Tower" as a waypoint, they should also see: *"Built in 1903 to honor Sultan Abdul Hamid II's jubilee, one of seven clock towers built across the Ottoman Empire."* This transforms the app from a route planner into a walking *experience*.

**Free tier:** Unlimited (Wikimedia REST API is free and requires no key).

### Step-by-Step Implementation

**Step 1 — Create Wikipedia service**

Create `server/services/wikipedia.js`:

```javascript
const WIKI_API = 'https://en.wikipedia.org/api/rest_v1';

async function getNearbySummary(lat, lng, name) {
  // Strategy 1: Search by name (most accurate)
  try {
    const searchUrl = `${WIKI_API}/page/summary/${encodeURIComponent(name)}`;
    const res = await fetch(searchUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.extract) {
        return {
          summary: truncate(data.extract, 150),
          url: data.content_urls?.desktop?.page || null,
          thumbnail: data.thumbnail?.source || null,
        };
      }
    }
  } catch { /* fall through */ }

  // Strategy 2: Geosearch for nearby articles
  try {
    const geoUrl = `https://en.wikipedia.org/w/api.php?action=query`
      + `&list=geosearch&gscoord=${lat}|${lng}&gsradius=500&gslimit=3&format=json`;
    const res = await fetch(geoUrl);
    if (res.ok) {
      const data = await res.json();
      const pages = data.query?.geosearch || [];
      if (pages.length > 0) {
        const page = pages[0];
        const summaryRes = await fetch(`${WIKI_API}/page/summary/${encodeURIComponent(page.title)}`);
        if (summaryRes.ok) {
          const summary = await summaryRes.json();
          return {
            summary: truncate(summary.extract, 150),
            url: summary.content_urls?.desktop?.page || null,
            thumbnail: summary.thumbnail?.source || null,
          };
        }
      }
    }
  } catch { /* no wiki data available */ }

  return null;
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, text.lastIndexOf(' ', maxLen)) + '...';
}

module.exports = { getNearbySummary };
```

**Step 2 — Enrich highlights for History & Architecture waypoints**

In `server/routes/routes.js`, after selecting waypoints:

```javascript
const { getNearbySummary } = require('../services/wikipedia');

// For each highlight, especially history/architecture:
for (const highlight of route.highlights) {
  const wiki = await getNearbySummary(highlight.lat, highlight.lng, highlight.name);
  if (wiki) {
    highlight.wikiSummary = wiki.summary;
    highlight.wikiUrl = wiki.url;
    highlight.wikiThumbnail = wiki.thumbnail;
  }
}
```

**Step 3 — Display on frontend**

```javascript
// In the highlight rendering:
const wikiHtml = h.wikiSummary
  ? `<p class="wiki-summary">${h.wikiSummary}
     ${h.wikiUrl ? `<a href="${h.wikiUrl}" target="_blank">Read more</a>` : ''}</p>`
  : '';
```

---

## 5. Open-Elevation API

**What it does:** Returns elevation data for any coordinate. Lets you calculate total ascent, descent, and elevation profile.

**Why it makes the app better:**
Two routes might both be "40 minutes" but one climbs a 100m hill while the other stays flat. This matters enormously for accessibility (wheelchair, stroller, elderly), fitness goals, and general comfort. Showing "mostly flat" vs "hilly: +85m elevation" lets users make informed choices.

**Free tier:** Fully free, open-source, no API key needed.

### Step-by-Step Implementation

**Step 1 — Create elevation service**

Create `server/services/elevation.js`:

```javascript
const ELEVATION_API = 'https://api.open-elevation.com/api/v1/lookup';

async function getElevationProfile(polylinePoints) {
  // Sample every ~200m (max 50 points to avoid oversized requests)
  const sampled = samplePoints(polylinePoints, 50);

  const locations = sampled.map(p => ({ latitude: p[0], longitude: p[1] }));
  const res = await fetch(ELEVATION_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const elevations = data.results.map(r => r.elevation);

  let totalAscent = 0;
  let totalDescent = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) totalAscent += diff;
    else totalDescent += Math.abs(diff);
  }

  const min = Math.min(...elevations);
  const max = Math.max(...elevations);

  return {
    totalAscent: Math.round(totalAscent),
    totalDescent: Math.round(totalDescent),
    minElevation: Math.round(min),
    maxElevation: Math.round(max),
    elevationRange: Math.round(max - min),
    difficulty: getDifficulty(totalAscent, max - min),
    profile: elevations.map((e, i) => ({
      distance: i / (elevations.length - 1),  // 0..1 normalized
      elevation: Math.round(e),
    })),
  };
}

function getDifficulty(ascent, range) {
  if (ascent < 20 && range < 15) return 'Flat';
  if (ascent < 50) return 'Gentle';
  if (ascent < 100) return 'Moderate';
  return 'Hilly';
}

function samplePoints(points, maxCount) {
  if (points.length <= maxCount) return points;
  const step = (points.length - 1) / (maxCount - 1);
  return Array.from({ length: maxCount }, (_, i) =>
    points[Math.round(i * step)]
  );
}

module.exports = { getElevationProfile };
```

**Step 2 — Add to route response**

```javascript
const { getElevationProfile } = require('../services/elevation');

// After getting the final directions for each route variant:
route.elevation = await getElevationProfile(decodedPolyline);
```

**Step 3 — Display elevation badge and mini chart**

```javascript
function renderElevationBadge(elev) {
  if (!elev) return '';
  const icon = { Flat: '~', Gentle: '/', Moderate: '/\\', Hilly: '/\\/\\' };
  return `
    <span class="elevation-badge elevation-${elev.difficulty.toLowerCase()}">
      ${icon[elev.difficulty]} ${elev.difficulty} · +${elev.totalAscent}m
    </span>
  `;
}
```

For a mini elevation chart, use a simple inline SVG or a `<canvas>` sparkline (no library needed).

---

## 6. Foursquare Places API

**What it does:** Alternative/complementary POI data source with rich categories, tips from real visitors, and venue photos.

**Why it makes the app better:**
Google Places gives you name, rating, and type — but Foursquare gives you **tips** ("The rooftop has the best sunset view"), **detailed categories** (650+ vs Google's ~100), and **popularity data** (check-in counts, trending status). Combining both sources gives you a dramatically richer POI pool and better scoring signals.

**Free tier:** 950 API calls/day (Essential plan — no credit card needed).

### Step-by-Step Implementation

**Step 1 — Get Foursquare API key**
- Sign up at https://foursquare.com/developers
- Create a project and get your API key
- Add `FOURSQUARE_API_KEY` to `.env`

**Step 2 — Create Foursquare service**

Create `server/services/foursquare.js`:

```javascript
const FSQ_KEY = process.env.FOURSQUARE_API_KEY;
const FSQ_BASE = 'https://api.foursquare.com/v3';

// Map Scenic Walk categories to Foursquare category IDs
const CATEGORY_MAP = {
  sea:       '16032',  // Beach
  instagram: '10027',  // Arts & Entertainment > Art Gallery
  history:   '12085',  // Landmarks & Outdoors > Historic Site
  streets:   '11146',  // Shopping
  food:      '13065',  // Food
  chill:     '16032,16019',  // Park, Garden
};

async function searchPlaces(lat, lng, categories, radius = 400) {
  const catIds = categories.map(c => CATEGORY_MAP[c]).filter(Boolean).join(',');
  const url = `${FSQ_BASE}/places/search?ll=${lat},${lng}&radius=${radius}`
    + `&categories=${catIds}&limit=10&fields=name,location,rating,stats,tips,photos,categories`;

  const res = await fetch(url, {
    headers: { Authorization: FSQ_KEY, Accept: 'application/json' },
  });

  if (!res.ok) return [];
  const data = await res.json();

  return data.results.map(p => ({
    name: p.name,
    lat: p.geocodes?.main?.latitude,
    lng: p.geocodes?.main?.longitude,
    rating: p.rating ? p.rating / 2 : null,  // FSQ rates 0-10, normalize to 0-5
    totalCheckins: p.stats?.total_checkins || 0,
    tip: p.tips?.[0]?.text || null,  // Best tip
    photoUrl: p.photos?.[0]
      ? `${p.photos[0].prefix}300x200${p.photos[0].suffix}` : null,
    categories: p.categories?.map(c => c.name) || [],
    source: 'foursquare',
  }));
}

module.exports = { searchPlaces };
```

**Step 3 — Merge with Google Places results**

In the POI search phase of `server/routes/routes.js`:

```javascript
const foursquare = require('../services/foursquare');

// For each sample point, run Google and Foursquare in parallel:
const [googlePois, fsqPois] = await Promise.all([
  google.nearbySearch(lat, lng, radius, types, keyword),
  foursquare.searchPlaces(lat, lng, selectedCategories, radius),
]);

// Merge, deduplicate by proximity (within 50m = same place):
const merged = deduplicateByProximity([...googlePois, ...fsqPois], 50);
```

**Step 4 — Use tips and photos in the frontend**

Foursquare tips add a "local insider" feel:

```javascript
// In highlight card:
const tipHtml = h.tip
  ? `<blockquote class="poi-tip">"${h.tip}"</blockquote>`
  : '';
const photoHtml = h.photoUrl
  ? `<img src="${h.photoUrl}" class="poi-photo" loading="lazy">`
  : '';
```

---

## 7. Claude / OpenAI API — AI Route Narration

**What it does:** Generates a personalized, natural-language description of the walking experience.

**Why it makes the app better:**
Instead of a dry list of waypoints, users get a narrative: *"Start at Dizengoff Center and head southwest toward the sea. Your first stop is Gordon Beach — grab a bench and watch the surfers. Continue along the promenade to Alma Beach Cafe, a local favorite with fresh lemonade and sea views. Turn inland through the Neve Tzedek alleys, where you'll pass street art murals and the Suzanne Dellal Centre..."*

This transforms route data into an **experience guide**. It's the difference between a GPS and a knowledgeable local friend.

### Step-by-Step Implementation

**Step 1 — Choose a provider and get an API key**
- **Claude API** (Anthropic): https://console.anthropic.com — use `claude-haiku` for fast, cheap narration
- **OpenAI**: https://platform.openai.com — use `gpt-4o-mini` for similar speed/cost
- Add `AI_API_KEY` and `AI_PROVIDER=anthropic|openai` to `.env`

**Step 2 — Create narration service**

Create `server/services/narration.js`:

```javascript
const AI_KEY = process.env.AI_API_KEY;
const PROVIDER = process.env.AI_PROVIDER || 'anthropic';

async function generateRouteNarration(route, origin, destination, categories) {
  const waypointList = route.highlights
    .map((h, i) => `${i + 1}. ${h.name} (${h.reason})`)
    .join('\n');

  const prompt = `You are a friendly local walking guide. Write a short (3-4 sentences), `
    + `vivid walking narration for this route from ${origin} to ${destination}. `
    + `The walker is interested in: ${categories.join(', ')}. `
    + `Waypoints in order:\n${waypointList}\n\n`
    + `Be specific about what they'll see. Use sensory details. Keep it under 80 words.`;

  if (PROVIDER === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': AI_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-20250414',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || null;
  }

  if (PROVIDER === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  }

  return null;
}

module.exports = { generateRouteNarration };
```

**Step 3 — Add to Scenic and Scenic+ routes**

```javascript
const { generateRouteNarration } = require('../services/narration');

// Only narrate the scenic routes (not fastest):
if (route.highlights?.length > 0) {
  route.narration = await generateRouteNarration(route, origin, destination, categories);
}
```

**Step 4 — Display on frontend**

```javascript
const narrationHtml = route.narration
  ? `<p class="route-narration">${route.narration}</p>`
  : '';
```

**Cost estimate:** Claude Haiku at ~$0.25/M input tokens — a typical narration costs ~$0.0003 per route.

---

## 8. IQAir API — Air Quality Index

**What it does:** Returns real-time air quality data (AQI, PM2.5, dominant pollutant).

**Why it makes the app better:**
Health-conscious walkers (runners, elderly, parents with children, people with asthma) need to know if outdoor air is safe. An AQI badge on the results screen ("Good air quality — great for walking" or "Moderate — sensitive groups may want to limit outdoor time") shows the app cares about user wellbeing.

**Free tier:** 5,000 calls/month (community plan).

### Step-by-Step Implementation

**Step 1 — Get API key**
- Sign up at https://www.iqair.com/air-pollution-data-api
- Add `IQAIR_API_KEY` to `.env`

**Step 2 — Create air quality service**

Create `server/services/airquality.js`:

```javascript
const IQAIR_KEY = process.env.IQAIR_API_KEY;

async function getAirQuality(lat, lng) {
  const url = `https://api.airvisual.com/v2/nearest_city`
    + `?lat=${lat}&lon=${lng}&key=${IQAIR_KEY}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const pollution = data.data?.current?.pollution;
  if (!pollution) return null;

  const aqi = pollution.aqius;  // US AQI standard
  return {
    aqi,
    level: getAqiLevel(aqi),
    mainPollutant: pollution.mainus,
    recommendation: getWalkingRecommendation(aqi),
  };
}

function getAqiLevel(aqi) {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  return 'Very Unhealthy';
}

function getWalkingRecommendation(aqi) {
  if (aqi <= 50) return 'Perfect air for walking';
  if (aqi <= 100) return 'Acceptable — sensitive individuals should take it easy';
  if (aqi <= 150) return 'Consider a shorter walk or indoor alternatives';
  return 'Outdoor exercise not recommended today';
}

module.exports = { getAirQuality };
```

**Step 3 — Add to response and display as a simple badge alongside weather**

```javascript
const airQuality = await getAirQuality(originGeo.lat, originGeo.lng);
// Add to response: { ...response, airQuality }
```

---

## 9. Unsplash API — Beautiful POI Photos

**What it does:** Returns high-quality, freely licensed photos by search term.

**Why it makes the app better:**
When Street View isn't flattering (construction, ugly angles) or a POI is indoors (museums, cafes), Unsplash provides beautiful, curated photos. It's a good **complement** to Street View — use Unsplash as a fallback or for categories like Food & Markets where interior atmosphere matters.

**Free tier:** 50 requests/hour.

### Step-by-Step Implementation

**Step 1 — Get API key**
- Sign up at https://unsplash.com/developers
- Create an app and get your access key
- Add `UNSPLASH_ACCESS_KEY` to `.env`

**Step 2 — Create photo service**

Create `server/services/photos.js`:

```javascript
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

async function getPoiPhoto(name, category) {
  const query = `${name} ${category}`;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}`
    + `&per_page=1&orientation=landscape&client_id=${UNSPLASH_KEY}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const photo = data.results?.[0];
  if (!photo) return null;

  return {
    url: photo.urls.small,       // 400px wide
    alt: photo.alt_description,
    credit: photo.user.name,
    creditUrl: photo.user.links.html,
  };
}

module.exports = { getPoiPhoto };
```

**Step 3 — Use as fallback for Street View**

```javascript
// If street view might not be ideal (indoor POI, food venue):
if (['food', 'chill'].includes(highlight.matchedCategory)) {
  highlight.photo = await getPoiPhoto(highlight.name, highlight.matchedCategory);
}
```

---

## 10. Sunrise-Sunset API — Daylight & Golden Hour

**What it does:** Returns sunrise, sunset, golden hour, and civil twilight times for any location and date.

**Why it makes the app better:**
Walking at sunset through a seafront promenade is a completely different experience than at noon. For the Instagram & Art and Sea categories especially, golden hour matters. This API is free, requires no key, and adds a simple but delightful "Golden hour starts at 5:42 PM" note.

**Free tier:** Completely free, no key needed.

### Step-by-Step Implementation

**Step 1 — Create daylight service**

Create `server/services/daylight.js`:

```javascript
async function getDaylightInfo(lat, lng) {
  const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  if (data.status !== 'OK') return null;

  const r = data.results;
  return {
    sunrise: formatTime(r.sunrise),
    sunset: formatTime(r.sunset),
    goldenHour: formatTime(r.golden_hour),
    dayLength: r.day_length,
    isDaytime: isNowBetween(r.sunrise, r.sunset),
    isGoldenHour: isNowBetween(r.golden_hour, r.sunset),
  };
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function isNowBetween(startIso, endIso) {
  const now = Date.now();
  return now >= new Date(startIso).getTime() && now <= new Date(endIso).getTime();
}

module.exports = { getDaylightInfo };
```

**Step 2 — Add to response**

```javascript
const daylight = await getDaylightInfo(originGeo.lat, originGeo.lng);
// Add: { ...response, daylight }
```

**Step 3 — Display a subtle daylight hint on the results screen**

```javascript
if (daylight?.isGoldenHour) {
  // Show: "Golden hour right now — perfect for photos"
}
if (!daylight?.isDaytime) {
  // Show: "It's after sunset — walk safely, stick to well-lit routes"
}
```

---

## Recommended Implementation Order

Prioritized by **maximum user value with minimum complexity**:

### Phase 1 — Quick Wins (1-2 days each)
1. **OpenWeatherMap** — Every walking app needs this. Low effort, critical impact.
2. **Sunrise-Sunset** — Zero-cost, no API key, adds delight.
3. **Google Street View** — You already have the API key. Huge visual upgrade.

### Phase 2 — Core Upgrades (2-4 days each)
4. **Open-Elevation** — Free, no key, adds real functional value (accessibility).
5. **Wikipedia** — Free, no key, transforms History category from basic to rich.
6. **IQAir** — Small effort, shows you care about user health.

### Phase 3 — Premium Features (3-5 days each)
7. **Mapbox GL JS** — The biggest UX leap but requires the most frontend work.
8. **Foursquare** — Richer data, but needs careful merge logic with Google POIs.
9. **AI Narration** — The "wow factor" feature that makes routes feel personal.
10. **Unsplash** — Nice complement to Street View for indoor venues.

---

## Environment Variables Summary

After all integrations, your `.env` file will look like:

```env
# Existing
GOOGLE_API_KEY=your_server_google_api_key
GOOGLE_MAPS_BROWSER_KEY=your_browser_key
PORT=3000

# Phase 1
OPENWEATHER_API_KEY=your_openweathermap_key

# Phase 2
IQAIR_API_KEY=your_iqair_key

# Phase 3
MAPBOX_TOKEN=your_mapbox_token
FOURSQUARE_API_KEY=your_foursquare_key
AI_API_KEY=your_anthropic_or_openai_key
AI_PROVIDER=anthropic
UNSPLASH_ACCESS_KEY=your_unsplash_key
```

Note: Open-Elevation, Wikipedia, and Sunrise-Sunset require **no API keys**.

---

## What This Gets You

| Capability | Before | After |
|------------|--------|-------|
| Route visualization | Deep link only | Interactive in-app map |
| Visual preview | None | Street View + Unsplash photos |
| Weather awareness | None | Real-time weather + walk advisory |
| Cultural context | POI name + rating | Wikipedia summaries + tips |
| Terrain info | None | Elevation profile + difficulty rating |
| Air quality | None | AQI badge + health recommendation |
| Route description | Bullet list | AI-narrated walking guide |
| POI data richness | Google only | Google + Foursquare merged |
| Daylight info | None | Sunrise/sunset + golden hour |
| Social proof | Star rating only | Foursquare tips + check-in counts |

The result is a walking app that doesn't just tell you *where* to walk — it tells you *what you'll see*, *what the weather is like*, *how hard the terrain is*, *whether the air is clean*, and *wraps it all in a story*. That's what separates a route planner from the best walking experience app.
