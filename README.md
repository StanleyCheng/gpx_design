# Trailcraft — GPX planning preview

Live site: https://stanleycheng.github.io/gpx_design/

A responsive single HTML page with embedded application CSS and JavaScript. Hosted on GitHub Pages. **This is an initial planning interface, not a completed routing or navigation app.**

## Implemented

- Decimal WGS84 coordinates: newline/CR, commas, spaces, or semicolons; explicit range and input validation.
- Local TXT/CSV and GPX import. GPX track segments remain separate and unverified; numeric source elevations are preserved. No invented connections, snapping, repair, or elevation statistics.
- Local JPEG/PNG/WebP review and EXIF GPS reading. GPS is never automatically added; user confirmation is required. It may describe the camera position rather than the area depicted.
- Full-width responsive OpenStreetMap preview, numbered pins, map-click pin placement, fit-to-draft, and waypoint removal.
- PNG of already displayed map tiles, with attribution and a prominent planning warning. No tile bulk download or offline map packaging.
- Reverse route: reverse waypoint order, segment order, and every segment’s point order. Start/end labels reflect the current geometry. GPX export preserves source segments and their gaps; coordinate-only drafts remain waypoint-only. Timestamps and unsupported GPX extensions are not re-exported.
- Paste route map → GPX: clipboard image button, keyboard paste, and file-upload fallback. On-device colour tracing after three-point geographic calibration, followed by mandatory image and basemap review. See [IMAGE_CONVERSION.md](IMAGE_CONVERSION.md).
- Larger phone controls, safe-area spacing, responsive image zoom, scroll-friendly map exploration, persistent download links, and native file sharing where supported.
- Matching browser favicon and iPhone Home Screen icon, plus a web app manifest. No offline mode is claimed.
- Three explicitly pending route-comparison categories; no fabricated route candidates or safety scores.

## Still required for the full product

1. Decide regional coverage and authoritative government trail sources.
2. Connect a real path graph and the `gpx-trail-fix` workflow: use OSM way geometry, verify hiking relations, and separately substantiate government management.
3. Check legal access, closures, trail conditions and terrain suitability. Missing critical evidence must not silently pass.
4. Verify start/end transit for the hike date and time, including last departures and service caveats.
5. Confirm user constraints, mandatory waypoint order, permitted connectors, difficulty limits, and fallback policy.
6. Generate up to three distinct qualifying routes, with distance/ascent provenance. Return fewer when fewer qualify.
7. Add automatic map geolocation and waypoint recognition. Current image conversion is assisted, limited to flat maps and continuous coloured lines, and requires independently known reference coordinates.
8. Enable verified navigation-route generation only after the routing and evidence workflow exists. Raw source exports are explicitly unverified references. The Python helper from `gpx-trail-fix` does not execute in this static page.

## Run and deploy

Serve only the public files with a static HTTP server and open localhost. Do not expose `.env`, even on a development server. No build step. Publish the `main` branch root in repository Settings → Pages. `.nojekyll` disables Jekyll processing.

Application code is in `index.html`. Leaflet 1.9.4, Exifr 7.1.3, Google Fonts, and the basemap load online; this is not a fully offline file. Library versions are pinned. Leaflet assets use integrity hashes.

## Privacy and safety

Files are processed in the browser, never uploaded by this application. Drafts are held only in memory. Optional Google Analytics loads only after visitor consent and only on the production site. Coordinates, filenames, files, typed text, query strings and referrer URLs are excluded. Enhanced measurement and advertising features are disabled. Privacy settings allow withdrawal, and browser privacy signals disable analytics. See [ANALYTICS.md](ANALYTICS.md). Hosting, fonts, CDNs and map providers receive normal browser requests; map tile requests reveal the viewed area and IP address. Do not mistake local file processing for total network privacy.

No API keys or account sign-in are included in the public app. Kimi is selected as the future AI provider, model `kimi-k3`; the private `.env` is ignored by Git. AI is not active. See [AI_SETUP.md](AI_SETUP.md) for the backend requirement.

Imported GPX tracks and digitized image traces are input evidence only, not proof of a traversable path. GPX export is a source transcription in the current direction, not a repaired or certified route. The `gpx-trail-fix` rule requiring OSM graph geometry still applies to future generated/repaired hiking routes; raw image references do not satisfy that rule. No route is certified safe.

Run the geometry/export safety checks with `node --test tests/image-converter.test.cjs`. See [RESPONSIVE_QA.md](RESPONSIVE_QA.md) for screen and browser checks.

## Design

Field-notebook editorial style, with DM Serif Display / DM Sans, paper `#f7f6f0`, forest `#263e35`, and clay `#bc4827`. Contour lines and a numbered field note form the visual anchor; interaction and warnings take priority over decoration. Responsive layout and reduced-motion support. Design feasibility score: 14 (impact 4, fit 5, feasibility 5, performance 4, consistency risk 4).

## Documentation

- [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Pages REST API](https://docs.github.com/en/rest/pages/pages)
- [Leaflet 1.9.4](https://leafletjs.com/reference.html)
- [Exifr](https://github.com/MikeKovarik/exifr)
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

Documentation checked through Context7 MCP and the official sources during initial development.
