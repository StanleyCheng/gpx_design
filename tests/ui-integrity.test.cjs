const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = join(__dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');
const html = read('index.html');
const planner = read('lib/planner-ui.js').trim();
const recognition = read('lib/recognition-ui.js').trim();
const guidance = read('lib/guidance-ui.js').trim();

function inlineFragment(marker) {
  const start = html.indexOf(`// BEGIN ${marker}`);
  const end = html.indexOf(`// END ${marker}`, start) + `// END ${marker}`.length;
  assert.ok(start >= 0 && end > start, `${marker} fragment is embedded`);
  return html.slice(start, end).trim();
}

test('confirmation checkboxes and their removed gates are absent', () => {
  assert.doesNotMatch(html, /type\s*=\s*["']checkbox/i);
  assert.doesNotMatch(recognition, /\.type\s*=\s*["']checkbox/i);
  for (const id of [
    'photo-confirm', 'ai-consent', 'ai-complete', 'confirm-trace',
    'confirm-waypoints', 'check-transit', 'check-access', 'check-offsets'
  ]) {
    assert.equal(html.includes(id), false, `${id} is absent from the built page`);
    assert.equal((planner + recognition).includes(id), false, `${id} is absent from authored UI code`);
  }
  assert.match(planner, /\$\('find-routes'\)\.disabled = !valid \|\| routing\.busy/);
  assert.match(planner, /\$\('save-gpx'\)\.disabled = false/);
  assert.match(html, /state\.requiresTraceReview && !trace\.reviewed/);
  assert.match(html, /if \(!trace\.route \|\| !trace\.reviewed\) return/);
});

test('AI place selection and server consent protocol remain fail-closed', () => {
  assert.match(recognition, /included: false, coordinate: null/);
  assert.match(recognition, /every\(p => p\.coordinate\)/);
  assert.match(recognition, /setAttribute\('aria-pressed', String\(p\.included\)\)/);
  assert.match(recognition, /consent: true/);
  assert.match(read('server/recognition.mjs'), /body\?\.consent !== true/);
  assert.match(recognition, /X-Trailcraft-Recognition|x-trailcraft-recognition/);
  assert.match(recognition, /new URL\('\/api\/recognize-map', location\.origin\)/);
});

test('single-file build embeds the authored UI fragments exactly', () => {
  assert.equal(inlineFragment('PLANNER UI'), planner);
  assert.equal(inlineFragment('RECOGNITION UI'), recognition);
  assert.equal(inlineFragment('GUIDANCE UI'), guidance);
});

test('method guidance and map gestures use the existing planning controls', () => {
  for (const id of ['guide-title', 'guide-language', 'guide-list', 'guide-action', 'guide-secondary']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(guidance, /function guideStateFor\(/);
  assert.match(guidance, /'zh-Hant'/);
  for (const method of ['coordinates', 'text', 'gpx', 'map-image', 'image']) assert.equal(guidance.includes(method), true, `${method} guidance is authored`);
  assert.doesNotMatch(html, /id=["']map-empty["']/);
  assert.match(html, /marker\.on\('contextmenu'/);
  assert.match(html, /Remove this pin/);
  assert.match(html, /event\.ctrlKey.*event\.metaKey/);
  assert.match(html, /touchZoom/);
});

test('static DOM ids remain unique', () => {
  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('all inline scripts parse', () => {
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]));
  }
});
