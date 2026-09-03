import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutePlanHandler } from '../api/plan-routes.mjs';

function fixture() {
  const nodes = [
    [1, 22, 114], [2, 22, 114.001], [3, 22, 114.004], [4, 22, 114.005],
    [5, 22.001, 114.002], [6, 22.001, 114.003], [7, 21.999, 114.002], [8, 21.999, 114.003],
    [9, 22.002, 114.002], [10, 22.002, 114.003]
  ].map(([id, lat, lon]) => ({ type: 'node', id, lat, lon }));
  const ways = [[101, [1, 2]], [102, [2, 5, 6, 3]], [103, [2, 7, 8, 3]], [104, [2, 9, 10, 3]], [105, [3, 4]]].map(([id, wayNodes]) => ({ type: 'way', id, nodes: wayNodes, tags: { highway: 'footway', foot: 'designated' } }));
  nodes[0].tags = { highway: 'bus_stop', name: 'Start transit' };
  nodes[3].tags = { railway: 'station', name: 'End transit' };
  const relations = [
    { type: 'relation', id: 501, tags: { route: 'bus', ref: 'Bus A' }, members: [{ type: 'node', ref: 1, role: 'platform' }] },
    { type: 'relation', id: 502, tags: { route: 'train', ref: 'Train B' }, members: [{ type: 'node', ref: 4, role: 'stop' }] },
    { type: 'relation', id: 503, tags: { route: 'hiking', name: 'Mapped trail' }, members: [{ type: 'way', ref: 102 }] }
  ];
  return { elements: [...nodes, ...ways, ...relations], osm3s: { timestamp_osm_base: '2026-08-31T00:00:00Z' } };
}

function routeRequest(points = [{ lat: 22, lon: 114.001 }, { lat: 22, lon: 114.004 }], origin = 'https://gpxdesign.vercel.app', settings = {}) {
  return new Request('https://gpxdesign.vercel.app/api/plan-routes', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points,
      provider: 'auto',
      region: 'world',
      settings: { radius: 1000, maxDistance: 30000, maxRoad: 1500, tolerance: 30, optimize: false, ...settings }
    })
  });
}

test('route backend rejects foreign origins and supports local-file preflight', async () => {
  const handler = createRoutePlanHandler({ fetcher: async () => { throw new Error('must not fetch'); } });
  assert.equal((await handler(routeRequest(undefined, 'https://evil.example'))).status, 403);
  const preflight = await handler(new Request('https://gpxdesign.vercel.app/api/plan-routes', { method: 'OPTIONS', headers: { Origin: 'null' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'null');
  assert.equal(preflight.headers.get('x-trailplanner-route-backend'), '1');
});

test('route backend rotates providers and returns only compact planned routes', async () => {
  const calls = [];
  const handler = createRoutePlanHandler({ fetcher: async url => {
    calls.push(url);
    if (calls.length === 1) return new Response('busy', { status: 504 });
    if (calls.length === 2) throw new TypeError('network unavailable');
    return new Response(JSON.stringify(fixture()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const response = await handler(routeRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.routes.length, 3);
  assert.equal(body.result.settings.loop, false, 'older clients retain normal routing when Loop is omitted');
  assert.match(body.source, /VK Maps \/ OpenStreetMap/);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /overpass-api\.de/);
  assert.match(calls[1], /overpass\.private\.coffee/);
  assert.match(calls[2], /maps\.mail\.ru/);
  assert.ok(body.result.routes.every(route => route.coords.length > 1));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const repeated = await handler(routeRequest());
  assert.equal(repeated.status, 200);
  assert.equal(calls.length, 3, 'reuse cached backup before contacting the unavailable primary providers');
  assert.match((await repeated.json()).source, /server cache/);
});

test('route backend turns upstream abort-style failures into a useful retry message', async () => {
  const handler = createRoutePlanHandler({ fetcher: async () => { throw new TypeError('fetch is aborted'); } });
  const response = await handler(routeRequest([{ lat: 22.01, lon: 114.001 }, { lat: 22.01, lon: 114.004 }]));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /All map providers failed/);
  assert.match(body.error, /Please retry; your waypoints are unchanged/);
  assert.doesNotMatch(body.error, /fetch is aborted/);
});

test('an aborted provider attempt can fall back without cancelling the route request', async () => {
  let calls = 0;
  const handler = createRoutePlanHandler({ fetcher: async () => {
    if (++calls === 1) throw new DOMException('The operation was aborted.', 'AbortError');
    return Response.json(fixture());
  } });
  const response = await handler(routeRequest([{ lat: 22.00001, lon: 114.001 }, { lat: 22, lon: 114.004 }]));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal((await response.json()).result.routes.length, 3);
});

test('a cancelled request never starts or retries map downloads', async () => {
  let calls = 0;
  const handler = createRoutePlanHandler({ fetcher: async () => { calls++; return Response.json(fixture()); } });
  const controller = new AbortController();
  const request = new Request(routeRequest(), { signal: controller.signal });
  controller.abort();
  const response = await handler(request);
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.equal((await response.json()).result, undefined);
});

test('route backend does not turn missing coordinates into zero', async () => {
  const handler = createRoutePlanHandler({ fetcher: async () => { throw new Error('must not fetch'); } });
  const response = await handler(routeRequest([{ lat: null, lon: 114.001 }]));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Waypoint 1 is invalid/);
});

test('route backend stops immediately when the map area response is oversized', async () => {
  let calls = 0;
  const handler = createRoutePlanHandler({ fetcher: async () => {
    calls++;
    return new Response('{}', { status: 200, headers: { 'Content-Length': String(65 * 1024 * 1024) } });
  } });
  const response = await handler(routeRequest([{ lat: 22.02, lon: 114.001 }, { lat: 22.02, lon: 114.004 }]));
  assert.equal(response.status, 413);
  assert.equal(calls, 1);
  assert.match((await response.json()).error, /closer waypoints or a smaller transport search distance/);
});

const { default: transportNetwork } = await import('./fixtures/transport-network.cjs');
test('backend retries only a missing transport end, with a separate expanded cache entry', async () => {
  const { data, points } = transportNetwork({ lat: 22.15 });
  const queries = [];
  const handler = createRoutePlanHandler({ fetcher: async (url, options) => {
    const query = options.body.get('data'); queries.push(query);
    return Response.json(data);
  } });
  const response = await handler(routeRequest(points));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(queries.length, 2);
  assert.doesNotMatch(queries[0], /around:/);
  assert.match(queries[1], /around:10000,22.150000,114.000000/);
  assert.doesNotMatch(queries[1], /around:10000,22.150000,114.010000/);
  assert.equal(body.result.transportExpanded, true);
  assert.equal(body.result.routes[0].start.extendedApproach, true);
  assert.equal(body.result.routes[0].end.extendedApproach, false);
  assert.equal((await handler(routeRequest(points))).status, 200);
  assert.equal(queries.length, 2, 'both initial and expanded queries are cached independently');
});
test('backend returns a specific off-path pin reason without a pointless transport expansion', async () => {
  let calls = 0;
  const handler = createRoutePlanHandler({ fetcher: async () => { calls++; return Response.json(fixture()); } });
  const response = await handler(routeRequest([{ lat: 22.001, lon: 114.007 }]));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, 'WAYPOINT_OFF_PATH');
  assert.match(body.error, /Waypoint 1 has no eligible path within 30 m/);
  assert.equal(calls, 1);
});
test('backend stops at 10 km and reports the missing start, not a generic server error', async () => {
  const { data, points } = transportNetwork({ lat: 22.2, detour: true });
  let calls = 0;
  const handler = createRoutePlanHandler({ fetcher: async () => { calls++; return Response.json(data); } });
  const response = await handler(routeRequest(points));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, 'NO_TRANSPORT');
  assert.match(body.error, /start before waypoint 1/);
  assert.match(body.error, /10 km maximum was reached/);
  assert.equal(calls, 2);
});

test('backend carries Loop through transport expansion and returns only closed tracks', async () => {
  const { data, points } = transportNetwork({ lat: 22.25, nearStart: true });
  data.elements.find(e => e.id === 501).members[0].role = 'platform';
  const queries = [];
  const handler = createRoutePlanHandler({ fetcher: async (url, options) => {
    queries.push(options.body.get('data'));
    return Response.json(data);
  } });
  const response = await handler(routeRequest(points, undefined, { loop: true }));
  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.equal(result.settings.loop, true);
  assert.equal(result.transportExpanded, true);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /around:10000,22.250000,114.000000/);
  assert.match(queries[1], /around:10000,22.250000,114.010000/);
  for (const route of result.routes) {
    assert.equal(route.start.id, 1); assert.equal(route.end.id, 1);
    assert.deepEqual(route.coords[0], route.coords.at(-1));
  }
});

test('backend rejects ambiguous Loop values before fetching any map data', async () => {
  const handler = createRoutePlanHandler({ fetcher: async () => { throw new Error('must not fetch'); } });
  for (const loop of ['false', 1, null]) {
    const response = await handler(routeRequest(undefined, undefined, { loop }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid Loop setting/);
  }
});
