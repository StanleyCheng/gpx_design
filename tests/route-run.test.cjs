const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const source = readFileSync(join(__dirname, '../lib/planner-ui.js'), 'utf8');
const animationSource = source.slice(source.indexOf('    function routeAnimationGeometry'), source.indexOf('    function harderTerrainWarning'));

function animationHarness(overrides = {}) {
  const routing = overrides.routing || { visible: new Set(), selected: null };
  const routeRunAnimation = { frame: 0, dots: [] };
  const frameQueue = new Map(), cancelled = [], removed = [], dots = [];
  let frameId = 0;
  const requestAnimationFrame = callback => { const id = ++frameId; frameQueue.set(id, callback); return id; };
  const cancelAnimationFrame = id => { cancelled.push(id); frameQueue.delete(id); };
  const markers = { removeLayer(dot) { removed.push(dot); } };
  const L = { circleMarker(latlng, options) { const dot = { latlng, options, positions: [], addTo() { return this; }, setLatLng(next) { this.latlng = next; this.positions.push(next); } }; dots.push(dot); return dot; } };
  const TrailRouter = { distance(a, b) { return Math.hypot(b.lat - a.lat, b.lon - a.lon) * 100; } };
  const factory = new Function('TrailRouter', 'routing', 'map', 'L', 'markers', 'requestAnimationFrame', 'cancelAnimationFrame', 'routeRunAnimation', 'ROUTE_RUNNER_COLOR', 'routeRunEnabled', `${animationSource}; return { routeAnimationGeometry, pointOnRoute, startRouteRun, stopRouteRun };`);
  const api = factory(TrailRouter, routing, {}, L, markers, requestAnimationFrame, cancelAnimationFrame, routeRunAnimation, '#ff6f7d', () => true);
  const runFrame = now => { const entry = frameQueue.entries().next().value; assert.ok(entry, 'an animation frame is queued'); frameQueue.delete(entry[0]); entry[1](now); };
  return { ...api, routing, routeRunAnimation, frameQueue, cancelled, removed, dots, runFrame };
}

test('Run switch is directly below Difficulty and starts off', () => {
  const dots = html.indexOf('id="map-route-dots"');
  const difficulty = html.indexOf('id="route-difficulty-control"');
  const run = html.indexOf('id="route-run-control"');
  const pins = html.indexOf('id="map-markers-action"');
  assert.ok(dots < difficulty && difficulty < run && run < pins);
  assert.match(html, /id="route-run"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.match(html, /small light red dot follows each visible route from start to finish/);
});

test('route animation interpolates by route distance and follows reversed geometry', () => {
  const { routeAnimationGeometry, pointOnRoute } = animationHarness();
  const route = { coords: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 3 }] };
  let geometry = routeAnimationGeometry(route);
  assert.equal(geometry.total, 300);
  assert.deepEqual(pointOnRoute(geometry, 0), { lat: 0, lon: 0 });
  assert.deepEqual(pointOnRoute(geometry, .5), { lat: 0, lon: 1.5 });
  route.coords.reverse(); geometry = routeAnimationGeometry(route);
  assert.deepEqual(pointOnRoute(geometry, 0), { lat: 0, lon: 3 });
  assert.deepEqual(pointOnRoute(geometry, .5), { lat: 0, lon: 1.5 });
  assert.equal(routeAnimationGeometry({ coords: [{ lat: 0, lon: 0 }] }), null);
});

test('one light red dot runs on each visible route with the exact route width', () => {
  const routes = [
    { id: 'route-1', coords: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 3 }] },
    { id: 'route-2', coords: [{ lat: 1, lon: 0 }, { lat: 1, lon: 3 }] },
    { id: 'hidden', coords: [{ lat: 2, lon: 0 }, { lat: 2, lon: 3 }] }
  ];
  const harness = animationHarness({ routing: { visible: new Set(['route-1', 'route-2']), selected: routes[1] } });
  harness.startRouteRun(routes);
  assert.equal(harness.dots.length, 2);
  assert.deepEqual(harness.dots.map(dot => dot.options.radius), [2.5, 3.5]);
  assert.ok(harness.dots.every(dot => dot.options.fillColor === '#ff6f7d' && dot.options.stroke === false));
  harness.runFrame(0);
  harness.runFrame(4000);
  assert.deepEqual(harness.dots[0].positions.at(-1), [0, 1.5]);
  harness.stopRouteRun();
  assert.equal(harness.routeRunAnimation.frame, 0);
  assert.equal(harness.removed.length, 2);
  assert.equal(harness.cancelled.length, 1);
});

test('Run toggles rendering immediately and resets for a new route search', () => {
  const control = { checked: 'false', state: { textContent: 'Off' }, setAttribute(name, value) { this.checked = value; }, querySelector() { return this.state; } };
  const renders = [];
  const code = source.slice(source.indexOf('    function setRouteRun'), source.indexOf("    $('route-run').addEventListener"));
  const toggle = new Function('$', 'routeRunEnabled', 'render', `${code}; return toggleRouteRun;`)(() => control, () => control.checked === 'true', fit => renders.push(fit));
  toggle(); assert.equal(control.checked, 'true'); assert.equal(control.state.textContent, 'On');
  toggle(); assert.equal(control.checked, 'false'); assert.equal(control.state.textContent, 'Off');
  assert.deepEqual(renders, [false, false]);
  assert.match(source, /function invalidateRoutes\(\)[\s\S]*?setRouteRun\(false\); stopRouteRun\(\)/);
  assert.match(source, /\$\('find-routes'\)\.addEventListener[\s\S]*?stopRouting\(\); setRouteRun\(false\); stopRouteRun\(\)/);
});
