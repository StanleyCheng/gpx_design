const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const source = readFileSync(require('node:path').join(__dirname, '../lib/planner-ui.js'), 'utf8');
const workerCode = source.slice(source.indexOf('    function workerPlan('), source.indexOf("    $('find-routes').addEventListener"));

test('cancelling an active worker settles its promise and releases its reference', async () => {
  const controller = new AbortController(), routing = { controller, serial: 1, worker: null };
  let worker, revoked = 0;
  class Worker {
    constructor() { worker = this; this.terminated = false; }
    terminate() { this.terminated = true; }
    postMessage() {}
  }
  const factory = new Function('routing', 'Worker', 'URL', '$', 'toast', `${workerCode}; return workerPlan;`);
  const plan = factory(routing, Worker, { createObjectURL: () => 'blob:test', revokeObjectURL: () => revoked++ }, () => ({ textContent: '' }), () => {});
  const promise = plan({}, [], {}, [], 1);
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
  assert.equal(routing.worker, null);
  assert.equal(revoked, 1);
});

test('a worker postMessage failure terminates the worker immediately', async () => {
  const routing = { controller: new AbortController(), serial: 1 };
  let terminated = false;
  class Worker { terminate() { terminated = true; } postMessage() { throw new Error('clone failure'); } }
  const plan = new Function('routing', 'Worker', '$', 'toast', `${workerCode}; return workerPlan;`)(routing, Worker, () => ({ textContent: '' }), () => {});
  await assert.rejects(plan({}, [], {}, [], 1), /clone failure/);
  assert.equal(terminated, true);
  assert.equal(routing.worker, null);
});

test('reversing a loop preserves waypoint 1 and updates the real closing distance', () => {
  const code = source.slice(source.indexOf('    function reversePlannedRoute('), source.indexOf('    function plannedGPX('));
  const route = {
    title: 'Loop', reason: 'Pin order', loop: true, reversible: true,
    start: { id: 'loop/1', approach: 0 }, end: { id: 'loop/1', approach: 30 },
    order: [0, 1, 2], ids: [1, 2, 3, 1], coords: [1, 2, 3, 1],
    edges: [{ metres: 10 }, { metres: 20 }, { metres: 30 }], snaps: [{ id: 1 }, { id: 2 }, { id: 3 }]
  };
  const reverse = new Function('routing', 'showRoutes', 'routeDetails', 'render', 'toast', `${code}; return reversePlannedRoute;`)({ selected: route }, ...Array(4).fill(() => {}));
  reverse();
  assert.deepEqual(route.order, [0, 2, 1]);
  assert.deepEqual(route.ids, [1, 3, 2, 1]);
  assert.equal(route.start.approach, 0);
  assert.equal(route.end.approach, 10);
  reverse();
  assert.deepEqual(route.order, [0, 1, 2]);
  assert.equal(route.end.approach, 30);
});

test('reversing one worker route leaves other routes, waypoint order and GPX unchanged', () => {
  const R = require('../lib/route-engine.js');
  const nodes = [
    [1, 22, 114], [2, 22, 114.001], [3, 22, 114.004], [4, 22, 114.005],
    [5, 22.001, 114.002], [6, 22.001, 114.003], [7, 21.999, 114.002], [8, 21.999, 114.003]
  ].map(([id, lat, lon]) => ({ type: 'node', id, lat, lon }));
  nodes[0].tags = nodes[3].tags = { highway: 'bus_stop' };
  const ways = [[10, [1, 2]], [11, [2, 5, 6, 3]], [12, [2, 7, 8, 3]], [13, [3, 4]]]
    .map(([id, nodes]) => ({ type: 'way', id, nodes, tags: { highway: 'footway' } }));
  const data = { elements: [...nodes, ...ways,
    { type: 'relation', id: 30, tags: { route: 'bus' }, members: [
      { type: 'node', ref: 1, role: 'platform' }, { type: 'node', ref: 4, role: 'platform' }
    ] },
    { type: 'relation', id: 31, tags: { route: 'hiking' }, members: [{ type: 'way', ref: 11 }] }
  ] };
  const points = [nodes[1], nodes[2]], result = structuredClone(R.plan(data, points));
  assert.ok(result.routes.length >= 2, 'real worker-style result contains independent alternatives');
  const [selected, other] = result.routes, originalSelected = structuredClone(selected), before = structuredClone(other);
  const routing = { selected };
  const code = source.slice(source.indexOf('    function reversePlannedRoute('), source.indexOf("    $('show-all-routes').addEventListener"));
  const { reversePlannedRoute, plannedGPX } = new Function(
    'routing', 'showRoutes', 'routeDetails', 'render', 'toast', 'state', '$', 'km', 'xmlText', 'harderTerrainWarning', 'roughSurfaceWarning',
    `${code}; return { reversePlannedRoute, plannedGPX };`
  )(routing, ...Array(4).fill(() => {}), { points }, id => ({ value: id === 'plan-tolerance' ? '30' : '' }),
    m => `${m / 1000} km`, text => String(text), () => '', () => '');
  const withoutTimestamp = xml => xml.replace(/<time>.*?<\/time>/, '<time/>');
  const beforeGPX = withoutTimestamp(plannedGPX(other));
  reversePlannedRoute();
  assert.deepEqual(other, before, 'the untouched route must keep its order, geometry and metadata');
  assert.equal(withoutTimestamp(plannedGPX(other)), beforeGPX);
  for (const route of result.routes) {
    let cursor = 0;
    for (const index of route.order) {
      cursor = route.ids.indexOf(route.snaps[index].id, cursor);
      assert.ok(cursor >= 0, 'the declared order agrees with the actual track');
    }
  }
  assert.deepEqual(selected.order, [...originalSelected.order].reverse());
  assert.deepEqual(selected.coords, [...originalSelected.coords].reverse());
  assert.match(plannedGPX(selected), /Visit order: 2 → 1/);
  reversePlannedRoute();
  assert.deepEqual(selected.order, originalSelected.order);
  assert.deepEqual(other, before);
});
