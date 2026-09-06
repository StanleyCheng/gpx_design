# Route engines and shortest routes through ordered pins

Reviewed 2026-09-06. Repository baseline: `9403420`. This comparison separates routing algorithms from hosted or self-hosted routing products. Product capabilities were checked against primary documentation; Context7 was unavailable in this session. Product performance has **not** been benchmarked against this application.

## Decision and implementation

**The best fit for this application now is its existing OSM graph with A* for individual legs, targeted Dijkstra for multiple destinations, and layered distance optimization for waypoint snaps.** This is the implementation selected and integrated in `lib/route-engine.js`, shared by the server and browser worker.

The app already has specific pedestrian exclusions, source-way evidence, AFCD corridor matching, explicit ford consent, service-linked transit endpoints, and a standalone HTML build. Replacing that pipeline with a generic route response would require rebuilding and validating those features. The chosen approach improves the actual optimization objective and computation without a new runtime dependency or external service.

For a future dedicated regional routing service, **Valhalla is my first product to evaluate**, subject to the same access, geometry and transport regression cases. This is an architectural recommendation, not a measured performance winner.

## Algorithm comparison

| Technique | Pros | Cons / limits | Decision for this app |
| --- | --- | --- | --- |
| Heap Dijkstra | Exact with nonnegative costs; supports directed edges, several destinations and multi-source searches; simple reference implementation | Explores in every direction; retaining a full tree for every pin consumes memory | Keep for multiple destinations, transport approaches and layered snap transitions; stop once requested targets settle |
| A* with great-circle lower bound | Exact for the supported costs; guides an individual leg toward its target; no preprocessing; works after segment splitting and with changing preferences | A weak heuristic helps less on winding paths or unreachable targets; overestimating the heuristic would invalidate shortest-path guarantees | **Use for a single destination**, including reverse-graph searches; keep Dijkstra available for regression comparisons |
| Bidirectional Dijkstra / A* | Can reduce the search region further on long legs | More complex termination and path reconstruction; bidirectional A* needs a sound potential and stopping rule; limited benefit for the layered multi-source stage | Reconsider after real-map profiling; do not introduce solely because it is often fast |
| Contraction hierarchies / landmark preprocessing | Attractive for repeated queries on a stable regional graph | Graph preparation, storage and invalidation; per-request virtual pins and preference changes complicate integration | Appropriate for a dedicated service, excessive for a freshly downloaded bounded graph |
| Layered shortest-distance optimization | Chooses a consistent snap for every ordered pin across the entire chain; avoids independent nearest-snap detours; incorporates endpoint or loop-return costs | Still limited to retained snap candidates; loops require examining possible anchors; a separate road budget is not represented in the scalar objective | **Use to choose snaps before leg construction** |
| Held–Karp visit-order dynamic program | Exact visit ordering for a supplied small distance/cost matrix, including a fixed loop anchor | Exponential in pin count; answers a different question when the user specified order; does not jointly reoptimize snaps or solve road-resource limits | Keep only as an explicit optional alternative for up to 8 pins |
| Pareto-label resource-constrained search | Can minimize distance while also respecting a total road allowance | Multiple labels per node; potentially large time/memory use; needs explicit bounds and exhaustion reporting | Recommended next step when exact routing under a nonzero road cap is required |

A* requires an admissible heuristic. Here every graph edge is measured in great-circle metres and every supported preference/penalty multiplier is at least one. Great-circle distance to the target is therefore a lower bound on remaining cost. The implementation does not use an inflated heuristic. See the [original A* paper](https://ai.stanford.edu/~nilsson/OnlinePubs-Nils/PublishedPapers/astar.pdf) and [NetworkX's documented admissibility requirement](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.shortest_paths.astar.astar_path.html).

## Routing product comparison

| Engine / service | Pros for this application | Cons / integration work | Assessment |
| --- | --- | --- | --- |
| Current OSM + A*/Dijkstra hybrid | Preserves all existing access decisions and source-way IDs; supports projected pins, directed loops, regional evidence and transit selection; no new packages | Public Overpass availability and download cost; app owns graph semantics and search limits; no global graph, instructions or closure feed | **Best immediate fit; implemented** |
| Valhalla | Pedestrian costing; distance-only `shortest`; ordered locations; flexible costing on a regional graph | Must reproduce app-specific access/ford policy and transit evidence; snapping and returned evidence require conformance tests; hosting and regional updates are operational work | Best candidate for a future dedicated backend |
| GraphHopper | Custom routing models, configurable profiles and alternative routing; useful basis for a prepared regional graph | A large `distance_influence` expresses preference rather than, by itself, proving pure distance optimization; must verify the complete weighting; bespoke evidence and transport layer remain | Strong alternative if custom profile management is the priority |
| openrouteservice | Walking profiles; avoidance controls for fords, ferries and steps; directions and snapping services | Profile defaults and service limits must match this app's 50-pin/local-area needs; AFCD matching and service-linked endpoints remain application work | Useful hosted prototype or self-hosted candidate |
| OSRM | Prepared graph and ordered route API; node annotations; nearest and matrix services | Standard route API finds the fastest route; matrix distances can be distances of fastest routes; the extracted profile determines the actual travel mode | Lower fit without a verified foot/distance extraction profile |

Valhalla documents that `shortest` uses distance and ignores other penalties; pedestrian hierarchies are disabled by default. Its normal pedestrian profile still has preferences, so those defaults should not be confused with pure metres. [Valhalla route and costing reference](https://valhalla.github.io/valhalla/api/route/api-reference/).

GraphHopper's examples explain configurable route weighting and distance preference. Profile behavior would need to be checked with independent shortest-distance fixtures before migration. [GraphHopper custom routing examples](https://www.graphhopper.com/blog/2020/05/31/examples-for-customizable-routing/).

openrouteservice documents pedestrian avoidance options and factors that can prefer greener or quieter ways over shorter ones. [openrouteservice routing options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options).

OSRM explicitly distinguishes route distance from shortest-distance optimization: its Route service finds the fastest route in supplied order and Table distances describe the fastest routes. Changing a URL's profile name does not change the profile used to extract its graph. [OSRM API reference](https://project-osrm.org/docs/v5.24.0/api/).

## What changed in route selection

1. **Pin order is now the default** in both the UI and core. Different visit orders require an explicit selection. All mandatory pins remain present.
2. **Snap selection minimizes mapped walking distance first**, then total snap offset, then deterministic candidate identity. Previously snap offset came first, even if that caused a long connected detour. The selected tolerance remains a hard limit.
3. For open routes, candidate selection includes eligible arrival and departure walking distances. The existing 1 km preference, walking-approach bounds, boarding/alighting checks and unrouted stop-gap disclosure remain active.
4. For loops, every retained feasible waypoint-1 anchor is evaluated. Directed return distances seed the last layer before choosing intermediate snaps. Choosing the shortest open chain and subsequently appending its return is insufficient to minimize a loop.
5. Individual legs use A*. Multi-target and multi-source searches stop after required targets settle. Unsettled tentative costs cannot become route legs, and an empty target set performs no graph expansion.
6. The planner retains compact requested paths instead of a graph-wide tree per pin, reuses unpenalized trail matrices, computes trail approaches lazily, and skips empty loop-order anchors.
7. Parallel source segments have separate identities. Reversal requires the reverse of the actual selected segment. Closely spaced projected pins retain their exact graph coordinates instead of being merged within a fuzzy 5 cm radius.

## What “shortest” means here

For fixed snapped locations `s₁ … sₙ` and additive metre costs, the shortest walk visiting them in the given order is the concatenation of shortest directed legs:

`d(s₁, s₂) + d(s₂, s₃) + … + d(sₙ₋₁, sₙ)`.

A loop adds `d(sₙ, s₁)`. An open transit route includes its arrival and departure legs. Repeated paths are allowed, and passing a later pin earlier does not prevent visiting it again in the required sequence. If the requirement instead forbids encountering any future pin early, that requires another state constraint and is not the current behavior.

The layered search minimizes this distance over **at most 24 retained segment projections per pin**, including loop closure or the selected endpoint costs. These are nearest projections onto retained segments, not every possible point inside a tolerance disc. The route engine cannot establish a global optimum over omitted candidates, excluded ways or missing map data.

**A hard road allowance is a separate resource constraint.** The shortest distance candidate is checked against distance and road limits; trail and diversity candidates may provide feasible alternatives. This is still a bounded heuristic for finding a route under a binding road cap, not an exact constrained solver. Endpoint choice caps, stop gaps, the 100 m minimum and later feasibility checks also mean “no qualifying candidate found” is not proof that no feasible route exists. No limit is silently relaxed.

Reordering, when requested, uses matrices for the snaps chosen in the entered order. It does not jointly optimize all orders, snaps, stops and constraints. “Route 1” remains the shortest qualifying candidate found, with these limits disclosed.

## Reproducible measurement

[benchmark.json](benchmark.json) contains recorded measurements. The fixture is a synthetic 100 × 100 footway grid with 10,000 nodes and 39,600 directed edges. Runs exclude network access. Timings are medians after warm-up: five single-leg repetitions and three complete planning repetitions. Hardware load and graph shape affect timings.

The recorded measurement on Node 24.15.0, macOS x64 showed:

| Check | Before / Dijkstra | Improved engine | Result |
| --- | ---: | ---: | --- |
| Single-leg settled nodes | 5,050 | 100 | 98.0% fewer nodes |
| Single-leg distance | 5,504.149 m | 5,504.149 m | Same shortest distance |
| Single-leg median | 7.357 ms | 0.205 ms | About 36× faster on this fixture |
| Complete strict-order 50-pin loop | 527.860 ms | 145.651 ms | About 3.6× faster on this fixture |
| Loop distance / returned options | 5,448.551 m / 2 | 5,448.551 m / 2 | Same distance and option count |

The complete-plan baseline is the routing file from `9403420`; the single-leg comparison uses the current engine with A* disabled to isolate the search algorithm. This favorable grid result is **not** a speed guarantee for mountainous, disconnected or dense real-world data, and it does not measure public-provider latency.

Reproduce from the project directory:

```sh
node scripts/benchmark-routing.cjs
```

To compare a saved earlier engine, supply its path as the script's first argument. The script checks that compared distances agree. Correctness regressions also compare A* against an independent Floyd–Warshall distance oracle on directed geometry, test weighted trail equivalence, and cover detour snaps, full loop closure, serviced endpoints, directionality and failure cases.

## Suggestions for finding the shortest route in the given order

1. Use **Keep pin order for every route**. Review the waypoint list before Find; do not enable different orders if the sequence is mandatory.
2. Place pins on the intended walking path or entrance, particularly at stations, bridges and paths on different levels. Inspect the route coordinate and offset in Details. Use 15 m when the pin position is precise; a larger tolerance gives the optimizer more freedom to choose a nearby shorter path.
3. Use the urban walking allowance if the goal is the shortest eligible walk across both paths and streets. A trail-focused road cap can require a detour. Set a distance maximum that permits the real mapped walk, including loop return or transit approaches.
4. Use Loop only when the route must return to pin 1. For open routes, the current app requires transport at both ends; a future explicit **pin-to-pin endpoint mode** would better serve users who need to start and finish exactly at the entered pins.
5. Treat a line on the basemap as a clue, not a connection. A bridge crossing another way needs the correct shared OSM topology; access tags may exclude a visually present path. Check the named failing leg and inspect its access and level information instead of inserting a straight connector.
6. Add a user-visible walking-map margin and bounded corridor expansion when a detour may lie outside the download. Currently automatic expansion addresses missing transport, not disconnected interior walking legs. Keep size limits and report when coverage remains insufficient.
7. For exact optimization under a road cap, add Pareto labels `(distance, roadMetres)` at each `(node, nextRequiredPin)` state. Retain nondominated labels, apply the shared road budget across the whole route, and return an explicit resource-exhaustion result if a documented bound is reached. Do not claim that multiplying road costs enforces that budget exactly.
8. For growing traffic, evaluate a prepared regional graph or dedicated Valhalla instance against these fixtures plus representative Hong Kong, Tokyo and rural routes. Record data versions, provider latency, search time, peak memory, route length, snap offsets and rejected-access reasons before selecting infrastructure.

See [review.md](review.md) for robustness fixes and remaining engineering work.

## High Junk Peak follow-up

The [path investigation and implemented harder-hiking switch](high_junk_peak.md) distinguish graph exclusions from shortest-path search. The routing opt-in admits recognized T2–T6 SAC grades. A separate Difficulty switch below the route toggles on the right enables immediate green/pink/red coloring, with gray for unknown grades. Vehicle smoothness no longer blocks walking paths by itself; the eastern through-shortcut remains interrupted by an abandoned continuation.
