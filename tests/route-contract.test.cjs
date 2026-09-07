const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/route-engine.js');
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });
const way = (id, nodes, tags = {}) => ({ type: 'way', id, nodes, tags: { highway: 'footway', ...tags } });

function checkVisits(route, points, tolerance) {
  assert.equal(route.snaps.length, points.length);
  assert.deepEqual([...route.order].sort((a, b) => a - b), points.map((_, i) => i));
  assert.equal(route.edges.length + 1, route.coords.length);
  let cursor = 0;
  for (const index of route.order) {
    const snap = route.snaps[index];
    cursor = route.ids.indexOf(snap.id, cursor);
    assert.ok(cursor >= 0, `waypoint ${index + 1} is visited in the declared order`);
    assert.deepEqual(route.coords[cursor], snap.point);
    const actualGap = R.distance(points[index], route.coords[cursor]);
    assert.ok(actualGap <= tolerance, `waypoint ${index + 1} is ${actualGap} m away, over ${tolerance} m`);
    assert.ok(Math.abs(actualGap - snap.metres) < 1e-9, 'reported gap describes the actual track vertex');
  }
}

test('a projection near a long segment endpoint is not moved beyond the chosen tolerance', () => {
  const data = { elements: [node(1, 0, 0), node(2, 0, 1), way(10, [1, 2])] };
  // Both pin projections lie within the old endpoint-ratio epsilon. Moving
  // either to the nearby OSM vertex would break the strict 1 mm tolerance.
  for (const lon of [5e-9, 1 - 5e-9]) {
    const points = [{ lat: 8e-9, lon }, { lat: 0, lon: lon < .5 ? .005 : .995 }];
    const result = R.plan(data, points, { loop: true, tolerance: .001 });
    for (const route of result.routes) {
      checkVisits(route, points, .001);
      assert.deepEqual(route.coords[0], route.coords.at(-1));
      assert.ok(route.coords.every(p => p.lat === 0 && p.lon >= 0 && p.lon <= 1));
      assert.ok(route.edges.every(edge => edge.way === 10));
    }
  }
});

test('trail-preferred alternatives obey approach limits smaller than 1 km at either end', () => {
  const data = { elements: [
    node(1, 22, 114, { highway: 'bus_stop' }), node(2, 22, 114.0008),
    node(3, 22.0005, 114.0004), node(4, 22, 114.0041),
    node(5, 22, 114.005, { highway: 'bus_stop' }),
    way(10, [1, 2], { highway: 'residential' }), way(11, [1, 3, 2]),
    way(12, [2, 4]), way(13, [4, 5]),
    { type: 'relation', id: 100, tags: { route: 'bus' }, members: [
      { type: 'node', ref: 1, role: 'platform' }, { type: 'node', ref: 5, role: 'platform' }
    ] }
  ] };
  for (const points of [[data.elements[1], data.elements[3]], [data.elements[3], data.elements[1]]]) {
    const result = R.plan(data, points, { maxApproach: 100, tolerance: 15 });
    for (const route of result.routes) {
      checkVisits(route, points, 15);
      assert.ok(route.start.approach + route.start.accessGap <= 100);
      assert.ok(route.end.approach + route.end.accessGap <= 100);
    }
  }
});

test('zero road allowance snaps to the nearby connected footway instead of a shorter road component', () => {
  const data = { elements: [
    node(1, 22, 114), node(2, 22, 114.003),
    node(3, 22.0001, 114), node(4, 22.0001, 114.003), node(5, 22.0002, 114.0015),
    way(10, [1, 2], { highway: 'residential' }), way(11, [3, 5, 4])
  ] };
  const points = data.elements.slice(0, 2);
  for (const route of R.plan(data, points, { loop: true, maxRoad: 0, tolerance: 30 }).routes) {
    checkVisits(route, points, 30);
    assert.equal(route.roadMetres, 0);
    assert.deepEqual(route.order, [0, 1]);
    assert.ok(route.edges.every(edge => edge.way === 11));
    assert.deepEqual(route.coords[0], route.coords.at(-1));
  }
  const restricted = structuredClone(data);
  restricted.elements.find(e => e.type === 'way' && e.id === 11).tags.foot = 'no';
  assert.throws(() => R.plan(restricted, points, { loop: true, maxRoad: 0, tolerance: 30 }), /eligible|road limit/i);
});

test('seeded directed networks retain every pin, source segment and requirement in every returned option', t => {
  let seed = 917, returned = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  // Independent line-membership check, not the engine's projection function.
  const onSegment = (point, a, b) => {
    const dx = b.lon - a.lon, dy = b.lat - a.lat;
    const ratio = ((point.lon - a.lon) * dx + (point.lat - a.lat) * dy) / (dx * dx + dy * dy);
    assert.ok(ratio >= -1e-8 && ratio <= 1 + 1e-8, 'track vertex is inside its source segment');
    assert.ok(R.distance(point, { lat: a.lat + ratio * dy, lon: a.lon + ratio * dx }) < 1e-6, 'track vertex lies on its source segment');
    return ratio;
  };
  for (let sample = 0; sample < 64; sample++) {
    const nodes = Array.from({ length: 10 }, (_, i) => node(i + 1, 22 + random() * .005, 114 + random() * .005, { highway: 'bus_stop' }));
    const ways = Array.from({ length: 20 }, (_, i) => {
      const a = Math.floor(random() * 10), b = (a + 1 + Math.floor(random() * 9)) % 10;
      return way(i + 100, [a + 1, b + 1], {
        highway: ['footway', 'path', 'residential'][i % 3], 'oneway:foot': ['yes', '-1', 'no'][i % 3],
        ...(i % 7 === 0 ? { foot: 'no' } : {})
      });
    });
    const data = { elements: [...nodes, ...ways, { type: 'relation', id: 500, tags: { route: 'bus' }, members: nodes.map(n => ({ type: 'node', ref: n.id, role: 'platform' })) }] };
    const points = Array.from({ length: 4 }, () => {
      const n = nodes[Math.floor(random() * nodes.length)];
      return { lat: n.lat + (random() - .5) * .00015, lon: n.lon + (random() - .5) * .00015 };
    });
    for (const loop of [false, true]) for (const tolerance of [15, 30]) {
      const settings = { loop, tolerance, maxApproach: 1000, maxDistance: 2000, maxRoad: sample % 3 ? 500 : 0 };
      let result;
      try { result = R.plan(data, points, settings); }
      catch (error) {
        assert.ok(['DISCONNECTED_WAYPOINTS', 'NO_TRANSPORT', 'WAYPOINT_OFF_PATH', 'ROUTE_LIMITS', 'NO_ELIGIBLE_NETWORK'].includes(error.code), error.message);
        continue;
      }
      for (const route of result.routes) {
        returned++;
        checkVisits(route, points, tolerance);
        assert.deepEqual(route.order, [0, 1, 2, 3]);
        assert.ok(route.metres + route.start.accessGap + route.end.accessGap <= settings.maxDistance);
        assert.ok(route.roadMetres <= settings.maxRoad);
        if (loop) assert.equal(route.ids[0], route.ids.at(-1));
        else for (const endpoint of [route.start, route.end]) assert.ok(endpoint.approach + endpoint.accessGap <= settings.maxApproach);
        let previous, measured = 0, roads = 0;
        for (let i = 0; i < route.edges.length; i++) {
          const edge = route.edges[i], source = ways.find(w => w.id === edge.way);
          assert.ok(source && source.tags.foot !== 'no', 'the source way permits walking');
          const a = nodes[source.nodes[0] - 1], b = nodes[source.nodes[1] - 1];
          const from = onSegment(route.coords[i], a, b), to = onSegment(route.coords[i + 1], a, b);
          if (source.tags['oneway:foot'] === 'yes') assert.ok(from <= to);
          if (source.tags['oneway:foot'] === '-1') assert.ok(from >= to);
          if (previous && previous.id !== source.id) {
            assert.ok(previous.nodes.includes(route.ids[i]) && source.nodes.includes(route.ids[i]), 'changing ways requires the same original OSM node, not a visual crossing');
          }
          const metres = R.distance(route.coords[i], route.coords[i + 1]);
          assert.ok(Math.abs(metres - edge.metres) < 1e-6);
          measured += metres;
          if (source.tags.highway === 'residential') roads += metres;
          previous = source;
        }
        assert.ok(Math.abs(measured - route.metres) < 1e-6);
        assert.ok(Math.abs(roads - route.roadMetres) < 1e-6);
      }
    }
  }
  assert.ok(returned >= 30, `expected substantial coverage, checked ${returned} routes`);
  t.diagnostic(`Checked ${returned} route options from 256 deterministic planning attempts.`);
});
