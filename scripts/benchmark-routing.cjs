const { performance } = require('node:perf_hooks');
const { resolve } = require('node:path');
const R = require('../lib/route-engine.js');
const grid = require('../tests/fixtures/routing-grid.cjs');

function measure(run, repetitions = 5) {
  run(); // Warm-up is deliberately excluded.
  const samples = []; let value;
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now(); value = run(); samples.push(performance.now() - start);
  }
  return { medianMs: Number(samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(3)), value };
}

const { data, source, target } = grid(100), graph = R.buildGraph(data);
const leg = {};
for (const algorithm of ['dijkstra', 'astar']) {
  const measured = measure(() => R.search(graph, source, 'distance', new Map(), false, [target], { algorithm }));
  leg[algorithm] = { medianMs: measured.medianMs, visitedNodes: measured.value.visited, metres: R.pathFrom(measured.value, target).metres };
}
if (Math.abs(leg.astar.metres - leg.dijkstra.metres) > 1e-6) throw new Error('Shortest-path distances differ.');

const points = data.elements.slice(0, 50).map(({ lat, lon }) => ({ lat, lon }));
const plan = engine => {
  const measured = measure(() => engine.plan(data, points, { loop: true, optimize: false, tolerance: 15 }), 3);
  const route = measured.value.routes[0];
  if (route.order.some((index, i) => index !== i) || route.coords[0].lon !== route.coords.at(-1).lon) throw new Error('The benchmark route is invalid.');
  return { medianMs: measured.medianMs, metres: route.metres, returnedRoutes: measured.value.routes.length, mandatoryPins: points.length };
};
const results = { node: process.version, platform: `${process.platform}/${process.arch}`, fixture: '100 × 100 mapped footway grid; synthetic, no network latency', nodes: graph.nodes.size, directedEdges: [...graph.adj.values()].reduce((sum, edges) => sum + edges.length, 0), singleLeg: leg, fiftyPinLoop: { current: plan(R) } };
if (process.argv[2]) {
  results.fiftyPinLoop.baseline = plan(require(resolve(process.argv[2])));
  if (Math.abs(results.fiftyPinLoop.current.metres - results.fiftyPinLoop.baseline.metres) > 1e-6) throw new Error('Baseline loop distance differs.');
}
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
