import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecognitionHandler } from '../api/recognize-map.mjs';

const result = {
  status: 'located',
  area: { name: 'A map', evidence: 'Visible place name', confidence: 'medium', lat: 25, lon: 121 },
  waypoints: [{ label: 'Pin 1', x: 0.2, y: 0.4, lat: 25, lon: 121, basis: 'landmark_match', confidence: 'low', evidence: 'Approximate visible landmark' }]
};
const image = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64');
const endpoint = 'https://trailcraft-test.vercel.app/api/recognize-map';
const token = 'v'.repeat(64);

function makeRequest(method, origin, authorization = '') {
  const headers = { Origin: origin };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    if (authorization) headers.Authorization = authorization;
  }
  return new Request(endpoint, { method, headers, body: method === 'POST' ? JSON.stringify({ image, consent: true }) : undefined });
}

test('Vercel handler supports same-origin discovery and rejects unapproved origins', async () => {
  const handle = createRecognitionHandler({ env: {}, recognize: async () => result });
  const discovery = await handle(makeRequest('OPTIONS', 'https://trailcraft-test.vercel.app'));
  assert.equal(discovery.status, 204);
  assert.equal(discovery.headers.get('x-trailcraft-recognition'), '1');
  assert.equal(discovery.headers.get('access-control-allow-origin'), 'https://trailcraft-test.vercel.app');
  assert.equal((await handle(makeRequest('OPTIONS', 'https://evil.example'))).status, 403);
});

test('Vercel handler keeps provider key private, authenticates the owner and has no daily quota', async () => {
  let clock = 0;
  let calls = 0;
  const env = {
    MOONSHOT_API_KEY: 'private-provider-key',
    TRAILCRAFT_ACCESS_TOKEN: token,
    ALLOWED_ORIGIN: 'https://stanleycheng.github.io'
  };
  const handle = createRecognitionHandler({ env, now: () => clock, recognize: async (_input, key) => {
    assert.equal(key, 'private-provider-key');
    calls++;
    return result;
  } });

  assert.equal((await handle(makeRequest('POST', 'https://stanleycheng.github.io'))).status, 401);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await handle(makeRequest('POST', 'https://stanleycheng.github.io', `Bearer ${token}`));
    assert.equal(response.status, 200);
  }
  assert.equal((await handle(makeRequest('POST', 'https://stanleycheng.github.io', `Bearer ${token}`))).status, 429);
  clock = 60_001;
  assert.equal((await handle(makeRequest('POST', 'https://stanleycheng.github.io', `Bearer ${token}`))).status, 200);
  assert.equal(calls, 4);
});
