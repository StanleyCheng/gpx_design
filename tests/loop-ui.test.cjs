const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const planner = fs.readFileSync(path.join(root, 'lib', 'planner-ui.js'), 'utf8');

test('route requirements default to 50 km distance and 3 km mapped roads', () => {
  assert.match(html, /<option value="80000">80 km · urban walk<\/option>/);
  assert.match(html, /<option value="50000" selected>50 km<\/option>/);
  assert.match(html, /<option value="3000" selected>3 km total<\/option>/);
  assert.doesNotMatch(html, /<option value="(?:30000|1500)" selected>/);
  assert.match(html, /id="plan-loop"[^>]*aria-checked="false"/);
});

test('loop UI explains the waypoint anchor and omits transport from direct map downloads', () => {
  assert.match(planner, /Waypoint 1 · no transport requirement/);
  assert.match(planner, /Public transport was not searched or required/);
  assert.match(planner, /includeTransport: !settings\.loop/);
  assert.match(planner, /Starts and finishes at waypoint 1/);
});
