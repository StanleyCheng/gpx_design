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
