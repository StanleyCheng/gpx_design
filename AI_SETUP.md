# Private Kimi image recognition

The implementation is in `server/recognition.mjs` and the embedded recognition UI. It uses **kimi-k3**, vision input and JSON output, at the fixed official `https://api.moonshot.ai/v1/chat/completions` endpoint. It does not send the unsupported `thinking` override to K3. Image extraction uses K3’s supported `reasoning_effort: "low"` setting to reduce latency and cost while keeping structured vision output. A model response is only a suggestion, never routing geometry or verified location evidence.

## Local use

1. Put your key in the ignored `.env` as `MOONSHOT_API_KEY=...`. Never put it in browser code, the endpoint field, an app access-code field, GitHub, screenshots or chat.
2. Run `node --env-file=.env server/recognition.mjs` with Node 24.
3. Open `http://127.0.0.1:8787/`. Its recognition endpoint is filled automatically. Upload/paste a map and optionally add a place-name clue. The disclosure beside the Identify button explains that selecting it sends the image and clue to the configured server and Kimi.
4. Review the suggested area and image markers. Select only the places the route must visit, and independently verify or correct each selected coordinate. Unknown positions remain blank and block use while selected.

The repository's ignored `.env` now contains a configured key. A successful live call on the synthetic calibrated-map fixture is recorded below and in `ROUTING_QA.md`; it proves the private request/response path, not accuracy on arbitrary real maps.

## GitHub Pages deployment boundary

Pages serves public static files and cannot keep a Kimi key or run the private server. The public frontend therefore has **no configured recognition endpoint**. Manual calibration and route planning work without one.

To enable AI on the public page, deploy the server to a private HTTPS service with:

- `HOST=0.0.0.0`, the hosting platform's `PORT`, `MOONSHOT_API_KEY`, and `ALLOWED_ORIGIN=https://stanleycheng.github.io`.
- A separate random `TRAILCRAFT_ACCESS_TOKEN` of at least 32 characters. The server refuses remote startup without it and refuses using the Kimi key as this token. Origin checking is supplemental; the token provides authentication.
- TLS termination and host-level request/body controls. Recognition is private to the owner through the separate access token. There is no daily request quota; monitor the Kimi account's usage and billing directly.

Set the endpoint ending `/api/recognize-map` and app access code in the page's private connection controls. They stay in memory only. Do not put the access code into a public config file. No remote backend has been deployed by this change; hosting access is still required.

## Security and accuracy controls

The server accepts only user-initiated requests marked with the consent protocol flag and base64 PNG/JPEG/WebP images up to 2 MB, checks the file signature, rejects arbitrary image URLs, forwards only to the fixed Kimi endpoint, caps context length, accepts at most 16 returned markers, validates coordinates and confidence/basis fields, rejects truncated model output, and redacts upstream errors. The browser sends that request only when Identify is selected and reserializes the image canvas before upload, stripping EXIF. Neither image bytes, clues, tokens nor model responses are written to server logs or storage.

One recognition request runs at a time per server process, with three attempts/minute. Different origins are rejected. Public files are allowlisted; `.env` and server source cannot be read via the server. Keys are never sent to the browser. The private server's operator and Kimi still receive the image; the app makes no promise about the provider's retention policy.

AI sees image text as untrusted evidence. Place-name guesses and model confidence are not measured accuracy. If an image lacks a readable grid, labels or a unique landmark, the expected result is a request for more context. Camera GPS is not used to establish the depicted map's coordinates. Manual calibration remains available when recognition is unavailable or ambiguous.

[Official Kimi model guide](https://platform.kimi.ai/docs/guide/use-thinking-models), [vision guide](https://platform.kimi.ai/docs/guide/use-kimi-vision-model), [JSON output](https://platform.kimi.ai/docs/guide/use-json-mode-feature-of-kimi-api).
