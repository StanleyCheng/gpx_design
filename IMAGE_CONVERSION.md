# Pasted map → GPX

Select **Paste a route map → GPX**, then paste the image itself with the button or ⌘V / Ctrl+V. On supported iPhone browsers, accept the native Paste prompt. If clipboard image access is unavailable, choose a saved JPEG, PNG or WebP screenshot. The app never opens pasted links or HTML.

1. Use a flat map with a distinctive, continuous coloured route. Maximum input: 10 MB / 40 megapixels. Analysis is resized to a maximum 1,400 pixels on its longest edge.
2. Choose the map projection: Web Mercator for most online maps, or a straight latitude/longitude grid. Unknown projections, angled photographs, globe views, and dateline crossings are unsupported.
3. Mark A, B and C at three well-spaced known locations and enter their WGS84 latitude, longitude. These locations must not lie on a line. Identify them independently; EXIF usually describes the camera, not the depicted map. Incorrect anchors can create a plausible-looking but incorrect route.
4. Pick a pixel in the route colour. Mark start, necessary via points, then end. Via points select intended branches. For a loop, include intermediate points before returning to the start. Image zoom is available for precision; keyboard arrows and Enter can place points.
5. Extract and inspect the cyan overlay. The algorithm finds paths through adjacent pixels matching the chosen RGB colour tolerance. It does not close gaps or use AI-generated geometry. Same-colour intersections can select an unintended branch, so review the entire result.
6. Select **Replace draft with trace for review**, compare it on the basemap, and then save if it matches the source. That preview action enables export while the unverified warning remains visible. **Reverse route** reverses the exported direction as well as the visible start/end labels.

The GPX is an **unverified source transcription**, not a route validated for hiking. No official trail status, legal access, closures, terrain, elevation or public transport is inferred. Do not navigate from it without separate trail verification. Navigation apps may draw connecting lines across segments even though this app preserves segment boundaries.

Changing the image, calibration, colour, tolerance or route points invalidates the previous conversion and its review/download. It also removes that trace from the preview. Independent draft data is replaced only when you explicitly preview the trace.

Manual calibration and tracing are local; neither the image nor calibration is sent to Kimi by that workflow. The separate Identify action can send a resized, metadata-stripped image and optional clue to a configured private recognition server. The public page never reads `.env` or contains API keys.

The browser clipboard implementation follows [MDN’s Clipboard.read documentation](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/read) and [paste-event guidance](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event), checked through Context7. Paste permission and Share/Save to Files behavior depend on the browser and operating system.
