const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const planner = readFileSync(join(root, 'lib/planner-ui.js'), 'utf8');

test('official-trail stream crossings are explicit, off by default, and sent to the planner', () => {
  assert.match(html, /id="plan-official-fords"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.match(html, /id="plan-official-fords-label">Official trail stream crossings</);
  assert.match(planner, /allowOfficialFords: officialFordsEnabled\(\)/);
  assert.match(planner, /\['loop', 'official-fords'\]/);
});

test('route review and GPX output disclose every enabled ford crossing', () => {
  assert.match(planner, /mapped stream crossing/);
  assert.match(planner, /Caution: this route uses/);
  assert.match(planner, /CAUTION:.*mapped ford crossing/);
  assert.match(planner, /recent rain and water level/);
});
