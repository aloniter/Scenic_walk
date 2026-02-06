# Scenic Walk

A walking experience layer on top of Google Maps. Given an origin, destination, selected categories, and detour tolerance, generates 3 walking route options:

1. **Fastest** — direct baseline route
2. **Scenic** — personalized with up to 3 curated waypoints
3. **Scenic+** — more exploratory with up to 4 different waypoints and a wider search radius

Routes open directly in Google Maps via deep links — no map rendering required.

## Prerequisites

- **Node.js 18+** (uses native `fetch` and `--watch` mode)
- **Google Cloud API key** with the following APIs enabled:
  - Geocoding API
  - Directions API
  - Places API
  - Maps JavaScript API (for Places Autocomplete in the web form)

## Setup

```bash
# 1. Install dependencies
cd server
npm install

# 2. Configure environment
cp ../.env.example ../.env
# Edit .env and add your keys:
# - GOOGLE_API_KEY (server APIs)
# - GOOGLE_MAPS_BROWSER_KEY (browser autocomplete; restrict by HTTP referrer)

# 3. Start the server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## API

### POST /api/routes

Generate 3 walking route options.

**Request:**
```json
{
  "origin": "Dizengoff Center, Tel Aviv",
  "destination": "Jaffa Port",
  "categories": ["sea", "food", "instagram"],
  "detour": "medium",
  "maxExtraMinutes": 15
}
```

**Categories:** `sea`, `instagram`, `history`, `architecture`, `main_streets`, `food`, `chill`

Legacy `preference` (single category) is still accepted for backward compatibility.

**Detour levels:** `low` (200m radius), `medium` (400m), `high` (700m)
  
**Time budget:** `maxExtraMinutes` integer from `0` to `45` (default: `15`)

**Response:**
```json
{
  "origin": "Dizengoff Center, Tel Aviv, Israel",
  "destination": "Jaffa Port, Tel Aviv, Israel",
  "maxExtraMinutes": 15,
  "routes": [
    {
      "id": "fastest",
      "title": "Fastest",
      "durationMinutes": 35,
      "extraMinutes": 0,
      "adjustedToBudget": false,
      "withinBudget": true,
      "waypointCount": 0,
      "highlights": [],
      "deepLink": "https://www.google.com/maps/dir/..."
    },
    {
      "id": "scenic",
      "title": "Scenic",
      "durationMinutes": 42,
      "extraMinutes": 7,
      "adjustedToBudget": false,
      "withinBudget": true,
      "waypointCount": 3,
      "waypoints": [
        {
          "name": "Gordon Beach",
          "location": { "lat": 32.1, "lng": 34.7 },
          "matched_categories": ["sea", "instagram"],
          "reason": "Matches Sea and Instagram (4.7★) with minimal detour."
        }
      ],
      "highlights": [
        {
          "name": "Gordon Beach",
          "matched_categories": ["sea", "instagram"],
          "reason": "Matches Sea and Instagram (4.7★) with minimal detour."
        }
      ],
      "route_summary": "Balances Sea and Food; adds +7 min via 3 coherent stops with minimal backtracking.",
      "deepLink": "https://www.google.com/maps/dir/..."
    },
    {
      "id": "scenic_plus",
      "title": "Scenic+",
      "durationMinutes": 48,
      "extraMinutes": 13,
      "highlights": [
        { "name": "Banana Beach", "reason": "Highly-rated beachside attraction" },
        { "name": "Alma Beach", "reason": "Top-rated coastal viewpoint" }
      ],
      "deepLink": "https://www.google.com/maps/dir/..."
    }
  ]
}
```

### POST /api/events

Log a telemetry event.

**Request:**
```json
{
  "event": "route_generated",
  "routeId": "scenic",
  "metadata": {}
}
```

**Events:** `route_generated`, `maps_opened`, `route_rated`

### GET /api/events/summary

Returns lightweight aggregates (`byEvent`, `mapsOpenedByRoute`, `avgRatingByRoute`) based on persisted telemetry.

### GET /api/public-config

Returns minimal browser-safe config for frontend integrations:

```json
{
  "googleMapsBrowserKey": "..."
}
```

## Project Structure

```
server/
  server.js              Express app entry point
  config.js              Environment, constants, category mappings
  routes/
    routes.js            POST /api/routes — main route generation
    events.js            POST /api/events — telemetry
    public-config.js     GET /api/public-config — browser config endpoint
  services/
    google.js            Google Geocoding, Directions, Places API
    scoring.js           POI scoring + waypoint selection algorithm
    polyline.js          Polyline decoding + spatial sampling
    cache.js             In-memory TTL cache (5 min)
web/
  index.html             Single-page app with form/loading/results screens
  styles.css             Mobile-first responsive styles
  app.js                 Frontend state management + UI logic
```

## How It Works

1. Geocode origin and destination addresses
2. Get the fastest walking route from Google Directions API
3. Decode the route polyline and sample points every ~400m
4. Query Google Places Nearby Search at each sample point for selected category variants
5. Score POIs with a multi-category intent mix (coverage + quality + detour + diversity)
6. Select waypoints with deterministic anchor + greedy + coverage-swap logic (Scenic: 2-3, Scenic+: 3-4)
7. Get walking directions through the selected waypoints
8. Return deep links that open directly in Google Maps

## Limitations

- Route cache is in-memory only (5-minute TTL)
- No user authentication
- Max ~13 Google API calls per uncached request
- Walking routes limited to 2 hours
- Recent searches are stored in browser localStorage only
