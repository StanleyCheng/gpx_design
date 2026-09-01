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

function routeRequest(points = [{ lat: 22, lon: 114.001 }, { lat: 22, lon: 114.004 }], origin = 'https://gpxdesign.vercel.app') {
  return new Request('https://gpxdesign.vercel.app/api/plan-routes', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points,
      provider: 'auto',
      region: 'world',
      settings: { radius: 1000, maxDistance: 30000, maxRoad: 1500, tolerance: 30, optimize: false }
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
  assert.match(body.source, /FOSSGIS \/ OpenStreetMap/);
  assert.equal(calls.length, 3);
  assert.ok(body.result.routes.every(route => route.coords.length > 1));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('route backend turns upstream abort-style failures into a useful retry message', async () => {
  const handler = createRoutePlanHandler({ fetcher: async () => { throw new TypeError('fetch is aborted'); } });
  const response = await handler(routeRequest([{ lat: 22.01, lon: 114.001 }, { lat: 22.01, lon: 114.004 }]));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /All map providers failed/);
  assert.match(body.error, /Please retry; your waypoints are unchanged/);
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
