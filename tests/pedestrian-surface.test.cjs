const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/route-engine.js');
const fixture = require('./fixtures/harder-hiking.cjs');
const highJunkPeak = require('./fixtures/high-junk-peak-paths.json');

test('vehicle smoothness alone does not reject an otherwise eligible walking way', () => {
  for (const smoothness of ['horrible', 'very_horrible', 'impassable']) {
    assert.equal(R.walkable({ highway: 'path', smoothness }), true);
    for (const tags of [{ foot: 'no' }, { access: 'private' }, { locked: 'yes' }, { sac_scale: 'mountain_hiking' }, { trail_visibility: 'no' }, { ford: 'yes' }]) {
      assert.equal(R.walkable({ highway: 'path', smoothness, ...tags }), false);
    }
  }
});

test('inactive highway prefixes remain excluded under every terrain and ford setting', () => {
  for (const state of ['disused', 'abandoned', 'construction', 'proposed', 'planned', 'demolished', 'destroyed', 'razed', 'removed']) {
    for (const lifecycle of [{ [state]: 'yes' }, { [`${state}:highway`]: 'path' }]) {
      const { data } = fixture('mountain_hiking', { foot: 'yes', smoothness: 'impassable', ...lifecycle });
      for (const allowHarderHiking of [false, true]) {
        const graph = R.buildGraph(data, [], { allowHarderHiking, allowOfficialFords: true });
        assert.equal(graph.segments.some(s => s.edge.way === 20), false, JSON.stringify(lifecycle));
      }
    }
  }
  assert.equal(R.walkable({ highway: 'path', abandoned: 'no', 'abandoned:highway': 'path' }), false);
  assert.equal(R.walkable({ highway: 'path', abandoned: 'no', 'abandoned:highway': 'no' }), true);
  assert.equal(R.walkable({ highway: 'footway', 'abandoned:railway': 'rail' }), true, 'a former railway can carry an active footway');
});

test('roughness evidence follows projected and retraced paths without inventing a SAC grade', () => {
  const { data } = fixture(null, { smoothness: 'impassable' });
  const points = [{ lat: 22, lon: 114.0015 }, { lat: 22, lon: 114.0025 }];
  const result = R.plan(data, points, { loop: true, tolerance: 15 });
  const route = result.routes[0];
  assert.equal(result.policyVersion, R.ROUTING_POLICY_VERSION);
  assert.equal(result.settings.allowHarderHiking, false);
  assert.equal(route.roughSurfaceMetres, route.metres);
  assert.equal(route.unknownTerrainMetres, route.metres);
  assert.equal(route.harderTerrainMetres, 0);
  assert.ok(route.edges.every(e => e.sacScale === null && e.smoothness === 'impassable'));
});

test('abandoning a connected rough shortcut forces a real mapped detour', () => {
  const { data, points } = fixture('hiking', { smoothness: 'impassable' });
  const short = R.plan(data, points, { loop: true }).routes[0];
  assert.ok(short.edges.some(e => e.way === 20));
  data.elements.find(e => e.type === 'way' && e.id === 20).tags['abandoned:highway'] = 'path';
  const detour = R.plan(data, points, { loop: true, allowHarderHiking: true }).routes[0];
  assert.ok(detour.metres > short.metres);
  assert.ok(detour.edges.every(e => e.way !== 20));
  assert.equal(detour.roughSurfaceMetres, 0);
});

test('High Junk Peak eastern branch enters the graph but its abandoned continuation does not', () => {
  for (const allowHarderHiking of [false, true]) {
    const graph = R.buildGraph(highJunkPeak, [], { allowHarderHiking });
    const ways = new Set(graph.segments.map(s => s.edge.way));
    assert.ok(ways.has(454454740), 'vehicle-only impassability no longer removes the eastern branch');
    assert.equal(ways.has(1442979752), false, 'the abandoned continuation never supplies a through-connection');
    assert.equal(ways.has(30014358), allowHarderHiking, 'the southwest branch still requires the SAC opt-in');
    assert.ok(ways.has(758100046));
    const eastern = R.pathFrom(R.search(graph, 330412564, 'distance', new Map(), false, [4510160209]), 4510160209);
    assert.ok(eastern && eastern.metres > 300 && eastern.metres < 310);
    assert.ok(eastern.edges.every(e => e.way === 454454740));
  }
});
