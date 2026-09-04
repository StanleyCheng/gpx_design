# Routing and interface validation — 2026-09-04

`npm test`: **83 passing tests**. The cases exercise independent 1 km arrival and departure checks, progressive 4 km / 10 km / 20 km endpoint downloads, actual mapped approaches between 10 and 20 km, rejection beyond 20 km despite geographically nearby stops, separate extension cache keys, strict and optional pin order, genuinely shorter reordered visits, source geometry and specific failure causes. Multi-candidate waypoint tests cover a closest isolated branch, a closest wrong-way branch, route-distance tie-breaking, visually crossing non-noded ways and complete candidate disconnection. Loop tests cover default-off compatibility, a shared arrival/departure stop, directed return paths, common-stop matching before shortlisting, full-return distance/road limits, reordered alternatives, single-pin out-and-back routes, backend expansion and malformed switch values. Ford tests cover default rejection, the explicit AFCD-corridor setting, continued rejection without official geometry, continued enforcement of `foot=no`, backend validation, UI default state and GPX warnings. The first distance search uses metres without hidden road or step weights; other profiles prefer mapped trails. Known unclear/impassable tags are excluded from every profile.

Waypoint selection scans eligible downloaded segments, retains at most 24 deterministic in-tolerance candidates per pin while reserving up to 8 distinct weak path components, and splits only those source segments. A backward layered multi-source directed search minimizes total snap offset across the full pin-order chain, then mapped route distance, then stable candidate identity. With `P ≤ 50`, `S` eligible segments and graph `V/E`, the added selection work is bounded by `O(P·S + P·(E + V) log V)` and at most 1,200 candidate split points. Directional foot access, exclusions, tolerance and all route limits are unchanged. If no full chain exists, the existing `DISCONNECTED_WAYPOINTS` message names the failing waypoint pair and confirms that no gap was bridged.

The supplied Hong Kong sample `22.295456, 114.286087 → 22.296001, 114.291364` was checked through the local backend against 3,340 live OSM elements from VK Maps Overpass, snapshot `2026-09-04T05:24:10Z`, at the normal 30 m tolerance. With **Official trail stream crossings** off, it correctly remains `DISCONNECTED_WAYPOINTS`: waypoint 1's component reaches OSM node `12662824179`, tagged `ford=yes`. The closest remaining eligible nodes are 23.4 m apart and no gap is fabricated. The ford lies 1.22 m from AFCD geometry for High Junk Peak Country Trail, which AFCD labels Demanding. With the explicit setting on, the same snapshot produces three fully mapped options of 6.307 km, 6.456 km and 6.672 km, with the original snaps 1.92 m and 0.84 m from the entered coordinates. A fresh uncached end-to-end run then stopped at the 4 km transport stage, returned HTTP 200 through Private.coffee in 38 seconds and produced three current-data options of 5.643 km, 6.075 km and 5.979 km. The setting never permits an OSM-only ford or overrides another restriction, and every result carries a ford warning. This is a software/topology check, not a current field-condition assessment.

The compact Find/Export labels and reduced-motion fallback passed browser checks. On WebKit's iPhone 16 Pro Max profile, Find measured 46 × 46 px with a 1 px dark border and shared the route-circle horizontal centre exactly. During a search, its three-dot indicator animates below the Find label while the background uses a slow nine-second red/green/blue cycle; it stays light green while idle, and reduced-motion mode displays steady dots. The collapsed dock measured 22 px high and sat flush against the viewport bottom, with an up arrow collapsed and down arrow expanded. Two-line route labels kept the route number and distance centred. The 24 × 30 px numbered teardrops retain 44 × 44 px touch targets; tap-to-delete passed. Desktop Chrome passed dragging, right-click deletion and keyboard activation of Loop. Explicit SVG stacking keeps Leaflet's SVG pane rule from painting over pin numbers. Pins above Export hides all numbered and S/F markers while keeping route geometry and labels; entering pin-edit mode restores them. Changing Loop clears stale route results. No horizontal page overflow was observed at 440 × 956 or 1280 × 800.

A recorded Hong Kong OSM sample (snapshot 2026-08-31) produced one qualifying 2.669 km loop near Sai Wan Pavilion with all 356 directed edges checked against the source graph. The response was replayed for browser controls/export checks; no live conditions are claimed. Exporting while pins were hidden produced valid GPX with 357 track points, identical first/last coordinates and both mandatory waypoints retained. A mocked route failure stopped the pulse and displayed its specific reason. Physical iPhone testing remains outstanding.

A fresh Hong Kong backend integration run downloaded 49,593 OSM elements (5.96 MB) after a missing-transport extension, and returned three routes in 47 seconds including provider fallback and AFCD lookup. The previously failing sample (22.3893078, 114.3664416 → 22.3913284, 114.3663188) now has a 2.669 km first candidate in pin order, starting and finishing near Sai Wan Pavilion, with 1.214 km arrival and 1.051 km exit walks. Alternatives were 7.122 km and 7.612 km. All 2,394 generated segments across the three routes were checked against their actual downloaded OSM way segments. The downloaded OSM snapshot reports 2026-05-31; this is a software validation sample, not a hiking recommendation or proof of current conditions or transit service.

Browser checks used WebKit’s iPhone 16 Pro Max profile (440 CSS px wide) and desktop Chrome at 1280 × 800, alongside the earlier 1440 × 900, 615 × 773 and 320 px layout checks. Method-stage switching, scrolling, map pin deletion, ordering, coloured route toggles, Details and GPX download passed without horizontal page overflow. The live-backend response was replayed for repeatable visual/export checks; provider fallback was separately exercised in-browser with a deterministic network fixture and two actual worker calculations (initial 1 km, then the successful bounded expansion). The exported first-route GPX parsed correctly with 357 track points, visit order and approach/gap warnings. A mocked 422 failure preserved both input pins, hid stale route controls, and kept its specific reason visible above the collapsed dock. A physical iPhone has not been tested.

The control panel now uses five stage tabs, no visible text when minimized, input-specific tools and an external Details dialog. Informational panels are hidden inside the dock; necessary file actions and route/waypoint data remain. Loop start and finish markers are separated so neither letter hides the other.

Map matching follows downloaded geometry, with no invented joins. Missing access, terrain, permit, closure, timetable and real-world accuracy checks remain unresolved. A route’s provisional status and data timestamp are retained in the app and GPX. The core area is limited to 250 km² with at most two additional 20 km transport circles; downloads and graph size remain bounded. The shortest-found label refers to searched candidates, not a proof of the globally shortest constrained itinerary. Reordering is bounded to 8 pins; larger drafts retain pin order.

---

## Earlier validation record (2026-09-01)

## Automated checks

`npm test`: **33 passing tests**.

- Three distinct candidates visit every mandatory point and contain only existing source graph nodes/ways.
- Missing geometry, disconnected paths, an off-network waypoint or a stop without a service fails closed.
- Private/student-only access, known demanding terrain, conditional access, disused paths and unsuitable roads are excluded. Fords remain excluded unless the user enables a crossing that also matches Hong Kong AFCD trail geometry; other restrictions continue to win.
- Foot one-way restrictions affect connectivity and reversal. Distance and road limits are not relaxed.
- Order optimisation retains all places. Large searches and waypoint counts are rejected, not truncated.
- Existing image calibration, connected-pixel tracing, segment reversal and XML escaping tests still pass.
- Recognition rejects absent consent, arbitrary image URLs, bad signatures and unsupported/invalid coordinates.
- Private server rejects other origins and invalid app tokens, will not serve `.env` or source, and throttles bursts after three recognition attempts per minute per process.
- Vercel handler accepts its own origin plus the explicit GitHub Pages origin, supports safe endpoint discovery, rejects unauthorized calls, keeps the provider key server-side and resumes after the short burst window without a daily quota.
- No checkbox controls or removed confirmation gates remain. Route search and export use the existing action buttons, while AI candidates still require explicit selection and a valid coordinate.
- Authored planner, recognition and guidance fragments exactly match the generated single-file page; all static DOM IDs remain unique and all inline scripts parse.
- English and Traditional Chinese guidance cover all five input methods, every action state and each four-step route path. Language is presentation state and does not change the planning draft.
- The empty-map blocker is absent. Static interaction checks cover manual-pin right-click removal, the tap-accessible Remove button, bounded Ctrl/Command-wheel zoom and Leaflet touch-zoom wiring.
- The inline build is reproducible; Git diff has no whitespace errors. Candidate tracked files contain no detected key/token literals. `.env` and QA outputs are ignored.

## Real map-data checks

Live Overpass data downloaded on the test date; graph edges were checked against the actual source for every generated route. These are software test samples, **not hiking recommendations or proof of transport availability**.

| Sample | Waypoints tested | Result |
|---|---:|---|
| Hong Kong, Sai Wan area | 2 | 3 distinct candidates, all mandatory nodes visited |
| Taiwan, Yangmingshan area | 1 | 3 candidates linked to mapped bus-service stops |
| Japan, Takao area | 1 | 3 candidates linked to mapped transit-service stops |
| South Korea, central Seoul sample | 1 | 3 candidates; station entrances inherit the mapped station name |
| South Korea, northern mountain sample | 1 | Rejected: no eligible service-linked passenger stops in the queried area |
| Original Hong Kong example | 3 | Rejected: a required transit approach exceeded the chosen limit |

AFCD GeoJSON returned official trail records in a direct integration check. A browser request also exercised the unavailable-data path; the interface explicitly reported that government-managed coverage could not be established. The requests now run alongside the OSM query, with a bounded 35-second AFCD timeout. The final two-waypoint browser run returned three routes and successfully checked AFCD corridors. No fallback data is presented as a current official check.

Private.coffee was unavailable during several probes; VK Maps worked and is the current default. Provider choice is visible; there is no silent retry against another provider. Public map services can time out or rate-limit and are not a production availability guarantee.

## Browser checks

The real browser workflow produced three candidates from a live OSM request, displayed selected-route geometry and evidence, and downloaded a labelled route PNG. An observed GPX file parsed as GPX 1.1 with one continuous 341-point track and a provisional warning. Reversal swapped the route direction and repeated the instruction to review arrival, departure and trail access. No timetable or field safety validation was performed.

A synthetic provider fixture, clearly labelled as a test and never deployed, exercised the recognition UI. The supported candidate showed its coordinate and independent map link; the unknown candidate stayed blank. “Use selected places” stayed disabled whenever an included candidate lacked exactly one valid coordinate. After the private key was supplied, the real Kimi backend returned structured JSON for the synthetic calibrated-map fixture. It read A/B/C coordinates exactly and estimated the labelled START/END positions within about 25 m of their known synthetic values, with medium confidence and explicit approximation warnings. A second live call used a real OSM route-preview image from the Hong Kong browser test. Kimi identified the Sai Wan / Sai Kung area at medium confidence, but its suggested area centre was about 2 km from the known route and it left all three visible marker coordinates blank, with low-confidence evidence and questions. This is the intended fail-safe behavior: approximate area recognition does not become route input. The deployed Vercel function was then exercised with the public Trailcraft app icon as a deliberate non-map fixture; the authenticated request returned HTTP 200, `not_map` and zero waypoints. These tests do not establish performance on photographed, rotated, blurry or unfamiliar maps. The candidate UI requires explicit inclusion for every mandatory mark and a valid coordinate for every included candidate; calibration references can be excluded.

The earlier responsive UI was inspected at 440 × 956 (iPhone 16 Pro Max CSS viewport), 1440 × 900, 1280 × 800, and 320 × 740 with no horizontal document overflow. The new guide and map controls use the same responsive grid, readable phone input sizes and 44–48 px touch targets. The new gesture paths have automated/static coverage but have not been tested on a physical iPhone Safari. Existing checks do not certify GPS accuracy, offline navigation or device performance.

## Remaining activation and product limits

- Test more real labelled and ambiguous maps before claiming live recognition quality. The Vercel adapter is deployed and its authenticated request path has passed; GitHub Pages still cannot run the function itself.
- Current timetables, last departures, closures, permits, weather and terrain conditions are not automatically verified.
- Government trail geometry outside Hong Kong is not integrated. OSM hiking membership alone does not prove official management.
- Endpoints can be up to 80 m from the mapped passenger stop; that access gap is shown and never fabricated in GPX. Mandatory points must fall within the explicitly accepted path-node tolerance.
- Search bounds, incomplete OSM tagging and conservative exclusions can reject a route that is actually walkable. Candidate ranking is heuristic; three routes and global optimality are not guaranteed.
- The Vercel backend is deployed; the alternative Docker recipe has not been deployed. Private recognition has no daily request quota; monitor Kimi usage and billing as documented in AI_SETUP.md.
