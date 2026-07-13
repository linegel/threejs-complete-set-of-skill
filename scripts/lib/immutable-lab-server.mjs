import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

import {
  IMMUTABLE_LAB_BUILD_MANIFEST,
  loadAndValidateImmutableLabBuild,
} from './immutable-lab-build.mjs';
import { canonicalSha256 } from './evidence-manifest-contract.mjs';

const MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function resolveImmutableLabRequest(rawUrl, immutableBuild) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return { status: 400, reason: 'invalid-request-target' };
  if (rawUrl.startsWith('/')) {
    let rawPath = rawUrl.split(/[?#]/, 1)[0];
    try {
      for (let pass = 0; pass < 2; pass += 1) rawPath = decodeURIComponent(rawPath);
    } catch {
      return { status: 400, reason: 'invalid-url-encoding' };
    }
    if (rawPath.includes('\\') || rawPath.includes(String.fromCharCode(0))
      || rawPath.split('/').some((segment) => segment === '..' || segment === '.')) {
      return { status: 400, reason: 'path-traversal' };
    }
  }
  const url = new URL(rawUrl, 'http://immutable.invalid');
  if (url.origin !== 'http://immutable.invalid') return { status: 400, reason: 'cross-origin-request-target' };
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return { status: 400, reason: 'invalid-url-encoding' };
  }
  if (decoded.includes('\\') || decoded.includes(String.fromCharCode(0))) return { status: 400, reason: 'invalid-path' };
  const path = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) {
    return { status: 400, reason: 'path-traversal', resolvedPath: path };
  }
  const descriptor = path === IMMUTABLE_LAB_BUILD_MANIFEST
    ? { sha256: immutableBuild.manifestSha256, byteLength: immutableBuild.manifestBytes.byteLength }
    : immutableBuild.manifest.files[path];
  if (!descriptor) return { status: 404, reason: 'missing-exact-static-route', resolvedPath: path };
  return {
    status: 200,
    resolvedPath: path,
    query: url.search.slice(1),
    descriptor,
    contentType: MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
  };
}

export async function finalizeImmutableServedLedger(ledgerPath) {
  const bytes = await readFile(ledgerPath);
  const lines = bytes.toString('utf8').split('\n').filter(Boolean);
  const entries = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`immutable served ledger line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
  if (!entries.some((entry) => entry.status === 200 && entry.responseKind === 'exact-prebuilt-byte')) {
    throw new Error('immutable served ledger contains no successful exact-byte response');
  }
  return Object.freeze({
    entries,
    ledgerSha256: canonicalSha256(entries),
    documentSha256: sha256(bytes),
    byteLength: bytes.byteLength,
  });
}

export async function startImmutableLabServer(options = {}) {
  const buildDirectory = resolve(options.buildDirectory ?? '');
  const immutableBuild = await loadAndValidateImmutableLabBuild(buildDirectory, { expectedLabId: options.labId });
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 0;
  const ledgerPath = resolve(options.ledgerPath ?? join(tmpdir(), `threejs-lab-served-${process.pid}-${Date.now()}.ndjson`));
  if (ledgerPath.startsWith(`${immutableBuild.directory}/`)) throw new Error('served ledger must remain outside the immutable build');
  if (existsSync(ledgerPath)) throw new Error(`refusing to append to existing served ledger ${ledgerPath}`);

  const server = createServer(async (request, response) => {
    const baseRecord = {
      at: new Date().toISOString(),
      method: request.method,
      requestUrl: request.url,
      redirected: false,
      fallback: false,
      transformed: false,
    };
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        await appendFile(ledgerPath, `${JSON.stringify({ ...baseRecord, status: 405, responseKind: 'method-not-allowed' })}\n`);
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }
      const resolvedRequest = resolveImmutableLabRequest(request.url ?? '/', immutableBuild);
      if (resolvedRequest.status !== 200) {
        await appendFile(ledgerPath, `${JSON.stringify({ ...baseRecord, ...resolvedRequest, responseKind: resolvedRequest.reason })}\n`);
        response.writeHead(resolvedRequest.status, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-ThreeJS-Static-Miss': resolvedRequest.reason,
        });
        response.end(`${resolvedRequest.status} ${resolvedRequest.reason}\n`);
        return;
      }
      const bytes = resolvedRequest.resolvedPath === IMMUTABLE_LAB_BUILD_MANIFEST
        ? immutableBuild.manifestBytes
        : await readFile(join(immutableBuild.directory, resolvedRequest.resolvedPath));
      const actualHash = sha256(bytes);
      if (actualHash !== resolvedRequest.descriptor.sha256 || bytes.byteLength !== resolvedRequest.descriptor.byteLength) {
        throw new Error(`immutable byte drift for ${resolvedRequest.resolvedPath}`);
      }
      await appendFile(ledgerPath, `${JSON.stringify({
        ...baseRecord,
        status: 200,
        resolvedPath: resolvedRequest.resolvedPath,
        query: resolvedRequest.query,
        sha256: actualHash,
        byteLength: bytes.byteLength,
        responseKind: 'exact-prebuilt-byte',
      })}\n`);
      response.writeHead(200, {
        'Content-Type': resolvedRequest.contentType,
        'Content-Length': bytes.byteLength,
        ETag: `"${actualHash}"`,
        'Cache-Control': 'no-store',
        'X-Content-SHA256': actualHash,
        'X-ThreeJS-Immutable-Build': immutableBuild.manifest.bundleHash,
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      await appendFile(ledgerPath, `${JSON.stringify({ ...baseRecord, status: 500, responseKind: 'immutable-server-error', error: error.message })}\n`);
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`500 immutable-server-error: ${error.message}\n`);
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  return {
    server,
    host,
    port,
    url: `http://${host}:${port}/`,
    ledgerPath,
    immutableBuild,
    async closeAndFinalize() {
      // Node 18+: force-drop keep-alive sockets so close() cannot hang when a
      // Playwright/CDP page still holds the immutable lab origin open.
      if (typeof server.closeAllConnections === 'function') {
        try { server.closeAllConnections(); } catch { /* ignore */ }
      }
      await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
      return finalizeImmutableServedLedger(ledgerPath);
    },
  };
}
