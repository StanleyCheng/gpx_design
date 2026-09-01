# Routing and recognition validation — 2026-09-01

## Automated checks

`node --test tests/*.test.cjs tests/*.test.mjs`: **31 passing tests**.

- Three distinct candidates visit every mandatory point and contain only existing source graph nodes/ways.
- Missing geometry, disconnected paths, an off-network waypoint or a stop without a service fails closed.
- Private/student-only access, known demanding terrain, conditional access, fords, disused paths and unsuitable roads are excluded.
- Foot one-way restrictions affect connectivity and reversal. Distance and road limits are not relaxed.
- Order optimisation retains all places. Large searches and waypoint counts are rejected, not truncated.
- Existing image calibration, connected-pixel tracing, segment reversal and XML escaping tests still pass.
- Recognition rejects absent consent, arbitrary image URLs, bad signatures and unsupported/invalid coordinates.
- Private server rejects other origins and invalid app tokens, will not serve `.env` or source, and throttles bursts after three recognition attempts per minute per process.
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

A synthetic provider fixture, clearly labelled as a test and never deployed, exercised the recognition UI. The supported candidate showed its coordinate and independent map link; the unknown candidate stayed blank. “Use selected places” stayed disabled whenever an included candidate lacked exactly one valid coordinate. After the private key was supplied, the real Kimi backend returned structured JSON for the synthetic calibrated-map fixture. It read A/B/C coordinates exactly and estimated the labelled START/END positions within about 25 m of their known synthetic values, with medium confidence and explicit approximation warnings. A second live call used a real OSM route-preview image from the Hong Kong browser test. Kimi identified the Sai Wan / Sai Kung area at medium confidence, but its suggested area centre was about 2 km from the known route and it left all three visible marker coordinates blank, with low-confidence evidence and questions. This is the intended fail-safe behavior: approximate area recognition does not become route input. These two tests do not establish performance on photographed, rotated, blurry or unfamiliar maps. The candidate UI requires explicit inclusion for every mandatory mark and a valid coordinate for every included candidate; calibration references can be excluded.

The earlier responsive UI was inspected at 440 × 956 (iPhone 16 Pro Max CSS viewport), 1440 × 900, 1280 × 800, and 320 × 740 with no horizontal document overflow. The new guide and map controls use the same responsive grid, readable phone input sizes and 44–48 px touch targets. The new gesture paths have automated/static coverage but have not been tested on a physical iPhone Safari. Existing checks do not certify GPS accuracy, offline navigation or device performance.

## Remaining activation and product limits

- Add the private Kimi key locally, deploy a separately authenticated HTTPS server, and test real labelled and ambiguous maps before claiming live recognition quality. GitHub Pages cannot run this server.
- Current timetables, last departures, closures, permits, weather and terrain conditions are not automatically verified.
- Government trail geometry outside Hong Kong is not integrated. OSM hiking membership alone does not prove official management.
- Endpoints can be up to 80 m from the mapped passenger stop; that access gap is shown and never fabricated in GPX. Mandatory points must fall within the explicitly accepted path-node tolerance.
- Search bounds, incomplete OSM tagging and conservative exclusions can reject a route that is actually walkable. Candidate ranking is heuristic; three routes and global optimality are not guaranteed.
- Docker deployment recipe is supplied but has not been built or deployed on a remote host. Private recognition has no daily request quota; monitor Kimi usage and billing as documented in AI_SETUP.md.
