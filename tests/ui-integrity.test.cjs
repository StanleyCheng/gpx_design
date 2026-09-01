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
const manifest = JSON.parse(read('site.webmanifest'));

function inlineFragment(marker) {
  const start = html.indexOf(`// BEGIN ${marker}`);
  const end = html.indexOf(`// END ${marker}`, start) + `// END ${marker}`.length;
  assert.ok(start >= 0 && end > start, `${marker} fragment is embedded`);
  return html.slice(start, end).trim();
}

test('visible product branding uses the requested TrailPlanner spelling', () => {
  assert.match(html, /<title>TrailPlanner — GPX route planner<\/title>/);
  assert.match(html, /<span class="brand-name">TrailPlanner<\/span>/);
  assert.doesNotMatch(html, /trailplaner/i);
});

test('Safari home-screen metadata consistently names the app TrailPlanner', () => {
  assert.match(html, /name="apple-mobile-web-app-title" content="TrailPlanner"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="manifest" href="site\.webmanifest\?v=3"/);
  assert.equal(manifest.name, 'TrailPlanner — GPX planner');
  assert.equal(manifest.short_name, 'TrailPlanner');
  assert.equal(manifest.display, 'standalone');
});

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
  for (const method of ['map-pins', 'coordinates', 'text', 'gpx', 'map-image', 'image']) assert.equal(guidance.includes(method), true, `${method} guidance is authored`);
  assert.doesNotMatch(html, /id=["']map-empty["']/);
  assert.match(html, /marker\.on\('contextmenu'/);
  assert.match(html, /Delete this waypoint/);
  assert.match(html, /draggable: true/);
  assert.match(html, /scrollWheelZoom: true/);
  assert.match(html, /touchZoom/);
});

test('map-first route controls support colored combinations and individual or combined GPX', () => {
  for (const id of ['control-dock', 'map-pins-panel', 'map-pin-action', 'map-route-action', 'map-route-toolbar', 'map-route-dots', 'map-export-action', 'route-visibility', 'show-all-routes', 'hide-all-routes', 'save-all-gpx']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(planner, /ROUTE_COLORS/);
  assert.match(planner, /routing\.visible/);
  assert.match(planner, /function allRoutesGPX/);
  assert.match(planner, /Route \$\{i \+ 1\} · \$\{km\(route\.metres\)\}/);
  assert.match(planner, /className: 'route-endpoint-pin'/);
  assert.match(planner, /const letter = endpoint \? 'F' : 'S'/);
  assert.match(planner, /'map-route-dot'/);
  assert.match(planner, /map-export-action.*routing\.visible/);
  assert.match(planner, /shown-routes-PROVISIONAL\.gpx/);
  assert.match(html, /map-pin-action.*Finish adding pins/);
  assert.match(html, /map-route-action.*find-routes/);
  assert.match(html, /--dock-visible-height/);
  assert.match(planner, /toast\(text, true, 9000\)/);
});

test('route limits include the compact transport search and long-hike choices', () => {
  assert.match(html, /<option value="1000">1 km per end<\/option>/);
  assert.match(html, /<option value="80000">80 km<\/option>/);
});

test('map data providers offer automatic transient-error fallback', () => {
  assert.match(html, /<option value="auto" selected>Automatic fallback · recommended<\/option>/);
  for (const provider of ['coffee', 'vk', 'fossgis']) assert.match(html, new RegExp(`<option value="${provider}">`));
  assert.match(planner, /https:\/\/overpass-api\.de\/api\/interpreter/);
  assert.match(planner, /const automaticProviderOrder = \['coffee', 'vk', 'fossgis'\]/);
  assert.match(planner, /\[502, 503, 504\]\.includes\(response\.status\)/);
  assert.match(planner, /async function getMapData\(/);
  assert.match(planner, /if \(!canTryAnotherProvider\(error\)/);
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
