import { timingSafeEqual } from 'node:crypto';
import { kimiRecognize, normalizeRecognition, validateInput } from '../server/recognition.mjs';

const MAX_REQUEST_BYTES = 3_100_000;
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 3;

const secureEqual = (a, b) => {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
};

function configuredOrigins(value) {
  return new Set(String(value || '').split(',').map(origin => origin.trim()).filter(Boolean));
}

function responseHeaders(origin = '') {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Trailcraft-Recognition': '1'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status, value, origin = '') {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders(origin) });
}

function safeError(error) {
  const message = error instanceof Error ? error.message : '';
  return /^(Kimi returned HTTP|Kimi did not finish|The recognition response|Image |Only embedded|Unexpected token|Expected property|JSON)/.test(message)
    ? message.slice(0, 220)
    : 'Recognition failed or timed out. No coordinates were accepted. Please try a clearer image or manual calibration.';
}

export function createRecognitionHandler(options = {}) {
  const env = options.env || process.env;
  const recognize = options.recognize || kimiRecognize;
  const now = options.now || Date.now;
  let active = false;
  let recent = [];

  return async function handleRecognition(request) {
    const origin = request.headers.get('origin') || '';
    const requestOrigin = new URL(request.url).origin;
    const allowed = origin && (origin === requestOrigin || configuredOrigins(env.ALLOWED_ORIGIN).has(origin));
    if (!allowed) return json(403, { error: 'This origin is not allowed. Open the app on its configured origin.' });

    if (request.method === 'OPTIONS') {
      const headers = responseHeaders(origin);
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Max-Age'] = '600';
      delete headers['Content-Type'];
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, origin);

    const key = env.MOONSHOT_API_KEY || '';
    const token = env.TRAILCRAFT_ACCESS_TOKEN || '';
    if (!key || token.length < 32 || secureEqual(key, token)) {
      return json(503, { error: 'Private recognition is not configured safely on this server.' }, origin);
    }
    if (!secureEqual(request.headers.get('authorization'), `Bearer ${token}`)) {
      return json(401, { error: 'The private app access code is missing or incorrect.' }, origin);
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return json(415, { error: 'Use application/json.' }, origin);
    }

    const at = now();
    recent = recent.filter(timestamp => at - timestamp < WINDOW_MS);
    if (active || recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
      return json(429, { error: 'Recognition is busy or rate limited. Wait a minute before trying again.' }, origin);
    }
    active = true;
    recent.push(at);

    try {
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > MAX_REQUEST_BYTES) return json(413, { error: 'Image request too large.' }, origin);
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody) > MAX_REQUEST_BYTES) return json(413, { error: 'Image request too large.' }, origin);
      const input = validateInput(JSON.parse(rawBody));
      const result = normalizeRecognition(await recognize(input, key));
      return json(200, { result }, origin);
    } catch (error) {
      return json(422, { error: safeError(error) }, origin);
    } finally {
      active = false;
    }
  };
}

const handleRecognition = createRecognitionHandler();

export default {
  fetch: handleRecognition
};
