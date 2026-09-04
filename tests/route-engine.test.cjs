const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/route-engine.js');
function fixture() {
  const nodes = [
    [1, 22, 114], [2, 22, 114.001], [3, 22, 114.004], [4, 22, 114.005],
    [5, 22.001, 114.002], [6, 22.001, 114.003], [7, 21.999, 114.002], [8, 21.999, 114.003],
    [9, 22.002, 114.002], [10, 22.002, 114.003]
  ].map(([id, lat, lon]) => ({ type: 'node', id, lat, lon }));
  const ways = [[101, [1, 2]], [102, [2, 5, 6, 3]], [103, [2, 7, 8, 3]], [104, [2, 9, 10, 3]], [105, [3, 4]]].map(([id, nodes]) => ({ type: 'way', id, nodes, tags: { highway: 'footway', foot: 'designated' } }));
  nodes[0].tags = { highway: 'bus_stop', name: 'Start transit' }; nodes[3].tags = { railway: 'station', name: 'End transit' };
  const relations = [
    { type: 'relation', id: 501, tags: { route: 'bus', ref: 'Bus A', operator: 'Test operator' }, members: [{ type: 'node', ref: 1, role: 'platform' }] },
    { type: 'relation', id: 502, tags: { route: 'train', ref: 'Train B' }, members: [{ type: 'node', ref: 4, role: 'stop' }] },
    { type: 'relation', id: 503, tags: { route: 'hiking', name: 'Mapped trail' }, members: [{ type: 'way', ref: 102 }] }
  ];
  return { elements: [...nodes, ...ways, ...relations], osm3s: { timestamp_osm_base: '2026-08-31T00:00:00Z' } };
}
function nearbyBranchFixture(kind = 'isolated') {
  const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) });
  const nodes = [
    node(1, 22, 114, { highway: 'bus_stop', name: 'Start transit' }),
    node(2, 22, 114.001), node(3, 22, 114.003),
    node(4, 22, 114.004, { railway: 'station', name: 'End transit' })
  ];
  const ways = [{ type: 'way', id: 10, nodes: [1, 2, 3, 4], tags: { highway: 'footway', foot: 'designated' } }];
  if (kind === 'isolated') {
    nodes.push(node(20, 22.00005, 114.0008), node(21, 22.00005, 114.0012));
    ways.push({ type: 'way', id: 20, nodes: [20, 21], tags: { highway: 'path' } });
  } else {
    nodes.push(node(21, 22.00025, 114.001));
    ways.push({ type: 'way', id: 20, nodes: [2, 21], tags: { highway: 'path', 'oneway:foot': 'yes' } });
  }
  const relations = [
    { type: 'relation', id: 101, tags: { route: 'bus' }, members: [{ type: 'node', ref: 1, role: 'platform' }] },
    { type: 'relation', id: 102, tags: { route: 'train' }, members: [{ type: 'node', ref: 4, role: 'stop' }] }
  ];
  return { data: { elements: [...nodes, ...ways, ...relations] }, points: [{ lat: 22.00005, lon: 114.001 }, { lat: 22, lon: 114.003 }] };
}
const points = [{ lat: 22, lon: 114.001 }, { lat: 22, lon: 114.004 }];
test('three distinct source-geometry routes visit every waypoint and reach serviced passenger stops', () => {
  const data = fixture(), result = R.plan(data, points);
  assert.equal(result.routes.length, 3);
  for (const route of result.routes) {
    assert.ok(route.ids.indexOf(3, route.ids.indexOf(2)) > route.ids.indexOf(2));
    assert.ok(route.start.services.some(s => s.alight)); assert.ok(route.end.services.some(s => s.board));
    for (const id of route.ids) assert.ok(data.elements.some(e => e.type === 'node' && e.id === id));
    assert.ok(route.edges.every(e => data.elements.some(w => w.type === 'way' && w.id === e.way)));
  }
  assert.ok(R.distinct(result.routes[0], result.routes[1]));
});
test('off-network mandatory waypoints fail instead of being dropped or joined', () => {
  assert.throws(() => R.plan(fixture(), [...points, { lat: 22.03, lon: 114.03 }]), /Waypoint 3/);
});
test('a waypoint on the middle of a mapped path segment is projected onto and routed through that path', () => {
  const waypoint = { lat: 22.0005, lon: 114.0015 }, graph = R.buildGraph(fixture());
  assert.equal(R.nearest(graph, waypoint, 30), null, 'the OSM vertices are farther away than the tolerance');
  const [snap] = R.snapWaypoints(graph, [waypoint], 30);
  assert.ok(String(snap.id).startsWith('waypoint:'));
  assert.ok(snap.metres < 0.1);
  assert.ok(R.pathFrom(R.search(graph, 2, 'distance', new Map()), snap.id));
  assert.ok(R.pathFrom(R.search(graph, snap.id, 'distance', new Map()), 5));
  const result = R.plan(fixture(), [waypoint, points[1]]);
  assert.ok(result.routes.every(route => route.ids.includes('waypoint:0')));
  assert.ok(result.routes.every(route => route.snaps[0].metres < 0.1));
});
test('splitting a path for an interior waypoint preserves its foot direction', () => {
  const data = { elements: [
    { type: 'node', id: 1, lat: 22, lon: 114 },
    { type: 'node', id: 2, lat: 22, lon: 114.002 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'path', 'oneway:foot': 'yes' } }
  ] };
  const graph = R.buildGraph(data), [snap] = R.snapWaypoints(graph, [{ lat: 22, lon: 114.001 }], 15);
  assert.ok(R.pathFrom(R.search(graph, 1, 'distance', new Map()), snap.id));
  assert.equal(R.pathFrom(R.search(graph, snap.id, 'distance', new Map()), 1), null);
});
test('a slightly farther connected segment is selected over the closest isolated branch', () => {
  const { data, points } = nearbyBranchFixture('isolated');
  const closest = R.snapWaypoints(R.buildGraph(data), [points[0]], 30)[0];
  assert.ok(Math.abs(closest.point.lat - 22.00005) < 1e-9, 'the isolated branch is locally closest');
  const first = R.plan(data, points, { optimize: false, tolerance: 30 }).routes[0];
  assert.equal(first.snaps.length, 2);
  assert.equal(first.snaps[0].id, 2, 'the collective choice uses the connected main path');
  assert.ok(first.snaps.every(snap => snap.metres <= 30));
  const ways = new Map(data.elements.filter(e => e.type === 'way').map(way => [way.id, way]));
  assert.ok(first.edges.every(edge => ways.has(edge.way) && R.walkable(ways.get(edge.way).tags)), 'every output edge retains eligible downloaded OSM provenance');
  assert.deepEqual(R.plan(data, points, { optimize: false, tolerance: 30 }).routes[0].snaps.map(s => s.id), first.snaps.map(s => s.id), 'candidate selection is deterministic');
  const loop = R.plan(data, points, { optimize: false, tolerance: 30, loop: true }).routes[0];
  assert.equal(loop.snaps[0].id, 2, 'loop snapping also rejects the closest isolated branch');
  assert.deepEqual(loop.coords[0], loop.coords.at(-1));
});
test('a valid directed candidate replaces the closest wrong-way dead-end snap', () => {
  const { data, points } = nearbyBranchFixture('oneway');
  const graph = R.buildGraph(data), closest = R.snapWaypoints(graph, [points[0]], 30)[0];
  assert.ok(Math.abs(closest.point.lat - points[0].lat) < 1e-9, 'the one-way branch is locally closest');
  assert.equal(R.pathFrom(R.search(graph, closest.id, 'distance', new Map()), 3), null, 'the closest branch cannot be exited in the requested direction');
  const route = R.plan(data, points, { optimize: false, tolerance: 30 }).routes[0];
  assert.equal(route.snaps[0].id, 2);
  assert.deepEqual(route.ids, [1, 2, 3, 4]);
  assert.ok(route.snaps.every(snap => snap.metres <= 30));
  const loop = R.plan(data, points, { optimize: false, tolerance: 30, loop: true }).routes[0];
  assert.equal(loop.snaps[0].id, 2, 'the loop uses a candidate that permits both outbound and return travel');
  assert.deepEqual(loop.coords[0], loop.coords.at(-1));
});
test('equal-offset connected combinations use mapped route distance as the deterministic tie-breaker', () => {
  const nodes = [
    [1, 22, 114], [2, 22, 114.001], [3, 22, 114.003], [4, 22, 114.004],
    [5, 22.0002, 114], [6, 22.0002, 114.001], [7, 22.002, 114.002], [8, 22.0002, 114.003], [9, 22.0002, 114.004]
  ].map(([id, lat, lon]) => ({ type: 'node', id, lat, lon }));
  const data = { elements: [...nodes,
    { type: 'way', id: 10, nodes: [1, 2, 3, 4], tags: { highway: 'path' } },
    { type: 'way', id: 20, nodes: [5, 6, 7, 8, 9], tags: { highway: 'path' } }
  ] };
  const snaps = R.snapWaypoints(R.buildGraph(data), [{ lat: 22.0001, lon: 114.001 }, { lat: 22.0001, lon: 114.003 }], 30);
  assert.deepEqual(snaps.map(snap => snap.id), [2, 3]);
});
test('visually crossing ways without a shared OSM node remain disconnected', () => {
  const nodes = [
    [1, 22, 114, { highway: 'bus_stop' }], [2, 22, 114.002],
    [3, 21.999, 114.001], [4, 22.001, 114.001, { railway: 'station' }]
  ].map(([id, lat, lon, tags]) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) }));
  const data = { elements: [...nodes,
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'path' } },
    { type: 'way', id: 20, nodes: [3, 4], tags: { highway: 'path' } },
    { type: 'relation', id: 101, tags: { route: 'bus' }, members: [{ type: 'node', ref: 1, role: 'platform' }] },
    { type: 'relation', id: 102, tags: { route: 'train' }, members: [{ type: 'node', ref: 4, role: 'stop' }] }
  ] };
  const crossingPoints = [{ lat: 22, lon: 114.0005 }, { lat: 22.0005, lon: 114.001 }];
  assert.throws(() => R.plan(data, crossingPoints, { optimize: false, tolerance: 30 }), error => error.code === 'DISCONNECTED_WAYPOINTS' && /No gap was bridged/.test(error.message));
});
test('all nearby candidates disconnected still fail without a fabricated link', () => {
  const nodes = [
    [1, 22, 114, { highway: 'bus_stop' }], [2, 22, 114.001], [3, 22.0001, 114], [4, 22.0001, 114.001],
    [5, 22, 114.003], [6, 22, 114.004, { railway: 'station' }], [7, 22.0001, 114.003], [8, 22.0001, 114.004]
  ].map(([id, lat, lon, tags]) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) }));
  const ways = [[10, [1, 2]], [11, [3, 4]], [20, [5, 6]], [21, [7, 8]]].map(([id, ids]) => ({ type: 'way', id, nodes: ids, tags: { highway: 'path' } }));
  const data = { elements: [...nodes, ...ways,
    { type: 'relation', id: 101, tags: { route: 'bus' }, members: [{ type: 'node', ref: 1, role: 'platform' }] },
    { type: 'relation', id: 102, tags: { route: 'train' }, members: [{ type: 'node', ref: 6, role: 'stop' }] }
  ] };
  const disconnected = [{ lat: 22.00005, lon: 114.0005 }, { lat: 22.00005, lon: 114.0035 }];
  const graph = R.buildGraph(data); R.snapWaypoints(graph, disconnected, 30);
  assert.ok([...graph.nodes.keys()].filter(id => String(id).startsWith('waypoint:')).length >= 4, 'multiple in-tolerance candidates were materialized');
  assert.throws(() => R.plan(data, disconnected, { optimize: false, tolerance: 30 }), error => error.code === 'DISCONNECTED_WAYPOINTS' && /Waypoint 1 → waypoint 2/.test(error.message));
});
test('a stop without a transport service never qualifies', () => {
  const data = fixture(); data.elements = data.elements.filter(e => e.type !== 'relation' || e.tags.route === 'hiking');
  assert.throws(() => R.plan(data, points), /No passenger stops linked/);
});
test('disconnected paths and missing source geometry fail closed', () => {
  const data = fixture(); data.elements = data.elements.filter(e => ![102, 103, 104].includes(e.id));
  assert.throws(() => R.plan(data, points), /Waypoint 1 → waypoint 2 cannot be connected/);
  const missing = fixture(); missing.elements = missing.elements.filter(e => e.id !== 5);
  assert.throws(() => R.plan(missing, points), /geometry is missing/);
  assert.throws(() => R.plan({ ...fixture(), remark: 'runtime timeout' }, points), /incomplete data/);
});
test('private, conditional, demanding, ford and car-only paths are excluded', () => {
  for (const tags of [{ highway: 'motorway', foot: 'yes' }, { highway: 'path', foot: 'no' }, { highway: 'path', access: 'private' }, { highway: 'path', sac_scale: 'mountain_hiking' }, { highway: 'path', ford: 'yes' }, { highway: 'path', 'foot:conditional': 'yes @ (Su)' }, { highway: 'cycleway' }]) assert.equal(R.walkable(tags), false);
  assert.equal(R.walkable({ highway: 'path', access: 'private', foot: 'yes' }), true);
  assert.equal(R.walkable({ highway: 'corridor', indoor: 'yes' }), true, 'a public mapped pedestrian corridor can connect station waypoints');
  assert.equal(R.walkable({ highway: 'corridor', indoor: 'yes', access: 'private' }), false);
});
test('a mapped ford is opt-in only and can connect an AFCD corridor without relaxing other restrictions', () => {
  assert.equal(R.walkable({ highway: 'path', ford: 'yes' }, true), false, 'the public walkability check cannot bypass ford policy');
  const nodes = [
    { type: 'node', id: 1, lat: 22, lon: 114, tags: { highway: 'bus_stop', name: 'Start transit' } },
    { type: 'node', id: 2, lat: 22, lon: 114.001, tags: { ford: 'yes' } },
    { type: 'node', id: 3, lat: 22, lon: 114.003 },
    { type: 'node', id: 4, lat: 22, lon: 114.004, tags: { railway: 'station', name: 'End transit' } },
    { type: 'node', id: 5, lat: 22.0005, lon: 114 }
  ];
  const ways = [
    { type: 'way', id: 10, nodes: [1, 2, 3, 4], tags: { highway: 'footway' } },
    { type: 'way', id: 11, nodes: [1, 5], tags: { highway: 'path' } }
  ];
  const services = [
    { type: 'relation', id: 101, tags: { route: 'bus' }, members: [{ type: 'node', ref: 1, role: 'platform' }] },
    { type: 'relation', id: 102, tags: { route: 'train' }, members: [{ type: 'node', ref: 4, role: 'stop' }] }
  ];
  const data = { elements: [...nodes, ...ways, ...services] };
  const required = [{ lat: 22, lon: 114 }, { lat: 22, lon: 114.003 }];
  const official = [{ type: 'Feature', properties: { TRAIL_NAME_EN: 'Test country trail' }, geometry: { type: 'LineString', coordinates: [[114, 22], [114.004, 22]] } }];
  assert.throws(() => R.plan(structuredClone(data), required, { optimize: false }, official), error => error.code === 'DISCONNECTED_WAYPOINTS' && /excluded by default/.test(error.message));
  assert.throws(() => R.plan(structuredClone(data), required, { optimize: false, allowOfficialFords: true }), error => error.code === 'DISCONNECTED_WAYPOINTS', 'an OSM-only ford remains excluded');
  const result = R.plan(structuredClone(data), required, { optimize: false, allowOfficialFords: true }, official);
  assert.ok(result.routes.length);
  assert.ok(result.routes.every(route => route.fordCrossings.some(crossing => crossing.id === 2)));
  assert.ok(result.routes.every(route => route.snaps.every(snap => snap.metres <= 30)));
  assert.match(result.notices.join(' '), /mapped ford on an AFCD trail corridor/);
  const restricted = structuredClone(data); restricted.elements.find(element => element.id === 2).tags.foot = 'no';
  assert.throws(() => R.plan(restricted, required, { optimize: false, allowOfficialFords: true }, official), error => error.code === 'DISCONNECTED_WAYPOINTS', 'explicit foot restrictions still win');
});
test('distance and road limits are not silently relaxed', () => {
  assert.throws(() => R.plan(fixture(), points, { maxDistance: 150 }), /none met/);
  const data = fixture(); data.elements.filter(e => e.type === 'way').forEach(e => { e.tags.highway = 'residential'; });
  assert.throws(() => R.plan(data, points, { maxRoad: 0 }), /none met/);
});
test('foot one-way affects connectivity and reversal', () => {
  const data = fixture(); data.elements.filter(e => e.type === 'way').forEach(e => { e.tags['oneway:foot'] = 'yes'; });
  const result = R.plan(data, points); assert.equal(result.routes[0].reversible, false);
  assert.throws(() => R.plan(data, [...points].reverse(), { optimize: false }), /Waypoint 1 → waypoint 2 cannot be connected/);
});
test('optimised order retains all mandatory waypoints', () => {
  const input = [points[1], points[0], { lat: 22.001, lon: 114.002 }];
  const result = R.plan(fixture(), input, { optimize: true });
  assert.deepEqual([...result.routes[0].order].sort(), [0, 1, 2]);
});
test('query size and large waypoint counts are bounded', () => {
  assert.throws(() => R.boundingBox([{ lat: 22, lon: 114 }, { lat: 35, lon: 139 }], 4000), /250/);
  assert.throws(() => R.plan(fixture(), Array(51).fill(points[0])), /1–50/);
  const denseElements = [];
  for (let i = 0; i < 40; i++) {
    const lat = 22 + (i - 20) * .00001, a = 1000 + i * 2, b = a + 1;
    denseElements.push({ type: 'node', id: a, lat, lon: 114 }, { type: 'node', id: b, lat, lon: 114.002 }, { type: 'way', id: 2000 + i, nodes: [a, b], tags: { highway: 'path' } });
  }
  const denseGraph = R.buildGraph({ elements: denseElements });
  R.snapWaypoints(denseGraph, [{ lat: 22, lon: 114.001 }], 30);
  assert.equal([...denseGraph.nodes.keys()].filter(id => String(id).startsWith('waypoint:')).length, R.MAX_SNAP_CANDIDATES, 'dense candidate materialization stays capped');
  const query = R.queryFor(R.boundingBox(points, 2000));
  assert.ok(query.includes('out body qt'));
  assert.ok(query.includes('relation(bw.paths)'));
  assert.ok(query.includes('relation(bn.stopmembers)'));
  assert.doesNotMatch(query, /relation\["route"[^\n]+\]\(/, 'never download every route relation intersecting the whole bounding box');
});
test('50 required waypoints stay on mapped geometry and in order, including loops', () => {
  assert.equal(R.MAX_SNAP_CANDIDATES, 24);
  const { data, points } = require('./fixtures/fifty-waypoints.cjs')();
  for (const loop of [false, true]) {
    const result = R.plan(data, points, { optimize: true, loop });
    assert.ok(result.routes.length);
    for (const route of result.routes) {
      assert.deepEqual(route.order, points.map((_, i) => i));
      assert.equal(route.snaps.length, 50);
      let position = -1;
      for (const snap of route.snaps) {
        position = route.ids.indexOf(snap.id, position + 1);
        assert.ok(position >= 0, `route visits waypoint ${snap.index + 1} in sequence`);
        assert.ok(snap.metres < .1);
      }
      assert.ok(route.edges.every(edge => edge.way === 10));
      assert.ok(route.coords.every(p => Math.abs(p.lat - 22.05) < 1e-9));
      if (loop) assert.deepEqual(route.coords[0], route.coords.at(-1));
    }
    assert.match(result.notices.join(' '), /keep your pin order/);
  }
  assert.throws(() => R.plan(data, [...points.slice(0, 49), { lat: 22.1, lon: 114 }]), /Waypoint 50 has no eligible path/);
});
test('passenger entrance names inherit their station and restricted services are excluded', () => {
  const data = fixture(), n = data.elements.find(e => e.id === 4); n.tags = { railway: 'subway_entrance', ref: '2' };
  data.elements.push({type:'relation',id:900,tags:{public_transport:'stop_area','name:en':'Example Station'},members:[{type:'node',ref:4}]});
  const graph = R.buildGraph(data), stops = R.transportStops(graph, points, 4000).stops;
  assert.equal(stops.find(s => s.id === 4).name, 'Example Station entrance 2');
  data.elements.find(e => e.id === 501).tags.access = 'students';
  assert.equal(R.transportStops(R.buildGraph(data), points, 4000).stops.some(s=>s.id===1), false);
  assert.equal(R.passableNode({tags:{highway:'ford'}}), false);
  assert.equal(R.walkable({highway:'path',disused:'yes'}), false);
});

const transportNetwork = require('./fixtures/transport-network.cjs');
const extended = { radius: 20000, maxApproach: 20000, optimize: false };
test('missing arrival transport widens only the start and preserves a nearby finish', () => {
  const { data, points } = transportNetwork();
  let failure;
  assert.throws(() => R.plan(data, points, { optimize: false }), error => { failure = error; return error.code === 'NO_TRANSPORT' && /start before waypoint 1/.test(error.message) && !/finish after/.test(error.message); });
  assert.deepEqual(failure.endpointIndices, [0]);
  const areas = R.transportExpansion(points, failure);
  assert.deepEqual(areas, [{ ...points[0], radius: 20000 }]);
  const result = R.plan(data, points, extended), route = result.routes[0];
  assert.equal(route.start.id, 1); assert.equal(route.end.id, 4);
  assert.equal(route.start.extendedApproach, true); assert.equal(route.end.extendedApproach, false);
  assert.ok(route.start.approach > 2000 && route.start.approach < 2200);
  assert.ok(route.end.approach < 400);
  assert.deepEqual(route.ids, [1, 2, 3, 4]);
  assert.ok(Math.abs(route.metres - (route.start.approach + R.distance(points[0], points[1]) + route.end.approach)) < .01);
  assert.throws(() => R.plan(data, points, { ...extended, maxDistance: 2000 }), error => error.code === 'ROUTE_LIMITS' && /including both approaches/.test(error.message));
});
test('reachable transport within 1 km takes priority over farther services after expansion', () => {
  const { data, points } = transportNetwork({ nearStart: true });
  const result = R.plan(data, points, extended);
  assert.ok(result.routes.every(r => r.start.id === 5 && !r.start.extendedApproach));
});
test('a mapped walking approach between 10 km and 20 km can reach transport', () => {
  const { data, points } = transportNetwork({ detour: .06 });
  const route = R.plan(data, points, extended).routes[0];
  assert.ok(route.start.approach > 10000 && route.start.approach < 20000);
  assert.equal(route.start.extendedApproach, true);
  assert.ok(route.ids.every(id => data.elements.some(e => e.type === 'node' && e.id === id)));
});
test('20 km is walking distance, not a straight-line circle; no detour is bridged', () => {
  const { data, points } = transportNetwork({ detour: true });
  assert.ok(R.distance(points[0], data.elements[0]) < 1000);
  assert.throws(() => R.plan(data, points, extended), error => error.code === 'NO_TRANSPORT' && /20 km maximum was reached/.test(error.message));
});
test('first route minimizes metres in pin order, without hidden road penalties', () => {
  const data = fixture();
  data.elements.push({ type: 'way', id: 106, nodes: [2, 3], tags: { highway: 'residential', foot: 'yes' } });
  const result = R.plan(data, points, { optimize: true });
  assert.deepEqual(result.routes[0].order, [0, 1]);
  assert.deepEqual(result.routes[0].ids, [1, 2, 3, 4]);
  assert.ok(result.routes[0].edges.some(e => e.way === 106));
  assert.ok(result.routes.some(r => r.roadMetres === 0), 'a trail option remains available');
  assert.ok(result.routes.every(r => r.metres >= result.routes[0].metres - .01));
});
test('the shortest qualifying candidate is Route 1 while pin order remains available', () => {
  const { data } = transportNetwork({ nearStart: true });
  const input = [{ lat: 22.05, lon: 114.006 }, { lat: 22.05, lon: 114.002 }, { lat: 22.05, lon: 114.01 }];
  const result = R.plan(data, input, { ...extended, optimize: true });
  assert.equal(result.routes[0].metres, Math.min(...result.routes.map(route => route.metres)));
  assert.equal(result.routes[0].preservesOrder, false);
  assert.deepEqual([...result.routes[0].order].sort(), [0, 1, 2]);
  assert.match(result.routes[0].title, /Shortest qualifying route/);
  const ordered = result.routes.find(route => route.preservesOrder);
  assert.ok(ordered, 'the valid entered-order route remains available');
  assert.deepEqual(ordered.order, [0, 1, 2]);
  assert.ok(result.routes[0].metres < ordered.metres);
  assert.ok(R.plan(data, input, extended).routes.every(r => r.preservesOrder));
});
test('one-way ordered failure is explained when reordering produces a qualifying route', () => {
  const data = fixture(); data.elements.filter(e => e.type === 'way').forEach(e => { e.tags['oneway:foot'] = 'yes'; });
  const result = R.plan(data, [...points].reverse(), { optimize: true });
  assert.deepEqual(result.routes[0].order, [1, 0]);
  assert.match(result.notices[0], /Waypoint 1 → waypoint 2 cannot be connected/);
  assert.equal(result.routes[0].reversible, false);
});
test('unclear or impassable tagged paths never enter any variant', () => {
  for (const tags of [{ trail_visibility: 'intermediate' }, { smoothness: 'impassable' }, { via_ferrata_scale: '2' }]) {
    const data = fixture(); data.elements.filter(e => e.type === 'way').forEach(e => Object.assign(e.tags, tags));
    assert.throws(() => R.plan(data, points), /No eligible walking network/);
  }
});
test('transport query expands only missing ends and rejects unbounded areas', () => {
  const box = R.boundingBox(points, 1000);
  const query = R.queryFor(box, [{ ...points[0], radius: 20000 }]);
  assert.deepEqual(R.TRANSPORT_EXPANSION_STEPS, [4000, 10000, 20000]);
  assert.match(query, /around:20000,22.000000,114.001000/);
  assert.doesNotMatch(query, /around:20000,22.000000,114.004000/);
  assert.ok(query.includes(box.join(',')), 'the complete core waypoint area is retained');
  assert.deepEqual(R.transportExpansion(points, { code: 'NO_TRANSPORT', endpointIndices: [0] }, 4000), [{ ...points[0], radius: 4000 }]);
  assert.deepEqual(R.transportExpansion(points, { code: 'WAYPOINT_OFF_PATH' }), []);
  assert.throws(() => R.transportExpansion(points, { code: 'NO_TRANSPORT' }, 6000), /bounded 4 km, 10 km or 20 km step/);
  assert.throws(() => R.queryFor(box, [{ ...points[0], radius: 50000 }]), /at most two/);
  const loopQuery = R.queryFor(box, [], { includeTransport: false });
  assert.match(loopQuery, /way\["highway"/);
  assert.doesNotMatch(loopQuery, /bus_stop|public_transport|ferry_terminal/);
  assert.throws(() => R.queryFor(box, [{ ...points[0], radius: 4000 }], { includeTransport: false }), /loop without transport/);
});
test('arrival and departure checks are independent when only the finish needs extension', () => {
  const { data, points } = transportNetwork();
  data.elements.filter(e => e.type === 'relation').forEach(r => { r.members[0].role = r.members[0].ref === 4 ? 'platform_exit_only' : 'platform_entry_only'; });
  const reversed = [...points].reverse();
  assert.throws(() => R.plan(data, reversed, { optimize: false }), error => error.code === 'NO_TRANSPORT' && error.endpointIndices.join(',') === '1' && /finish after waypoint 2/.test(error.message));
  const route = R.plan(data, reversed, extended).routes[0];
  assert.equal(route.start.extendedApproach, false);
  assert.equal(route.end.extendedApproach, true);
  assert.deepEqual(route.ids, [4, 3, 2, 1]);
});

test('Loop defaults off; enabling it closes every route using real directed graph edges', () => {
  const data = fixture(), normal = R.plan(data, points);
  assert.equal(normal.settings.loop, false);
  assert.notEqual(normal.routes[0].start.id, normal.routes[0].end.id);
  const result = R.plan(data, points, { loop: true, optimize: false });
  const graph = R.buildGraph(data);
  assert.ok(result.routes.length >= 1 && result.routes.length <= 3);
  for (const route of result.routes) {
    assert.equal(route.loop, true);
    assert.equal(route.start.id, route.end.id);
    assert.equal(route.start.id, 'loop/2');
    assert.equal(route.start.approach, 0);
    assert.deepEqual(route.coords[0], route.coords.at(-1));
    assert.deepEqual(route.order, [0, 1]);
    assert.ok(route.ids.indexOf(3, route.ids.indexOf(2)) > route.ids.indexOf(2));
    route.ids.slice(1).forEach((id, i) => assert.ok(graph.adj.get(route.ids[i]).some(e => e.to === id), 'including the last edge back to the start'));
    assert.ok(route.metres >= result.routes[0].metres - .01);
  }
  const tree = R.search(graph, 2, 'distance', new Map());
  const expected = 2 * tree.length.get(3);
  assert.ok(Math.abs(result.routes[0].metres - expected) < .01, 'the first loop uses the shortest in-order walk, including return');
  assert.equal(result.stopCount, 0);
});

test('loops ignore public transport but still require a real directed mapped return', () => {
  const data = fixture();
  data.elements = data.elements.filter(element => element.type !== 'relation' || element.tags.route === 'hiking');
  data.elements.filter(element => element.type === 'node').forEach(node => { delete node.tags; });
  const loop = R.plan(data, points, { loop: true, optimize: false });
  assert.ok(loop.routes.length);
  assert.equal(loop.stopCount, 0);
  assert.equal(loop.routes[0].start.id, 'loop/2');
  assert.deepEqual(loop.routes[0].coords[0], loop.routes[0].coords.at(-1));
  const directed = fixture();
  directed.elements.filter(e => e.type === 'way').forEach(e => { e.tags['oneway:foot'] = 'yes'; });
  assert.ok(R.plan(directed, points).routes.length);
  assert.throws(() => R.plan(directed, points, { loop: true, optimize: false }), error => error.code === 'DISCONNECTED_WAYPOINTS' && /cannot return to waypoint 1|loop cannot close/.test(error.message));
});

test('dense or invalid passenger service data is not processed for a loop', () => {
  const { data, points } = transportNetwork({ nearStart: true });
  for (let i = 0; i < 15; i++) {
    data.elements.push({ type: 'node', id: 1000 + i, ...points[0], tags: { highway: 'bus_stop' } });
    data.elements.push({ type: 'relation', id: 2000 + i, tags: { route: 'bus' }, members: [{ type: 'node', ref: 1000 + i, role: 'platform_exit_only' }] });
  }
  const result = R.plan(data, points, { loop: true, optimize: false });
  assert.equal(result.stopCount, 0);
  assert.equal(result.unlinkedStops, 0);
  assert.ok(result.routes.every(route => route.start.id === route.end.id && route.start.id.startsWith('loop/')));
});

test('loop returns count toward distance and road limits; no partial open route is substituted', () => {
  const loop = R.plan(fixture(), points, { loop: true, optimize: false }).routes[0];
  assert.throws(() => R.plan(fixture(), points, { loop: true, optimize: false, maxDistance: loop.metres - 1 }), error => error.code === 'ROUTE_LIMITS' && /loop returning/.test(error.message));
  const data = fixture();
  data.elements.filter(e => e.type === 'way').forEach(e => { e.tags.highway = 'residential'; });
  const roadLoop = R.plan(data, points, { loop: true, optimize: false, maxRoad: 30000 }).routes[0];
  assert.throws(() => R.plan(data, points, { loop: true, optimize: false, maxRoad: roadLoop.roadMetres - 1 }), /road limit/);
});

test('reordered loop alternatives stay anchored at waypoint 1 and retain every mandatory pin', () => {
  const { data } = transportNetwork({ nearStart: true });
  data.elements.filter(e => e.type === 'relation').forEach(e => { e.members[0].role = 'platform'; });
  const input = [.006, .002, .01, .004].map(lon => ({ lat: 22.05, lon: 114 + lon }));
  const result = R.plan(data, input, { ...extended, loop: true, optimize: true });
  assert.equal(result.routes[0].metres, Math.min(...result.routes.map(route => route.metres)));
  assert.equal(result.routes[0].preservesOrder, false);
  assert.deepEqual(result.routes.find(route => route.preservesOrder)?.order, [0, 1, 2, 3]);
  for (const route of result.routes) {
    assert.equal(route.start.id, route.end.id);
    assert.equal(route.order[0], 0);
    assert.equal(route.start.node, route.snaps[0].id);
    assert.deepEqual(route.coords[0], route.coords.at(-1));
    assert.deepEqual([...route.order].sort(), [0, 1, 2, 3]);
  }
});

test('a loop needs at least two mandatory pins instead of inventing a circuit', () => {
  assert.throws(() => R.plan(fixture(), [points[0]], { loop: true }), error => error.code === 'INVALID_LOOP' && /at least two waypoints/.test(error.message));
});

test('the walking graph accepts the documented dense-city bound and rejects larger payloads', () => {
  assert.equal(R.MAX_MAP_ELEMENTS, 500000);
  const aboveOldLimit = { elements: [
    { type: 'node', id: 1, lat: 22, lon: 114 },
    { type: 'node', id: 2, lat: 22, lon: 114.001 },
    { type: 'way', id: 1, nodes: [1, 2], tags: { highway: 'path' } },
    ...Array.from({ length: 199998 }, (_, index) => ({ type: 'ignored', id: index + 1 }))
  ] };
  assert.doesNotThrow(() => R.buildGraph(aboveOldLimit));
  assert.throws(() => R.buildGraph({ elements: new Array(R.MAX_MAP_ELEMENTS + 1) }), error => error.code === 'MAP_TOO_LARGE' && /500,000-element/.test(error.message));
});
