const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const source = readFileSync(join(__dirname, '../lib/planner-ui.js'), 'utf8');
const functionSource = source.match(/async function getBackendPlan\([\s\S]*?\n    }\n    function workerPlan/);
assert.ok(functionSource, 'getBackendPlan can be isolated for regression testing');

function backendPlanner(fetcher, status = { textContent: '' }, messages = []) {
  const factory = new Function(
    'fetch', 'AbortSignal', '$', 'toast', 'ROUTE_BACKEND_URL',
    `${functionSource[0].replace(/\n    function workerPlan$/, '')}; return getBackendPlan;`
  );
  return {
    plan: factory(fetcher, AbortSignal, () => status, text => messages.push(text), 'https://example.test/api/plan-routes'),
    status,
    messages
  };
}

const points = [{ lat: 35.68, lon: 139.76 }, { lat: 35.67, lon: 139.75 }];
const settings = { loop: true };
const success = {
  result: {
    settings: { loop: true },
    routes: [{ coords: [{ lat: 1, lon: 2 }, { lat: 1, lon: 2 }], start: { id: 7 }, end: { id: 7 } }]
  }
};

test('route backend retries transient browser fetch failures before accepting a valid plan', async () => {
  let calls = 0;
  const ui = backendPlanner(async () => {
    calls++;
    if (calls < 3) throw new TypeError('fetch is aborted');
    return Response.json(success);
  });

  assert.deepEqual(await ui.plan(points, settings, 'auto', 'jp', new AbortController().signal), success);
  assert.equal(calls, 3);
  assert.equal(ui.messages.length, 2);
  assert.match(ui.status.textContent, /Retrying \(3 of 3\)/);
});

test('three failed backend connections do not start a large direct-browser fallback', async () => {
  let calls = 0;
  const ui = backendPlanner(async () => { calls++; throw new TypeError('network interrupted'); });

  await assert.rejects(
    ui.plan(points, settings, 'auto', 'jp', new AbortController().signal),
    error => {
      assert.match(error.message, /connection failed three times/);
      assert.equal(error.directFallback, false);
      return true;
    }
  );
  assert.equal(calls, 3);
});

test('direct browser fallback remains available only when the route endpoint is absent', async () => {
  const ui = backendPlanner(async () => new Response('', { status: 404 }));

  await assert.rejects(
    ui.plan(points, settings, 'auto', 'jp', new AbortController().signal),
    error => {
      assert.equal(error.status, 404);
      assert.equal(error.directFallback, true);
      return true;
    }
  );
});

test('browser size-limit guidance points dense plans back to the route server', () => {
  assert.doesNotMatch(source, /Map response is too large\. Reduce the search radius/);
  assert.match(source, /walking map is too large for safe browser processing/);
});
