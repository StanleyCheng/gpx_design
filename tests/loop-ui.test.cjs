const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const planner = fs.readFileSync(path.join(root, 'lib', 'planner-ui.js'), 'utf8');

test('long urban loops expose the required route limits without changing defaults', () => {
  assert.match(html, /<option value="80000">80 km · urban walk<\/option>/);
  assert.match(html, /<option value="1500" selected>1\.5 km total<\/option>/);
  assert.match(html, /id="plan-loop"[^>]*aria-checked="false"/);
});

test('loop UI explains the waypoint anchor and omits transport from direct map downloads', () => {
  assert.match(planner, /Waypoint 1 · no transport requirement/);
  assert.match(planner, /Public transport was not searched or required/);
  assert.match(planner, /includeTransport: !settings\.loop/);
  assert.match(planner, /Starts and finishes at waypoint 1/);
});
