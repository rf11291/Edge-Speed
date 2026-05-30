const VERSION = 'v0.4.0-workers';
const ONE_MIB = 1024 * 1024;
const downloadChunk_SIZE = 64 * 1024;
let cachedDownloadChunk = null;

function getDownloadChunk() {
  if (cachedDownloadChunk) return cachedDownloadChunk;
  const chunk = new Uint8Array(downloadChunk_SIZE);
  for (let i = 0; i < chunk.length; i += 1) {
    chunk[i] = (i * 31 + 17) & 0xff;
  }
  cachedDownloadChunk = chunk;
  return chunk;
}

const ipInfoCache = new Map();

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'accelerometer=(), autoplay=(), camera=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'none'; manifest-src 'self'"
};

const staticCacheHeaders = {
  'Cache-Control': 'public, max-age=3600, immutable'
};

const htmlCacheHeaders = {
  'Cache-Control': 'no-store'
};

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx).catch((error) => {
      console.error('Unhandled Worker error', error);
      return jsonResponse(request, env, 500, { ok: false, error: 'internal_error' });
    });
  }
};

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS' && isDynamicPath(url.pathname)) {
    return preflightResponse(request, env);
  }

  if (url.pathname === '/healthz') {
    return jsonResponse(request, env, 200, {
      ok: true,
      runtime: 'cloudflare-workers',
      version: VERSION,
      edge: edgeSnapshot(request)
    }, true);
  }

  if (url.pathname === '/__down') {
    return handleDownload(request, env, url);
  }

  if (url.pathname === '/__up') {
    return handleUpload(request, env, url);
  }

  if (url.pathname === '/api/config') {
    return handleConfig(request, env);
  }

  if (url.pathname === '/api/client') {
    return handleClient(request, env, ctx);
  }

  if (url.pathname.startsWith('/api/')) {
    return jsonResponse(request, env, 404, { ok: false, error: 'api_not_found' });
  }

  return handleStaticAsset(request, env, url);
}

function isDynamicPath(pathname) {
  return pathname === '/__down' || pathname === '/__up' || pathname.startsWith('/api/');
}

function configFromEnv(env) {
  return {
    siteName: envString(env, 'SITE_NAME', 'Open Edge Speed'),
    serverRegion: envString(env, 'SERVER_REGION', ''),
    maxDownloadBytes: envBytes(env, 'MAX_DOWNLOAD_BYTES', 512 * ONE_MIB),
    maxUploadBytes: envBytes(env, 'MAX_UPLOAD_BYTES', 50 * ONE_MIB),
    exposeClientIp: envBool(env, 'EXPOSE_CLIENT_IP', true),
    allowedOrigins: parseOrigins(envString(env, 'ALLOWED_ORIGINS', '')),
    ipInfoApiUrl: envString(env, 'IP_INFO_API_URL', ''),
    ipInfoApiToken: envString(env, 'IP_INFO_API_TOKEN', ''),
    ipInfoTimeoutMs: envInt(env, 'IP_INFO_TIMEOUT_MS', 1200, 200, 10000),
    ipInfoCacheTtlSeconds: envInt(env, 'IP_INFO_CACHE_TTL_SECONDS', 3600, 60, 86400)
  };
}

function envString(env, name, fallback) {
  const value = env?.[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function envBool(env, name, fallback) {
  const value = env?.[name];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function envInt(env, name, fallback, min, max) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

function envBytes(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = parseByteString(raw);
  return parsed === null ? fallback : parsed;
}

function parseByteString(raw) {
  const text = String(raw).trim().toLowerCase();
  const match = text.match(/^(\d+)(b|kb|kib|mb|mib|gb|gib)?$/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(n)) return null;
  const unit = match[2] || 'b';
  const factor = {
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 * 1000,
    mib: 1024 * 1024,
    gb: 1000 * 1000 * 1000,
    gib: 1024 * 1024 * 1024
  }[unit];
  const value = n * factor;
  return Number.isSafeInteger(value) ? value : null;
}

function parseOrigins(raw) {
  const origins = String(raw)
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (origins.includes('*')) return new Set(['*']);
  return new Set(origins);
}

function parseRequestedBytes(url, maxBytes) {
  const raw = url.searchParams.get('bytes');
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw)) return null;
  const bytes = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) return null;
  return bytes;
}

function handleDownload(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(request, env, 405, { ok: false, error: 'method_not_allowed' });
  }

  const config = configFromEnv(env);
  const downloadChunk = getDownloadChunk();
  const bytes = parseRequestedBytes(url, config.maxDownloadBytes);
  if (bytes === null) {
    return jsonResponse(request, env, 400, { ok: false, error: `invalid_bytes_parameter_max_${config.maxDownloadBytes}` });
  }

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(bytes),
    'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Timing-Allow-Origin': request.headers.get('Origin') || '*',
    'Server-Timing': 'edge;dur=0',
    'Content-Encoding': 'identity'
  });
  applySecurityHeaders(headers);
  applyCorsHeaders(request, env, headers);

  if (request.method === 'HEAD' || bytes === 0) {
    return new Response(null, { status: 200, headers });
  }

  let remaining = bytes;
  const body = new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const chunkSize = Math.min(remaining, downloadChunk.byteLength);
      const chunk = chunkSize === downloadChunk.byteLength ? downloadChunk : downloadChunk.subarray(0, chunkSize);
      remaining -= chunkSize;
      controller.enqueue(chunk);
      if (remaining <= 0) controller.close();
    }
  });

  return new Response(body, { status: 200, headers });
}

async function handleUpload(request, env, url) {
  if (request.method !== 'POST') {
    return jsonResponse(request, env, 405, { ok: false, error: 'method_not_allowed' });
  }

  const config = configFromEnv(env);
  const expectedBytes = parseRequestedBytes(url, config.maxUploadBytes);
  if (expectedBytes === null) {
    return jsonResponse(request, env, 400, { ok: false, error: `invalid_bytes_parameter_max_${config.maxUploadBytes}` });
  }

  const declaredLength = contentLength(request);
  if (declaredLength !== null && declaredLength > config.maxUploadBytes) {
    return jsonResponse(request, env, 413, { ok: false, error: 'upload_too_large' });
  }

  let received = 0;
  const started = performance.now();
  try {
    if (request.body) {
      const reader = request.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value ? value.byteLength : 0;
        if (received > config.maxUploadBytes) {
          await reader.cancel('upload_too_large').catch(() => undefined);
          return jsonResponse(request, env, 413, { ok: false, error: 'upload_too_large' });
        }
      }
    }
  } catch {
    return jsonResponse(request, env, 400, { ok: false, error: 'upload_stream_error' });
  }

  const durationMs = Math.max(0, performance.now() - started);
  return jsonResponse(request, env, 200, {
    ok: true,
    receivedBytes: received,
    expectedBytes,
    durationMs: Number(durationMs.toFixed(3)),
    edge: edgeSnapshot(request)
  });
}

function contentLength(request) {
  const raw = request.headers.get('Content-Length');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}

function handleConfig(request, env) {
  const config = configFromEnv(env);
  const edge = edgeSnapshot(request);
  const serverRegion = config.serverRegion || formatEdgeRegion(edge);
  return jsonResponse(request, env, 200, {
    ok: true,
    version: VERSION,
    runtime: 'cloudflare-workers',
    siteName: config.siteName,
    serverRegion,
    serverRegionSource: config.serverRegion ? 'configured' : 'cloudflare_edge',
    maxDownloadBytes: config.maxDownloadBytes,
    maxUploadBytes: config.maxUploadBytes,
    exposeClientIp: config.exposeClientIp,
    ipInfoAvailable: Boolean(config.ipInfoApiUrl),
    ipInfoProvider: ipInfoProviderName(config),
    limits: {
      mode: 'disabled'
    },
    edge
  });
}

async function handleClient(request, env, ctx) {
  const config = configFromEnv(env);
  const edge = edgeSnapshot(request);
  const ip = clientIp(request);
  const cfInfo = config.exposeClientIp ? cfToIpInfo(request, ip) : null;
  const lookup = config.exposeClientIp ? await lookupIpInfo(config, ip, ctx) : { status: 'hidden', data: null };
  const info = lookup.data || cfInfo;

  return jsonResponse(request, env, 200, {
    ok: true,
    ip: config.exposeClientIp ? ip : null,
    ipVersion: config.exposeClientIp ? ipVersion(ip) : null,
    publicIp: config.exposeClientIp ? isPublicIp(ip) : null,
    ipSource: 'cf-connecting-ip',
    proxyHint: null,
    ipInfo: config.exposeClientIp ? info : null,
    ipInfoStatus: lookup.data ? lookup.status : (cfInfo ? 'cloudflare' : lookup.status),
    headers: {
      country: cleanText(request.cf?.country, 32),
      region: cleanText(request.cf?.region, 80),
      city: cleanText(request.cf?.city, 80),
      colo: cleanText(request.cf?.colo, 16)
    },
    connection: {
      remoteFamily: null,
      runtime: 'cloudflare-workers'
    },
    userAgent: headerValue(request.headers.get('User-Agent'), 220),
    serverRegion: config.serverRegion || formatEdgeRegion(edge),
    serverRegionSource: config.serverRegion ? 'configured' : 'cloudflare_edge',
    edge,
    serverTime: new Date().toISOString()
  });
}

async function handleStaticAsset(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(request, env, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return jsonResponse(request, env, 500, { ok: false, error: 'assets_binding_missing' });
  }

  const assetUrl = new URL(request.url);
  if (assetUrl.pathname === '/') assetUrl.pathname = '/index.html';
  else if (assetUrl.pathname === '/about') assetUrl.pathname = '/about.html';

  const assetRequest = new Request(assetUrl, request);
  const response = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  if (isHtmlPath(assetUrl.pathname)) setHeaders(headers, htmlCacheHeaders);
  else if (response.ok) setHeaders(headers, staticCacheHeaders);
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isHtmlPath(pathname) {
  return pathname === '/' || pathname.endsWith('.html');
}

function jsonResponse(request, env, status, payload, cacheable = false) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheable ? 'public, max-age=60' : 'no-store'
  });
  applySecurityHeaders(headers);
  applyCorsHeaders(request, env, headers);
  return new Response(JSON.stringify(payload), { status, headers });
}

function preflightResponse(request, env) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  applySecurityHeaders(headers);
  applyCorsHeaders(request, env, headers);
  return new Response(null, { status: 204, headers });
}

function applySecurityHeaders(headers) {
  setHeaders(headers, securityHeaders);
}

function setHeaders(headers, entries) {
  for (const [name, value] of Object.entries(entries)) headers.set(name, value);
}

function applyCorsHeaders(request, env, headers) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  const allowedOrigins = configFromEnv(env).allowedOrigins;
  if (allowedOrigins.size === 0) return;
  if (allowedOrigins.has('*') || allowedOrigins.has(origin.replace(/\/+$/, ''))) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', appendVary(headers.get('Vary'), 'Origin'));
    headers.set('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
    headers.set('Access-Control-Max-Age', '600');
  }
}

function appendVary(current, value) {
  if (!current) return value;
  const parts = current.split(',').map((part) => part.trim().toLowerCase());
  return parts.includes(value.toLowerCase()) ? current : `${current}, ${value}`;
}

function edgeSnapshot(request) {
  const cf = request.cf || {};
  return {
    colo: cleanText(cf.colo, 16),
    country: cleanText(cf.country, 32),
    region: cleanText(cf.region, 80),
    city: cleanText(cf.city, 80),
    timezone: cleanText(cf.timezone, 80),
    latitude: cleanText(cf.latitude, 32),
    longitude: cleanText(cf.longitude, 32),
    asn: normalizeAsn(cf.asn),
    asOrganization: cleanText(cf.asOrganization, 120)
  };
}

function formatEdgeRegion(edge) {
  return edge.colo ? `Cloudflare Edge · ${edge.colo}` : 'Cloudflare Edge';
}

function clientIp(request) {
  return headerIp(request.headers.get('CF-Connecting-IP')) || headerIp(request.headers.get('True-Client-IP')) || headerIp(request.headers.get('X-Forwarded-For')) || '0.0.0.0';
}

function headerIp(value) {
  if (typeof value !== 'string') return null;
  const first = value.split(',')[0].trim();
  const normalized = normalizeIp(first);
  return isIpLike(normalized) ? normalized : null;
}

function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return '0.0.0.0';
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined);
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  const portMatch = ip.match(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/);
  if (portMatch) ip = portMatch[1];
  return ip;
}

function isIpLike(ip) {
  return isIpv4(ip) || isIpv6(ip);
}

function isIpv4(ip) {
  const parts = String(ip).split('.');
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isIpv6(ip) {
  const text = String(ip);
  return text.includes(':') && /^[0-9a-f:]+$/i.test(text);
}

function ipVersion(ip) {
  const normalized = normalizeIp(ip);
  if (isIpv4(normalized)) return 'IPv4';
  if (isIpv6(normalized)) return 'IPv6';
  return null;
}

function isPublicIp(ip) {
  const text = normalizeIp(ip).toLowerCase();
  const v4 = text.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map((part) => Number.parseInt(part, 10));
    if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a === 255 && b === 255 && c === 255 && d === 255) return false;
    return true;
  }
  if (!isIpv6(text)) return false;
  if (text === '::1' || text === '::' || text.startsWith('fc') || text.startsWith('fd') || text.startsWith('fe80')) return false;
  return true;
}

function cfToIpInfo(request, ip) {
  const cf = request.cf || {};
  const edge = edgeSnapshot(request);
  const data = {
    provider: 'cloudflare',
    ip: cleanText(ip, 80),
    country: cleanText(cf.country, 80),
    region: cleanText(cf.region, 80),
    city: cleanText(cf.city, 80),
    asn: normalizeAsn(cf.asn),
    org: cleanText(cf.asOrganization, 120),
    isp: cleanText(cf.asOrganization, 120),
    timezone: cleanText(cf.timezone, 80),
    edgeColo: edge.colo
  };
  return Object.values(data).some(Boolean) ? data : null;
}

function ipInfoProviderName(config) {
  if (!config.ipInfoApiUrl) return null;
  try {
    return new URL(config.ipInfoApiUrl.replace('{ip}', '1.1.1.1').replace('{token}', 'token')).hostname;
  } catch {
    return 'custom';
  }
}

async function lookupIpInfo(config, ip, ctx) {
  if (!config.ipInfoApiUrl) return { status: 'disabled', data: null };
  const normalized = normalizeIp(ip);
  if (!isPublicIp(normalized)) return { status: 'private', data: null };
  const now = Date.now();
  const cached = ipInfoCache.get(normalized);
  if (cached && cached.expires > now) return { status: cached.status, data: cached.data };
  if (cached && cached.expires <= now) ipInfoCache.delete(normalized);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ipInfoTimeoutMs);
  try {
    const response = await fetch(buildIpInfoUrl(config, normalized), {
      headers: {
        Accept: 'application/json',
        'User-Agent': `${config.siteName}/${VERSION}`
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`ip_info_http_${response.status}`);
    const contentLength = Number.parseInt(response.headers.get('Content-Length') || '0', 10);
    if (contentLength > 65536) throw new Error('ip_info_response_too_large');
    const text = await response.text();
    if (text.length > 65536) throw new Error('ip_info_response_too_large');
    const data = normalizeIpInfo(JSON.parse(text), ipInfoProviderName(config));
    const status = data ? 'ok' : 'unavailable';
    cacheIpInfo(normalized, status, data, config.ipInfoCacheTtlSeconds);
    return { status, data };
  } catch {
    cacheIpInfo(normalized, 'unavailable', null, 120);
    return { status: 'unavailable', data: null };
  } finally {
    clearTimeout(timer);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cleanExpiredIpInfoCache());
  }
}

function buildIpInfoUrl(config, ip) {
  const encodedToken = encodeURIComponent(config.ipInfoApiToken || '');
  let url = config.ipInfoApiUrl.replaceAll('{token}', encodedToken);
  const encodedIp = encodeURIComponent(normalizeIp(ip));
  url = url.replaceAll('{ip}', encodedIp);
  if (!url.includes(encodedIp) && !config.ipInfoApiUrl.includes('{ip}')) {
    url = url.endsWith('/') ? `${url}${encodedIp}` : `${url}/${encodedIp}`;
  }
  return url;
}

function cacheIpInfo(ip, status, data, ttlSeconds) {
  ipInfoCache.set(ip, {
    status,
    data,
    expires: Date.now() + ttlSeconds * 1000
  });
}

async function cleanExpiredIpInfoCache() {
  const now = Date.now();
  for (const [key, entry] of ipInfoCache.entries()) {
    if (!entry || entry.expires <= now) ipInfoCache.delete(key);
  }
}

function normalizeIpInfo(raw, provider) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.success === false || raw.error || raw.status === 'fail') return null;
  const connection = objectValue(raw.connection);
  const timezone = objectValue(raw.timezone);
  const asnObject = objectValue(raw.asn);
  const company = objectValue(raw.company);
  const timezoneText = typeof raw.timezone === 'string' ? raw.timezone : timezone.id;
  const orgRaw = pickValue(connection.org, connection.organization, raw.org, raw.organization, raw.asn_org, raw.asname, asnObject.org, asnObject.name, company.name);
  const org = stripLeadingAsn(cleanText(orgRaw, 120));
  const isp = stripLeadingAsn(cleanText(pickValue(connection.isp, raw.isp, raw.isp_name, company.name, orgRaw), 120));
  const asnRaw = pickValue(connection.asn, asnObject.asn, raw.asn, raw.as_number, raw.as, orgRaw);
  const data = {
    provider: cleanText(provider, 80),
    ip: cleanText(pickValue(raw.ip, raw.query), 80),
    country: cleanText(pickValue(raw.country, raw.country_name, raw.countryCode, raw.country_code), 80),
    region: cleanText(pickValue(raw.region, raw.region_name, raw.regionName, raw.region_code), 80),
    city: cleanText(raw.city, 80),
    asn: normalizeAsn(asnRaw),
    org,
    isp,
    timezone: cleanText(timezoneText, 80)
  };
  return [data.ip, data.country, data.region, data.city, data.asn, data.org, data.isp, data.timezone].some(Boolean) ? data : null;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pickValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function stripLeadingAsn(value) {
  if (!value) return null;
  const text = String(value).replace(/^AS\s*\d+\s+/i, '').trim();
  return text || value;
}

function normalizeAsn(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/AS\s*\d+/i) || text.match(/^\d+$/);
  if (!match) return cleanText(text, 32);
  const asn = match[0].replace(/\s+/g, '').toUpperCase();
  return asn.startsWith('AS') ? asn : `AS${asn}`;
}

function cleanText(value, max = 120) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/[\x00-\x1f\x7f]/g, '').trim();
  return text ? text.slice(0, max) : null;
}

function headerValue(value, max = 120) {
  if (typeof value !== 'string') return null;
  return cleanText(value, max);
}
