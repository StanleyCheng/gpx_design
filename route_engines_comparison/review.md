# Code review and robustness changes

Reviewed 2026-09-06 against baseline `9403420`, focusing on `lib/route-engine.js`, `lib/planner-ui.js`, `api/plan-routes.mjs`, the generated frontend and relevant tests. Existing uncommitted marker/UI changes in `index.html` and `tests/ui-integrity.test.cjs` were preserved. This is a routing-focused review, not a claim that every unrelated image-conversion or recognition path was re-audited.

## Findings addressed

| Priority | Finding and effect | Resolution |
| --- | --- | --- |
| P1 | Snap offset outranked route length; the nearest connected snap could cause a long detour | Distance-first layered selection, with offset and stable identity as tie-breakers |
| P1 | Loop snap selection optimized an open chain before adding the return | Evaluate retained anchors with directed closure cost in the final layer |
| P1 | Snap selection ignored arrival/departure services; a connected but unserviced component could displace a usable one | Include bounded serviced approaches during open-route snap selection |
| P1 | Invalid numeric core settings such as `NaN` could bypass comparisons | Reject non-finite, negative or ambiguous settings before graph processing |
| P1 | Request size was checked after reading the full body | Count streamed request bytes and cancel immediately when exceeding 64,000 bytes |
| P1 | The server's timeout timer could not interrupt synchronous routing computation | Pass a real deadline into graph work and check it during construction/search, in addition to the abort signal |
| P2 | A tree for every pin retained large Maps; empty targets and repeated trail variants did unnecessary work | Keep compact paths; target-aware A*/Dijkstra; matrix reuse; lazy trail approaches |
| P2 | Eight large cached map responses could retain up to 512 MiB of wire data, with greater parsed heap cost | Bound total cached map wire bytes to 64 MiB and official data to 12 MiB; prune expired entries when adding data; retain the count cap |
| P2 | Cancelling a worker terminated it but left its promise unsettled; startup failures could leak a worker reference | Abort listener settles and cleans up the worker; cleanup also runs on postMessage and worker errors |
| P2 | Reversing a loop reversed its visit list away from waypoint 1 and left the closing-leg distance wrong | Keep the loop anchor first and recalculate the reversed mapped closing distance |
| P2 | Reversibility accepted any parallel reverse edge, even if it belonged to a different way | Require the same selected source-segment identity in reverse |
| P2 | Fuzzy projection merging could report a different pin coordinate than the route actually visited | Merge only identical projected coordinates |
| P2 | Way-tagged fords without ford-tagged nodes were absent from route warnings | Disclose admitted way-level fords once per source way, including retraced loops |
| P2 | Reordering was enabled by default despite the ordered-pin workflow | Default to strict order; retain an explicit different-order choice |

Removed redundant code includes duplicate numeric-choice validation, the unused transport-loop endpoint filtering mode, obsolete loop-stop preference/pruning logic, redundant boolean coercion, repeated trail-matrix computation, and dynamic-program initialization for anchors with no starts. The build still embeds authored modules; that generated duplication is required by the single-file delivery format.

## Verification

- `npm test`: **106 tests passed**. Existing regression suite plus new independent shortest-path, snapping, loop, transport, request-streaming, deadline, reversal and worker-lifecycle cases.
- New distance oracle: all source/target pairs in both directions on a directed nine-node graph, compared with Floyd–Warshall independently of the engine's search.
- Deterministic performance fixture and executable benchmark in `scripts/benchmark-routing.cjs`; results and limitations in [comparison.md](comparison.md).
- Browser smoke test of the rebuilt local app: coordinate entry accepts two points, advances to Requirements, renders both pins, enables Find and shows **Keep pin order for every route** selected.
- Inline/generated-source integrity and build checks are part of the existing test/build workflow.

No production deployment or new live-provider route validation was performed in this review. The browser smoke test did not invoke the production route backend. Existing live-map checks in `ROUTING_QA.md` remain historical evidence for their recorded snapshots.

## Remaining engineering priorities

1. **Constrained shortest paths:** scalar road penalties plus candidate rejection can miss a valid route under a strict road cap. Implement a resource-constrained solver if exact feasibility is required; see the concrete state/label proposal in [comparison.md](comparison.md).
2. **Map coverage and snapping:** index eligible segments spatially to reduce the current `pins × segments` scan. Add bounded walking-corridor expansion and surface candidate pruning. Transport stops still use the nearest graph node within 80 m; segment projection and connected multi-candidate stop snapping would improve long-segment and multi-level station handling.
3. **Graph semantics:** add fixtures and explicit policies for pedestrian turn-restriction relations, directional access tags beyond `oneway:foot`, and complex indoor levels. A shared node plus current exclusions does not model every OSM rule. Keep unmodelled conditional access excluded until time-aware evaluation exists.
4. **Load isolation:** deadline checks bound an individual computation cooperatively, but do not free the event loop during that work. Worker-thread isolation, concurrency limits, in-flight request coalescing, and a prepared regional graph are the next steps for sustained concurrent traffic.
5. **Memory accounting:** cache budgets measure wire bytes, not parsed heap size. JSON parsing and graph construction still have transient allocations. Profile peak resident memory with representative dense maps before raising download, candidate or element limits.
6. **Local backend parity:** the frontend still points at the existing Vercel route endpoint and the local recognition server does not host routing. Add a configurable/same-origin routing endpoint and a local adapter for end-to-end testing of newly edited routing code against live downloads without deployment.

The result is a more efficient and better aligned ordered-pin planner within its documented downloaded-map and candidate limits. It does not establish current physical access, worldwide optimality, or an exact solution under every additional constraint.

## Path eligibility and difficulty-display follow-up

The shared routing policy now has an explicit harder-hiking opt-in, per-edge difficulty evidence, pedestrian-specific smoothness handling and inactive highway lifecycle exclusions. The independent **Difficulty** switch below the right-hand route toggles changes visible route colors immediately without recalculation. Easy grades are green, T2–T3 pink, T4–T6 red, and unknown grades gray. Normal option colors remain the default.

The updated API identifies its graph policy in results and response headers, allowing the page to reject outdated eligibility decisions and use bounded local fallback. Current-policy errors and request/rate/size limits are preserved. All **128 tests passed** after these changes, and a separate local browser preview verified the switch position and immediate T2 recoloring using the recorded public High Junk Peak snapshot. No production deployment was performed.
