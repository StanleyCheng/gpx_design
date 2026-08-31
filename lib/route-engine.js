/* Trailcraft's deterministic routing core. Generated tracks use existing OSM nodes only. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrailRouter = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WALK = new Set(['path', 'footway', 'pedestrian', 'steps', 'living_street', 'track', 'residential', 'service', 'unclassified', 'tertiary', 'cycleway']);
  const ROAD = new Set(['residential', 'service', 'unclassified', 'tertiary']);
  const TRANSIT = new Set(['bus', 'trolleybus', 'train', 'subway', 'light_rail', 'tram', 'ferry', 'share_taxi']);
  const NO = new Set(['no', 'private', 'customers', 'permit', 'agricultural', 'forestry', 'delivery', 'students', 'staff', 'residents']);
  const YES = new Set(['yes', 'designated', 'permissive']);
  const distance = (a, b) => {
    const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  const validPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) < 75 && Math.abs(p.lon) <= 180;
  const nameOf = e => String(e.tags?.['name:en'] || e.tags?.name || e.tags?.ref || `OSM ${e.type} ${e.id}`).slice(0, 160);
  const edgeKey = (a, b) => a < b ? `${a}/${b}` : `${b}/${a}`;
  function walkable(tags = {}) {
    if (!WALK.has(tags.highway) || tags.area === 'yes' || ['disused', 'abandoned', 'construction', 'proposed'].some(k => tags[k] && tags[k] !== 'no')) return false;
    if (NO.has(tags.foot) || (NO.has(tags.access) && !YES.has(tags.foot))) return false;
    if (tags['access:conditional'] || tags['foot:conditional'] || tags.seasonal === 'yes' || tags.locked === 'yes') return false;
    if (tags.ford && tags.ford !== 'no') return false;
    if (tags.sac_scale && tags.sac_scale !== 'hiking') return false;
    if (['bad', 'horrible', 'no'].includes(tags.trail_visibility) || ['grade4', 'grade5'].includes(tags.tracktype)) return false;
    if (tags.highway === 'cycleway' && !YES.has(tags.foot)) return false;
    // Larger roads require explicit foot access and a mapped sidewalk. Never use motorways/trunks.
    if (tags.highway === 'tertiary' && !(YES.has(tags.foot) && ['yes', 'both', 'left', 'right'].includes(tags.sidewalk))) return false;
    if (tags.sidewalk === 'separate' && ROAD.has(tags.highway)) return false;
    if (tags.highway === 'service' && ['driveway', 'parking_aisle', 'drive-through'].includes(tags.service)) return false;
    return true;
  }
  function passableNode(node) {
    const t = node.tags || {};
    if (NO.has(t.foot) || (NO.has(t.access) && !YES.has(t.foot))) return false;
    if (t.highway === 'ford' || t.locked === 'yes' || t['foot:conditional'] || t['access:conditional'] || (t.ford && t.ford !== 'no')) return false;
    return !['wall', 'fence', 'retaining_wall', 'city_wall', 'hedge'].includes(t.barrier);
  }
  class Heap {
    constructor() { this.items = []; }
    push(item) { const a = this.items; let i = a.length; a.push(item); while (i) { const p = (i - 1) >> 1; if (a[p][0] <= item[0]) break; a[i] = a[p]; i = p; } a[i] = item; }
    pop() { const a = this.items, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && a[c + 1][0] < a[c][0]) c++; if (a[c][0] >= last[0]) break; a[i] = a[c]; i = c; } a[i] = last; } return first; }
    get size() { return this.items.length; }
  }
  function segmentDistance(p, a, b) {
    const cos = Math.cos(p.lat * Math.PI / 180), x = (p.lon - a.lon) * cos, y = p.lat - a.lat, dx = (b.lon - a.lon) * cos, dy = b.lat - a.lat;
    const ratio = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - ratio * dx, y - ratio * dy) * 111195;
  }
  function officialIndex(features = []) {
    const cells = new Map(), step = .002;
    features.forEach((f, index) => {
      const lines = f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : [];
      for (const line of lines) for (let i = 1; i < line.length; i++) {
        const a = { lat: line[i - 1][1], lon: line[i - 1][0] }, b = { lat: line[i][1], lon: line[i][0] };
        for (let x = Math.floor(Math.min(a.lon, b.lon) / step) - 1; x <= Math.floor(Math.max(a.lon, b.lon) / step) + 1; x++) for (let y = Math.floor(Math.min(a.lat, b.lat) / step) - 1; y <= Math.floor(Math.max(a.lat, b.lat) / step) + 1; y++) {
          const key = `${x},${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push({ a, b, index });
        }
      }
    });
    return (a, b) => {
      const segments = cells.get(`${Math.floor(a.lon / step)},${Math.floor(a.lat / step)}`) || [];
      // This is deliberately called a corridor match, not proof of management or current access.
      for (const s of segments) if (segmentDistance(a, s.a, s.b) <= 12 && segmentDistance(b, s.a, s.b) <= 12) return s.index;
      return -1;
    };
  }
  function buildGraph(data, features = []) {
    if (!data || data.remark || !Array.isArray(data.elements) || data.elements.length > 200000) throw new Error('The map server returned incomplete data. Please retry later; no partial route was used.');
    const unique = new Map();
    for (const e of data.elements) { const key = `${e.type}/${e.id}`, prior = unique.get(key); unique.set(key, prior ? { ...prior, ...e, tags: { ...prior.tags, ...e.tags } } : e); }
    const elements = [...unique.values()], nodes = new Map(elements.filter(e => e.type === 'node' && validPoint(e)).map(e => [e.id, e]));
    const relations = elements.filter(e => e.type === 'relation'), hiking = new Map();
    for (const r of relations) if (['hiking', 'foot'].includes(r.tags?.route)) for (const m of r.members || []) if (m.type === 'way') { if (!hiking.has(m.ref)) hiking.set(m.ref, []); hiking.get(m.ref).push({ id: r.id, name: nameOf(r) }); }
    const adj = new Map(), reverse = new Map(), eligible = new Map(), corridor = officialIndex(features);
    let excludedWays = 0, missingNodes = 0;
    const add = (from, to, edge) => { if (!adj.has(from)) adj.set(from, []); if (!reverse.has(to)) reverse.set(to, []); adj.get(from).push({ ...edge, to }); reverse.get(to).push({ ...edge, to: from }); };
    for (const way of elements.filter(e => e.type === 'way' && e.tags?.highway)) {
      if (!walkable(way.tags)) { excludedWays++; continue; }
      const tags = way.tags, direction = tags['oneway:foot'];
      for (let i = 1; i < (way.nodes || []).length; i++) {
        const a = nodes.get(way.nodes[i - 1]), b = nodes.get(way.nodes[i]);
        if (!a || !b) { missingNodes++; continue; }
        if (!passableNode(a) || !passableNode(b)) continue;
        const metres = distance(a, b); if (metres <= 0) continue;
        const edge = { key: edgeKey(a.id, b.id), way: way.id, metres, road: ROAD.has(tags.highway), steps: tags.highway === 'steps', hiking: hiking.get(way.id) || [], official: corridor(a, b), unknown: !ROAD.has(tags.highway) && !tags.sac_scale, name: nameOf(way) };
        eligible.set(a.id, a); eligible.set(b.id, b);
        if (direction !== '-1') add(a.id, b.id, edge);
        if (!['yes', '1'].includes(direction)) add(b.id, a.id, edge);
      }
    }
    if (missingNodes) throw new Error('Some walking-way geometry is missing. No incomplete graph will be routed. Please retry the map download.');
    if (!eligible.size) throw new Error('No eligible walking network was found. Roads without suitable access, restricted paths and demanding tagged terrain are excluded.');
    return { nodes: eligible, allNodes: nodes, adj, reverse, relations, features, excludedWays, timestamp: data.osm3s?.timestamp_osm_base || null };
  }
  function nearest(graph, point, maxMetres) {
    let match = null;
    for (const node of graph.nodes.values()) { const d = distance(point, node); if (d <= maxMetres && (!match || d < match.metres)) match = { id: node.id, point: { lat: node.lat, lon: node.lon }, metres: d }; }
    return match;
  }
  function transportStops(graph, points, radius) {
    const memberships = new Map(), parentAreas = new Map(), areaNames = new Map();
    for (const r of graph.relations) if (r.tags?.public_transport === 'stop_area') for (const member of r.members || []) if (member.type === 'node') { if (!parentAreas.has(r.id)) parentAreas.set(r.id, []); parentAreas.get(r.id).push(member.ref); if (r.tags.name || r.tags['name:en']) areaNames.set(member.ref, nameOf(r)); }
    for (const r of graph.relations) {
      if (!TRANSIT.has(r.tags?.route) || NO.has(r.tags?.access) || r.tags?.disused === 'yes' || r.tags?.state === 'proposed' || r.tags?.service === 'school') continue;
      for (const member of r.members || []) {
        const ids = member.type === 'node' ? [member.ref] : member.type === 'relation' ? parentAreas.get(member.ref) || [] : [];
        for (const id of ids) { if (!memberships.has(id)) memberships.set(id, []); memberships.get(id).push({ id: r.id, ref: String(r.tags.ref || nameOf(r)).slice(0, 100), name: nameOf(r), mode: r.tags.route, operator: r.tags.operator || '', board: !/exit_only|drop_off_only/.test(member.role || ''), alight: !/entry_only|pickup_only/.test(member.role || '') }); }
      }
    }
    // A station entrance may belong to the same stop_area as a serviced platform.
    for (const ids of parentAreas.values()) {
      const service = ids.flatMap(id => memberships.get(id) || []);
      if (service.length) for (const id of ids) if (!memberships.has(id)) memberships.set(id, service);
    }
    const stops = [], unlinked = [];
    for (const node of graph.allNodes.values()) {
      const t = node.tags || {}, passenger = t.highway === 'bus_stop' || t.public_transport === 'platform' || ['station', 'halt', 'tram_stop', 'subway_entrance'].includes(t.railway) || t.amenity === 'ferry_terminal';
      if (!passenger || t.public_transport === 'stop_position' || !passableNode(node) || t.disused === 'yes') continue;
      const near = Math.min(...points.map(p => distance(p, node))); if (near > radius) continue;
      const services = [...new Map((memberships.get(node.id) || []).map(s => [`${s.id}/${s.board}/${s.alight}`, s])).values()];
      if (!services.length) { unlinked.push(node); continue; }
      const snap = nearest(graph, node, 80); if (!snap) continue;
      const label = t.railway === 'subway_entrance' ? `${areaNames.get(node.id) || 'Subway'} entrance ${t.ref || t.name || node.id}` : nameOf(node);
      stops.push({ id: node.id, name: label, lat: node.lat, lon: node.lon, node: snap.id, accessGap: snap.metres, services, near, rail: services.some(s => ['train', 'subway', 'light_rail', 'tram'].includes(s.mode)) });
    }
    // Keep a balanced candidate pool so a dense town around the first waypoint cannot crowd out the last.
    const balanced = new Map(), perPoint = Math.max(5, Math.floor(80 / points.length));
    for (const point of points) for (const stop of [...stops].sort((a, b) => distance(point, a) - distance(point, b)).slice(0, perPoint)) balanced.set(stop.id, stop);
    return { stops: [...balanced.values()], unlinked: unlinked.length };
  }
  function search(graph, source, profile, penalties, backward = false, targets = null) {
    const adj = backward ? graph.reverse : graph.adj, cost = new Map([[source, 0]]), length = new Map([[source, 0]]), previous = new Map(), heap = new Heap(); heap.push([0, source]);
    const pending = targets ? new Set(targets) : null;
    while (heap.size) {
      const [currentCost, id] = heap.pop(); if (currentCost !== cost.get(id)) continue;
      if (pending) { pending.delete(id); if (!pending.size) break; }
      for (const edge of adj.get(id) || []) {
        let factor = profile === 'distance' ? (edge.road ? 1.7 : 1) : edge.official >= 0 ? 1 : edge.hiking.length ? 1.12 : edge.road ? 4 : 1.65;
        if (edge.steps) factor *= 1.12; factor *= 1 + (penalties.get(edge.key) || 0);
        const next = currentCost + edge.metres * factor;
        if (next < (cost.get(edge.to) ?? Infinity)) { cost.set(edge.to, next); length.set(edge.to, length.get(id) + edge.metres); previous.set(edge.to, { from: id, edge }); heap.push([next, edge.to]); }
      }
    }
    return { source, cost, length, previous, backward };
  }
  function pathFrom(tree, target) {
    if (!tree.cost.has(target)) return null;
    const ids = [target], edges = []; let at = target;
    while (at !== tree.source) { const p = tree.previous.get(at); if (!p) return null; edges.push(p.edge); at = p.from; ids.push(at); }
    if (!tree.backward) { ids.reverse(); edges.reverse(); }
    return { ids, edges, cost: tree.cost.get(target), metres: tree.length.get(target) };
  }
  function endpoints(tree, stops, role, maxApproach) {
    return stops.filter(s => s.services.some(service => service[role]) && tree.length.get(s.node) <= maxApproach).map(stop => {
      const path = pathFrom(tree, stop.node), convenience = stop.accessGap * 12 + (stop.rail ? 0 : 180) + 250 / Math.min(5, stop.services.length);
      return { stop, path, score: path.cost + convenience };
    }).sort((a, b) => a.score - b.score).slice(0, 6);
  }
  function stitch(legs) {
    const ids = [], edges = [];
    for (const leg of legs) { if (!leg) return null; if (ids.length && ids.at(-1) !== leg.ids[0]) throw new Error('Internal route continuity check failed.'); ids.push(...(ids.length ? leg.ids.slice(1) : leg.ids)); edges.push(...leg.edges); }
    return { ids, edges };
  }
  function summarize(graph, chain, start, end, snaps, order, settings) {
    if (!chain || chain.ids.length < 2) return null;
    const metres = chain.edges.reduce((sum, e) => sum + e.metres, 0), roadMetres = chain.edges.filter(e => e.road).reduce((sum, e) => sum + e.metres, 0);
    if (metres > settings.maxDistance || roadMetres > settings.maxRoad || metres < 100) return null;
    let cursor = 0;
    for (const index of order) { const at = chain.ids.indexOf(snaps[index].id, cursor); if (at < 0) throw new Error('A mandatory waypoint is missing from this route.'); cursor = at; }
    const unique = new Map(); for (const e of chain.edges) if (!unique.has(e.key)) unique.set(e.key, e.metres);
    const repeatedMetres = metres - [...unique.values()].reduce((s, d) => s + d, 0);
    const relations = [...new Map(chain.edges.flatMap(e => e.hiking).map(r => [r.id, r])).values()];
    const officialIds = [...new Set(chain.edges.filter(e => e.official >= 0).map(e => e.official))];
    return {
      ids: chain.ids, coords: chain.ids.map(id => { const n = graph.nodes.get(id); return { lat: n.lat, lon: n.lon }; }),
      edges: chain.edges.map(e => ({ key: e.key, way: e.way, metres: e.metres })), metres, roadMetres, repeatedMetres,
      trailMetres: chain.edges.filter(e => e.hiking.length || e.official >= 0).reduce((s, e) => s + e.metres, 0),
      corridorMetres: chain.edges.filter(e => e.official >= 0).reduce((s, e) => s + e.metres, 0),
      unknownTerrainMetres: chain.edges.filter(e => e.unknown).reduce((s, e) => s + e.metres, 0),
      start: { ...start.stop, approach: start.path.metres }, end: { ...end.stop, approach: end.path.metres },
      snaps, order, relations, official: officialIds.map(i => graph.features[i].properties),
      reversible: chain.ids.slice(1).every((id, i) => (graph.adj.get(id) || []).some(e => e.to === chain.ids[i])) && end.stop.services.some(s => s.alight) && start.stop.services.some(s => s.board),
      score: chain.edges.reduce((s, e) => s + e.metres * (e.official >= 0 ? 1 : e.hiking.length ? 1.1 : e.road ? 4 : 1.6), 0) + start.score - start.path.cost + end.score - end.path.cost + repeatedMetres * .45,
      osmTimestamp: graph.timestamp
    };
  }
  function distinct(a, b) {
    const edgesA = new Map(a.edges.map(e => [e.key, e.metres])), edgesB = new Map(b.edges.map(e => [e.key, e.metres]));
    const shared = [...edgesA].filter(([key]) => edgesB.has(key)).reduce((s, [, d]) => s + d, 0);
    const union = new Map([...edgesA, ...edgesB]), total = [...union.values()].reduce((s, d) => s + d, 0);
    return total > 0 && shared / total < .9;
  }
  function optimizeOrder(matrix, starts, ends) {
    const n = matrix.length, size = 1 << n, dp = Array.from({ length: size }, () => Array(n).fill(null));
    for (let i = 0; i < n; i++) if (starts[i]?.length) dp[1 << i][i] = { cost: starts[i][0].score, order: [i] };
    for (let mask = 1; mask < size; mask++) for (let last = 0; last < n; last++) {
      const old = dp[mask][last]; if (!old) continue;
      for (let next = 0; next < n; next++) { if (mask & (1 << next) || !matrix[last][next]) continue; const nextMask = mask | (1 << next), cost = old.cost + matrix[last][next].cost; if (!dp[nextMask][next] || cost < dp[nextMask][next].cost) dp[nextMask][next] = { cost, order: [...old.order, next] }; }
    }
    const choices = dp[size - 1].flatMap((state, last) => state && ends[last]?.length ? [{ order: state.order, cost: state.cost + ends[last][0].score }] : []);
    return choices.sort((a, b) => a.cost - b.cost)[0]?.order || null;
  }
  function plan(data, points, inputSettings = {}, features = [], progress = () => {}) {
    const settings = { tolerance: 30, radius: 4000, maxApproach: 4000, maxDistance: 30000, maxRoad: 1500, optimize: false, ...inputSettings };
    if (!Array.isArray(points) || !points.length || points.length > 16 || points.some(p => !validPoint(p))) throw new Error('Use 1–16 confirmed waypoints within one local walking area, between 75°S and 75°N. No waypoints are silently omitted.');
    if (settings.optimize && points.length > 8) throw new Error('Order optimisation supports up to 8 waypoints. Keep your entered order for larger drafts.');
    const graph = buildGraph(data, features);
    progress('Checking every waypoint against eligible paths…');
    const snaps = points.map((point, index) => { const snap = nearest(graph, point, settings.tolerance); if (!snap) throw new Error(`Waypoint ${index + 1} has no eligible path node within ${settings.tolerance} m. Move or correct that waypoint, or explicitly change the tolerance; it will not be skipped.`); return { ...snap, index, original: point }; });
    const transit = transportStops(graph, points, settings.radius);
    if (!transit.stops.length) throw new Error(`No passenger stops linked to mapped transit services and within 80 m of the walking network were found. ${transit.unlinked ? `${transit.unlinked} nearby stop(s) lacked service links. ` : ''}Try a wider search area or different waypoints; no convenient endpoint can be claimed from this data.`);
    const selected = [], penalties = new Map(), stopIds = transit.stops.map(s => s.node), n = snaps.length;
    for (let variant = 0; variant < 5; variant++) {
      progress(`Searching route variant ${variant + 1} of 5 through all ${n} waypoints…`);
      const profile = variant === 1 ? 'distance' : 'trail', matrix = Array.from({ length: n }, () => Array(n).fill(null)), starts = [], ends = [];
      for (let i = 0; i < n; i++) {
        const targets = settings.optimize ? [...snaps.map(s => s.id), ...stopIds] : [...(i + 1 < n ? [snaps[i + 1].id] : []), ...(i === n - 1 ? stopIds : [])];
        const tree = search(graph, snaps[i].id, profile, penalties, false, targets);
        for (let j = 0; j < n; j++) if (settings.optimize || j === i + 1) matrix[i][j] = pathFrom(tree, snaps[j].id);
        if (settings.optimize || i === n - 1) ends[i] = endpoints(tree, transit.stops, 'board', settings.maxApproach);
        if (settings.optimize || !i) starts[i] = endpoints(search(graph, snaps[i].id, profile, penalties, true, stopIds), transit.stops, 'alight', settings.maxApproach);
      }
      const order = settings.optimize ? optimizeOrder(matrix, starts, ends) : Array.from({ length: n }, (_, i) => i);
      if (!order || order.slice(1).some((to, i) => !matrix[order[i]][to])) { if (!variant) throw new Error('The waypoints cannot all be connected in the requested order using eligible walking paths. Restricted, disconnected or demanding sections are never bridged. Check the waypoint locations or order.'); continue; }
      const first = order[0], last = order.at(-1), middle = order.slice(1).map((to, i) => matrix[order[i]][to]);
      if (!starts[first]?.length || !ends[last]?.length) { if (!variant) throw new Error('No reachable transport connection was found at both ends within the approach limit. Expand the search / approach distance or adjust the waypoint order.'); continue; }
      const fresh = [];
      for (const start of starts[first]) for (const end of ends[last]) {
        const candidate = summarize(graph, stitch([start.path, ...middle, end.path]), start, end, snaps, order, settings);
        if (candidate) { candidate.variant = variant; fresh.push(candidate); }
      }
      fresh.sort((a, b) => (profile === 'distance' ? a.metres - b.metres : a.score - b.score));
      const choice = fresh.find(route => selected.every(prior => distinct(route, prior)));
      if (choice && selected.length < 3) { choice.title = selected.length === 0 ? 'Trail-first connection' : selected.length === 1 && profile === 'distance' ? 'Distance-focused connection' : 'Alternative approach'; selected.push(choice); }
      if (selected.length === 3) break;
      const avoid = choice || fresh[0] || selected[0]; if (avoid) for (const e of avoid.edges) penalties.set(e.key, Math.min(3.5, (penalties.get(e.key) || 0) + .7));
    }
    if (!selected.length) throw new Error('Connected paths were found, but none met the distance and road-connector limits. No limits were relaxed. Review your waypoints or explicitly change those limits.');
    selected.forEach((route, i) => { route.id = `route-${i + 1}`; });
    return { routes: selected, eligibleNodes: graph.nodes.size, excludedWays: graph.excludedWays, stopCount: transit.stops.length, unlinkedStops: transit.unlinked, timestamp: graph.timestamp, qualified: 'provisional', settings };
  }
  function boundingBox(points, radius) {
    if (!points.length || points.some(p => !validPoint(p))) throw new Error('Add valid waypoints in a local walking area first.');
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length, padLat = radius / 111195, padLon = padLat / Math.cos(lat * Math.PI / 180);
    const box = [Math.min(...points.map(p => p.lat)) - padLat, Math.min(...points.map(p => p.lon)) - padLon, Math.max(...points.map(p => p.lat)) + padLat, Math.max(...points.map(p => p.lon)) + padLon];
    const area = distance({ lat: box[0], lon: box[1] }, { lat: box[2], lon: box[1] }) * distance({ lat: box[0], lon: box[1] }, { lat: box[0], lon: box[3] });
    if (box[1] < -180 || box[3] > 180 || box[3] - box[1] > 180 || area > 250e6) throw new Error('This search area exceeds 250 km² or crosses the date line. Use closer waypoints or a smaller transport search radius.');
    return box.map(n => Number(n.toFixed(6)));
  }
  function queryFor(box) {
    const bbox = box.join(',');
    return `[out:json][timeout:40][maxsize:67108864];\nway["highway"~"^(path|footway|pedestrian|steps|living_street|track|residential|service|unclassified|tertiary|cycleway)$"](${bbox})->.paths;\n(.paths;node(w.paths););out body;\nrelation["route"~"^(hiking|foot|bus|trolleybus|train|subway|light_rail|tram|ferry|share_taxi)$"](${bbox});out body;\n(node["highway"="bus_stop"](${bbox});node["public_transport"="platform"](${bbox});node["railway"~"^(station|halt|tram_stop|subway_entrance)$"](${bbox});node["amenity"="ferry_terminal"](${bbox});)->.stops;.stops out body;\nrelation(bn.stops)["public_transport"="stop_area"];out body;`;
  }
  return { distance, walkable, passableNode, buildGraph, nearest, transportStops, search, pathFrom, distinct, optimizeOrder, plan, boundingBox, queryFor };
});
