import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TrailRouter = require('../lib/route-engine.js');

const MAX_REQUEST_BYTES = 64_000;
const MAX_MAP_BYTES = 64 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const ROUTE_TIMEOUT_MS = 220_000;
const PROVIDERS = {
  coffee: { name: 'Private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
  vk: { name: 'VK Maps', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
  fossgis: { name: 'FOSSGIS', url: 'https://overpass-api.de/api/interpreter' }
};
const PROVIDER_ORDER = ['fossgis', 'coffee', 'vk'];
const PUBLIC_ORIGINS = new Set(['https://gpxdesign.vercel.app', 'https://stanleycheng.github.io', 'null']);
const mapCache = new Map();
const officialCache = new Map();

class RequestError extends Error {}
class UpstreamError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

function configuredOrigins(value) {
  return new Set(String(value || '').split(',').map(origin => origin.trim()).filter(Boolean));
}

function responseHeaders(origin = '') {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-TrailPlanner-Route-Backend': '1'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status, value, origin = '') {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders(origin) });
}

function validateChoice(value, allowed, label) {
  if (!allowed.includes(value)) throw new RequestError(`Choose a valid ${label}.`);
  return value;
}

function validateNumber(value, allowed, label) {
  if (typeof value !== 'number' || !allowed.includes(value)) throw new RequestError(`Choose a valid ${label}.`);
  return value;
}

function validateInput(input) {
  if (!input || !Array.isArray(input.points) || !input.points.length || input.points.length > TrailRouter.MAX_WAYPOINTS) throw new RequestError(`Use 1–${TrailRouter.MAX_WAYPOINTS} valid waypoints.`);
  const points = input.points.map((point, index) => {
    const lat = point?.lat, lon = point?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 75 || Math.abs(lon) > 180) throw new RequestError(`Waypoint ${index + 1} is invalid.`);
    return { lat, lon, name: String(point.name || `Waypoint ${index + 1}`).slice(0, 160) };
  });
  const settings = input.settings || {};
  if (typeof settings.optimize !== 'boolean') throw new RequestError('Choose a valid waypoint order setting.');
  if (settings.loop !== undefined && typeof settings.loop !== 'boolean') throw new RequestError('Choose a valid Loop setting: on or off.');
  const radius = validateNumber(settings.radius, [1000, 2000, 4000, 6000], 'transport search distance');
  return {
    points,
    provider: validateChoice(input.provider || 'auto', ['auto', ...PROVIDER_ORDER], 'map data provider'),
    region: validateChoice(input.region || 'world', ['hk', 'tw', 'jp', 'kr', 'world'], 'region'),
    settings: {
      radius,
      maxApproach: 1000,
      maxDistance: validateNumber(settings.maxDistance, [10000, 20000, 30000, 50000, 80000], 'maximum hike distance'),
      maxRoad: validateNumber(settings.maxRoad, [0, 500, 1500, 3000], 'road connector limit'),
      tolerance: validateNumber(settings.tolerance, [15, 30, 60], 'waypoint tolerance'),
      optimize: Boolean(settings.optimize),
      loop: settings.loop === true
    }
  };
}

async function readJSON(response, maxBytes = MAX_MAP_BYTES) {
  if (!response.ok) {
    const status = response.status;
    throw new UpstreamError(`HTTP ${status}`, [429, 502, 503, 504].includes(status) ? status : 503);
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError('response too large', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new UpstreamError('response too large', 413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new UpstreamError('invalid JSON', 503); }
}

function cacheGet(cache, key, now) {
  const entry = cache.get(key);
  if (!entry || now - entry.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}

function cachePut(cache, key, value, now) {
  cache.set(key, { value, at: now });
  while (cache.size > 8) cache.delete(cache.keys().next().value);
}

async function fetchMapData(box, selected, fetcher, signal, now, areas = []) {
  const choices = selected === 'auto' ? PROVIDER_ORDER : [selected];
  const query = TrailRouter.queryFor(box, areas);
  signal.throwIfAborted();
  // A cached backup is immediately usable; do not wait for earlier providers again.
  for (const choice of choices) {
    const cached = cacheGet(mapCache, `${choice}/${query}`, now());
    if (cached) return { data: cached, provider: PROVIDERS[choice], cached: true };
  }
  const failures = [];
  for (const choice of choices) {
    const provider = PROVIDERS[choice], key = `${choice}/${query}`;
    try {
      const response = await fetcher(provider.url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'TrailPlanner/1.0 (+https://gpxdesign.vercel.app/)', Referer: 'https://gpxdesign.vercel.app/' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)])
      });
      const data = await readJSON(response);
      if (data?.remark || !Array.isArray(data?.elements)) throw new UpstreamError('incomplete map data', 503);
      cachePut(mapCache, key, data, now());
      return { data, provider, cached: false };
    } catch (error) {
      if (signal.aborted) throw error;
      if (error?.status === 413) throw new UpstreamError(areas.length ? 'The 20 km transport extension exceeded the map download size limit. Try a waypoint closer to a serviced trailhead; no partial route was used.' : 'The requested map area is too large. Use closer waypoints or a smaller transport search distance.', 413);
      const reason = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : error instanceof UpstreamError ? error.message : 'network unavailable';
      failures.push(`${provider.name}: ${String(reason).slice(0, 80)}`);
    }
  }
  throw new UpstreamError(`All map providers failed (${failures.join('; ')}).`, 503);
}

async function fetchOfficialTrails(box, region, fetcher, signal, now) {
  if (region !== 'hk') return { features: [], note: 'No government trail geometry is integrated for this region yet.' };
  const key = box.join(','), cached = cacheGet(officialCache, key, now());
  if (cached) return cached;
  const params = new URLSearchParams({ where: '1=1', geometry: `${box[1]},${box[0]},${box[3]},${box[2]}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'TRAIL_NAME_EN,DIFFICULTY_EN,WEBSITE', outSR: '4326', returnGeometry: 'true', f: 'geojson' });
  try {
    const response = await fetcher(`https://portal.csdi.gov.hk/server/rest/services/common/afcd_rcd_1665568199103_4360/MapServer/0/query?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]) });
    const data = await readJSON(response, 12 * 1024 * 1024);
    if (!Array.isArray(data.features) || data.exceededTransferLimit) throw new Error('incomplete data');
    const value = { features: data.features, note: 'AFCD corridor data checked; nearby geometry is not proof of current access.' };
    cachePut(officialCache, key, value, now()); return value;
  } catch (error) {
    if (signal.aborted) throw error;
    return { features: [], note: 'AFCD trail data was unavailable. Government-managed coverage cannot be established.' };
  }
}

export function createRoutePlanHandler(options = {}) {
  const fetcher = options.fetcher || fetch;
  const now = options.now || Date.now;
  const env = options.env || process.env;
  return async function handleRoutePlan(request) {
    const origin = request.headers.get('origin') || '';
    const requestOrigin = new URL(request.url).origin;
    const allowed = origin && (origin === requestOrigin || PUBLIC_ORIGINS.has(origin) || configuredOrigins(env.ALLOWED_ORIGIN).has(origin));
    if (!allowed) return json(403, { error: 'This origin is not allowed.' });
    if (request.method === 'OPTIONS') {
      const headers = responseHeaders(origin);
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Max-Age'] = '600';
      delete headers['Content-Type'];
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, origin);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: 'Use application/json.' }, origin);

    try {
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > MAX_REQUEST_BYTES) throw new RequestError('Route request is too large.');
      const raw = await request.text();
      if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) throw new RequestError('Route request is too large.');
      const input = validateInput(JSON.parse(raw));
      const box = TrailRouter.boundingBox(input.points, input.settings.radius);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException('Route backend timed out', 'TimeoutError')), ROUTE_TIMEOUT_MS);
      const clientAbort = () => controller.abort(request.signal.reason);
      request.signal.addEventListener('abort', clientAbort, { once: true });
      if (request.signal.aborted) clientAbort();
      try {
        let [map, official] = await Promise.all([
          fetchMapData(box, input.provider, fetcher, controller.signal, now),
          fetchOfficialTrails(box, input.region, fetcher, controller.signal, now)
        ]);
        controller.signal.throwIfAborted();
        let result;
        try { result = TrailRouter.plan(map.data, input.points, input.settings, official.features); }
        catch (error) {
          const areas = TrailRouter.transportExpansion(input.points, error);
          if (!areas.length) throw error;
          [map, official] = await Promise.all([
            fetchMapData(box, input.provider, fetcher, controller.signal, now, areas),
            fetchOfficialTrails(TrailRouter.coverageBox(box, areas), input.region, fetcher, controller.signal, now)
          ]);
          controller.signal.throwIfAborted();
          result = TrailRouter.plan(map.data, input.points, { ...input.settings, radius: TrailRouter.MAX_APPROACH, maxApproach: TrailRouter.MAX_APPROACH }, official.features);
          result.transportExpanded = true;
        }
        return json(200, { result, source: `${map.provider.name} / OpenStreetMap${map.cached ? ' · server cache' : ''}`, officialNote: official.note }, origin);
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', clientAbort);
        controller.abort();
      }
    } catch (error) {
      if (error instanceof RequestError || error instanceof SyntaxError) return json(400, { error: error.message || 'Invalid JSON.' }, origin);
      if (error instanceof UpstreamError || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        const timedOut = error?.name === 'TimeoutError' || /timed out/i.test(error?.message || '');
        const status = error?.status === 413 ? 413 : timedOut ? 504 : 503;
        const message = status === 413 ? `${error.message} Your waypoints are unchanged.` : timedOut ? 'The route backend timed out while waiting for map data. Please retry; your waypoints are unchanged.' : `${error.message} Please retry; your waypoints are unchanged.`;
        return json(status, { error: message }, origin);
      }
      const message = String(error?.message || 'No connected route met the selected limits.').slice(0, 1200);
      return json(422, { error: message, code: error?.code }, origin);
    }
  };
}

const handler = createRoutePlanHandler();

export default { fetch: handler };
