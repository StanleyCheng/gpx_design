# High Junk Peak: dotted path exclusions and harder hiking switch

Checked 2026-09-06 against the app and a public OSM Overpass snapshot dated **2026-09-06T07:50:51Z**, retrieved from VK Maps. Query: walking ways and their full nodes in bbox `(22.290,114.280,22.301,114.294)`. These are mapped attributes, not a current trail inspection.

## Why the original detour occurred

The summit graph node **330412564** (22.2954625, 114.2860697) is shared by three ways. The original default eligibility policy left only the northward exit available; A* cannot use edges removed before the search.

| Branch | OSM source and tags | Original exclusion | Current behavior |
| --- | --- | --- | --- |
| Southwest to Chik Sha Au, approximately 319 m | [Way 30014358](https://www.openstreetmap.org/way/30014358): `highway=footway`, `sac_scale=mountain_hiking`, `access=discouraged` | Any SAC grade other than `hiking` was rejected | Eligible with Allow harder hiking paths on; T2 sections are pink when the separate difficulty-color switch is on. The discouraged-access tag remains relevant when reviewing this path. |
| East/right from the summit, approximately 308 m | [Way 454454740](https://www.openstreetmap.org/way/454454740): `highway=path`, `informal=yes`, `smoothness=impassable` | The smoothness filter | Eligible after correcting pedestrian smoothness handling; untagged hiking difficulty remains unknown. |
| East continuation, approximately 48 m | [Way 1442979752](https://www.openstreetmap.org/way/1442979752): `highway=path`, `abandoned:highway=path`, `informal=yes`, `smoothness=impassable` | The smoothness filter | Excluded by the highway lifecycle policy. The abandoned status needs verification before this continuation can be used. |
| North/northwest | [Way 758100046](https://www.openstreetmap.org/way/758100046): `highway=footway`, no difficulty tag | None | Eligible with either setting; missing difficulty remains unknown. |

The basemap independently renders paths that are excluded from the routing graph. Both requested branches share the summit node, so a missing junction at the summit is not their cause. The screenshot does not show waypoint 2, so the branch lengths above are not claimed savings for the user's full waypoint 1 → 2 journey.

## Implemented control

**Allow harder hiking paths** is on by default and admits the five recognized SAC grades above `hiking`: T2 mountain hiking, T3 demanding mountain hiking, T4 alpine hiking, T5 demanding alpine hiking and T6 difficult alpine hiking. Turn it off to exclude those known harder grades. Easier `strolling` and `hiking` remain eligible. Unknown tag values remain excluded; absent tags remain unknown. See [OSM's SAC scale definitions](https://wiki.openstreetmap.org/wiki/Key:sac_scale).

Every selected route edge carries its SAC grade. Difficulty coloring is **off by default**. The **Difficulty** switch is directly below the route-number toggles in the right-hand map toolbar and recolors the visible routes immediately. It does not recompute routes, change their visibility or alter the selected option.

| Color when enabled | Mapped SAC difficulty |
| --- | --- |
| Green | Strolling and hiking (T1) |
| Pink | Mountain hiking and demanding mountain hiking (T2–T3) |
| Red | Alpine, demanding alpine and difficult alpine hiking (T4–T6) |
| Gray | Absent or unrecognized difficulty |

These are application display groups, not an assessment of current conditions. Grade changes split the rendered line on existing source segments. Higher known grades draw last where alternative routes overlap. Popups and the legend explain the colors. Turning the switch off restores the original option colors. Reversal keeps the colors attached to their original geometry; hidden routes stay hidden. PNG output uses the chosen mode, and GPX descriptions retain difficulty warnings without promising a GPX viewer's colors.

The shared worker/server graph policy preserves access, lifecycle, visibility, ford and foot-direction restrictions. Policy version checks prevent silently accepting an older server's graph rules, including outdated no-route responses. Bounded direct downloads and the local worker provide fallback; current-policy failures and request/rate/size limits remain authoritative. Deploy the API and page together for server support.

## Verification

- Build and all **128 automated tests** passed, including SAC opt-in/off, invalid values, remaining exclusions, directed edges, projected pins, exact grade sections, immediate display toggling, restoration of original colors, reversal, hidden routes, GPX warnings, surface evidence, lifecycle restrictions, API propagation and older-server fallback.
- Rebuilt graphs from the public snapshot now include north way 758100046 and east way 454454740 by default. Enabling harder hiking also admits southwest way 30014358. The abandoned east continuation 1442979752 remains excluded. The four source ways and 120 nodes are preserved with OSM attribution in `tests/fixtures/high-junk-peak-paths.json`.
- A separate local browser preview used public test junctions 330412675 and 330412275, in loop mode. The local API produced a **986.1 m loop with 638.6 m of T2 terrain**, rendered pink when difficulty coloring is on, while the northern section is gray because its difficulty is untagged. The same route retains its original option color when the display switch is off. These are test pins, not the user's current saved pins. No private browser state was accessed.

## Eastern-path result

OSM defines [smoothness](https://wiki.openstreetmap.org/wiki/Key:smoothness) primarily as usability for wheeled vehicles. `impassable` does not by itself establish pedestrian impassability. The blanket pedestrian smoothness exclusion has been corrected. The eastern branch can enter the graph, but the abandoned continuation remains excluded, so this change does not establish a usable through-shortcut. Route evidence retains rough-surface tags and distance; no hiking grade is inferred from them. Reopening the continuation requires verification of its mapped lifecycle status and real connectivity.
