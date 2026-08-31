# Private Kimi image recognition

The implementation is in `server/recognition.mjs` and the embedded recognition UI. It uses **kimi-k3**, vision input and JSON output, at the fixed official `https://api.moonshot.ai/v1/chat/completions` endpoint. It does not send the unsupported `thinking` override to K3. A model response is only a suggestion, never routing geometry or verified location evidence.

## Local use

1. Put your key in the ignored `.env` as `MOONSHOT_API_KEY=...`. Never put it in browser code, the endpoint field, an app access-code field, GitHub, screenshots or chat.
2. Run `node --env-file=.env server/recognition.mjs` with Node 24.
3. Open `http://127.0.0.1:8787/`. Its recognition endpoint is filled automatically. Upload/paste a map, optionally add a place-name clue, consent to sending the image, and choose Identify.
4. Review the suggested area and image markers. Independently verify or correct **each** coordinate. Unknown positions remain blank. Only then use the confirmed places for routing.

The repository's existing `.env` contained an empty key during this implementation. No successful live Kimi recognition has been verified. The backend and frontend failure path and mocked provider contract are tested; they do not substitute for a real model test.

## GitHub Pages deployment boundary

Pages serves public static files and cannot keep a Kimi key or run the private server. The public frontend therefore has **no configured recognition endpoint**. Manual calibration and route planning work without one.

To enable AI on the public page, deploy the server to a private HTTPS service with:

- `HOST=0.0.0.0`, the hosting platform's `PORT`, `MOONSHOT_API_KEY`, and `ALLOWED_ORIGIN=https://stanleycheng.github.io`.
- A separate random `TRAILCRAFT_ACCESS_TOKEN` of at least 32 characters. The server refuses remote startup without it and refuses using the Kimi key as this token. Origin checking is supplemental; the token provides authentication.
- **One running process/instance**, persistent `.runtime/` storage, TLS termination and a small host-level request/body budget. Do not scale replicas against separate ledgers. For public multi-user service, replace the shared access code with account authentication and a shared transactional quota store.
- `KIMI_DAILY_REQUEST_LIMIT` (default 12, maximum 100). Each attempted provider request reserves one count before sending; failures still count. It limits request count, not a guaranteed monetary spend. Each call also has a fixed token and image budget. The host's storage must survive restarts; failed/corrupt ledger reads pause recognition.

Set the endpoint ending `/api/recognize-map` and app access code in the page's private connection controls. They stay in memory only. Do not put the access code into a public config file. No remote backend has been deployed by this change; hosting access is still required.

## Security and accuracy controls

The server accepts only consented base64 PNG/JPEG/WebP images up to 2 MB, checks the file signature, rejects arbitrary image URLs, forwards only to the fixed Kimi endpoint, caps context length, accepts at most 16 returned markers, validates coordinates and confidence/basis fields, rejects truncated model output, and redacts upstream errors. The browser reserializes an image canvas before upload, stripping EXIF. Neither image bytes, clues, tokens nor model responses are written to server logs or storage.

One recognition request runs at a time, with three attempts/minute and a persistent daily request ledger. Different origins are rejected. Public files are allowlisted; `.env`, the usage ledger and server source cannot be read via the server. Keys are never sent to the browser. The private server's operator and Kimi still receive the image; the app makes no promise about the provider's retention policy.

AI sees image text as untrusted evidence. Place-name guesses and model confidence are not measured accuracy. If an image lacks a readable grid, labels or a unique landmark, the expected result is a request for more context. Camera GPS is not used to establish the depicted map's coordinates. Manual calibration remains available when recognition is unavailable or ambiguous.

[Official Kimi model guide](https://platform.kimi.ai/docs/guide/use-thinking-models), [vision guide](https://platform.kimi.ai/docs/guide/use-kimi-vision-model), [JSON output](https://platform.kimi.ai/docs/guide/use-json-mode-feature-of-kimi-api).
