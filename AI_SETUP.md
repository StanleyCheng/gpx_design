# Private Kimi image recognition

The implementation is in `server/recognition.mjs` and the embedded recognition UI. It uses **kimi-k3**, vision input and JSON output, at the fixed official `https://api.moonshot.ai/v1/chat/completions` endpoint. It does not send the unsupported `thinking` override to K3. Image extraction uses K3’s supported `reasoning_effort: "low"` setting to reduce latency and cost while keeping structured vision output. A model response is only a suggestion, never routing geometry or verified location evidence.

## Local use

1. Put your key in the ignored `.env` as `MOONSHOT_API_KEY=...`. Never put it in browser code, the endpoint field, an app access-code field, GitHub, screenshots or chat.
2. Run `node --env-file=.env server/recognition.mjs` with Node 24.
3. Open `http://127.0.0.1:8787/`. Its recognition endpoint is filled automatically. Upload/paste a map and optionally add a place-name clue. The disclosure beside the Identify button explains that selecting it sends the image and clue to the configured server and Kimi.
4. Review the suggested area and image markers. Select only the places the route must visit, and independently verify or correct each selected coordinate. Unknown positions remain blank and block use while selected.

The repository's ignored `.env` now contains a configured key. A successful live call on the synthetic calibrated-map fixture is recorded below and in `ROUTING_QA.md`; it proves the private request/response path, not accuracy on arbitrary real maps.

## Vercel setup

GitHub Pages cannot keep a Kimi key or run the private server. This repository now includes a Vercel Node.js Function at `/api/recognize-map`, a 120-second function configuration and a static allowlist build. The Kimi key never enters `index.html` or the browser.

1. Sign in at [Vercel](https://vercel.com/) with the GitHub account that can access `StanleyCheng/gpx_design`.
2. Choose **Add New → Project**, import `StanleyCheng/gpx_design`, keep the repository root as the Root Directory and choose the Hobby plan only for personal, non-commercial use. `vercel.json` selects the Other framework preset, build command and `dist` output.
3. Deploy once. The page will work, while recognition will return a safe configuration error until secrets are added.
4. Open **Project → Settings → Environment Variables**. Add these for **Production**:
   - `MOONSHOT_API_KEY`: copy the value from the ignored local `.env`; enable **Sensitive**.
   - `TRAILCRAFT_ACCESS_TOKEN`: generate a different random owner code with `openssl rand -hex 32`; enable **Sensitive**. Save this code in a password manager. Never use the Kimi key as this code.
   - `ALLOWED_ORIGIN`: `https://stanleycheng.github.io` if the GitHub Pages copy will call this backend. This value is an origin allowlist, not a secret. Multiple origins may be comma-separated.
5. Open **Settings → Functions** and confirm **Fluid Compute** is enabled. New projects normally enable it. The Kimi call can take longer than the older Hobby function window.
6. Redeploy the latest production deployment. Vercel environment-variable changes apply only to new deployments.
7. Open the production `*.vercel.app` URL. The page discovers its same-origin recognition endpoint automatically. Expand **Private recognition connection**, enter the `TRAILCRAFT_ACCESS_TOKEN` owner code, upload a map and select **Identify map & waypoints**. Never enter the Kimi key in the page.

To keep using GitHub Pages, enter `https://YOUR-VERCEL-DOMAIN/api/recognize-map` and the owner code in its private connection fields. Both stay only in browser memory for the current visit. The Vercel function accepts the Vercel page on the same origin and only the extra origins listed in `ALLOWED_ORIGIN`.

Do not add the Kimi key to GitHub Actions, `vercel.json`, source files or any variable prefixed with `NEXT_PUBLIC_`. Production-only sensitive variables also prevent untrusted preview deployments from using the live Kimi account. There is no daily recognition quota; monitor Kimi usage and billing directly. A short three-attempts-per-minute guard remains per warm function instance.

The equivalent CLI flow, after installing the Vercel CLI, is `vercel login`, `vercel link`, `vercel env add MOONSHOT_API_KEY production --sensitive`, `vercel env add TRAILCRAFT_ACCESS_TOKEN production --sensitive`, `vercel env add ALLOWED_ORIGIN production`, and `vercel --prod`. Enter secret values only at the CLI prompts; do not put them directly in shell commands.

## Security and accuracy controls

The server accepts only user-initiated requests marked with the consent protocol flag and base64 PNG/JPEG/WebP images up to 2 MB, checks the file signature, rejects arbitrary image URLs, forwards only to the fixed Kimi endpoint, caps context length, accepts at most 16 returned markers, validates coordinates and confidence/basis fields, rejects truncated model output, and redacts upstream errors. The browser sends that request only when Identify is selected and reserializes the image canvas before upload, stripping EXIF. Neither image bytes, clues, tokens nor model responses are written to server logs or storage.

One recognition request runs at a time per warm server process, with three attempts/minute. Serverless instances may scale independently, so the access token is the primary privacy boundary. Different origins are rejected. The Vercel build publishes only the HTML, icons and web manifest; `.env`, tests, documentation and server source are not static files. Keys are never sent to the browser. Vercel and Kimi still receive the recognition request; the app makes no promise about either provider's retention policy.

AI sees image text as untrusted evidence. Place-name guesses and model confidence are not measured accuracy. If an image lacks a readable grid, labels or a unique landmark, the expected result is a request for more context. Camera GPS is not used to establish the depicted map's coordinates. Manual calibration remains available when recognition is unavailable or ambiguous.

[Official Kimi model guide](https://platform.kimi.ai/docs/guide/use-thinking-models), [vision guide](https://platform.kimi.ai/docs/guide/use-kimi-vision-model), [JSON output](https://platform.kimi.ai/docs/guide/use-json-mode-feature-of-kimi-api).
