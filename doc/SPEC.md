# Scenic Walk — MVP Spec (v0.1)

## Purpose
Build a “walking experience layer” on top of Google Maps.
Given origin + destination + user preference + detour tolerance, generate 3 walking route options:
1) Fastest (baseline)
2) Scenic (personalized)
3) Scenic+ (more personalized, bigger detour)

The app must NOT render its own map and must NOT replace Google Maps.
It should output Google Maps Directions deep links (walking + waypoints) that open in Google Maps.

## User Input
- Origin: address/place text OR “Use my location”
- Destination: address/place text
- Preference: Sea | Instagram | History | Main Streets | Food | Chill
- Detour tolerance: Low | Medium | High

## Output
For each route option:
- Title: Fastest / Scenic / Scenic+
- Duration minutes
- Extra minutes vs fastest
- 3–6 highlights (name + 1-line reason)
- "Open in Google Maps" button (deep link)

## MVP Algorithm (no ML)
1. Geocode origin/destination
2. Directions API (walking) to get Fastest baseline + polyline + duration
3. Decode polyline, sample points every ~400m along the baseline
4. For each sample point, query Places Nearby within radius by detour:
   - Low: 200m
   - Medium: 400m
   - High: 700m
5. Score candidate POIs:
   score = type_match(preference) + popularity(rating, reviews) - detour_penalty - duplicate_category_penalty
6. Select up to 4 waypoints that progress from origin to destination (monotonic order)
7. Build Scenic and Scenic+ using Directions API with waypoints and compute duration
8. Create highlights from chosen waypoints with one-line reasons

## Preference Mapping (initial)
- Sea: beach, marina, tourist_attraction, viewpoint keyword "promenade"
- Instagram: tourist_attraction, point_of_interest, cafe, art_gallery keyword "street art"
- History: museum, point_of_interest, tourist_attraction, art_gallery keyword "historic"
- Main Streets: shopping_mall, store, point_of_interest, tourist_attraction keyword "boulevard"
- Food: restaurant, cafe, bakery, meal_takeaway keyword "market"
- Chill: park, cafe, point_of_interest keyword "garden"

## Google Maps Deep Link
Use:
https://www.google.com/maps/dir/?api=1&origin=...&destination=...&travelmode=walking&waypoints=wp1|wp2|wp3

Constraints:
- URL encode all fields
- Max 4 waypoints

## Tech Constraints
- Mobile-first web UI (no map rendering)
- Backend: Node.js + Express
- Frontend: plain HTML/CSS/JS
- Must run locally:
  - server: npm install, npm run dev
  - web: open index.html or served by server
- Add .env.example and README with setup steps
- Add in-memory cache for 5 minutes to reduce API calls
- Add basic telemetry endpoint: generate_route, open_in_maps, rate_route