import { readFileSync, writeFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import sharp from 'sharp';
import { ownerIdForResponsiveSource, responsiveDependencyHash, sha256 } from './generated-asset-ledger.mjs';

const ENCODINGS = {
  avif: [
    { id: 'quality-60', options: { quality: 60, effort: 7, chromaSubsampling: '4:4:4' } },
  ],
  webp: [
    { id: 'quality-80', options: { quality: 80, effort: 6, smartSubsample: true } },
    { id: 'lossless', options: { lossless: true, effort: 6 } },
  ],
};

// Settings and linked encoder versions both affect the emitted bytes. A legacy
// record without this identity is rebuilt once before it can be reused.
export const RESPONSIVE_ENCODER_HASH = sha256(JSON.stringify({
  encodings: ENCODINGS,
  versions: sharp.versions,
}));

async function outputsAreCurrent(sourcePath, relativeSource, source, previous, site) {
  if (!previous || previous.encoderHash !== RESPONSIVE_ENCODER_HASH) return false;
  for (const key of ['ownerId', 'url', 'width', 'height', 'bytes', 'sourceSha256']) {
    if (previous[key] !== source[key]) return false;
  }
  if (previous.dependencyClosureHash !== responsiveDependencyHash(relativeSource, previous)) return false;
  if (Object.keys(previous.formats ?? {}).length !== Object.keys(ENCODINGS).length) return false;

  for (const [format, candidates] of Object.entries(ENCODINGS)) {
    const output = previous.formats[format];
    const relativeOutput = relativeSource.replace(/\.png$/i, `.${format}`);
    if (!output || output.url !== new URL(relativeOutput, site).href
      || output.width !== source.width || output.height !== source.height
      || !candidates.some(({ id }) => id === output.encoding)) return false;
    try {
      const bytes = readFileSync(sourcePath.replace(/\.png$/i, `.${format}`));
      if (bytes.length !== output.bytes || sha256(bytes) !== output.sha256) return false;
      const metadata = await sharp(bytes).metadata();
      if (metadata.width !== source.width || metadata.height !== source.height) return false;
    } catch {
      // Missing or undecodable cache files are rebuilt from the authoritative PNG.
      return false;
    }
  }
  return true;
}

export async function encodeResponsivePreview(sourcePath, { docsRoot, site, previous } = {}) {
  const relativeSource = relative(docsRoot, sourcePath).split(sep).join('/');
  const input = readFileSync(sourcePath);
  const metadata = await sharp(input).metadata();
  const record = {
    ownerId: ownerIdForResponsiveSource(relativeSource),
    url: new URL(relativeSource, site).href,
    width: metadata.width,
    height: metadata.height,
    bytes: input.length,
    sourceSha256: sha256(input),
    encoderHash: RESPONSIVE_ENCODER_HASH,
    formats: {},
  };
  if (await outputsAreCurrent(sourcePath, relativeSource, record, previous, site)) {
    return { record: previous, reused: true };
  }

  for (const [format, recipes] of Object.entries(ENCODINGS)) {
    const candidates = await Promise.all(recipes.map(async ({ id, options }) => ({
      id,
      bytes: await sharp(input)[format](options).toBuffer(),
    })));
    const selected = candidates.reduce((smallest, candidate) => (
      candidate.bytes.length < smallest.bytes.length ? candidate : smallest
    ));
    const outputPath = sourcePath.replace(/\.png$/i, `.${format}`);
    writeFileSync(outputPath, selected.bytes);
    const outputMetadata = await sharp(selected.bytes).metadata();
    record.formats[format] = {
      url: new URL(relativeSource.replace(/\.png$/i, `.${format}`), site).href,
      width: outputMetadata.width,
      height: outputMetadata.height,
      bytes: selected.bytes.length,
      encoding: selected.id,
      sha256: sha256(selected.bytes),
    };
  }
  record.dependencyClosureHash = responsiveDependencyHash(relativeSource, record);
  return { record, reused: false };
}
