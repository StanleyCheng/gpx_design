// Deterministic mapped grid for correctness checks and reproducible benchmarks.
module.exports = function routingGrid(size = 60) {
  const elements = [], id = (row, col) => row * size + col + 1;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    elements.push({ type: 'node', id: id(row, col), lat: row * .0005, lon: col * .0005 });
  }
  for (let i = 0; i < size; i++) {
    elements.push({ type: 'way', id: 100000 + i, nodes: Array.from({ length: size }, (_, j) => id(i, j)), tags: { highway: 'footway' } });
    elements.push({ type: 'way', id: 200000 + i, nodes: Array.from({ length: size }, (_, j) => id(j, i)), tags: { highway: 'footway' } });
  }
  return { data: { elements }, source: id(0, 0), target: id(0, size - 1) };
};
