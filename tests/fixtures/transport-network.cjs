// Small real-geometry-style network with directional passenger service roles.
module.exports = function transportNetwork({ lat = 22.05, nearStart = false, detour = false } = {}) {
  const coordinates = [[1, lat, 113.98], [2, lat, 114], [3, lat, 114.01], [4, lat, 114.013]];
  if (nearStart) coordinates.push([5, lat, 113.995]);
  if (detour) { coordinates[0][2] = 113.992; coordinates.push([6, lat + .06, 113.992], [7, lat + .06, 114]); }
  const nodes = coordinates.map(([id, lat, lon]) => ({ type: 'node', id, lat, lon }));
  for (const id of [1, 4, ...(nearStart ? [5] : [])]) nodes.find(n => n.id === id).tags = { highway: 'bus_stop', name: `Transport ${id}` };
  const line = detour ? [1, 6, 7, 2, 3, 4] : nearStart ? [1, 5, 2, 3, 4] : [1, 2, 3, 4];
  const way = { type: 'way', id: 100, nodes: line, tags: { highway: 'path', sac_scale: 'hiking', trail_visibility: 'good' } };
  const services = [1, 4, ...(nearStart ? [5] : [])].map(id => ({ type: 'relation', id: id + 500, tags: { route: 'bus', ref: `Bus ${id}` }, members: [{ type: 'node', ref: id, role: id === 4 ? 'platform_entry_only' : 'platform_exit_only' }] }));
  return { data: { elements: [...nodes, way, ...services] }, points: [{ lat, lon: 114 }, { lat, lon: 114.01 }] };
};
