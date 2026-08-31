# Kimi integration boundary

The selected AI provider is **Kimi**, with model **`kimi-k3`**. The model name and the global `https://api.moonshot.ai/v1` endpoint were verified in the official Kimi documentation through Context7 MCP.

Place your API key in the local `.env` file as `MOONSHOT_API_KEY=...`. The file is excluded from Git and must never be deployed to GitHub Pages. `.env.example` contains names and non-secret defaults only.

This release has **no AI backend and makes no Kimi calls**. Pasted-map conversion runs locally using user-provided calibration and colour-based pixel tracing; it does not require AI. Adding a key does not enable recognition yet. GitHub Pages serves static public files and cannot keep an API key secret or execute a private backend. Do not add a client-side key input, expose the key through build-time substitution, or commit `.env` to make this work.

The next implementation should deploy a separate server endpoint which:

1. Loads the secret from the hosting provider's secret environment, and selects `KIMI_MODEL=kimi-k3` without silently substituting another model.
2. Authenticates callers as appropriate, restricts origin, caps image size and output tokens, rate-limits requests, and enforces a cost budget. CORS alone is not access control.
3. Sends a map image to Kimi only after the user explicitly chooses AI recognition and is told the provider will receive the image.
4. Returns proposed location/waypoint candidates and uncertainty. It must not treat the model as a source of actual trail geometry or claim that a route is safe.
5. Requires manual confirmation of extracted locations, then validates them against real trail geometry and official access and transport sources.
6. Redacts secrets and file contents from logs and error responses. No secret is ever returned to the browser.

Provider reference: [Kimi thinking models](https://platform.kimi.ai/docs/guide/use-thinking-models).
