# API Integration Plan — Scenic Walk MVP

> **Philosophy: Ship free, pay later.**
> Every API below starts at $0. This plan tells you exactly when each one
> starts costing money, how much, and whether you can delay or avoid it.

---

## Your Current Google Bill (Important Context)

Before adding anything new, understand what you're already spending.
Google gives you **$200/month free credit** across all Maps Platform APIs.

Your app currently makes ~13 Google API calls per route request:

| Google API | Calls per request | Price per 1,000 | Cost per request |
|------------|:-:|:-:|:-:|
| Geocoding | 2 | $5.00 | $0.010 |
| Directions | 1 | $5.00 | $0.005 |
| Places Nearby Search | ~10 | $32.00 | $0.320 |
| **Total per route** | **~13** | | **~$0.335** |

With the $200 free credit, you get **~597 free route requests/month**.
That's ~20 routes/day — fine for MVP, but something to watch as you grow.

---

## The Plan at a Glance

| # | API | Cost | Free Limit | MVP Safe? |
|---|-----|------|-----------|:-:|
| 1 | Sunrise-Sunset | **$0 forever** | Unlimited, no key | Yes |
| 2 | Wikipedia / Wikimedia | **$0 forever** | Unlimited, no key | Yes |
| 3 | Open-Elevation | **$0 forever** | Unlimited, no key | Yes |
| 4 | OpenWeatherMap | **$0 free tier** | 1,000 calls/day | Yes |
| 5 | Mapbox GL JS | **$0 free tier** | 50,000 map loads/month | Yes |
| 6 | Foursquare Places | **$0 free tier** | 950 calls/day | Yes |
| 7 | IQAir | **$0 free tier** | 5,000 calls/month | Yes |
| 8 | Unsplash | **$0 free tier** | 50 requests/hour | Yes |
| 9 | Google Street View | **$0 under credit** | Covered by existing $200/month | Yes* |
| 10 | Claude / OpenAI | **Paid from call #1** | No free API tier | No** |

*\* Street View shares your Google $200 credit — see cost section below.*
*\*\* Defer to Phase 3. Cheapest option is ~$0.0003/route but there's no free tier.*

---

## Phase 1 — Completely Free, No API Key Needed

These three APIs cost nothing, need no signup, and have no rate limits that matter.
**Implement all three first.** They add real value with zero risk.

---

### 1. Sunrise-Sunset API

**Cost: $0 forever. No key. No signup. No limits.**

**What it does:** Returns sunrise, sunset, golden hour, and twilight times.

**Why it matters for MVP:**
Walking at golden hour on a seafront is a 10/10 experience. Walking the same route in the dark is a 2/10. This tiny API adds contextual intelligence — "Golden hour at 5:42 PM, perfect for your Sea + Instagram route" or "It's past sunset, stick to well-lit main streets." It takes 30 minutes to implement and makes your app feel smart.

#### Step-by-Step

**Step 1 — Create the service**

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

**Step 2 — Add to route response**

In `server/routes/routes.js`, after geocoding:

```javascript
const { getDaylightInfo } = require('../services/daylight');

// After geocoding origin:
const daylight = await getDaylightInfo(originGeo.lat, originGeo.lng);

// Add to response:
res.json({ ...existingResponse, daylight });
```

**Step 3 — Display on frontend**

In `web/app.js`, add a banner to results:

```javascript
function renderDaylightHint(daylight) {
  if (!daylight) return '';
  if (daylight.isGoldenHour)
    return `<div class="daylight-hint golden">Golden hour now — perfect for photos. Sunset at ${daylight.sunset}</div>`;
  if (!daylight.isDaytime)
    return `<div class="daylight-hint dark">After sunset — stick to well-lit routes</div>`;
  return `<div class="daylight-hint">Sunset at ${daylight.sunset}</div>`;
}
```

**Env vars needed:** None.

---

### 2. Wikipedia / Wikimedia API

**Cost: $0 forever. No key. No signup.**

**What it does:** Fetches cultural and historical summaries for landmarks, neighborhoods, and POIs.

**Why it matters for MVP:**
Your History & Architecture category shows "Jaffa Clock Tower — 4.5 stars." But users chose that category because they care about history. Wikipedia turns it into: *"Built in 1903 to honor Sultan Abdul Hamid II's jubilee, one of seven clock towers built across the Ottoman Empire."* This transforms your app from "route planner" to "walking experience." And it's free.

#### Step-by-Step

**Step 1 — Create Wikipedia service**

Create `server/services/wikipedia.js`:

```javascript
const WIKI_API = 'https://en.wikipedia.org/api/rest_v1';

async function getNearbySummary(lat, lng, name) {
  // Strategy 1: Direct name lookup (most accurate)
  try {
    const res = await fetch(`${WIKI_API}/page/summary/${encodeURIComponent(name)}`);
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
  } catch { /* fall through to geosearch */ }

  // Strategy 2: Find articles near this location
  try {
    const geoUrl = `https://en.wikipedia.org/w/api.php?action=query`
      + `&list=geosearch&gscoord=${lat}|${lng}&gsradius=500&gslimit=3&format=json`;
    const res = await fetch(geoUrl);
    if (res.ok) {
      const data = await res.json();
      const pages = data.query?.geosearch || [];
      if (pages.length > 0) {
        const summaryRes = await fetch(
          `${WIKI_API}/page/summary/${encodeURIComponent(pages[0].title)}`
        );
        if (summaryRes.ok) {
          const s = await summaryRes.json();
          return {
            summary: truncate(s.extract, 150),
            url: s.content_urls?.desktop?.page || null,
            thumbnail: s.thumbnail?.source || null,
          };
        }
      }
    }
  } catch { /* no wiki data — that's okay */ }

  return null;
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, text.lastIndexOf(' ', maxLen)) + '...';
}

module.exports = { getNearbySummary };
```

**Step 2 — Enrich waypoint highlights**

In `server/routes/routes.js`, after waypoint selection:

```javascript
const { getNearbySummary } = require('../services/wikipedia');

// For each highlight in the scenic/scenic+ routes:
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
const wikiHtml = h.wikiSummary
  ? `<p class="wiki-blurb">${h.wikiSummary}
     ${h.wikiUrl ? ` <a href="${h.wikiUrl}" target="_blank">Read more</a>` : ''}</p>`
  : '';
```

**Env vars needed:** None.

**Rate limit courtesy:** Wikimedia asks for a `User-Agent` header with your app name. Add this:
```javascript
headers: { 'User-Agent': 'ScenicWalk/1.0 (your@email.com)' }
```

---

### 3. Open-Elevation API

**Cost: $0 forever. No key. No signup. Open-source.**

**What it does:** Returns elevation in meters for any coordinates. Lets you show total climb, descent, and route difficulty.

**Why it matters for MVP:**
Two 40-minute routes can feel completely different — one is flat along the beach, the other climbs a steep hill. This matters enormously for:
- **Accessibility:** wheelchair, stroller, elderly users
- **Fitness:** runners want hills, casual walkers don't
- **Expectation setting:** knowing "Gentle: +15m" vs "Hilly: +85m" changes which route you pick

#### Step-by-Step

**Step 1 — Create elevation service**

Create `server/services/elevation.js`:

```javascript
const ELEVATION_API = 'https://api.open-elevation.com/api/v1/lookup';

async function getElevationProfile(polylinePoints) {
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

  let totalAscent = 0, totalDescent = 0;
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
    difficulty: getDifficulty(totalAscent, max - min),
    profile: elevations.map((e, i) => ({
      progress: i / (elevations.length - 1),
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
  return Array.from({ length: maxCount }, (_, i) => points[Math.round(i * step)]);
}

module.exports = { getElevationProfile };
```

**Step 2 — Add to each route in the response**

```javascript
const { getElevationProfile } = require('../services/elevation');

// After getting directions for each route variant:
route.elevation = await getElevationProfile(decodedPolyline);
```

**Step 3 — Display difficulty badge**

```javascript
function renderElevationBadge(elev) {
  if (!elev) return '';
  const labels = { Flat: 'Flat', Gentle: 'Gentle hills', Moderate: 'Moderate climb', Hilly: 'Hilly' };
  return `<span class="elevation-badge">${labels[elev.difficulty]} · +${elev.totalAscent}m</span>`;
}
```

For a mini sparkline chart, use a simple inline SVG (no library needed):

```javascript
function renderElevationSparkline(profile) {
  if (!profile || profile.length < 2) return '';
  const w = 200, h = 40;
  const maxE = Math.max(...profile.map(p => p.elevation));
  const minE = Math.min(...profile.map(p => p.elevation));
  const range = maxE - minE || 1;
  const points = profile.map((p, i) => {
    const x = (i / (profile.length - 1)) * w;
    const y = h - ((p.elevation - minE) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" class="elevation-chart"><polyline points="${points}" fill="none" stroke="#6366f1" stroke-width="2"/></svg>`;
}
```

**Env vars needed:** None.

**Reliability note:** The public Open-Elevation server can be slow under heavy load.
If you hit this in production, you can self-host it (it's open-source Docker image) or
switch to Google's Elevation API ($5/1K requests, covered by your $200 credit).

---

## Phase 2 — Free Tier APIs (Signup Required, $0 for MVP)

These APIs require creating a free account and getting an API key,
but their free tiers are generous enough for MVP and early growth.

---

### 4. OpenWeatherMap

**Cost: $0 up to 1,000 calls/day (30,000/month).**

**What it does:** Real-time weather + 3-hour forecast for the walk area.

**Why it matters for MVP:**
Walking is the most weather-sensitive activity. Showing "28°C, sunny, great for walking" or "Rain expected in 2 hours — bring an umbrella" is not a nice-to-have, it's essential. Every serious walking/outdoor app has weather. Your competitors have it. You need it.

#### When does it cost money?

| Monthly route requests | Weather API calls | Cost |
|:----------------------:|:-----------------:|:----:|
| 1 - 30,000 | 1 per request | **$0** (free tier) |
| 30,001 - 100,000 | 1 per request | **$0** — switch to One Call 3.0 (1,000 free/day) |
| 100,000+ | | ~$0.15 per 100 calls beyond free tier |

**You won't pay for weather until you have 1,000+ users/day.** That's a great problem to have.

#### Step-by-Step

**Step 1 — Sign up and get a free key**
- Go to https://openweathermap.org/api and register
- Your free API key activates within a few hours
- Add to `.env`: `OPENWEATHER_API_KEY=your_key_here`

**Step 2 — Create weather service**

Create `server/services/weather.js`:

```javascript
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const BASE = 'https://api.openweathermap.org/data/2.5';

async function getWeatherForRoute(lat, lng) {
  if (!OPENWEATHER_KEY) return null; // Graceful skip if not configured

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
  const rain = w.rain?.['3h'] || 0;
  const id = w.weather[0].id;

  if (id >= 200 && id < 300) return { ok: false, reason: 'Thunderstorm expected' };
  if (rain > 5) return { ok: false, reason: 'Heavy rain expected' };
  if (rain > 0.5) return { ok: true, reason: 'Light rain — bring an umbrella' };
  if (temp > 38) return { ok: false, reason: 'Extreme heat — avoid walking' };
  if (temp > 32) return { ok: true, reason: 'Hot — stay hydrated and seek shade' };
  if (w.wind.speed > 15) return { ok: true, reason: 'Very windy — dress accordingly' };
  if (temp < 3) return { ok: true, reason: 'Near freezing — bundle up' };
  return { ok: true, reason: 'Great walking weather' };
}

module.exports = { getWeatherForRoute };
```

**Step 3 — Integrate into route response**

In `server/routes/routes.js`, after geocoding:

```javascript
const { getWeatherForRoute } = require('../services/weather');

const weather = await getWeatherForRoute(originGeo.lat, originGeo.lng);
// Add to response: { ...existingResponse, weather }
```

**Step 4 — Display weather banner on results screen**

In `web/app.js`:

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

**Env vars:** `OPENWEATHER_API_KEY`

---

### 5. Mapbox GL JS — In-App Route Map

**Cost: $0 up to 50,000 map loads/month.**

**What it does:** Renders an interactive map inside your app showing route lines, waypoints, and POIs.

**Why it matters for MVP:**
This is your app's **biggest UX gap**. Right now users see route cards with text but zero visual. Every competitor (Komoot, AllTrails, Citymapper) renders the route inline. Users need to visually compare 3 route options before picking one. An embedded map makes the difference between "interesting tool" and "real app."

#### When does it cost money?

| Map loads/month | Cost |
|:--:|:--:|
| 0 - 50,000 | **$0** |
| 50,001 - 100,000 | $5.00 per 1,000 loads |
| 100,000+ | $4.00 per 1,000 loads |

50,000 free map loads = ~1,666 users/day (if each loads 1 map). For an MVP, this is more than enough.

#### Step-by-Step

**Step 1 — Sign up for Mapbox (no credit card needed)**
- Go to https://account.mapbox.com and register
- Copy your default public access token
- Add to `.env`: `MAPBOX_TOKEN=pk.your_token_here`
- Expose via your existing `/api/public-config` endpoint

**Step 2 — Add Mapbox to the frontend**

In `web/index.html` `<head>`:

```html
<link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js"></script>
```

**Step 3 — Expose polyline coordinates from backend**

In `server/routes/routes.js`, add decoded polyline to each route in the response:

```javascript
// In your route response builder:
route.polyline = decodedPolylinePoints; // Array of [lat, lng] pairs
```

**Step 4 — Add map container to results screen**

In `web/index.html`, inside the results section:

```html
<div id="route-map" style="width:100%; height:280px; border-radius:12px; margin-bottom:16px;"></div>
```

**Step 5 — Render routes on the map**

In `web/app.js`:

```javascript
function renderRouteMap(routes, mapboxToken) {
  mapboxgl.accessToken = mapboxToken;
  const map = new mapboxgl.Map({
    container: 'route-map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
  });

  const colors = { fastest: '#888', scenic: '#2563eb', scenic_plus: '#7c3aed' };

  map.on('load', () => {
    // Fit map to all route bounds
    const allCoords = routes.flatMap(r => (r.polyline || []).map(p => [p[1], p[0]]));
    if (allCoords.length) {
      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
      );
      map.fitBounds(bounds, { padding: 40 });
    }

    routes.forEach(route => {
      if (!route.polyline) return;
      const coords = route.polyline.map(p => [p[1], p[0]]); // [lng, lat]

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

      // Waypoint markers
      (route.highlights || []).forEach(h => {
        new mapboxgl.Marker({ color: colors[route.id], scale: 0.7 })
          .setLngLat([h.lng, h.lat])
          .setPopup(new mapboxgl.Popup().setHTML(`<b>${h.name}</b><br>${h.reason}`))
          .addTo(map);
      });
    });
  });
}
```

**Env vars:** `MAPBOX_TOKEN`

---

### 6. Foursquare Places API

**Cost: $0 up to 950 calls/day (~28,500/month).**

**What it does:** Complementary POI source with visitor tips, photos, detailed categories (650+ vs Google's ~100), and popularity data (check-in counts).

**Why it matters for MVP:**
Google Places gives you name + rating. Foursquare gives you *"The rooftop has the best sunset view"* as a visitor tip, plus a photo of the actual venue. Merging both sources gives you a richer POI pool with better signals for scoring. The tips alone make waypoint cards 10x more engaging.

#### When does it cost money?

| API calls/day | Cost |
|:--:|:--:|
| 0 - 950 | **$0** (Essential plan, no credit card) |
| 951+ | Need "Plus" plan — starts at $125/month |

950 calls/day with ~5 Foursquare calls per route = **~190 routes/day free.** Plenty for MVP.

#### Step-by-Step

**Step 1 — Get free API key**
- Sign up at https://foursquare.com/developers (no credit card)
- Create a project and copy your API key
- Add to `.env`: `FOURSQUARE_API_KEY=your_key_here`

**Step 2 — Create Foursquare service**

Create `server/services/foursquare.js`:

```javascript
const FSQ_KEY = process.env.FOURSQUARE_API_KEY;
const FSQ_BASE = 'https://api.foursquare.com/v3';

const CATEGORY_MAP = {
  sea:       '16032',        // Beach
  instagram: '10027',        // Art Gallery
  history:   '12085',        // Historic Site
  streets:   '11146',        // Shopping
  food:      '13065',        // Food
  chill:     '16032,16019',  // Park, Garden
};

async function searchPlaces(lat, lng, categories, radius = 400) {
  if (!FSQ_KEY) return []; // Skip if not configured

  const catIds = categories.map(c => CATEGORY_MAP[c]).filter(Boolean).join(',');
  const url = `${FSQ_BASE}/places/search?ll=${lat},${lng}&radius=${radius}`
    + `&categories=${catIds}&limit=10&fields=name,geocodes,rating,stats,tips,photos,categories`;

  const res = await fetch(url, {
    headers: { Authorization: FSQ_KEY, Accept: 'application/json' },
  });
  if (!res.ok) return [];

  const data = await res.json();
  return data.results.map(p => ({
    name: p.name,
    lat: p.geocodes?.main?.latitude,
    lng: p.geocodes?.main?.longitude,
    rating: p.rating ? p.rating / 2 : null,  // Normalize 0-10 to 0-5
    totalCheckins: p.stats?.total_checkins || 0,
    tip: p.tips?.[0]?.text || null,
    photoUrl: p.photos?.[0]
      ? `${p.photos[0].prefix}300x200${p.photos[0].suffix}` : null,
    categories: p.categories?.map(c => c.name) || [],
    source: 'foursquare',
  }));
}

module.exports = { searchPlaces };
```

**Step 3 — Merge with Google results**

In `server/routes/routes.js`, during POI search:

```javascript
const foursquare = require('../services/foursquare');

// For each sample point, run Google and Foursquare in parallel:
const [googlePois, fsqPois] = await Promise.all([
  google.nearbySearch(lat, lng, radius, types, keyword),
  foursquare.searchPlaces(lat, lng, selectedCategories, radius),
]);

// Merge and deduplicate (within 50m = same place):
const merged = deduplicateByProximity([...googlePois, ...fsqPois], 50);
```

**Step 4 — Show tips and photos on frontend**

```javascript
const tipHtml = h.tip ? `<blockquote class="poi-tip">"${h.tip}"</blockquote>` : '';
const photoHtml = h.photoUrl ? `<img src="${h.photoUrl}" class="poi-photo" loading="lazy">` : '';
```

**Env vars:** `FOURSQUARE_API_KEY`

---

### 7. IQAir — Air Quality

**Cost: $0 up to 5,000 calls/month.**

**What it does:** Returns real-time Air Quality Index (AQI) with health recommendations.

**Why it matters for MVP:**
Parents, asthmatics, elderly walkers, and runners all care about air quality. A simple badge — "Air: Good" or "Air: Moderate — sensitive groups should limit outdoor time" — shows your app cares about user health. Takes 20 minutes to implement.

#### When does it cost money?

| Calls/month | Cost |
|:--:|:--:|
| 0 - 5,000 | **$0** (Community plan) |
| 5,001 - 10,000 | Startup plan — $4.99/month |
| 10,000+ | Enterprise — custom pricing |

5,000 calls/month = ~166 routes/day. Fine for MVP.

#### Step-by-Step

**Step 1 — Sign up**
- Go to https://www.iqair.com/air-pollution-data-api
- Sign up for Community (free) plan
- Add to `.env`: `IQAIR_API_KEY=your_key_here`

**Step 2 — Create air quality service**

Create `server/services/airquality.js`:

```javascript
const IQAIR_KEY = process.env.IQAIR_API_KEY;

async function getAirQuality(lat, lng) {
  if (!IQAIR_KEY) return null;

  const url = `https://api.airvisual.com/v2/nearest_city?lat=${lat}&lon=${lng}&key=${IQAIR_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const pollution = (await res.json()).data?.current?.pollution;
  if (!pollution) return null;

  const aqi = pollution.aqius;
  return {
    aqi,
    level: aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy for Sensitive Groups' : 'Unhealthy',
    recommendation: aqi <= 50 ? 'Perfect air for walking'
      : aqi <= 100 ? 'Acceptable — sensitive individuals should take it easy'
      : 'Consider a shorter walk or indoor alternatives',
  };
}

module.exports = { getAirQuality };
```

**Step 3 — Add to response alongside weather**

```javascript
const { getAirQuality } = require('../services/airquality');
const airQuality = await getAirQuality(originGeo.lat, originGeo.lng);
// Add: { ...response, airQuality }
```

**Env vars:** `IQAIR_API_KEY`

---

### 8. Unsplash — POI Photos

**Cost: $0 for development (50 requests/hour). Production requires free approval.**

**What it does:** Returns high-quality, freely licensed photos by search term.

**Why it matters for MVP:**
Photos make waypoint cards visual and engaging. Unsplash is the best free photo source — higher quality than Google Places photos (which require additional API calls). Use it for categories where atmosphere matters: Food, Chill, Instagram.

#### When does it cost money?

| Stage | Limit | Cost |
|:--:|:--:|:--:|
| Development | 50 req/hour | **$0** |
| Production (after approval) | 5,000 req/hour | **$0** |
| Beyond 5,000/hour | Contact Unsplash | Custom |

**Unsplash is free even in production** — they just require you to apply for production status (takes a few days) and attribute photographers.

#### Step-by-Step

**Step 1 — Sign up**
- Go to https://unsplash.com/developers
- Create an app (demo mode: 50 req/hr)
- Add to `.env`: `UNSPLASH_ACCESS_KEY=your_key_here`

**Step 2 — Create photo service**

Create `server/services/photos.js`:

```javascript
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

async function getPoiPhoto(name, category) {
  if (!UNSPLASH_KEY) return null;

  const query = `${name} ${category}`;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}`
    + `&per_page=1&orientation=landscape&client_id=${UNSPLASH_KEY}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const photo = (await res.json()).results?.[0];
  if (!photo) return null;

  return {
    url: photo.urls.small,
    alt: photo.alt_description,
    credit: photo.user.name,
    creditUrl: photo.user.links.html,
  };
}

module.exports = { getPoiPhoto };
```

**Important:** Unsplash requires you to show photographer attribution:
```javascript
const creditHtml = photo.credit
  ? `<small>Photo by <a href="${photo.creditUrl}" target="_blank">${photo.credit}</a> on Unsplash</small>`
  : '';
```

**Env vars:** `UNSPLASH_ACCESS_KEY`

---

## Phase 3 — APIs That Cost Money (Defer Until You Have Users)

These APIs have **no free tier** or share limited credit with your existing services.
Don't implement them until you have validated demand and have paying users or funding.

---

### 9. Google Street View Static API

**Cost: $7 per 1,000 images. Shares your Google $200/month free credit.**

**What it does:** Returns a photo of the actual street-level view at any location.

**Why it's powerful:**
It's the only API that shows users *exactly* what they'll see standing at a waypoint. Not a stock photo — the real view from that exact GPS coordinate.

#### The cost reality

Street View shares your existing $200/month Google credit with Geocoding, Directions, and Places. Here's how it adds up:

| Routes/month | Current Google cost | + Street View (3 imgs/route) | Total | Still free? |
|:--:|:--:|:--:|:--:|:--:|
| 100 | $33.50 | $2.10 | $35.60 | Yes ($200 credit) |
| 300 | $100.50 | $6.30 | $106.80 | Yes |
| 500 | $167.50 | $10.50 | $178.00 | Yes |
| **600** | **$201.00** | **$12.60** | **$213.60** | **No — $13.60 bill** |
| 1,000 | $335.00 | $21.00 | $356.00 | No — $156/month |

**Decision point:** If you're under 500 routes/month, Street View fits within your free credit. Above that, it accelerates your Google bill.

#### Step-by-Step

**Step 1 — Enable Street View Static API** in your Google Cloud Console (uses existing key).

**Step 2 — Build Street View URLs in the backend**

```javascript
function streetViewUrl(lat, lng, apiKey) {
  return `https://maps.googleapis.com/maps/api/streetview`
    + `?size=400x200&location=${lat},${lng}&fov=100&pitch=5&key=${apiKey}`;
}

// Per highlight:
highlight.streetViewUrl = streetViewUrl(poi.lat, poi.lng, process.env.GOOGLE_API_KEY);
```

**Step 3 — Display in waypoint cards**

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

**Cost-saving tip:** Cache Street View URLs — the same POI will have the same image. Your existing 5-min cache handles this for repeat searches.

**Env vars:** None new (uses existing `GOOGLE_API_KEY`).

---

### 10. Claude / OpenAI API — AI Route Narration

**Cost: Paid from the very first API call. No free tier.**

**What it does:** Generates a personalized, vivid walking narration from your route data.

**Why it's the "wow factor":**
Instead of bullet points, users get: *"Head southwest from Dizengoff Center toward the sound of waves. Your first stop is Gordon Beach — grab a bench and watch the surfers. Follow the promenade south to Alma Beach Cafe, a local favorite with fresh lemonade and sea views..."*

#### The cost reality

| Provider | Model | Cost per route | 1,000 routes/month |
|:--:|:--:|:--:|:--:|
| Anthropic | Claude Haiku 4 | ~$0.0003 | **$0.30** |
| OpenAI | GPT-4o-mini | ~$0.0002 | **$0.20** |

**This is extremely cheap** — but there's no free tier. You pay from call #1.
At $0.30/month for 1,000 routes, the cost is negligible, but you need a credit card on file.

#### When to add it

- **If you have a credit card and $1/month budget:** Add it now. The cost is trivial.
- **If you want strict $0:** Defer. Build a template-based narration instead (free but less magical):

```javascript
// Free alternative: template-based narration
function templateNarration(highlights, origin, destination) {
  const stops = highlights.map(h => h.name).join(', then ');
  return `Walk from ${origin} to ${destination}, passing through ${stops}. Enjoy the journey!`;
}
```

#### Step-by-Step (when ready)

**Step 1 — Choose provider and get key**
- **Anthropic (recommended):** https://console.anthropic.com
- **OpenAI:** https://platform.openai.com
- Add to `.env`: `AI_API_KEY=your_key` and `AI_PROVIDER=anthropic`

**Step 2 — Create narration service**

Create `server/services/narration.js`:

```javascript
const AI_KEY = process.env.AI_API_KEY;
const PROVIDER = process.env.AI_PROVIDER || 'anthropic';

async function generateRouteNarration(route, origin, destination, categories) {
  if (!AI_KEY) return null; // Graceful skip if not configured

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
      headers: { Authorization: `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' },
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

**Step 3 — Add to scenic routes only**

```javascript
const { generateRouteNarration } = require('../services/narration');

if (route.highlights?.length > 0) {
  route.narration = await generateRouteNarration(route, origin, destination, categories);
}
```

**Env vars:** `AI_API_KEY`, `AI_PROVIDER`

---

## Full Cost Summary — What You Pay at Every Scale

### At MVP Launch (< 100 routes/day)

| API | Monthly cost |
|-----|:--:|
| Google (existing) | **$0** (under $200 credit) |
| Sunrise-Sunset | **$0** |
| Wikipedia | **$0** |
| Open-Elevation | **$0** |
| OpenWeatherMap | **$0** |
| Mapbox | **$0** |
| Foursquare | **$0** |
| IQAir | **$0** |
| Unsplash | **$0** |
| **Total** | **$0/month** |

### At 500 routes/day (~15,000/month)

| API | Monthly cost |
|-----|:--:|
| Google (existing) | **$0** (still under $200 credit at ~$167) |
| Sunrise-Sunset | **$0** |
| Wikipedia | **$0** |
| Open-Elevation | **$0** |
| OpenWeatherMap | **$0** (15K < 30K limit) |
| Mapbox | **$0** (15K < 50K limit) |
| Foursquare | **$0** (500/day < 950 limit) |
| IQAir | **$0** (15K > 5K limit — **upgrade needed: $4.99/mo**) |
| Unsplash | **$0** |
| Google Street View (if added) | ~$0 (fits in $200 credit) |
| AI Narration (if added) | ~$4.50 |
| **Total** | **$0 - $9.49/month** |

### At 2,000 routes/day (~60,000/month) — "You've made it"

| API | Monthly cost |
|-----|:--:|
| Google (existing) | **~$20,100** — this is your biggest cost by far |
| Sunrise-Sunset | **$0** |
| Wikipedia | **$0** |
| Open-Elevation | **$0** (consider self-hosting for speed) |
| OpenWeatherMap | **$0** (60K > 30K — upgrade to paid: **~$9/month**) |
| Mapbox | **$50** (60K - 50K = 10K extra × $5/1K) |
| Foursquare | **$125/month** (Plus plan needed) |
| IQAir | **$4.99/month** |
| Unsplash | **$0** |
| Google Street View | ~$1,260 (included in Google bill above) |
| AI Narration | ~$18 |
| **Total** | **~$20,307/month** — but 95% of that is Google |

**Key insight:** At scale, **Google Maps Platform is your cost**, not these APIs. Consider caching aggressively and exploring Google Maps Platform Premium agreements or alternative routing engines (OSRM, Valhalla) if you reach this level.

---

## Environment Variables — Complete Reference

```env
# ── Existing ──
GOOGLE_API_KEY=your_server_google_api_key
GOOGLE_MAPS_BROWSER_KEY=your_browser_key
PORT=3000

# ── Phase 1: No key needed ──
# (Sunrise-Sunset, Wikipedia, Open-Elevation need no keys)

# ── Phase 2: Free tier ──
OPENWEATHER_API_KEY=your_openweathermap_key     # Free: 1K calls/day
MAPBOX_TOKEN=pk.your_mapbox_token                # Free: 50K loads/month
FOURSQUARE_API_KEY=your_foursquare_key           # Free: 950 calls/day
IQAIR_API_KEY=your_iqair_key                     # Free: 5K calls/month
UNSPLASH_ACCESS_KEY=your_unsplash_key            # Free: 50 req/hour (dev)

# ── Phase 3: Paid ──
AI_API_KEY=your_anthropic_or_openai_key          # ~$0.0003/route
AI_PROVIDER=anthropic                            # or "openai"
# (Street View uses existing GOOGLE_API_KEY)
```

**Every service is coded to gracefully skip if its env var is missing.**
You can add APIs one at a time by simply adding the env var — no code changes needed.

---

## Implementation Checklist

- [ ] **Phase 1** — Zero cost, zero signup
  - [ ] Sunrise-Sunset (30 min)
  - [ ] Wikipedia enrichment (1 hour)
  - [ ] Open-Elevation + difficulty badge (1 hour)

- [ ] **Phase 2** — Free signup required
  - [ ] OpenWeatherMap + weather banner (1 hour)
  - [ ] Mapbox in-app map (2-3 hours)
  - [ ] Foursquare POI merge + tips (2 hours)
  - [ ] IQAir air quality badge (30 min)
  - [ ] Unsplash POI photos (1 hour)

- [ ] **Phase 3** — When you're ready to spend
  - [ ] Google Street View previews
  - [ ] AI route narration (Claude/OpenAI)
