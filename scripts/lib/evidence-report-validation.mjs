const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function validateEvidenceReportManifest({
  manifest,
  demos,
  buildRevision,
  configuredRuntimePreviewIds = new Set(),
}) {
  const errors = [];
  const expected = new Map(demos.map((demo) => [demo.id, demo]));
  const reports = Array.isArray(manifest?.reports) ? manifest.reports : [];
  const reportIds = reports.map((record) => record?.labId);
  const reportIdSet = new Set(reportIds);

  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (manifest?.generatedBy !== 'scripts/build-evidence-pages.mjs') errors.push('generatedBy is invalid');
  if (manifest?.buildRevision !== buildRevision) errors.push('buildRevision drift');
  if (!SHA256_PATTERN.test(manifest?.indexSha256 ?? '')) errors.push('indexSha256 is invalid');
  if (reports.length !== demos.length) errors.push(`report count ${reports.length} does not equal ${demos.length}`);
  if (reportIdSet.size !== reportIds.length) errors.push('report ids are duplicated');

  for (const id of expected.keys()) {
    if (!reportIdSet.has(id)) errors.push(`missing report ${id}`);
  }
  for (const id of reportIdSet) {
    if (!expected.has(id)) errors.push(`unexpected report ${id}`);
  }

  for (const record of reports) {
    const demo = expected.get(record?.labId);
    if (!demo) continue;
    if (record.path !== `evidence/${demo.id}/`) errors.push(`${demo.id}: path drift`);
    if (record.status !== demo.status) errors.push(`${demo.id}: status drift`);
    if (record.sourceHash !== demo.sourceHash) errors.push(`${demo.id}: source hash drift`);
    if (!SHA256_PATTERN.test(record.publishedBundleHash ?? '')) errors.push(`${demo.id}: published bundle hash is invalid`);
    if (!SHA256_PATTERN.test(record.htmlSha256 ?? '')) errors.push(`${demo.id}: HTML hash is invalid`);
    if (!Array.isArray(record.media)) {
      errors.push(`${demo.id}: media must be an array`);
      continue;
    }
    const files = new Set();
    for (const image of record.media) {
      if (files.has(image?.file)) errors.push(`${demo.id}: duplicate media ${image?.file}`);
      files.add(image?.file);
      if (!SHA256_PATTERN.test(image?.outputSha256 ?? '')) errors.push(`${demo.id}: media hash is invalid for ${image?.file}`);
      const allowed = configuredRuntimePreviewIds.has(demo.id)
        ? image?.file?.startsWith(`visual-validation/${demo.id}/`)
        : (demo.nonRenderingScenarioSuite === true && image?.file === `previews/primary/${demo.id}.png`);
      if (!allowed) errors.push(`${demo.id}: unrelated or unconfigured media ${image?.file}`);
    }
  }
  return errors;
}
