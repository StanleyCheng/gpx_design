const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const R = require('../lib/route-engine.js');
const source = readFileSync(join(__dirname, '../lib/planner-ui.js'), 'utf8');
const functionSource = source.match(/async function getBackendPlan\([\s\S]*?\n    }\n    function workerPlan/);
assert.ok(functionSource, 'getBackendPlan can be isolated for regression testing');

function backendPlanner(fetcher, status = { textContent: '' }, messages = []) {
  const factory = new Function(
    'fetch', 'AbortSignal', '$', 'toast', 'ROUTE_BACKEND_URL', 'TrailRouter',
    `${functionSource[0].replace(/\n    function workerPlan$/, '')}; return getBackendPlan;`
  );
  return {
    plan: factory(fetcher, AbortSignal, () => status, text => messages.push(text), 'https://example.test/api/plan-routes', R),
    status,
    messages
  };
}

const points = [{ lat: 35.68, lon: 139.76 }, { lat: 35.67, lon: 139.75 }];
const settings = { loop: true };
const success = {
  result: {
    policyVersion: R.ROUTING_POLICY_VERSION,
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

test('direct browser fallback remains available when the route endpoint is absent', async () => {
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

test('a server that ignores harder hiking or omits segment grades triggers the local engine', async () => {
  for (const payload of [success, { result: { ...success.result, settings: { loop: true, allowHarderHiking: true } } }]) {
    const ui = backendPlanner(async () => Response.json(payload));
    await assert.rejects(ui.plan(points, { loop: true, allowHarderHiking: true }, 'auto', 'world', new AbortController().signal), error => {
      assert.match(error.message, /does not support harder hiking/);
      return error.directFallback === true;
    });
  }
});

test('a server supporting harder hiking preserves its warning metadata', async () => {
  const payload = structuredClone(success);
  payload.result.settings.allowHarderHiking = true;
  payload.result.routes[0].edges = [{ sacScale: 'mountain_hiking' }];
  const ui = backendPlanner(async () => Response.json(payload));
  assert.deepEqual(await ui.plan(points, { loop: true, allowHarderHiking: true }, 'auto', 'world', new AbortController().signal), payload);
});

test('a mismatched or unversioned graph policy falls back even when harder hiking is off', async () => {
  for (const version of [undefined, R.ROUTING_POLICY_VERSION - 1, R.ROUTING_POLICY_VERSION + 1]) {
    const payload = structuredClone(success); payload.result.policyVersion = version;
    const ui = backendPlanner(async () => Response.json(payload));
    await assert.rejects(ui.plan(points, { loop: true, allowHarderHiking: false }, 'auto', 'world', new AbortController().signal), error => {
      assert.match(error.message, /different path policy/);
      return error.directFallback === true;
    });
  }
});

test('an old server routing rejection retries locally rather than hiding newly eligible paths', async () => {
  const ui = backendPlanner(async () => Response.json({ error: 'No eligible walking network' }, { status: 422 }));
  await assert.rejects(ui.plan(points, settings, 'auto', 'world', new AbortController().signal), error => {
    assert.match(error.message, /rejected this plan under a different path policy/);
    return error.directFallback === true;
  });
});

test('current policy rejections and request, size or rate limits do not trigger policy fallback', async () => {
  for (const [status, version] of [[422, R.ROUTING_POLICY_VERSION], [400, null], [403, null], [413, null], [429, null], [503, null]]) {
    const ui = backendPlanner(async () => Response.json({ error: 'Original failure' }, { status, headers: version ? { 'X-TrailPlanner-Route-Policy': String(version) } : {} }));
    await assert.rejects(ui.plan(points, settings, 'auto', 'world', new AbortController().signal), error => error.directFallback === false && error.message === 'Original failure');
  }
});
