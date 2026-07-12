function humanize(value) {
  return String(value).split('-').map((word) => word.length <= 4 && /^(ao|cpu|gpu|gtao|hdr|lod|mrt|pbr|tsl|ui|webgpu)$/i.test(word)
    ? word.toUpperCase()
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

function openGates(entries = []) {
  return entries.filter((entry) => entry.status !== 'accepted');
}

function isPerformanceGate(entry) {
  return /performance|timing|timestamp|frame|cadence|budget/i.test(`${entry.id} ${entry.evidence ?? ''}`);
}

function gateItem(category, entry) {
  return {
    id: `${category}:${entry.id}`,
    priority: entry.required === true || isPerformanceGate(entry) ? 'P0' : 'P1',
    category,
    title: `${humanize(entry.id)} ${category === 'capability' ? 'capability proof' : 'runtime proof'}`,
    detail: entry.evidence
      ? String(entry.evidence)
      : `Capture current-source evidence for the declared ${humanize(entry.id).toLowerCase()} gate.`,
    source: `${category === 'capability' ? 'capabilityRequirements' : 'runtimeProof'}.${entry.id}`,
  };
}

export function buildDemoRoadmap(lab) {
  if (!lab || typeof lab !== 'object') throw new TypeError('buildDemoRoadmap requires a demo registry record');

  if (lab.status === 'accepted') {
    return {
      status: lab.status,
      summary: 'The declared published contract has accepted evidence and no open acceptance gates.',
      items: [],
    };
  }

  if (lab.status === 'secondary') {
    const canonicalLabId = lab.proxyStatus?.canonicalLabId ?? null;
    return {
      status: lab.status,
      summary: 'This is a secondary presentation surface; canonical readiness is owned elsewhere.',
      items: [{
        id: 'classification:secondary-surface',
        priority: 'P0',
        category: 'classification',
        title: canonicalLabId ? `Follow canonical lab ${canonicalLabId}` : 'Follow the owning skill contract',
        detail: lab.proxyStatus?.limitation ?? 'Do not treat this secondary surface as canonical runtime evidence.',
        source: 'proxyStatus',
      }],
    };
  }

  const capabilityGates = openGates(lab.capabilityRequirements);
  const runtimeGates = openGates(lab.runtimeProof);
  const openTiers = (lab.tiers ?? []).filter((tier) => tier.acceptanceStatus !== 'accepted');
  const tiersWithoutFrameTarget = (lab.tiers ?? []).filter((tier) => tier.frameTargetMs == null);
  const items = [];

  if (tiersWithoutFrameTarget.length > 0) {
    items.push({
      id: 'performance:target-contract',
      priority: 'P0',
      category: 'performance',
      title: 'Define and measure the target performance contract',
      detail: `The ${tiersWithoutFrameTarget.map((tier) => tier.id).join(', ')} tier${tiersWithoutFrameTarget.length === 1 ? '' : 's'} have no accepted frame target. Record named device/browser/GPU, viewport, DPR, sustained CPU/GPU/presentation p50 and p95, deadline misses, memory, and settled quality. Submission time is not GPU timing.`,
      source: 'tiers[].frameTargetMs',
    });
  }

  items.push(...capabilityGates.map((entry) => gateItem('capability', entry)));
  items.push(...runtimeGates.map((entry) => gateItem('runtime', entry)));

  if (!lab.evidenceBundle) {
    items.push({
      id: 'evidence:current-source-bundle',
      priority: 'P1',
      category: 'evidence',
      title: 'Capture a current-source evidence bundle',
      detail: 'Publish source-hash-bound renderer/backend facts, required diagnostic images, aligned readbacks, resource inventory, timing method, and limitations; directly inspect the important artifacts before promotion.',
      source: 'evidenceBundle',
    });
  }

  if (openTiers.length > 0) {
    items.push({
      id: 'tiers:acceptance',
      priority: 'P2',
      category: 'tiers',
      title: 'Close tier-specific acceptance',
      detail: `Validate and promote ${openTiers.map((tier) => tier.id).join(', ')} as independent visual and performance contracts without crossing their protected invariants.`,
      source: 'tiers[].acceptanceStatus',
    });
  }

  const priorityOrder = new Map([['P0', 0], ['P1', 1], ['P2', 2]]);
  items.sort((left, right) => priorityOrder.get(left.priority) - priorityOrder.get(right.priority));
  return {
    status: lab.status,
    summary: `${items.length} open closure item${items.length === 1 ? '' : 's'}. Loadable does not mean accepted or performance-valid.`,
    items,
  };
}
