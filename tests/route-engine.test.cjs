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
  assert.throws(() => R.plan(fixture(), Array(17).fill(points[0])), /1–16/);
  const query = R.queryFor(R.boundingBox(points, 2000));
  assert.ok(query.includes('out body qt'));
  assert.ok(query.includes('relation(bw.paths)'));
  assert.ok(query.includes('relation(bn.stopmembers)'));
  assert.doesNotMatch(query, /relation\["route"[^\n]+\]\(/, 'never download every route relation intersecting the whole bounding box');
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
const extended = { radius: 10000, maxApproach: 10000, optimize: false };
test('missing arrival transport widens only the start and preserves a nearby finish', () => {
  const { data, points } = transportNetwork();
  let failure;
  assert.throws(() => R.plan(data, points, { optimize: false }), error => { failure = error; return error.code === 'NO_TRANSPORT' && /start before waypoint 1/.test(error.message) && !/finish after/.test(error.message); });
  assert.deepEqual(failure.endpointIndices, [0]);
  const areas = R.transportExpansion(points, failure);
  assert.deepEqual(areas, [{ ...points[0], radius: 10000 }]);
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
test('10 km is walking distance, not a straight-line circle; no detour is bridged', () => {
  const { data, points } = transportNetwork({ detour: true });
  assert.ok(R.distance(points[0], data.elements[0]) < 1000);
  assert.throws(() => R.plan(data, points, extended), error => error.code === 'NO_TRANSPORT' && /10 km maximum was reached/.test(error.message));
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
test('a shorter reordered alternative follows, never replaces, the valid pin-order route', () => {
  const { data } = transportNetwork({ nearStart: true });
  const input = [{ lat: 22.05, lon: 114.006 }, { lat: 22.05, lon: 114.002 }, { lat: 22.05, lon: 114.01 }];
  const result = R.plan(data, input, { ...extended, optimize: true });
  assert.deepEqual(result.routes[0].order, [0, 1, 2]);
  const reordered = result.routes.find(r => !r.preservesOrder);
  assert.ok(reordered, 'a different visit order is useful even if it shares path edges');
  assert.ok(reordered.metres < result.routes[0].metres);
  assert.deepEqual([...reordered.order].sort(), [0, 1, 2]);
  assert.match(reordered.reason, /shorter/);
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
  const query = R.queryFor(box, [{ ...points[0], radius: 10000 }]);
  assert.match(query, /around:10000,22.000000,114.001000/);
  assert.doesNotMatch(query, /around:10000,22.000000,114.004000/);
  assert.ok(query.includes(box.join(',')), 'the complete core waypoint area is retained');
  assert.deepEqual(R.transportExpansion(points, { code: 'WAYPOINT_OFF_PATH' }), []);
  assert.throws(() => R.queryFor(box, [{ ...points[0], radius: 50000 }]), /at most two/);
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
    assert.deepEqual(route.coords[0], route.coords.at(-1));
    assert.deepEqual(route.order, [0, 1]);
    assert.ok(route.ids.indexOf(3, route.ids.indexOf(2)) > route.ids.indexOf(2));
    route.ids.slice(1).forEach((id, i) => assert.ok(graph.adj.get(route.ids[i]).some(e => e.to === id), 'including the last edge back to the start'));
    assert.ok(route.metres >= result.routes[0].metres - .01);
  }
  const tree = R.search(graph, 2, 'distance', new Map());
  const expected = 2 * (tree.length.get(1) + tree.length.get(3));
  assert.ok(Math.abs(result.routes[0].metres - expected) < .01, 'the first loop uses the shortest in-order walk, including return');
});

test('loops require a shared stop with both passenger roles and a mapped return', () => {
  const data = fixture();
  data.elements.find(e => e.id === 501).members[0].role = 'platform_exit_only';
  data.elements.find(e => e.id === 502).members[0].role = 'platform_entry_only';
  assert.ok(R.plan(data, points).routes.length);
  assert.throws(() => R.plan(data, points, { ...extended, loop: true }), error => error.code === 'NO_TRANSPORT' && /shared start\/finish/.test(error.message));
  const directed = fixture();
  directed.elements.filter(e => e.type === 'way').forEach(e => { e.tags['oneway:foot'] = 'yes'; });
  assert.ok(R.plan(directed, points).routes.length);
  assert.throws(() => R.plan(directed, points, { ...extended, loop: true }), /one-way path without a mapped return/);
});

test('a shared loop stop is matched before nearby-stop pruning and the 12-stop shortlist', () => {
  const { data, points } = transportNetwork({ nearStart: true });
  // Nearby arrival-only / departure-only stops cannot form a loop. Only the
  // farther stop at node 1 has both roles, so it needs the existing expansion.
  data.elements.find(e => e.id === 501).members[0].role = 'platform';
  for (let i = 0; i < 15; i++) {
    data.elements.push({ type: 'node', id: 1000 + i, ...points[0], tags: { highway: 'bus_stop' } });
    data.elements.push({ type: 'relation', id: 2000 + i, tags: { route: 'bus' }, members: [{ type: 'node', ref: 1000 + i, role: 'platform_exit_only' }] });
  }
  assert.throws(() => R.plan(data, points, { loop: true }), error => error.code === 'NO_TRANSPORT' && error.endpointIndices.join(',') === '0,1');
  const route = R.plan(data, points, { ...extended, loop: true }).routes[0];
  assert.equal(route.start.id, 1); assert.equal(route.end.id, 1);
  assert.ok(route.start.extendedApproach && route.end.extendedApproach);
  assert.deepEqual(route.ids, [1, 5, 2, 3, 2, 5, 1]);
});

test('loop returns count toward distance and road limits; no partial open route is substituted', () => {
  const normal = R.plan(fixture(), points, { optimize: false }).routes[0];
  assert.throws(() => R.plan(fixture(), points, { loop: true, maxDistance: normal.metres + 10 }), error => error.code === 'ROUTE_LIMITS' && /loop returning/.test(error.message));
  const data = fixture();
  data.elements.filter(e => e.type === 'way').forEach(e => { e.tags.highway = 'residential'; });
  assert.throws(() => R.plan(data, points, { loop: true, maxRoad: normal.metres + 10 }), /road limit/);
});

test('reordered loop alternatives retain the common stop and every mandatory pin', () => {
  const { data } = transportNetwork({ nearStart: true });
  data.elements.filter(e => e.type === 'relation').forEach(e => { e.members[0].role = 'platform'; });
  const input = [.006, .002, .01, .004].map(lon => ({ lat: 22.05, lon: 114 + lon }));
  const result = R.plan(data, input, { ...extended, loop: true, optimize: true });
  assert.deepEqual(result.routes[0].order, [0, 1, 2, 3]);
  assert.ok(result.routes.some(r => !r.preservesOrder && r.metres < result.routes[0].metres));
  for (const route of result.routes) {
    assert.equal(route.start.id, route.end.id);
    assert.deepEqual(route.coords[0], route.coords.at(-1));
    assert.deepEqual([...route.order].sort(), [0, 1, 2, 3]);
  }
});

test('a single mandatory pin can make an out-and-back loop without dropping that pin', () => {
  const route = R.plan(fixture(), [points[0]], { loop: true }).routes[0];
  assert.deepEqual(route.ids, [1, 2, 1]);
  assert.deepEqual(route.order, [0]);
});
