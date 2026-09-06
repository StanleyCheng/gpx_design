module.exports = function harderHiking(sacScale = 'mountain_hiking', extraTags = {}) {
  const nodes = [
    [1, 22, 114], [2, 22, 114.001], [3, 22, 114.002], [4, 22, 114.003],
    [5, 22.002, 114.001], [6, 22.002, 114.003]
  ].map(([id, lat, lon]) => ({ type: 'node', id, lat, lon }));
  const data = { elements: [...nodes,
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'path', sac_scale: 'hiking' } },
    { type: 'way', id: 20, nodes: [2, 3, 4], tags: { highway: 'path', sac_scale: sacScale, ...extraTags } },
    { type: 'way', id: 30, nodes: [2, 5, 6, 4], tags: { highway: 'footway' } }
  ] };
  return { data, points: [nodes[0], nodes[3]].map(({ lat, lon }) => ({ lat, lon })) };
};
