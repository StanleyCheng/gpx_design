const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/route-engine.js');
const grid = require('./fixtures/routing-grid.cjs');
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });
const way = (id, nodes, tags = {}) => ({ type: 'way', id, nodes, tags: { highway: 'footway', ...tags } });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('A* matches an independent all-pairs distance oracle on directed geometry', () => {
  const nodes = Array.from({ length: 9 }, (_, i) => node(i + 1, 22 + Math.floor(i / 3) * .001, 114 + (i % 3) * .001));
  const data = { elements: [...nodes,
    way(10, [1, 2, 3, 6, 9], { 'oneway:foot': 'yes' }),
    way(11, [9, 8, 7, 4, 1], { 'oneway:foot': 'yes' }),
    way(12, [2, 5, 8]), way(13, [4, 5, 6]), way(14, [1, 5, 9])
  ] };
  const graph = R.buildGraph(data), oracle = nodes.map((_, i) => nodes.map((_, j) => i === j ? 0 : Infinity));
  for (const [from, edges] of graph.adj) for (const edge of edges) oracle[from - 1][edge.to - 1] = Math.min(oracle[from - 1][edge.to - 1], edge.metres);
  for (let k = 0; k < 9; k++) for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) oracle[i][j] = Math.min(oracle[i][j], oracle[i][k] + oracle[k][j]);
  for (let from = 1; from <= 9; from++) for (let to = 1; to <= 9; to++) for (const backward of [false, true]) {
    const path = R.pathFrom(R.search(graph, from, 'distance', new Map(), backward, [to]), to);
    close(path.metres, backward ? oracle[to - 1][from - 1] : oracle[from - 1][to - 1]);
    assert.equal(path.ids[0], backward ? to : from);
    assert.equal(path.ids.at(-1), backward ? from : to);
  }
});

test('A* reduces explored nodes while preserving distance and weighted trail optima', () => {
  const { data, source, target } = grid(), graph = R.buildGraph(data);
  for (const profile of ['distance', 'trail']) {
    const penalties = new Map([[graph.adj.get(source)[0].key, 2]]);
    const astar = R.search(graph, source, profile, penalties, false, [target]);
    const dijkstra = R.search(graph, source, profile, penalties, false, [target], { algorithm: 'dijkstra' });
    close(R.pathFrom(astar, target).cost, R.pathFrom(dijkstra, target).cost);
    assert.ok(astar.visited < dijkstra.visited);
  }
  const astar = R.search(graph, source, 'distance', new Map(), false, [target]);
  const dijkstra = R.search(graph, source, 'distance', new Map(), false, [target], { algorithm: 'dijkstra' });
  assert.ok(astar.visited < dijkstra.visited / 10);
});

test('empty target sets do no graph work and tentative frontier paths are unavailable', () => {
  const { data, source, target } = grid(8), graph = R.buildGraph(data);
  assert.equal(R.search(graph, source, 'distance', new Map(), false, []).visited, 0);
  const tree = R.search(graph, source, 'distance', new Map(), false, [target]);
  assert.equal(R.pathFrom(tree, 9), null, 'an off-route frontier node was never settled');
  const bounded = R.search(graph, source, 'distance', new Map(), false, [target], { maxCost: 100 });
  assert.equal(R.pathFrom(bounded, target), null);
});

test('shortest route uses a slightly farther snap instead of a connected long detour', () => {
  const data = { elements: [node(1, 22.00005, 114.001), node(2, 22, 114.001), node(3, 22, 114.003), node(4, 22.01, 114.001),
    way(10, [1, 4, 3]), way(20, [2, 3])
  ] };
  const points = [data.elements[0], data.elements[2]];
  const snaps = R.snapWaypoints(R.buildGraph(data), points, 30);
  assert.equal(snaps[0].id, 2);
  assert.ok(snaps[0].metres > 5 && snaps[0].metres < 6);
  const route = R.plan(data, points, { loop: true }).routes[0];
  assert.deepEqual(route.order, [0, 1]);
  assert.ok(route.metres < 450);
  assert.ok(route.edges.every(edge => edge.way === 20));
});

test('loop snap selection includes directed return cost before choosing the final snap', () => {
  const data = { elements: [node(1, 22, 114), node(2, 22, 114.002), node(3, 22.0001, 114.002), node(4, 22.01, 114.002), node(5, 22.001, 114.001),
    way(10, [1, 2, 4, 1], { 'oneway:foot': 'yes' }), way(20, [1, 5, 3])
  ] };
  const points = [data.elements[0], data.elements[1]];
  const open = R.snapWaypoints(R.buildGraph(data), points, 15);
  assert.equal(open[1].id, 2, 'shortest outbound snap');
  const loop = R.plan(data, points, { loop: true, tolerance: 15 }).routes[0];
  assert.equal(loop.snaps[1].id, 3, 'the nearby alternative avoids a long directed return');
  assert.ok(loop.metres < 800);
  assert.deepEqual(loop.coords[0], loop.coords.at(-1));
});

test('open snap selection includes serviced arrival and departure geometry', () => {
  const data = { elements: [
    node(1, 22, 114), node(2, 22, 114.002),
    node(3, 22.0001, 114, { highway: 'bus_stop' }), node(4, 22.0001, 114.002, { highway: 'bus_stop' }),
    way(10, [1, 2]), way(20, [3, 4]),
    { type: 'relation', id: 30, tags: { route: 'bus' }, members: [{ type: 'node', ref: 3, role: 'platform' }, { type: 'node', ref: 4, role: 'platform' }] }
  ] };
  const route = R.plan(data, data.elements.slice(0, 2), { tolerance: 15 }).routes[0];
  assert.deepEqual(route.snaps.map(snap => snap.id), [3, 4], 'a shorter isolated pin chain cannot displace the serviced chain');
  assert.equal(route.start.accessGap, 0);
  assert.equal(route.end.accessGap, 0);
});

test('near-identical projections keep their real graph coordinates and exact tolerance', () => {
  const data = { elements: [node(1, 22, 114), node(2, 22, 114.002), way(10, [1, 2])] };
  const graph = R.buildGraph(data), points = [{ lat: 22, lon: 114.001 }, { lat: 22, lon: 114.0010001 }];
  const snaps = R.snapWaypoints(graph, points, .001);
  assert.notEqual(snaps[0].id, snaps[1].id);
  for (const snap of snaps) {
    assert.equal(snap.point.lon, graph.nodes.get(snap.id).lon);
    assert.ok(R.distance(snap.original, graph.nodes.get(snap.id)) <= .001);
  }
});

test('invalid core settings fail before graph processing instead of bypassing limits', () => {
  for (const settings of [{ maxDistance: NaN }, { maxRoad: Infinity }, { tolerance: -1 }, { radius: '1000' }, { optimize: 'false' }]) {
    assert.throws(() => R.plan(null, [{ lat: 22, lon: 114 }], settings), error => error.code === 'INVALID_SETTINGS');
  }
});

test('routing checks cancellation and a computation deadline during synchronous work', () => {
  const { data } = grid(4), points = data.elements.slice(0, 2), controller = new AbortController();
  controller.abort();
  assert.throws(() => R.plan(data, points, { loop: true }, [], undefined, { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => R.plan(data, points, { loop: true }, [], undefined, { deadline: Date.now() - 1 }), { name: 'TimeoutError' });
  const control = {};
  assert.throws(() => R.plan(data, points, { loop: true }, [], () => { control.deadline = 0; }, control), { name: 'TimeoutError' });
});

test('a reverse edge on a different parallel way does not make a selected track reversible', () => {
  const data = { elements: [node(1, 22, 114, { highway: 'bus_stop' }), node(2, 22, 114.002, { highway: 'bus_stop' }),
    way(10, [1, 2], { 'oneway:foot': 'yes' }), way(20, [2, 1], { 'oneway:foot': 'yes' }),
    { type: 'relation', id: 30, tags: { route: 'bus' }, members: [{ type: 'node', ref: 1, role: 'platform' }, { type: 'node', ref: 2, role: 'platform' }] }
  ] };
  const route = R.plan(data, data.elements.slice(0, 2)).routes[0];
  assert.equal(route.reversible, false);
  assert.equal(R.buildGraph(data).adj.get(1)[0].segment, '10/1');
});

test('an admitted ford tagged on a way is disclosed even without a ford node', () => {
  const data = { elements: [node(1, 22, 114), node(2, 22, 114.002), way(10, [1, 2], { ford: 'yes' })] };
  const official = [{ type: 'Feature', properties: { TRAIL_NAME_EN: 'Test corridor' }, geometry: { type: 'LineString', coordinates: [[114, 22], [114.002, 22]] } }];
  const result = R.plan(data, data.elements.slice(0, 2), { loop: true, allowOfficialFords: true }, official);
  assert.equal(result.routes[0].fordCrossings.length, 1);
  assert.equal(result.routes[0].fordCrossings[0].id, 'way/10');
  assert.match(result.notices.join(' '), /ford/);
});
