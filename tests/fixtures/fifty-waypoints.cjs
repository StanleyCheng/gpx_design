// Fifty distinct required places inside one mapped segment test repeated snapping.
module.exports = function fiftyWaypoints() {
  const points = Array.from({ length: 50 }, (_, i) => ({
    lat: 22.05, lon: 114 + (i + 1) * .009 / 51, name: `Place ${i + 1}`
  }));
  const data = { elements: [
    { type: 'node', id: 1, lat: 22.05, lon: 114, tags: { highway: 'bus_stop', name: 'West stop' } },
    { type: 'node', id: 2, lat: 22.05, lon: 114.009, tags: { highway: 'bus_stop', name: 'East stop' } },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'footway', foot: 'designated' } },
    { type: 'relation', id: 20, tags: { route: 'bus', ref: 'Test bus' }, members: [
      { type: 'node', ref: 1, role: 'platform' }, { type: 'node', ref: 2, role: 'platform' }
    ] }
  ] };
  return { data, points };
};
