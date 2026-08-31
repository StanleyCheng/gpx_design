# Google Analytics

- Property: **Trailcraft — GPX Design**
- Property ID: **552206689**
- Web stream: **Trailcraft GitHub Pages**
- Stream ID: **15532103444**
- Measurement ID: **G-YF4QD5R18X** (public, not an API secret)
- Site: https://stanleycheng.github.io/gpx_design/
- Reporting time zone: **Hong Kong, UTC+08:00**
- Currency: **HKD**
- [Open Analytics](https://analytics.google.com/analytics/web/#/a18442354p552206689/reports/intelligenthome)

The property was created in the owner's existing Analytics account. Existing properties were not modified.

## Privacy and consent

The Google tag is loaded only on the production site and only after the visitor selects **Allow analytics**. Before consent, this app sends no Google Analytics requests, including cookieless pings. Declining has no effect on planning features. Global Privacy Control or Do Not Track keeps analytics off. The choice is kept locally for up to 180 days. Analytics cookies are prefixed for Trailcraft, host-only, scoped to `/gpx_design/`, and set to expire after 90 days.

Use **Privacy settings** in the footer to change the choice. Withdrawal disables collection and deletes this project's analytics cookies. Previously collected data is not automatically erased.

Enhanced measurement is disabled in the web stream. Google signals and advertising personalization are disabled in the tag configuration. No advertising integrations or Measurement Protocol secrets were created.

## Collected events

The tag sends one explicit `page_view` after initialization with a fixed canonical page URL and title and an empty referrer. These fixed action names are allowlisted, with no user-generated parameters:

- `waypoints_previewed`
- `file_imported`
- `photo_reviewed`
- `photo_gps_confirmed`
- `map_pin_added`
- `gpx_exported`
- `png_exported`
- `draft_discarded`

Standard Analytics session, engagement, browser/device and approximate geographic information may also be collected after consent. Never add coordinate values, routes, filenames, photos, form values, GPX contents, query strings, or personal identifiers to events.

## Verification

On the production site, allow analytics and perform an import or export. Check the property's Realtime report. Localhost and other previews never send analytics. Blocking extensions, browser privacy signals, and a declined consent choice prevent tracking. Google reports that initial data collection may take up to 48 hours; immediate dashboard population is not guaranteed.
