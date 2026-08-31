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
test('a stop without a transport service never qualifies', () => {
  const data = fixture(); data.elements = data.elements.filter(e => e.type !== 'relation' || e.tags.route === 'hiking');
  assert.throws(() => R.plan(data, points), /No passenger stops linked/);
});
test('disconnected paths and missing source geometry fail closed', () => {
  const data = fixture(); data.elements = data.elements.filter(e => ![102, 103, 104].includes(e.id));
  assert.throws(() => R.plan(data, points), /cannot all be connected/);
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
  assert.throws(() => R.plan(data, [...points].reverse()), /cannot all be connected/);
});
test('optimised order retains all mandatory waypoints', () => {
  const input = [points[1], points[0], { lat: 22.001, lon: 114.002 }];
  const result = R.plan(fixture(), input, { optimize: true });
  assert.deepEqual([...result.routes[0].order].sort(), [0, 1, 2]);
});
test('query size and large waypoint counts are bounded', () => {
  assert.throws(() => R.boundingBox([{ lat: 22, lon: 114 }, { lat: 35, lon: 139 }], 4000), /250/);
  assert.throws(() => R.plan(fixture(), Array(17).fill(points[0])), /1–16/);
  assert.ok(R.queryFor(R.boundingBox(points, 2000)).includes('out body'));
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
