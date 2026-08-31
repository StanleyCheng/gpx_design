# Responsive and workflow verification

Checked 2026-08-31 using the Codex in-app browser on macOS. Viewports emulate screen dimensions, **not physical devices or Safari/WebKit**.

| Viewport | Result |
| --- | --- |
| iPhone 16 Pro Max portrait, 440 × 956 CSS pixels | No page overflow; 16 px text inputs; 48 px primary map/export controls; stacked converter |
| iPhone 16 Pro Max landscape, 956 × 440 | No page overflow; shorter map; usable controls |
| MacBook-sized, 1366 × 768 | No page overflow; desktop form and converter columns |
| Desktop, 1920 × 1080 | No page overflow; wide map and converter |
| Tablet, 768 × 1024 | No page overflow; image converter stacked |
| Small phone, 320 × 740 | No page overflow; export controls stack |

The 440 × 956 logical size is listed in [Apple’s layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout). Safe-area CSS, `viewport-fit=cover`, and dynamic/small viewport units account for supported mobile browser chrome. Layout tests do not reproduce a physical notch, virtual keyboard, or home indicator.

Verified through the visible UI:

- Coordinate import/reversal; invalid input leaves the existing draft intact.
- GPX import/reversal/export. Downloaded XML retained two distinct two-point segments, reversed endpoints, and elevations in reversed order; no gap connector was created.
- Synthetic map calibration, coloured-line extraction, overlay review gating, basemap preview, reversal and downloaded image-trace GPX.
- Changing calibration invalidates the trace, review and download, and removes its stale preview.
- Image zoom stays inside its own scroll area without widening the page.
- Map Explore/Done controls enable and disable interaction on compact screens. Resizing preserves the draft and refits it.
- PNG creation, persistent download link, discard dialog and disabled states after discard.
- No application console warnings or errors during these workflows.

Eight automated checks in `tests/image-converter.test.cjs` cover coordinate transforms, unstable calibration rejection, pixel-path fidelity, disconnected-line rejection, invalid colour/route points, reverse-twice identity, preserved segment gaps/elevations, and escaped XML without fabricated tracks. Run `node --test tests/image-converter.test.cjs`.

Native clipboard permission prompts, the system Share/Save to Files sheet, physical iPhone Safari, and Windows browsers still need device testing. Clipboard ingestion was reviewed against current documentation; file upload was used for the controlled conversion tests. The file-upload fallback remains available when native clipboard access is unavailable. No claim of fully automatic image geolocation, trail safety verification, or offline capability is made.
