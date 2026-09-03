import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, normalizeRecognition, validateInput } from '../server/recognition.mjs';
const result = { status: 'located', area: { name: 'A map', evidence: 'Visible place name', confidence: 'medium', lat: 25, lon: 121 }, waypoints: [{ label: 'Pin 1', x: .2, y: .4, lat: 25, lon: 121, basis: 'landmark_match', confidence: 'low', evidence: 'Approximate visible landmark' }] };
const image = 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
test('uncertain/invalid coordinates cannot silently become usable pins', () => {
  const r = normalizeRecognition({ ...result, waypoints: [{ ...result.waypoints[0], basis: 'unknown' }, { ...result.waypoints[0], lat: null }, { ...result.waypoints[0], lat: '25' }] });
  assert.ok(r.waypoints.every(p => p.lat === null && p.lon === null));
  assert.throws(() => normalizeRecognition({ ...result, waypoints: Array(51).fill(result.waypoints[0]) }));
});
test('recognition retains all 50 candidate pins without inventing uncertain locations', () => {
  const waypoints = Array.from({ length: 50 }, (_, i) => ({ ...result.waypoints[0], label: `Pin ${i + 1}`, basis: i === 49 ? 'unknown' : 'printed_coordinates' }));
  const normalized = normalizeRecognition({ ...result, waypoints });
  assert.equal(normalized.waypoints.length, 50);
  assert.equal(normalized.waypoints[48].lat, 25);
  assert.equal(normalized.waypoints[49].label, 'Pin 50');
  assert.equal(normalized.waypoints[49].lat, null);
});
test('image URL fetching and absent consent are rejected', () => {
  assert.throws(() => validateInput({ image, consent: false }));
  assert.throws(() => validateInput({ image: 'https://internal.example/private', consent: true }));
  assert.throws(() => validateInput({ image: 'data:image/png;base64,' + Buffer.from('not a real image').toString('base64'), consent: true }));
  assert.equal(validateInput({ image, consent: true }).image, image);
});
test('HTTP server protects secrets, rejects other origins, applies auth and short-term throttling', async () => {
  let calls = 0;
  const app = createApp({ host: '0.0.0.0', port: 8787, origin: 'https://stanleycheng.github.io', key: 'private-provider-key', token: 'x'.repeat(32), recognize: async () => { calls++; return result; } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.address().port}`;
  try {
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/server/recognition.mjs')).status, 404);
    const request = (origin, token) => fetch(base + '/api/recognize-map', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ image, consent: true }) });
    assert.equal((await request('https://evil.example', 'x'.repeat(32))).status, 403);
    assert.equal((await request('https://stanleycheng.github.io', 'bad')).status, 401);
    const good = await request('https://stanleycheng.github.io', 'x'.repeat(32)); assert.equal(good.status, 200); assert.equal((await good.json()).result.waypoints.length, 1);
    assert.equal((await request('https://stanleycheng.github.io', 'x'.repeat(32))).status, 200);
    assert.equal((await request('https://stanleycheng.github.io', 'x'.repeat(32))).status, 200);
    assert.equal((await request('https://stanleycheng.github.io', 'x'.repeat(32))).status, 429); assert.equal(calls, 3);
  } finally { await new Promise(resolve => app.close(resolve)); }
});
