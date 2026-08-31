// No dependencies: test the exact pure functions shipped inside the single-page app.
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const math = html.split('// BEGIN IMAGE CONVERSION MATH')[1].split('// END IMAGE CONVERSION MATH')[0].replace(/^.*\n/, '');
const source = html.slice(html.indexOf('    function xmlText('), html.indexOf("    $('save-gpx').addEventListener"));
const context = vm.createContext({ $: () => ({ addEventListener() {} }) });
vm.runInContext(math + '\n' + source, context);
const { imageTransform, extractColourPath, reverseGeometry, gpxDocument } = context;
const red = [220, 35, 55];
function raster(gap = false) {
  const width = 200, height = 140, rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixel = (x, y) => { rgba.set([...red, 255], (y * width + x) * 4); };
  for (let x = 20; x <= 80; x++) pixel(x, 110);
  for (let y = 30; y <= 110; y++) if (!gap || y < 60 || y > 64) pixel(80, y);
  for (let x = 80; x <= 180; x++) pixel(x, 30);
  return { width, height, rgba };
}
test('affine geographic calibration maps rotated image locations and a known interior point', () => {
  const anchors = [{ x: 20, y: 20, lat: 22.4, lon: 114.3 }, { x: 180, y: 40, lat: 22.38, lon: 114.46 }, { x: 40, y: 120, lat: 22.3, lon: 114.32 }];
  const project = imageTransform(anchors, 200, 140, 'geographic');
  for (const p of anchors) { assert.ok(Math.abs(project(p).lat - p.lat) < 1e-9); assert.ok(Math.abs(project(p).lon - p.lon) < 1e-9); }
  const p = project({ x: 80, y: 60 });
  assert.ok(Math.abs(p.lat - 22.36) < 1e-9); assert.ok(Math.abs(p.lon - 114.36) < 1e-9);
});
test('Mercator calibration preserves the independently known projected midpoint', () => {
  const anchors = [{ x: 0, y: 0, lat: 60.5, lon: 10 }, { x: 200, y: 0, lat: 60.5, lon: 11 }, { x: 0, y: 140, lat: 60, lon: 10 }];
  const p = imageTransform(anchors, 200, 140, 'mercator')({ x: 100, y: 70 });
  // Independent spherical Mercator reference: inverse asinh(tan(latitude)) midpoint.
  assert.ok(Math.abs(p.lon - 10.5) < 1e-9); assert.ok(Math.abs(p.lat - 60.25095430048943) < 1e-9);
});
test('bad or unstable calibration is rejected', () => {
  const a = [{ x: 10, y: 10, lat: 22, lon: 114 }, { x: 90, y: 50, lat: 22.1, lon: 114.1 }, { x: 170, y: 90, lat: 22.2, lon: 114.2 }];
  assert.throws(() => imageTransform(a, 200, 140, 'mercator'), /line/);
  assert.throws(() => imageTransform([null, null, null], 200, 140, 'mercator'), /Mark/);
  a[2] = { x: 10, y: 120, lat: 42, lon: 150 };
  assert.throws(() => imageTransform(a, 200, 140, 'mercator'), /local map/);
});
test('bends follow source pixels, keeping exact endpoints without drawing a shortcut', () => {
  const { width, height, rgba } = raster();
  const path = extractColourPath(rgba, width, height, red, 20, [{ x: 20, y: 110 }, { x: 180, y: 30 }]);
  assert.equal(path[0].x, 20); assert.equal(path.at(-1).x, 180);
  assert.ok(path.some(p => p.x === 80 && p.y > 90));
  for (const p of path) assert.equal(rgba[(p.y * width + p.x) * 4], red[0]);
});
test('disconnected route cannot produce GPX geometry', () => {
  const { width, height, rgba } = raster(true);
  assert.throws(() => extractColourPath(rgba, width, height, red, 55, [{ x: 20, y: 110 }, { x: 180, y: 30 }]), /disconnected/);
});
test('wrong colour, background and remote route points are rejected', () => {
  const { width, height, rgba } = raster();
  assert.throws(() => extractColourPath(rgba, width, height, null, 55, []), /colour/);
  assert.throws(() => extractColourPath(rgba, width, height, [80, 80, 80], 55, []), /grey/);
  assert.throws(() => extractColourPath(rgba, width, height, red, 55, [{ x: 10, y: 10 }, { x: 180, y: 30 }]), /point 1/);
});
test('reversing swaps segment order and points, never joins gaps, and is involutive', () => {
  const points = [{ lat: 1, lon: 2 }, { lat: 5, lon: 6 }], segments = [[{ lat: 1, lon: 2, ele: 9 }, { lat: 2, lon: 3 }], [{ lat: 4, lon: 5 }, { lat: 5, lon: 6 }]];
  const reverse = reverseGeometry(points, segments);
  assert.equal(reverse.segments.length, 2); assert.equal(reverse.segments[0][0].lat, 5); assert.equal(reverse.segments[1][1].ele, 9); assert.equal(segments[0][0].lat, 1);
  assert.equal(JSON.stringify(reverseGeometry(reverse.points, reverse.segments)), JSON.stringify({ points, segments }));
  const gpx = gpxDocument(reverse.points, reverse.segments, 'Imported GPX');
  assert.equal((gpx.match(/<trkseg>/g) || []).length, 2); assert.equal((gpx.match(/<trkpt /g) || []).length, 4);
  assert.ok(gpx.indexOf('<trkpt lat="5"') < gpx.indexOf('<trkpt lat="1"'));
  assert.match(gpx, /<ele>9<\/ele>/); assert.match(gpx, /NOT FOR NAVIGATION/);
});
test('waypoint-only GPX invents no track, and XML labels are escaped', () => {
  const gpx = gpxDocument([{ lat: 1, lon: 2, name: '<x & "y">' }], [], 'Coordinates');
  assert.doesNotMatch(gpx, /<trk/); assert.match(gpx, /&lt;x &amp; &quot;y&quot;&gt;/);
  const nearZero = gpxDocument([{ lat: 0.0000001, lon: -0.0000002, ele: 0.0000003 }], [], 'Coordinates');
  assert.match(nearZero, /lat="0.0000001" lon="-0.0000002"/); assert.match(nearZero, /<ele>0.0000003<\/ele>/);
});
