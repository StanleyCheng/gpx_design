const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const R = require('../lib/route-engine.js');
const fixture = require('./fixtures/harder-hiking.cjs');
const source = readFileSync(join(__dirname, '../lib/planner-ui.js'), 'utf8');
const helpers = source.slice(source.indexOf('    const DIFFICULTY_STYLES'), source.indexOf('    const WAYPOINT_PIN_PATH')) + source.slice(source.indexOf('    const sacScaleLabel'), source.indexOf('    function activeRegion'));
const makeHelpers = routing => new Function('TrailRouter', 'routing', `${helpers}; return { routeDifficultySections, visibleDifficultySections, harderTerrainWarning, roughSurfaceWarning, sacScaleLabel };`)(R, routing);
const { routeDifficultySections, harderTerrainWarning, roughSurfaceWarning, sacScaleLabel } = makeHelpers();
const harderRouteSections = route => routeDifficultySections(route).filter(section => R.harderThanHiking(section.sacScale));

test('the harder hiking switch is off initially and changing it changes the route fingerprint', () => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /id="plan-harder-hiking"[^>]*role="switch"[^>]*aria-checked="false"/);
  const controls = new Map();
  const $ = id => {
    if (!controls.has(id)) controls.set(id, { value: '', checked: 'false', state: { textContent: 'Off' }, getAttribute() { return this.checked; }, setAttribute(k, v) { this.checked = v; }, querySelector() { return this.state; }, addEventListener(k, fn) { this[k] = fn; }, dispatchEvent() { this.changed = true; } });
    return controls.get(id);
  };
  const declarations = source.slice(source.indexOf('    const planSwitches'), source.indexOf('    const providers')) + source.slice(source.indexOf('    const switchEnabled'), source.indexOf('    const sacScaleLabel'));
  const handler = source.slice(source.indexOf('    for (const id of planSwitches)'), source.indexOf('    const today'));
  const fingerprint = new Function('$', 'state', `${declarations}\n${handler}\nreturn routingFingerprint;`)($, { points: [], segments: [], source: '' });
  const before = fingerprint(), control = $('plan-harder-hiking');
  control.click();
  assert.equal(control.checked, 'true');
  assert.equal(control.state.textContent, 'On');
  assert.equal(control.changed, true);
  assert.notEqual(fingerprint(), before);
  control.click(); assert.equal(fingerprint(), before);
  assert.match(source, /allowHarderHiking: harderHikingEnabled\(\)/);
});

test('harder hiking requires an explicit boolean and admits exactly the known higher SAC grades', () => {
  for (const grade of R.SAC_SCALES) {
    const { data } = fixture(grade);
    const hasShortcut = options => R.buildGraph(data, [], options).segments.some(s => s.edge.way === 20);
    assert.equal(hasShortcut(), !R.harderThanHiking(grade), grade);
    assert.equal(hasShortcut({ allowHarderHiking: true }), true, grade);
    assert.equal(hasShortcut({ allowHarderHiking: 'true' }), !R.harderThanHiking(grade));
  }
  const { data, points } = fixture('unrecognized_grade');
  assert.equal(R.buildGraph(data, [], { allowHarderHiking: true }).segments.some(s => s.edge.way === 20), false);
  assert.throws(() => R.plan(data, points, { allowHarderHiking: 'true' }), /harder hiking paths setting/);
});

test('terrain opt-in preserves access, ford, visibility and pedestrian direction rules', () => {
  for (const tags of [{ foot: 'no' }, { access: 'private' }, { 'foot:conditional': 'yes @ (Su)' }, { ford: 'yes' }, { trail_visibility: 'no' }, { via_ferrata_scale: '2' }]) {
    const { data } = fixture('mountain_hiking', tags);
    assert.equal(R.buildGraph(data, [], { allowHarderHiking: true }).segments.some(s => s.edge.way === 20), false, JSON.stringify(tags));
  }
  const { data } = fixture('mountain_hiking', { 'oneway:foot': 'yes' });
  const graph = R.buildGraph(data, [], { allowHarderHiking: true });
  assert.ok(graph.adj.get(2).some(e => e.to === 3));
  assert.equal(graph.adj.get(3).some(e => e.to === 2), false);
});

test('the shortest loop uses the harder shortcut only when enabled and retains exact warning geometry', () => {
  const { data, points } = fixture();
  const normal = R.plan(data, points, { loop: true, tolerance: 15 });
  const allowed = R.plan(data, points, { loop: true, tolerance: 15, allowHarderHiking: true });
  assert.equal(normal.settings.allowHarderHiking, false);
  assert.ok(normal.routes.every(r => r.harderTerrainMetres === 0 && r.edges.every(e => e.way !== 20)));
  const r = allowed.routes[0];
  assert.ok(r.metres < normal.routes[0].metres);
  assert.deepEqual(r.order, [0, 1]);
  assert.equal(r.edges.length, r.coords.length - 1);
  assert.equal(r.harderTerrainMetres, r.edges.filter(e => e.way === 20).reduce((n, e) => n + e.metres, 0));
  assert.ok(r.edges.filter(e => e.way === 20).every(e => e.sacScale === 'mountain_hiking'));
  assert.match(allowed.notices.join(' '), /Some sections are tagged harder/);
  assert.match(harderTerrainWarning(r), /T2 · mountain hiking/);
});

test('projected pin edges retain difficulty, including the closing leg', () => {
  const { data } = fixture('demanding_mountain_hiking');
  const points = [{ lat: 22, lon: 114.0015 }, { lat: 22, lon: 114.0025 }];
  const route = R.plan(data, points, { loop: true, tolerance: 15, allowHarderHiking: true }).routes[0];
  assert.ok(route.edges.every(e => e.sacScale === 'demanding_mountain_hiking'));
  assert.equal(route.harderTerrainMetres, route.metres);
  assert.deepEqual(route.coords[0], route.coords.at(-1));
});

test('difficulty sections stop at grade changes and reverse with their geometry', () => {
  const coords = Array.from({ length: 7 }, (_, i) => ({ lat: 22, lon: 114 + i / 1000 }));
  const scales = ['hiking', 'mountain_hiking', 'mountain_hiking', null, 'mountain_hiking', 'alpine_hiking'];
  const route = { coords, edges: scales.map(sacScale => ({ sacScale, metres: 10 })) };
  assert.deepEqual(harderRouteSections(route).map(s => s.coords), [coords.slice(1, 4), coords.slice(4, 6), coords.slice(5, 7)]);
  route.coords = [...coords].reverse(); route.edges.reverse();
  assert.deepEqual(harderRouteSections(route).map(s => s.coords), [coords.slice(5, 7).reverse(), coords.slice(4, 6).reverse(), coords.slice(1, 4).reverse()]);
});

test('difficulty colors are optional and immediately replace normal colors for visible routes', () => {
  const { data, points } = fixture();
  const route = R.plan(data, points, { loop: true, allowHarderHiking: true }).routes[0];
  const routes = [route, { ...route, id: 'route-2' }];
  const routing = { result: { routes }, selected: null, visible: new Set(routes.map(r => r.id)) };
  const lines = [], controls = new Map();
  const $ = id => { if (!controls.has(id)) controls.set(id, { checked: 'false' }); return controls.get(id); };
  const enabled = () => $('route-difficulty-colors').checked === 'true';
  const layer = { bindPopup(text) { this.popup = text; return this; }, addTo() { return this; } };
  const L = { polyline(coords, options) { const line = { ...layer, coords, ...options }; lines.push(line); return line; }, marker: () => layer, divIcon: () => ({}) };
  const paintSource = source.slice(source.indexOf('    function paintPlannedRoute'), source.indexOf('    async function boundedJSON'));
  const paint = new Function('routing', '$', 'map', 'L', 'tracks', 'markers', 'ROUTE_COLORS', 'difficultyColorsEnabled', 'visibleDifficultySections', 'sacScaleLabel', 'mapMarkersVisible', 'km', 'stopRouteRun', 'startRouteRun', `${paintSource};return paintPlannedRoute;`)(routing, $, {}, L, {}, {}, ['green', 'purple'], enabled, makeHelpers(routing).visibleDifficultySections, sacScaleLabel, false, n => String(n), () => {}, () => {});
  paint();
  assert.deepEqual(lines.map(l => l.color), ['green', 'purple']);
  assert.equal($('route-difficulty-legend').hidden, true);
  lines.length = 0; $('route-difficulty-colors').checked = 'true'; paint();
  assert.ok(lines.length > 2);
  assert.deepEqual(new Set(lines.map(l => l.color)), new Set(['#13834b', '#e34e9b']));
  assert.ok(lines.some(l => /T2 · mountain hiking/.test(l.popup)));
  assert.equal($('route-difficulty-legend').hidden, false);
  lines.length = 0; $('route-difficulty-colors').checked = 'false'; paint();
  assert.deepEqual(lines.map(l => l.color), ['green', 'purple']);
  $('route-difficulty-colors').checked = 'true';
  lines.length = 0; routing.visible.clear(); paint();
  assert.equal(lines.length, 0);
  assert.equal($('route-difficulty-legend').hidden, true);
});

test('easy grades are green, T2–T3 pink, alpine grades red, and unknown remains gray', () => {
  const scales = [...R.SAC_SCALES, null, 'unrecognized'];
  const route = { coords: Array.from({ length: scales.length + 1 }, (_, i) => ({ lat: 22, lon: 114 + i / 1000 })), edges: scales.map(sacScale => ({ sacScale, metres: 10 })) };
  const sections = routeDifficultySections(route);
  assert.deepEqual(sections.map(s => s.color), ['#13834b', '#13834b', '#e34e9b', '#e34e9b', '#d00000', '#d00000', '#d00000', '#777777']);
  assert.equal(sections.at(-1).coords.length, 3, 'adjacent unknown values form one gray section');
  assert.equal(sections.reduce((sum, s) => sum + s.metres, 0), 90);
});

test('the difficulty switch sits below map route toggles and changes only the display', () => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /id="map-route-dots"[^>]*><\/div><div id="route-difficulty-control"/);
  assert.match(html, /id="route-difficulty-colors"[^>]*role="switch"[^>]*aria-checked="false"/);
  const control = { checked: 'false', state: { textContent: 'Off' }, setAttribute(k, v) { this.checked = v; }, querySelector() { return this.state; } };
  const renders = [];
  const code = source.slice(source.indexOf('    function toggleDifficultyColors'), source.indexOf("    $('route-difficulty-colors').addEventListener"));
  const toggle = new Function('$', 'difficultyColorsEnabled', 'render', `${code};return toggleDifficultyColors;`)(() => control, () => control.checked === 'true', fit => renders.push(fit));
  toggle(); assert.equal(control.checked, 'true'); assert.equal(control.state.textContent, 'On');
  toggle(); assert.equal(control.checked, 'false'); assert.equal(control.state.textContent, 'Off');
  assert.deepEqual(renders, [false, false]);
  assert.doesNotMatch(source.slice(source.indexOf('    const planSwitches'), source.indexOf('    const providers')), /route-difficulty/);
});

test('single and combined GPX exports include separate hiking and surface warnings', () => {
  const { data, points } = fixture('mountain_hiking', { smoothness: 'impassable' });
  const route = R.plan(data, points, { loop: true, allowHarderHiking: true }).routes[0];
  const code = source.slice(source.indexOf('    function plannedGPX'), source.indexOf("    $('show-all-routes')"));
  const { plannedGPX, allRoutesGPX } = new Function('state', '$', 'km', 'xmlText', 'harderTerrainWarning', 'roughSurfaceWarning', `${code}; return { plannedGPX, allRoutesGPX };`)({ points }, () => ({ value: '30' }), String, String, harderTerrainWarning, roughSurfaceWarning);
  for (const gpx of [plannedGPX(route), allRoutesGPX([route])]) {
    assert.match(gpx, /CAUTION: .*T2 · mountain hiking/);
    assert.match(gpx, /rough-surface vehicle tags/);
    assert.match(gpx, /do not establish hiking difficulty/);
  }
});
