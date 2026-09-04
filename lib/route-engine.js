/* TrailPlanner's deterministic routing core. Generated tracks follow eligible OSM ways; projected waypoint vertices only split existing way segments. */
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
  const MAX_WAYPOINTS = 50, MAX_SNAP_CANDIDATES = 24, SNAP_COMPONENT_RESERVE = 8;
  const PREFERRED_APPROACH = 1000, MAX_APPROACH = 20000;
  function routeError(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
  const distance = (a, b) => {
    const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  const validPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) < 75 && Math.abs(p.lon) <= 180;
  const nameOf = e => String(e.tags?.['name:en'] || e.tags?.name || e.tags?.ref || `OSM ${e.type} ${e.id}`).slice(0, 160);
  const edgeKey = (a, b) => a < b ? `${a}/${b}` : `${b}/${a}`;
  const isFord = (tags = {}) => tags.highway === 'ford' || Boolean(tags.ford && tags.ford !== 'no');
  function walkableWithFords(tags = {}, allowFord = false) {
    if (!WALK.has(tags.highway) || tags.area === 'yes' || ['disused', 'abandoned', 'construction', 'proposed'].some(k => tags[k] && tags[k] !== 'no')) return false;
    if (NO.has(tags.foot) || (NO.has(tags.access) && !YES.has(tags.foot))) return false;
    if (tags['access:conditional'] || tags['foot:conditional'] || tags.seasonal === 'yes' || tags.locked === 'yes') return false;
    if (!allowFord && isFord(tags)) return false;
    if (tags.sac_scale && tags.sac_scale !== 'hiking') return false;
    if (['intermediate', 'bad', 'horrible', 'no'].includes(tags.trail_visibility) || ['grade4', 'grade5'].includes(tags.tracktype)) return false;
    if (['horrible', 'very_horrible', 'impassable'].includes(tags.smoothness) || (tags.via_ferrata_scale && tags.via_ferrata_scale !== '0')) return false;
    if (tags.highway === 'cycleway' && !YES.has(tags.foot)) return false;
    // Larger roads require explicit foot access and a mapped sidewalk. Never use motorways/trunks.
    if (tags.highway === 'tertiary' && !(YES.has(tags.foot) && ['yes', 'both', 'left', 'right'].includes(tags.sidewalk))) return false;
    if (tags.sidewalk === 'separate' && ROAD.has(tags.highway)) return false;
    if (tags.highway === 'service' && ['driveway', 'parking_aisle', 'drive-through'].includes(tags.service)) return false;
    return true;
  }
  const walkable = (tags = {}) => walkableWithFords(tags, false);
  function passableNode(node) {
    const t = node.tags || {};
    if (NO.has(t.foot) || (NO.has(t.access) && !YES.has(t.foot))) return false;
    if (isFord(t) || t.locked === 'yes' || t['foot:conditional'] || t['access:conditional']) return false;
    return !['wall', 'fence', 'retaining_wall', 'city_wall', 'hedge'].includes(t.barrier);
  }
  function passableOnOfficialSegment(node, official, allowOfficialFords) {
    if (passableNode(node)) return true;
    const t = node.tags || {};
    if (!allowOfficialFords || official < 0 || !isFord(t)) return false;
    if (NO.has(t.foot) || (NO.has(t.access) && !YES.has(t.foot))) return false;
    if (t.locked === 'yes' || t['foot:conditional'] || t['access:conditional']) return false;
    return !['wall', 'fence', 'retaining_wall', 'city_wall', 'hedge'].includes(t.barrier);
  }
  class Heap {
    constructor(compare = (a, b) => a[0] - b[0]) { this.items = []; this.compare = compare; }
    push(item) { const a = this.items; let i = a.length; a.push(item); while (i) { const p = (i - 1) >> 1; if (this.compare(a[p], item) <= 0) break; a[i] = a[p]; i = p; } a[i] = item; }
    pop() { const a = this.items, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && this.compare(a[c + 1], a[c]) < 0) c++; if (this.compare(a[c], last) >= 0) break; a[i] = a[c]; i = c; } a[i] = last; } return first; }
    get size() { return this.items.length; }
  }
  function projectToSegment(p, a, b) {
    const cos = Math.cos(p.lat * Math.PI / 180), x = (p.lon - a.lon) * cos, y = p.lat - a.lat, dx = (b.lon - a.lon) * cos, dy = b.lat - a.lat;
    const ratio = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)));
    const point = { lat: a.lat + (b.lat - a.lat) * ratio, lon: a.lon + (b.lon - a.lon) * ratio };
    return { ratio, point, metres: distance(p, point) };
  }
  const segmentDistance = (p, a, b) => projectToSegment(p, a, b).metres;
  function addDirected(adj, reverse, from, to, edge) {
    if (!adj.has(from)) adj.set(from, []); if (!reverse.has(to)) reverse.set(to, []);
    adj.get(from).push({ ...edge, to }); reverse.get(to).push({ ...edge, to: from });
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
  function buildGraph(data, features = [], options = {}) {
    if (!data || data.remark || !Array.isArray(data.elements)) throw routeError('INCOMPLETE_MAP', 'The map server returned incomplete data. Please retry later; no partial route was used.');
    if (data.elements.length > 200000) throw routeError('MAP_TOO_LARGE', 'The downloaded map exceeds the 200,000-element processing limit. Move the first or last waypoint closer to a serviced trailhead, or plan a smaller area. No partial graph was used.');
    const unique = new Map();
    for (const e of data.elements) { const key = `${e.type}/${e.id}`, prior = unique.get(key); unique.set(key, prior ? { ...prior, ...e, tags: { ...prior.tags, ...e.tags } } : e); }
    const elements = [...unique.values()], nodes = new Map(elements.filter(e => e.type === 'node' && validPoint(e)).map(e => [e.id, e]));
    const relations = elements.filter(e => e.type === 'relation'), hiking = new Map();
    for (const r of relations) if (['hiking', 'foot'].includes(r.tags?.route)) for (const m of r.members || []) if (m.type === 'way') { if (!hiking.has(m.ref)) hiking.set(m.ref, []); hiking.get(m.ref).push({ id: r.id, name: nameOf(r) }); }
    const adj = new Map(), reverse = new Map(), eligible = new Map(), segments = [], corridor = officialIndex(features);
    const allowOfficialFords = options.allowOfficialFords === true, excludedOfficialFords = new Set();
    let excludedWays = 0, missingNodes = 0;
    for (const way of elements.filter(e => e.type === 'way' && e.tags?.highway)) {
      const tags = way.tags, fordWay = isFord(tags);
      if (!walkableWithFords(tags, allowOfficialFords && fordWay)) { excludedWays++; continue; }
      const direction = tags['oneway:foot'];
      for (let i = 1; i < (way.nodes || []).length; i++) {
        const a = nodes.get(way.nodes[i - 1]), b = nodes.get(way.nodes[i]);
        if (!a || !b) { missingNodes++; continue; }
        const official = corridor(a, b), officialFord = official >= 0 && (fordWay || isFord(a.tags) || isFord(b.tags));
        if (fordWay && !officialFord) continue;
        if (!passableOnOfficialSegment(a, official, allowOfficialFords) || !passableOnOfficialSegment(b, official, allowOfficialFords)) {
          if (!allowOfficialFords && officialFord) { if (isFord(a.tags)) excludedOfficialFords.add(a.id); if (isFord(b.tags)) excludedOfficialFords.add(b.id); }
          continue;
        }
        const metres = distance(a, b); if (metres <= 0) continue;
        const segment = `${way.id}/${i}`, forward = direction !== '-1', backward = !['yes', '1'].includes(direction);
        const edge = { key: edgeKey(a.id, b.id), segment, way: way.id, metres, road: ROAD.has(tags.highway), steps: tags.highway === 'steps', ford: officialFord, hiking: hiking.get(way.id) || [], official, unknown: !ROAD.has(tags.highway) && !tags.sac_scale, clear: ['excellent', 'good'].includes(tags.trail_visibility), name: nameOf(way) };
        eligible.set(a.id, a); eligible.set(b.id, b);
        segments.push({ key: segment, a: a.id, b: b.id, edge, forward, backward });
        if (forward) addDirected(adj, reverse, a.id, b.id, edge);
        if (backward) addDirected(adj, reverse, b.id, a.id, edge);
      }
    }
    if (missingNodes) throw new Error('Some walking-way geometry is missing. No incomplete graph will be routed. Please retry the map download.');
    if (!eligible.size) throw new Error('No eligible walking network was found. Roads without suitable access, restricted paths and demanding tagged terrain are excluded.');
    return { nodes: eligible, allNodes: nodes, adj, reverse, segments, relations, features, excludedWays, excludedOfficialFords: [...excludedOfficialFords], timestamp: data.osm3s?.timestamp_osm_base || null };
  }
  function nearest(graph, point, maxMetres, candidates = graph.nodes.values()) {
    let match = null;
    for (const node of candidates) { const d = distance(point, node); if (d <= maxMetres && (!match || d < match.metres)) match = { id: node.id, point: { lat: node.lat, lon: node.lon }, metres: d }; }
    return match;
  }
  const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const compareSnapCandidate = (a, b) => a.metres - b.metres || compareText(a.key, b.key) || a.ratio - b.ratio;
  function weakComponents(graph) {
    const parent = new Map();
    for (const id of graph.nodes.keys()) parent.set(id, id);
    const root = id => { let at = id; while (parent.get(at) !== at) at = parent.get(at); while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, at); id = next; } return at; };
    for (const segment of graph.segments) {
      const a = root(segment.a), b = root(segment.b);
      if (a !== b) compareText(`${typeof a}:${a}`, `${typeof b}:${b}`) <= 0 ? parent.set(b, a) : parent.set(a, b);
    }
    return root;
  }
  function collectSnapCandidates(graph, points, maxMetres) {
    const componentOf = weakComponents(graph);
    return points.map((point, index) => {
      const matches = new Map();
      for (const segment of graph.segments) {
        const a = graph.nodes.get(segment.a), b = graph.nodes.get(segment.b), projected = projectToSegment(point, a, b);
        if (projected.metres > maxMetres) continue;
        let candidate;
        if (projected.ratio <= 1e-8) candidate = { id: segment.a, point: { lat: a.lat, lon: a.lon }, metres: projected.metres, ratio: 0, segment, index, original: point, key: `node/${typeof segment.a}:${segment.a}` };
        else if (projected.ratio >= 1 - 1e-8) candidate = { id: segment.b, point: { lat: b.lat, lon: b.lon }, metres: projected.metres, ratio: 1, segment, index, original: point, key: `node/${typeof segment.b}:${segment.b}` };
        else candidate = { ...projected, segment, index, original: point, key: `segment/${segment.key}` };
        candidate.component = componentOf(segment.a);
        const prior = matches.get(candidate.key);
        if (!prior || compareSnapCandidate(candidate, prior) < 0) matches.set(candidate.key, candidate);
      }
      const ranked = [...matches.values()].sort(compareSnapCandidate);
      if (!ranked.length) throw routeError('WAYPOINT_OFF_PATH', `Waypoint ${index + 1} has no eligible path within ${maxMetres} m. The path may be absent from the downloaded data or excluded by access, terrain or visibility tags. Move or correct that waypoint, or explicitly change the tolerance; it will not be skipped.`, { waypoint: index });
      // Reserve places for distinct disconnected path clusters, then fill the
      // remaining bounded set by distance. This prevents dense isolated geometry
      // from crowding a slightly farther connected trail out of consideration.
      const selected = new Map(), components = new Set();
      for (const candidate of ranked) {
        const component = `${typeof candidate.component}:${candidate.component}`;
        if (!components.has(component) && components.size < SNAP_COMPONENT_RESERVE) { components.add(component); selected.set(candidate.key, candidate); }
      }
      for (const candidate of ranked) { if (selected.size >= MAX_SNAP_CANDIDATES) break; selected.set(candidate.key, candidate); }
      return [...selected.values()].sort(compareSnapCandidate).map((candidate, rank) => ({ ...candidate, rank, tie: `${String(rank).padStart(2, '0')}/${candidate.key}` }));
    });
  }
  function materializeSnapCandidates(graph, candidateSets) {
    const groups = new Map();
    for (const candidates of candidateSets) for (const candidate of candidates) if (!candidate.id) { if (!groups.has(candidate.segment.key)) groups.set(candidate.segment.key, []); groups.get(candidate.segment.key).push(candidate); }
    for (const group of groups.values()) {
      const segment = group[0].segment, a = graph.nodes.get(segment.a), b = graph.nodes.get(segment.b), sequence = [{ id: segment.a, point: a }];
      for (const snap of group.sort((x, y) => x.ratio - y.ratio || x.index - y.index || x.rank - y.rank)) {
        const prior = sequence.at(-1);
        if (distance(prior.point, snap.point) < .05) snap.id = prior.id;
        else { snap.id = snap.rank ? `waypoint:${snap.index}:${snap.rank}` : `waypoint:${snap.index}`; graph.nodes.set(snap.id, { type: 'node', id: snap.id, ...snap.point, virtual: true }); sequence.push({ id: snap.id, point: snap.point }); }
      }
      sequence.push({ id: segment.b, point: b });
      for (const id of [segment.a, segment.b]) {
        graph.adj.set(id, (graph.adj.get(id) || []).filter(edge => edge.segment !== segment.key));
        graph.reverse.set(id, (graph.reverse.get(id) || []).filter(edge => edge.segment !== segment.key));
      }
      for (let i = 1; i < sequence.length; i++) {
        const from = sequence[i - 1], to = sequence[i], metres = distance(from.point, to.point); if (metres <= 0) continue;
        const edge = { ...segment.edge, key: `${segment.key}@${i}`, metres };
        if (segment.forward) addDirected(graph.adj, graph.reverse, from.id, to.id, edge);
        if (segment.backward) addDirected(graph.adj, graph.reverse, to.id, from.id, edge);
      }
    }
  }
  const compareSnapScore = (a, b) => a.snapMetres - b.snapMetres || a.routeMetres - b.routeMetres || compareText(a.tie, b.tie);
  function connectedSnapCombination(graph, candidateSets) {
    const layers = Array(candidateSets.length);
    layers[candidateSets.length - 1] = candidateSets.at(-1).map(candidate => ({ snapMetres: candidate.metres, routeMetres: 0, tie: candidate.tie, next: null }));
    let failureLeg = null;
    for (let layer = candidateSets.length - 2; layer >= 0; layer--) {
      const future = layers[layer + 1];
      if (!future.some(Boolean)) { layers[layer] = candidateSets[layer].map(() => null); continue; }
      const best = new Map(), heap = new Heap(compareSnapScore);
      future.forEach((state, next) => {
        if (!state) return;
        const item = { ...state, id: candidateSets[layer + 1][next].id, next };
        const prior = best.get(item.id);
        if (!prior || compareSnapScore(item, prior) < 0) { best.set(item.id, item); heap.push(item); }
      });
      while (heap.size) {
        const current = heap.pop(), known = best.get(current.id);
        if (!known || compareSnapScore(current, known) !== 0) continue;
        for (const edge of graph.reverse.get(current.id) || []) {
          const item = { ...current, id: edge.to, routeMetres: current.routeMetres + edge.metres };
          const prior = best.get(item.id);
          if (!prior || compareSnapScore(item, prior) < 0) { best.set(item.id, item); heap.push(item); }
        }
      }
      layers[layer] = candidateSets[layer].map(candidate => {
        const suffix = best.get(candidate.id);
        return suffix ? { snapMetres: candidate.metres + suffix.snapMetres, routeMetres: suffix.routeMetres, tie: `${candidate.tie}>${suffix.tie}`, next: suffix.next } : null;
      });
      if (!layers[layer].some(Boolean)) failureLeg = layer;
    }
    const first = layers[0].map((state, index) => state && { ...state, index }).filter(Boolean).sort(compareSnapScore)[0];
    if (!first) return { snaps: null, failureLeg };
    const snaps = []; let candidate = first.index;
    for (let layer = 0; layer < candidateSets.length; layer++) { snaps.push(candidateSets[layer][candidate]); candidate = layers[layer][candidate].next; }
    return { snaps, failureLeg: null };
  }
  function snapWaypoints(graph, points, maxMetres) {
    const candidateSets = collectSnapCandidates(graph, points, maxMetres);
    materializeSnapCandidates(graph, candidateSets);
    const connected = candidateSets.length > 1 ? connectedSnapCombination(graph, candidateSets).snaps : [candidateSets[0][0]];
    // Retain the nearest candidates only to let plan() produce its existing
    // actionable directed-disconnection error or try an allowed reordered route.
    const selected = connected || candidateSets.map(candidates => candidates[0]);
    return selected.map(({ segment, ratio, component, rank, tie, key, ...snap }) => snap);
  }
  function transportStops(graph, points, radius) {
    const memberships = new Map(), parentAreas = new Map(), areaNames = new Map();
    const cells = new Map(), cellSize = .002;
    for (const node of graph.nodes.values()) {
      const key = `${Math.floor(node.lat / cellSize)}/${Math.floor(node.lon / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(node);
    }
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
      const candidates = [], latPad = 80 / 111195, lonPad = latPad / Math.cos(node.lat * Math.PI / 180);
      for (let y = Math.floor((node.lat - latPad) / cellSize); y <= Math.floor((node.lat + latPad) / cellSize); y++) for (let x = Math.floor((node.lon - lonPad) / cellSize); x <= Math.floor((node.lon + lonPad) / cellSize); x++) candidates.push(...(cells.get(`${y}/${x}`) || []));
      const snap = nearest(graph, node, 80, candidates); if (!snap) continue;
      const label = t.railway === 'subway_entrance' ? `${areaNames.get(node.id) || 'Subway'} entrance ${t.ref || t.name || node.id}` : nameOf(node);
      stops.push({ id: node.id, name: label, lat: node.lat, lon: node.lon, node: snap.id, accessGap: snap.metres, services, near, rail: services.some(s => ['train', 'subway', 'light_rail', 'tram'].includes(s.mode)) });
    }
    // Filter by reachable walking distance later. A geographically near but disconnected
    // cluster must not crowd a usable stop out of the candidate pool.
    return { stops, unlinked: unlinked.length };
  }
  function search(graph, source, profile, penalties, backward = false, targets = null) {
    const adj = backward ? graph.reverse : graph.adj, cost = new Map([[source, 0]]), length = new Map([[source, 0]]), previous = new Map(), heap = new Heap(); heap.push([0, source]);
    const pending = targets ? new Set(targets) : null;
    while (heap.size) {
      const [currentCost, id] = heap.pop(); if (currentCost !== cost.get(id)) continue;
      if (pending) { pending.delete(id); if (!pending.size) break; }
      for (const edge of adj.get(id) || []) {
        let factor = profile === 'distance' ? 1 : edge.official >= 0 ? 1 : edge.hiking.length ? 1.12 : edge.road ? 4 : edge.clear ? 1.35 : 1.65;
        if (profile !== 'distance' && edge.steps) factor *= 1.12;
        factor *= 1 + (penalties.get(edge.key) || 0);
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
  function endpoints(tree, stops, role, maxApproach, pairForLoop = false) {
    const reachable = stops.filter(s => s.services.some(service => service[role]) && tree.length.get(s.node) + s.accessGap <= maxApproach);
    const nearby = reachable.filter(s => tree.length.get(s.node) + s.accessGap <= PREFERRED_APPROACH);
    const choices = (pairForLoop ? reachable : nearby.length ? nearby : reachable).map(stop => {
      const path = pathFrom(tree, stop.node), convenience = stop.accessGap * 12 + (stop.rail ? 0 : 180) + 250 / Math.min(5, stop.services.length);
      return { stop, path, score: path.metres, convenience, extended: path.metres + stop.accessGap > PREFERRED_APPROACH };
    }).sort((a, b) => a.path.metres - b.path.metres || a.convenience - b.convenience);
    // Match loop endpoints before pruning: independently choosing nearby stops can
    // discard the only stop reachable for both arrival and departure.
    return pairForLoop ? choices : choices.slice(0, 12);
  }
  function endpointPairs(starts = [], ends = [], loop = false) {
    if (!loop) return starts.flatMap(start => ends.map(end => ({ start, end })));
    const departures = new Map(ends.map(end => [end.stop.id, end]));
    const pairs = starts.flatMap(start => {
      const end = departures.get(start.stop.id);
      return end && start.stop.node === end.stop.node ? [{ start, end }] : [];
    });
    const nearby = pairs.filter(({ start, end }) => !start.extended && !end.extended);
    // Bound expensive track assembly only after matching shared stops and ranking
    // both approaches together; dense city stop clusters must not exhaust memory.
    return (nearby.length ? nearby : pairs).sort((a, b) =>
      a.start.score + a.end.score - b.start.score - b.end.score ||
      a.start.convenience + a.end.convenience - b.start.convenience - b.end.convenience).slice(0, 12);
  }
  function trailApproaches(graph, snaps, choices, backward, maxApproach) {
    return choices.map((options, i) => {
      if (!options?.length) return options;
      const tree = search(graph, snaps[i].id, 'trail', new Map(), backward, options.map(o => o.stop.node));
      return options.map(option => {
        const path = pathFrom(tree, option.stop.node), limit = option.extended ? maxApproach : PREFERRED_APPROACH;
        return path && path.metres + option.stop.accessGap <= limit ? { ...option, path, score: path.cost } : option;
      }).sort((a, b) => a.score - b.score);
    });
  }
  function stitch(legs) {
    const ids = [], edges = [];
    for (const leg of legs) { if (!leg) return null; if (ids.length && ids.at(-1) !== leg.ids[0]) throw new Error('Internal route continuity check failed.'); ids.push(...(ids.length ? leg.ids.slice(1) : leg.ids)); edges.push(...leg.edges); }
    return { ids, edges };
  }
  function summarize(graph, chain, start, end, snaps, order, settings, failures) {
    if (!chain || chain.ids.length < 2) return null;
    if (settings.loop && (start.stop.id !== end.stop.id || chain.ids[0] !== chain.ids.at(-1))) throw new Error('Internal loop continuity check failed. No open route was returned.');
    const metres = chain.edges.reduce((sum, e) => sum + e.metres, 0), roadMetres = chain.edges.filter(e => e.road).reduce((sum, e) => sum + e.metres, 0);
    const totalWithStopGaps = metres + start.stop.accessGap + end.stop.accessGap;
    if (totalWithStopGaps > settings.maxDistance || roadMetres > settings.maxRoad || metres < 100) {
      if (failures) {
        if (totalWithStopGaps > settings.maxDistance) failures.distance = Math.min(failures.distance, totalWithStopGaps);
        if (roadMetres > settings.maxRoad) failures.roads = Math.min(failures.roads, roadMetres);
        if (metres < 100) failures.short = true;
      }
      return null;
    }
    let cursor = 0;
    for (const index of order) { const at = chain.ids.indexOf(snaps[index].id, cursor); if (at < 0) throw new Error('A mandatory waypoint is missing from this route.'); cursor = at; }
    const unique = new Map(); for (const e of chain.edges) if (!unique.has(e.key)) unique.set(e.key, e.metres);
    const repeatedMetres = metres - [...unique.values()].reduce((s, d) => s + d, 0);
    const relations = [...new Map(chain.edges.flatMap(e => e.hiking).map(r => [r.id, r])).values()];
    const officialIds = [...new Set(chain.edges.filter(e => e.official >= 0).map(e => e.official))];
    const fordCrossings = [...new Set(chain.ids.filter(id => isFord(graph.nodes.get(id)?.tags)))].map(id => { const node = graph.nodes.get(id); return { id, lat: node.lat, lon: node.lon }; });
    return {
      ids: chain.ids, coords: chain.ids.map(id => { const n = graph.nodes.get(id); return { lat: n.lat, lon: n.lon }; }),
      edges: chain.edges.map(e => ({ key: e.key, way: e.way, metres: e.metres })), metres, roadMetres, repeatedMetres,
      trailMetres: chain.edges.filter(e => e.hiking.length || e.official >= 0).reduce((s, e) => s + e.metres, 0),
      corridorMetres: chain.edges.filter(e => e.official >= 0).reduce((s, e) => s + e.metres, 0),
      unknownTerrainMetres: chain.edges.filter(e => e.unknown).reduce((s, e) => s + e.metres, 0),
      start: { ...start.stop, approach: start.path.metres, extendedApproach: start.extended }, end: { ...end.stop, approach: end.path.metres, extendedApproach: end.extended },
      snaps, order, loop: settings.loop, relations, official: officialIds.map(i => graph.features[i].properties), fordCrossings,
      reversible: chain.ids.slice(1).every((id, i) => (graph.adj.get(id) || []).some(e => e.to === chain.ids[i])) && end.stop.services.some(s => s.alight) && start.stop.services.some(s => s.board),
      score: chain.edges.reduce((s, e) => s + e.metres * (e.official >= 0 ? 1 : e.hiking.length ? 1.1 : e.road ? 4 : e.clear ? 1.3 : 1.6), 0) + start.convenience + end.convenience + repeatedMetres * .45,
      osmTimestamp: graph.timestamp
    };
  }
  function distinct(a, b) {
    const edgesA = new Map(a.edges.map(e => [e.key, e.metres])), edgesB = new Map(b.edges.map(e => [e.key, e.metres]));
    const shared = [...edgesA].filter(([key]) => edgesB.has(key)).reduce((s, [, d]) => s + d, 0);
    const union = new Map([...edgesA, ...edgesB]), total = [...union.values()].reduce((s, d) => s + d, 0);
    const differentVisits = a.order && b.order && a.order.join(',') !== b.order.join(',');
    return total > 0 && (shared / total < .9 || (differentVisits && Math.abs(a.metres - b.metres) > Math.max(25, Math.min(a.metres, b.metres) * .02)));
  }
  function optimizeOrder(matrix, starts, ends, loop = false) {
    const n = matrix.length, size = 1 << n, choices = [];
    // Fix each possible first pin for loops, so the return cost uses the same
    // transport stop as the arrival. The interior pin-order search is shared
    // across all stops, avoiding a separate exponential search for every stop.
    for (const first of loop ? Array.from({ length: n }, (_, i) => i) : [null]) {
      const dp = Array.from({ length: size }, () => Array(n).fill(null));
      for (let i = 0; i < n; i++) if (starts[i]?.length && (first === null || i === first)) dp[1 << i][i] = { cost: loop ? 0 : starts[i][0].score, order: [i] };
      for (let mask = 1; mask < size; mask++) for (let last = 0; last < n; last++) {
        const old = dp[mask][last]; if (!old) continue;
        for (let next = 0; next < n; next++) { if (mask & (1 << next) || !matrix[last][next]) continue; const nextMask = mask | (1 << next), cost = old.cost + matrix[last][next].cost; if (!dp[nextMask][next] || cost < dp[nextMask][next].cost) dp[nextMask][next] = { cost, order: [...old.order, next] }; }
      }
      dp[size - 1].forEach((state, last) => {
        if (!state || !ends[last]?.length) return;
        const pairs = loop ? endpointPairs(starts[first], ends[last], true) : [];
        const approachCost = loop ? pairs.reduce((best, { start, end }) => Math.min(best, start.score + end.score), Infinity) : ends[last][0].score;
        if (Number.isFinite(approachCost)) choices.push({ order: state.order, cost: state.cost + approachCost });
      });
    }
    return choices.sort((a, b) => a.cost - b.cost)[0]?.order || null;
  }
  function plan(data, points, inputSettings = {}, features = [], progress = () => {}) {
    const settings = { tolerance: 30, radius: 1000, maxApproach: 1000, maxDistance: 30000, maxRoad: 1500, optimize: true, loop: false, allowOfficialFords: false, ...inputSettings };
    if (typeof settings.loop !== 'boolean') throw new Error('Choose a valid Loop setting: on or off.');
    if (typeof settings.allowOfficialFords !== 'boolean') throw new Error('Choose a valid official-trail stream-crossing setting: on or off.');
    settings.maxApproach = Math.min(MAX_APPROACH, settings.maxApproach);
    if (!Array.isArray(points) || !points.length || points.length > MAX_WAYPOINTS || points.some(p => !validPoint(p))) throw new Error(`Use 1–${MAX_WAYPOINTS} confirmed waypoints within one local walking area, between 75°S and 75°N. No waypoints are silently omitted.`);
    const canReorder = settings.optimize && points.length <= 8;
    const graph = buildGraph(data, features, settings);
    progress('Comparing nearby eligible path snaps and directed connections…');
    const snaps = snapWaypoints(graph, points, settings.tolerance), n = snaps.length;
    const transit = transportStops(graph, points, settings.radius), stopIds = transit.stops.map(s => s.node);
    const ordered = Array.from({ length: n }, (_, i) => i), shortest = [], starts = [], ends = [];
    const noPenalties = new Map();
    // Measure approach limits with shortest walking distances, independently of
    // trail preferences. Direction matters: arrival walks run toward the first pin.
    for (let i = 0; i < n; i++) {
      const targets = canReorder ? [...snaps.map(s => s.id), ...stopIds] : [...(i + 1 < n ? [snaps[i + 1].id] : []), ...(i === n - 1 ? stopIds : [])];
      shortest[i] = search(graph, snaps[i].id, 'distance', noPenalties, false, targets);
      if (canReorder || i === n - 1) ends[i] = endpoints(shortest[i], transit.stops, 'board', settings.maxApproach, settings.loop);
      if (canReorder || !i) starts[i] = endpoints(search(graph, snaps[i].id, 'distance', noPenalties, true, stopIds), transit.stops, 'alight', settings.maxApproach, settings.loop);
    }
    const missingLeg = ordered.slice(1).findIndex((to, i) => !pathFrom(shortest[i], snaps[to].id));
    const fordHint = graph.excludedOfficialFords.length ? ' An AFCD-corridor ford is excluded by default; after checking current weather and crossing conditions, you may explicitly enable Official trail stream crossings in Requirements.' : '';
    let orderedFailure = missingLeg >= 0 ? routeError('DISCONNECTED_WAYPOINTS', `Waypoint ${missingLeg + 1} → waypoint ${missingLeg + 2} cannot be connected in pin order in the downloaded walking network. Missing connections, foot one-way restrictions, access restrictions or excluded terrain may separate them. No gap was bridged.${fordHint}`) : null;
    const missingEnds = [!starts[0]?.length ? 0 : null, !ends[n - 1]?.length ? n - 1 : null].filter(i => i !== null);
    const missingLoop = settings.loop && !endpointPairs(starts[0], ends[n - 1], true).length;
    if (!orderedFailure && missingLoop) {
      orderedFailure = routeError('NO_TRANSPORT', `No shared start/finish was found for a loop in pin order within ${settings.maxApproach / 1000} km of walking from both end pins. The same transport stop must allow arrival and departure, with eligible mapped paths to waypoint 1 and back from waypoint ${n}. Separate stops or a one-way path without a mapped return cannot close the loop.${settings.maxApproach >= MAX_APPROACH ? ' The 20 km maximum was reached; no off-path closing line was added.' : ''}`, { endpointIndices: [...new Set([0, n - 1])] });
      if (settings.maxApproach < MAX_APPROACH) throw orderedFailure;
    } else if (!orderedFailure && missingEnds.length) {
      const roles = [!starts[0]?.length ? `start before waypoint 1 (a service allowing arrival)` : '', !ends[n - 1]?.length ? `finish after waypoint ${n} (a service allowing departure)` : ''].filter(Boolean);
      const unlinked = transit.unlinked ? ` ${transit.unlinked} nearby stop(s) had no mapped service link.` : '';
      orderedFailure = routeError('NO_TRANSPORT', `${!transit.stops.length ? 'No passenger stops linked to usable mapped services were found. ' : ''}No reachable transport for the ${roles.join(' and ')} within ${settings.maxApproach / 1000} km of walking. Stops must connect to the eligible walking network within 80 m; that final stop gap remains unverified.${unlinked}${settings.maxApproach >= MAX_APPROACH ? ' The 20 km maximum was reached; no longer approach or off-path shortcut was used.' : ''}`, { endpointIndices: [...new Set(missingEnds)] });
      // Give the entered order its transport extension before considering reorderings.
      if (settings.maxApproach < MAX_APPROACH) throw orderedFailure;
    }
    const variants = [{ profile: 'distance', reorder: false }, { profile: 'trail', reorder: false }];
    if (canReorder) variants.push({ profile: 'distance', reorder: true }, { profile: 'trail', reorder: true });
    variants.push(...Array.from({ length: 3 }, () => ({ profile: 'trail', reorder: false, diverse: true })));
    const selected = [], penalties = new Map(), failures = { distance: Infinity, roads: Infinity, short: false };
    const trailStarts = trailApproaches(graph, snaps, starts, true, settings.maxApproach), trailEnds = trailApproaches(graph, snaps, ends, false, settings.maxApproach);
    let orderedFound = false;
    for (const [variant, spec] of variants.entries()) {
      progress(`Searching ${spec.reorder ? 'an alternative pin order' : 'in your pin order'} · ${spec.profile === 'distance' ? 'shortest mapped walks' : 'mapped trail preference'}…`);
      const matrix = Array.from({ length: n }, () => Array(n).fill(null));
      for (let i = 0; i < n; i++) {
        const targets = spec.reorder ? snaps.map(s => s.id) : (i + 1 < n ? [snaps[i + 1].id] : []);
        const tree = spec.profile === 'distance' ? shortest[i] : search(graph, snaps[i].id, spec.profile, spec.diverse ? penalties : noPenalties, false, targets);
        for (let j = 0; j < n; j++) if (spec.reorder || j === i + 1) matrix[i][j] = pathFrom(tree, snaps[j].id);
      }
      const arrivals = spec.profile === 'distance' ? starts : trailStarts, departures = spec.profile === 'distance' ? ends : trailEnds;
      const order = spec.reorder ? optimizeOrder(matrix, arrivals, departures, settings.loop) : ordered;
      if (!order || order.slice(1).some((to, i) => !matrix[order[i]][to])) continue;
      const first = order[0], last = order.at(-1), middle = order.slice(1).map((to, i) => matrix[order[i]][to]);
      if (!arrivals[first]?.length || !departures[last]?.length) continue;
      const fresh = [];
      for (const { start, end } of endpointPairs(arrivals[first], departures[last], settings.loop)) {
        const candidate = summarize(graph, stitch([start.path, ...middle, end.path]), start, end, snaps, order, settings, failures);
        if (candidate) { candidate.variant = variant; candidate.preservesOrder = order.every((p, i) => p === i); fresh.push(candidate); }
      }
      fresh.sort((a, b) => (spec.profile === 'distance' ? a.metres - b.metres : a.score - b.score));
      const baseline = selected.find(r => r.preservesOrder);
      const choice = fresh.find(route => selected.every(prior => distinct(route, prior)) &&
        (route.preservesOrder || !baseline || route.metres < baseline.metres - 1 || route.score < baseline.score - 1));
      if (choice) {
        orderedFound ||= choice.preservesOrder;
        choice.title = choice.preservesOrder ? (selected.length === 0 ? 'Shortest found · pin order' : 'Mapped-trail alternative · pin order') : (!baseline ? 'Connected alternative · different order' : choice.metres < baseline.metres - 1 ? 'Shorter walk · different pin order' : 'Mapped-trail alternative · different order');
        choice.reason = !choice.preservesOrder && baseline ? (choice.metres < baseline.metres - 1 ? `${((baseline.metres - choice.metres) / 1000).toFixed(1)} km shorter than the first option.` : 'Better mapped-trail preference score than the first option; current condition is unverified.') : choice.preservesOrder ? 'Visits every pin in the listed order.' : 'Uses a different order because no qualifying route in the listed order was found.';
        selected.push(choice);
      }
      if (selected.length === 3) break;
      const avoid = choice || fresh[0] || selected[0];
      if (avoid) for (const e of avoid.edges) penalties.set(e.key, Math.min(3.5, (penalties.get(e.key) || 0) + .7));
    }
    const limitReasons = [];
    if (Number.isFinite(failures.distance)) limitReasons.push(`the shortest over-distance candidate checked was ${(failures.distance / 1000).toFixed(1)} km, above your ${settings.maxDistance / 1000} km maximum including both approaches and stop gaps`);
    if (Number.isFinite(failures.roads)) limitReasons.push(`the least road use among over-limit candidates checked was ${(failures.roads / 1000).toFixed(2)} km, above your ${settings.maxRoad / 1000} km road limit`);
    if (failures.short) limitReasons.push('the mapped walk was shorter than the 100 m minimum');
    if (!selected.length) {
      if (orderedFailure) throw orderedFailure;
      throw routeError('ROUTE_LIMITS', `Connected paths were found, but none met your limits${settings.loop ? ' for a loop returning to the same start' : ''}: ${limitReasons.join('; ') || 'no usable transport-to-transport walk through every pin was found'}. No limits were relaxed.`);
    }
    const notices = [];
    if (!orderedFound) notices.push(`Pin order could not be kept. ${orderedFailure?.message || limitReasons.join('; ') || 'The ordered candidates failed the selected limits.'}`);
    if (settings.optimize && !canReorder) notices.push('For more than 8 waypoints, alternatives keep your pin order.');
    if (selected.some(route => route.fordCrossings.length)) notices.push('This plan crosses a mapped ford on an AFCD trail corridor. Check rain, water level, official notices and conditions before going; the app cannot verify that the crossing is safe today.');
    selected.forEach((route, i) => {
      route.id = `route-${i + 1}`;
      if (settings.loop) { route.title += ' · loop'; route.reason += ' Returns to the same mapped start/finish near the same transport stop; some paths may be retraced.'; }
    });
    return { routes: selected, notices, eligibleNodes: graph.nodes.size, excludedWays: graph.excludedWays, stopCount: transit.stops.length, unlinkedStops: transit.unlinked, timestamp: graph.timestamp, qualified: 'provisional', settings };
  }
  function transportExpansion(points, error) {
    if (error?.code !== 'NO_TRANSPORT') return [];
    return [...new Set(error.endpointIndices || [0, points.length - 1])].filter(i => Number.isInteger(i) && points[i]).map(i => ({ lat: points[i].lat, lon: points[i].lon, radius: MAX_APPROACH }));
  }
  function coverageBox(box, areas) {
    const coverage = [...box];
    for (const p of areas) {
      const latPad = p.radius / 111195, lonPad = latPad / Math.cos(p.lat * Math.PI / 180);
      coverage[0] = Math.min(coverage[0], p.lat - latPad); coverage[1] = Math.min(coverage[1], p.lon - lonPad);
      coverage[2] = Math.max(coverage[2], p.lat + latPad); coverage[3] = Math.max(coverage[3], p.lon + lonPad);
    }
    return coverage;
  }
  function boundingBox(points, radius) {
    if (!points.length || points.some(p => !validPoint(p))) throw new Error('Add valid waypoints in a local walking area first.');
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length, padLat = radius / 111195, padLon = padLat / Math.cos(lat * Math.PI / 180);
    const box = [Math.min(...points.map(p => p.lat)) - padLat, Math.min(...points.map(p => p.lon)) - padLon, Math.max(...points.map(p => p.lat)) + padLat, Math.max(...points.map(p => p.lon)) + padLon];
    const area = distance({ lat: box[0], lon: box[1] }, { lat: box[2], lon: box[1] }) * distance({ lat: box[0], lon: box[1] }, { lat: box[0], lon: box[3] });
    if (box[1] < -180 || box[3] > 180 || box[3] - box[1] > 180 || area > 250e6) throw routeError('AREA_TOO_LARGE', 'The core waypoint area exceeds 250 km² or crosses the date line. Use closer waypoints or split this into separate hikes. The 20 km transport extension does not remove this core-area limit.');
    return box.map(n => Number(n.toFixed(6)));
  }
  function queryFor(box, areas = []) {
    if (areas.length > 2 || areas.some(p => !validPoint(p) || p.radius !== MAX_APPROACH)) throw new Error('Transport expansion must use at most two valid 20 km endpoint areas.');
    const scopes = [box.join(','), ...areas.map(p => `around:${p.radius},${p.lat.toFixed(6)},${p.lon.toFixed(6)}`)];
    const paths = scopes.map(scope => `way["highway"~"^(path|footway|pedestrian|steps|living_street|track|residential|service|unclassified|tertiary|cycleway)$"](${scope});`).join('\n');
    const stops = scopes.map(scope => `node["highway"="bus_stop"](${scope});node["public_transport"="platform"](${scope});node["railway"~"^(station|halt|tram_stop|subway_entrance)$"](${scope});node["amenity"="ferry_terminal"](${scope});`).join('\n');
    return `[out:json][timeout:40][maxsize:67108864];\n(${paths})->.paths;\n(.paths;node(w.paths););out body qt;\nrelation(bw.paths)["route"~"^(hiking|foot)$"];out body qt;\n(${stops})->.stops;\n.stops out body qt;\nrelation(bn.stops)["public_transport"="stop_area"]->.stopareas;\n.stopareas out body qt;\nnode(r.stopareas)->.stopmembers;\n(relation(bn.stops)["route"~"^(bus|trolleybus|train|subway|light_rail|tram|ferry|share_taxi)$"];relation(bn.stopmembers)["route"~"^(bus|trolleybus|train|subway|light_rail|tram|ferry|share_taxi)$"];relation(br.stopareas)["route"~"^(bus|trolleybus|train|subway|light_rail|tram|ferry|share_taxi)$"];);out body qt;`;
  }
  return { MAX_WAYPOINTS, MAX_SNAP_CANDIDATES, MAX_APPROACH, distance, walkable, passableNode, buildGraph, nearest, snapWaypoints, transportStops, search, pathFrom, distinct, optimizeOrder, plan, boundingBox, queryFor, transportExpansion, coverageBox };
});
