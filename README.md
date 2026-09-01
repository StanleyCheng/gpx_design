# TrailPlanner — GPX route planner

[AI-enabled Vercel app](https://gpxdesign.vercel.app/) · [GitHub Pages static app](https://stanleycheng.github.io/gpx_design/). A responsive single HTML frontend with embedded CSS and JavaScript. **Routes are provisional planning candidates, not certified safe navigation tracks.**

## Workflow

1. Add mandatory places using decimal coordinates, TXT/CSV, GPX, image recognition, or map pins.
2. Review each place and its order. Select regional guidance, hike date, distance, transport approach, waypoint tolerance and road-connector limits.
3. Find up to three distinct routes. Every route must include every place within the accepted tolerance, follow real connected OSM walking ways, and start/end near passenger stops linked to mapped transit services.
4. Choose a route, inspect the full map and evidence, independently check access and transport, then save GPX. After reversing, review arrival and departure services for the new direction; reversal is disabled when mapped foot direction or boarding rules prohibit it. PNG remains a clearly labelled planning preview.

The “Your next step” field card follows the selected input method and the current planning state. Its four short steps, safety reminders and main action can switch between English and Traditional Chinese without changing the draft or route logic.

The engine returns fewer options or an actionable failure instead of inventing routes or silently relaxing limits. Candidate ranking prefers hiking relations and nearby official trail corridors, penalises roads and retracing, and considers endpoint access distance and mapped services. It is a bounded heuristic, not a globally optimal itinerary or timetable planner. A 30 m default waypoint tolerance is explicit, reviewable and adjustable. No synthetic connectors fill waypoint or transport-stop gaps.

## Regional coverage and evidence

- **Hong Kong:** worldwide OSM graph plus a live AFCD hiking-trail geometry query. Approximate corridor matches use 12 m tolerance, not proof of ownership, management or current access. If AFCD is unavailable, the app says so.
- **Taiwan, Japan, South Korea:** the same OSM walking and transport-service graph, plus relevant official authority links. Government trail geometry, current closures and timetables are **not integrated** for these regions yet.
- **Elsewhere:** experimental, subject to OSM coverage. Limited to local searches between 75°S and 75°N, at most 250 km², not crossing the date line.

Up to 16 mandatory places in entered order, or 8 with order optimisation. All limits are enforced. A bus-stop symbol without a mapped service does not qualify. Stops must be within 80 m of a route-network node, with that unrouted gap explicitly shown. The hike date is for manual timetable checks, not an automatic schedule filter. No ascent, duration, safety score or elevation is invented. Known restrictions, conditional access, fords, demanding `sac_scale` tags and unsuitable roads are excluded; untagged conditions remain unknown.

## Image input

[Kimi recognition](AI_SETUP.md) is the main route-map workflow: it identifies a suggested area and visible marked places only through the deployed private Vercel function and a user-initiated Identify action. After review, the selected places feed the same three-option route planner. Kimi never supplies the routing graph. Each selected place still needs one valid coordinate; unsupported coordinates remain blank. No endpoint secret or provider key is shipped to the browser.

[Manual image conversion](IMAGE_CONVERSION.md) still works locally: calibrate three known locations, select a continuous route colour, trace and review. Image traces and imported tracks are unverified source references, not traversability evidence. GPX import preserves segments and numeric elevations; if no waypoints exist, only segment endpoints become mandatory places. Add any other must-visit locations explicitly.

The planning map stays clear when empty. On desktop, drag to pan and hold Ctrl or Command while scrolling to zoom. Right-click a manually added pin to remove it. On iPhone, choose Explore map or Add pins, drag with one finger, pinch with two, and tap an added pin to open its Remove button. Ordinary swipes still scroll the page when map exploration is off.

## Run, test and publish

Node 22.12 or newer, with no third-party runtime packages required:

```sh
node scripts/build-inline.mjs
npm test
npm run build
node --env-file=.env server/recognition.mjs
```

Open `http://127.0.0.1:8787/`. Copy `.env.example` to a private `.env` if one does not already exist; never overwrite a populated key file. The server serves an explicit public-file allowlist and will not serve `.env`, source files or tests. No Kimi calls are possible without a configured key and the user selecting Identify.

The authored routing engine and UI fragments in `lib/` are embedded into `index.html` by the build script. The deployed frontend stays one HTML file plus icons. Leaflet 1.9.4, Exifr 7.1.3, fonts and map tiles load online. No offline navigation is claimed. Vercel publishes the allowlisted assets, private recognition function and server-side route planner. The GitHub Pages and local-file frontends use that Vercel route planner first, with direct public-provider access retained as an emergency fallback. See [AI_SETUP.md](AI_SETUP.md).

## Privacy and operations

Drafts and files stay in browser memory except recognition images/clues sent when the user selects Identify. Recognition serializes a resized canvas, stripping camera metadata; the server forwards to Kimi and does not write images to disk. Remote hosting requires a separate private app access token; see setup notes. There is no daily recognition quota, so monitor Kimi usage and billing directly.

Routing sends waypoint coordinates and the chosen route limits to the TrailPlanner Vercel function. That function validates and bounds the request, sends the derived bounding box to the selected Overpass provider and (Hong Kong only) the AFCD service, computes the three candidates, and returns only the compact route results. Providers see the area and Vercel server address; Vercel processes the waypoints. Uploaded files and map images are not sent by route planning. OSM tiles still reveal the viewed area to the tile provider, and PNG reuses displayed tiles. Ten-minute server memory caching, sequential provider fallback, bounded downloads and explicit timeouts reduce public-service load. High-traffic deployment still needs a dedicated or commercial routing data service.

Optional Google Analytics is consent-based and production-only; coordinates, files, photos, typed clues and access codes are never analytics parameters. See [ANALYTICS.md](ANALYTICS.md). `.env`, private inputs, exports, runtime ledgers and common generated files are ignored by Git. The header's noninteractive “Early preview” badge has been removed.

## Sources

- [OpenStreetMap / Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) and [public-service usage guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)
- [AFCD hiking trails dataset](https://data.gov.hk/en-data/dataset/hk-afcd-afcdlist-hikingtrailscp/resource/4186314e-8a12-452c-b8c8-9d60eadce640)
- [Taiwan Forestry and Nature Conservation Agency](https://recreation.forest.gov.tw/EN/)
- [Japan Ministry of the Environment national parks](https://www.env.go.jp/en/nature/nps/park/parks/)
- [Korea National Park Service](https://english.knps.or.kr/)
- [Kimi thinking and vision models](https://platform.kimi.ai/docs/guide/use-thinking-models)

The `gpx-trail-fix` workflow informed the graph-geometry and evidence rules; its Python script is not executed in the browser. Current API documentation was checked through Context7 and primary sources. See [ROUTING_QA.md](ROUTING_QA.md) for validation and limits.
