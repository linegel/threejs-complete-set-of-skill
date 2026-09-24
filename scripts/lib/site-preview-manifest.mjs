// Keep historical files intact; publication only advertises registered owners.
export function currentSitePreviewManifest(manifest, publishedIds) {
  if (!Array.isArray(manifest?.results)) throw new Error('Site preview manifest must contain results');
  return { ...manifest, results: manifest.results.filter(record => publishedIds.has(record.id)) };
}
