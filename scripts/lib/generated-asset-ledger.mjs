import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function ownerIdForResponsiveSource(relativeSource) {
  return relativeSource.match(/^visual-validation\/([^/]+)\//)?.[1]
    ?? relativeSource.match(/^previews\/(?:primary|provider)\/([^/.]+)\.png$/)?.[1]
    ?? (relativeSource === 'generated-asset-contact-sheet.png' ? 'generated-asset-archive' : 'site');
}

export function responsiveDependencyHash(relativeSource, record) {
  const formats = Object.entries(record.formats ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([format, output]) => ({
      format,
      url: output.url,
      sha256: output.sha256,
      bytes: output.bytes,
    }));
  return sha256(JSON.stringify({
    source: relativeSource,
    ownerId: record.ownerId,
    sourceSha256: record.sourceSha256,
    sourceBytes: record.bytes,
    formats,
  }));
}

export function ownerIdForSiteImageUrl(urlString, siteOrigin) {
  const url = new URL(urlString, siteOrigin);
  if (url.origin !== new URL(siteOrigin).origin) throw new Error(`site image has foreign origin: ${urlString}`);
  const relativeSource = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const ownerId = ownerIdForResponsiveSource(relativeSource);
  if (ownerId === 'site' || ownerId === 'generated-asset-archive') {
    throw new Error(`site image has no primary lab owner: ${urlString}`);
  }
  return ownerId;
}

export function articleDependencyHash(slug, record) {
  const images = Object.entries(record.images ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ratio, output]) => ({
      ratio,
      url: output.url,
      sha256: output.sha256,
      bytes: output.bytes,
    }));
  return sha256(JSON.stringify({
    slug,
    ownerId: record.ownerId,
    source: record.source,
    sourceSha256: record.sourceSha256,
    sourceWidth: record.sourceWidth,
    sourceHeight: record.sourceHeight,
    images,
  }));
}

export function manifestOwnedOutputPaths(manifest, docsRoot, siteOrigin) {
  const docs = resolve(docsRoot);
  const expectedOrigin = new URL(siteOrigin).origin;
  const paths = new Set();

  for (const record of Object.values(manifest?.sources ?? {})) {
    for (const output of Object.values(record.formats ?? {})) {
      if (!output?.url) continue;
      const url = new URL(output.url, siteOrigin);
      if (url.origin !== expectedOrigin) throw new Error(`generated output has foreign origin: ${output.url}`);
      const path = resolve(docs, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!path.startsWith(`${docs}${sep}`)) throw new Error(`generated output escapes docs/: ${output.url}`);
      if (!/\.(?:avif|webp)$/i.test(path)) throw new Error(`generated output has unsupported extension: ${output.url}`);
      paths.add(path);
    }
  }
  return paths;
}

export function staleManifestOwnedOutputPaths(previousManifests, currentManifest, docsRoot, siteOrigin) {
  const retained = manifestOwnedOutputPaths(currentManifest, docsRoot, siteOrigin);
  const stale = new Set();
  for (const previous of previousManifests) {
    for (const path of manifestOwnedOutputPaths(previous, docsRoot, siteOrigin)) {
      if (!retained.has(path)) stale.add(path);
    }
  }
  return stale;
}
