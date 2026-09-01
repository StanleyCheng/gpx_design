const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'lib', 'guidance-ui.js'), 'utf8');
const stateStart = source.indexOf('// BEGIN GUIDANCE STATE');
const stateEnd = source.indexOf('// END GUIDANCE STATE') + '// END GUIDANCE STATE'.length;
const stateContext = {};
vm.runInNewContext(source.slice(stateStart, stateEnd), stateContext);
const guideStateFor = stateContext.guideStateFor;
const state = model => JSON.parse(JSON.stringify(guideStateFor(model)));

const base = method => ({ method, hasCoordinatesText: false, hasImage: false, hasRecognitionEndpoint: false, recognitionBusy: false, hasRecognitionResult: false, hasPhotoGPS: false, pointCount: 0, routingBusy: false, hasRoutes: false, hasSelectedRoute: false });

test('each empty input method points to its own first action', () => {
  assert.deepEqual(state(base('coordinates')), { step: 1, action: 'focus-coordinates' });
  assert.deepEqual(state(base('text')), { step: 1, action: 'choose-text' });
  assert.deepEqual(state(base('gpx')), { step: 1, action: 'choose-gpx' });
  assert.deepEqual(state(base('map-image')), { step: 1, action: 'choose-image' });
  assert.deepEqual(state(base('image')), { step: 1, action: 'choose-image' });
});

test('coordinate and image work move through clear review states', () => {
  assert.deepEqual(state({ ...base('coordinates'), hasCoordinatesText: true }), { step: 2, action: 'preview-coordinates' });
  assert.deepEqual(state({ ...base('map-image'), hasImage: true }), { step: 2, action: 'setup-recognition' });
  assert.deepEqual(state({ ...base('map-image'), hasImage: true, hasRecognitionEndpoint: true }), { step: 2, action: 'identify-image' });
  assert.deepEqual(state({ ...base('map-image'), hasImage: true, recognitionBusy: true }), { step: 2, action: 'waiting-recognition' });
  assert.deepEqual(state({ ...base('map-image'), hasImage: true, hasRecognitionResult: true }), { step: 3, action: 'review-candidates' });
  assert.deepEqual(state({ ...base('image'), hasImage: true, hasPhotoGPS: true }), { step: 2, action: 'add-photo-gps' });
});

test('shared planning states override the chosen input method', () => {
  assert.deepEqual(state({ ...base('gpx'), pointCount: 2 }), { step: 3, action: 'route-settings' });
  assert.deepEqual(state({ ...base('text'), pointCount: 17 }), { step: 3, action: 'review-remove' });
  assert.deepEqual(state({ ...base('coordinates'), pointCount: 2, routingBusy: true }), { step: 3, action: 'waiting-routes' });
  assert.deepEqual(state({ ...base('map-image'), hasRoutes: true }), { step: 4, action: 'compare-routes' });
  assert.deepEqual(state({ ...base('image'), hasRoutes: true, hasSelectedRoute: true }), { step: 4, action: 'review-save' });
});

test('English and Traditional Chinese cover every method, state and four-step path', () => {
  const copyStart = source.indexOf('const guideCopy = ');
  const copyEnd = source.indexOf('\n\n    let guideLanguage', copyStart);
  const copyContext = {};
  vm.runInNewContext(source.slice(copyStart, copyEnd).replace('const guideCopy =', 'guideCopy ='), copyContext);
  const copies = copyContext.guideCopy;
  const actions = ['focus-coordinates', 'preview-coordinates', 'choose-text', 'choose-gpx', 'choose-image', 'setup-recognition', 'identify-image', 'waiting-recognition', 'review-candidates', 'add-photo-gps', 'review-remove', 'route-settings', 'waiting-routes', 'compare-routes', 'review-save'];
  for (const language of ['en', 'zh-Hant']) {
    const copy = copies[language];
    for (const method of ['coordinates', 'text', 'gpx', 'map-image', 'image']) assert.equal(copy.methods[method].steps.length, 4);
    for (const action of actions) { assert.ok(copy.prompts[action][0]); assert.ok(copy.actions[action]); }
  }
});
