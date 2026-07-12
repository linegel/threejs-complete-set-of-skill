import {
  numericValue,
  validateNumericArray,
  validateNumericDatum,
} from '../../labs/runtime/numeric-evidence.mjs';

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new TypeError(`${label} requires at least ${minimum} entries`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

function requireDatum(value, label, {
  unit,
  labels,
  minimum = -Infinity,
  maximum = Infinity,
} = {}) {
  validateNumericDatum(value, label);
  if (unit !== undefined && value.unit !== unit) throw new TypeError(`${label} must use ${unit}`);
  if (labels !== undefined && !labels.includes(value.label)) {
    throw new TypeError(`${label} provenance must be ${labels.join(' or ')}`);
  }
  const number = numericValue(value, label);
  if (number < minimum || number > maximum) {
    throw new RangeError(`${label} must be within [${minimum}, ${maximum}]`);
  }
  return number;
}

function requirePopulation(value, label, {
  unit = 'ms',
  labels,
  minimum = 1,
} = {}) {
  validateNumericArray(value, label);
  if (value.unit !== unit) throw new TypeError(`${label} must use ${unit}`);
  if (labels !== undefined && !labels.includes(value.label)) {
    throw new TypeError(`${label} provenance must be ${labels.join(' or ')}`);
  }
  if (value.values.length < minimum) throw new Error(`${label} requires at least ${minimum} samples`);
  if (value.values.some((sample) => sample < 0)) throw new Error(`${label} samples must be nonnegative`);
  return value.values;
}

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function requireRecomputed(actual, expected, label, tolerance = 1e-9) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} does not reconcile with its retained population`);
  }
}

function validateTraceSegment(segment, label, refreshPeriod, {
  minimumCpuSamples,
  minimumPresentationSamples,
  measuredPresentation = false,
} = {}) {
  requireRecord(segment, label);
  const cpuSamples = requirePopulation(segment.cpuSamples, `${label}.cpuSamples`, {
    labels: ['Measured'],
    minimum: minimumCpuSamples,
  });
  const presentationSamples = requirePopulation(segment.presentationSamples, `${label}.presentationSamples`, {
    labels: measuredPresentation ? ['Measured'] : ['Measured', 'Authored'],
    minimum: minimumPresentationSamples,
  });
  const cpuP50 = requireDatum(segment.cpuP50, `${label}.cpuP50`, { unit: 'ms', labels: ['Measured'], minimum: 0 });
  const cpuP95 = requireDatum(segment.cpuP95, `${label}.cpuP95`, { unit: 'ms', labels: ['Measured'], minimum: 0 });
  const presentationP95 = requireDatum(segment.presentationP95, `${label}.presentationP95`, {
    unit: 'ms', labels: measuredPresentation ? ['Measured'] : ['Measured', 'Authored'], minimum: 0,
  });
  const deadlineMissRatio = requireDatum(segment.deadlineMissRatio, `${label}.deadlineMissRatio`, {
    unit: 'ratio', labels: measuredPresentation ? ['Measured'] : ['Measured', 'Authored'], minimum: 0, maximum: 1,
  });
  requireRecomputed(cpuP50, percentile(cpuSamples, 0.5), `${label}.cpuP50`);
  requireRecomputed(cpuP95, percentile(cpuSamples, 0.95), `${label}.cpuP95`);
  requireRecomputed(presentationP95, percentile(presentationSamples, 0.95), `${label}.presentationP95`);
  requireRecomputed(
    deadlineMissRatio,
    presentationSamples.filter((sample) => sample > refreshPeriod).length / presentationSamples.length,
    `${label}.deadlineMissRatio`,
  );
  return { cpuP95, deadlineMissRatio };
}

function validateStageAttribution(attribution, gpuSamples, sampleFrames) {
  requireRecord(attribution, 'frame-trace.json.gpuStageAttribution');
  const metadata = new Set([
    'timestampRows',
    'lastFrameResolveResidual',
    'reconciliationGate',
    'reconciliationScope',
    'independentPerFrameTotalsAvailable',
    'verdict',
  ]);
  const stages = Object.entries(attribution).filter(([key, value]) => (
    !metadata.has(key) && value && typeof value === 'object' && !Array.isArray(value)
  ));
  if (stages.length === 0) throw new Error('GPU attribution PASS requires at least one timestamped stage population');
  const stagePopulations = [];
  for (const [id, stage] of stages) {
    const samples = requirePopulation(stage.samples, `frame-trace.json.gpuStageAttribution.${id}.samples`, {
      labels: ['Measured'],
      minimum: sampleFrames,
    });
    if (samples.length !== sampleFrames) throw new Error(`GPU stage ${id} sample count must equal sampleFrames`);
    const p50 = requireDatum(stage.p50, `frame-trace.json.gpuStageAttribution.${id}.p50`, {
      unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0,
    });
    const p95 = requireDatum(stage.p95, `frame-trace.json.gpuStageAttribution.${id}.p95`, {
      unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0,
    });
    requireRecomputed(p50, percentile(samples, 0.5), `GPU stage ${id} p50`);
    requireRecomputed(p95, percentile(samples, 0.95), `GPU stage ${id} p95`);
    stagePopulations.push(samples);
  }
  for (let index = 0; index < sampleFrames; index += 1) {
    const attributedTotal = stagePopulations.reduce((total, samples) => total + samples[index], 0);
    requireRecomputed(gpuSamples[index], attributedTotal, `GPU frame ${index} attributed total`);
  }
  const residual = requireDatum(
    attribution.lastFrameResolveResidual,
    'frame-trace.json.gpuStageAttribution.lastFrameResolveResidual',
    { unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0 },
  );
  const gate = requireDatum(
    attribution.reconciliationGate,
    'frame-trace.json.gpuStageAttribution.reconciliationGate',
    { unit: 'ms', labels: ['Gated'], minimum: 0 },
  );
  requireString(attribution.reconciliationScope, 'frame-trace.json.gpuStageAttribution.reconciliationScope');
  if (attribution.independentPerFrameTotalsAvailable !== false) {
    throw new Error('stage attribution must not overclaim unavailable independent per-frame totals');
  }
  if (residual > gate) throw new Error('GPU stage attribution residual exceeds its reconciliation gate');
  if (attribution.verdict !== 'PASS') throw new Error('GPU attribution PASS requires a passing stage-attribution verdict');
}

function validateGovernor(governor) {
  requireRecord(governor, 'quality-governor.json');
  if (governor.enabled !== true) throw new Error('performance PASS requires an exercised quality governor');
  if (governor.oscillationDetected !== false) throw new Error('quality governor oscillation is blocking');
  const states = requireArray(governor.states, 'quality-governor.json.states', 2);
  if (!states.includes(governor.settledState)) throw new Error('quality governor settled outside its declared states');
  const target = requireDatum(governor.target, 'quality-governor.json.target', {
    unit: 'ms', labels: ['Gated'], minimum: Number.MIN_VALUE,
  });
  requireDatum(governor.hysteresis, 'quality-governor.json.hysteresis', {
    unit: 'ms', labels: ['Gated'], minimum: Number.MIN_VALUE,
  });
  requireDatum(governor.minimumResidence, 'quality-governor.json.minimumResidence', {
    labels: ['Gated'], minimum: 1,
  });
  requireDatum(governor.cooldown, 'quality-governor.json.cooldown', {
    labels: ['Gated'], minimum: 1,
  });
  const windows = requireArray(governor.windows, 'quality-governor.json.windows', 6);
  let previousResultingTier = null;
  for (const [index, window] of windows.entries()) {
    requireRecord(window, `quality-governor.json.windows[${index}]`);
    const windowIndex = requireDatum(window.window, `quality-governor.json.windows[${index}].window`, {
      labels: ['Measured'], minimum: 0,
    });
    if (!Number.isInteger(windowIndex) || windowIndex !== index) {
      throw new Error(`quality governor window ${index} has a discontinuous index`);
    }
    const measuredTier = requireString(window.measuredTier, `quality-governor.json.windows[${index}].measuredTier`);
    const resultingTier = requireString(window.resultingTier, `quality-governor.json.windows[${index}].resultingTier`);
    if (!states.includes(measuredTier) || !states.includes(resultingTier)) {
      throw new Error(`quality governor window ${index} references an undeclared tier`);
    }
    if (previousResultingTier !== null && measuredTier !== previousResultingTier) {
      throw new Error(`quality governor window ${index} breaks tier lineage`);
    }
    const samples = requirePopulation(window.gpuSamples, `quality-governor.json.windows[${index}].gpuSamples`, {
      labels: ['Derived', 'Measured'],
      minimum: 1,
    });
    const p95 = requireDatum(window.gpuP95, `quality-governor.json.windows[${index}].gpuP95`, {
      unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0,
    });
    requireRecomputed(p95, percentile(samples, 0.95), `quality governor window ${index} p95`);
    const timestampRows = requireArray(
      window.timestampRows,
      `quality-governor.json.windows[${index}].timestampRows`,
      samples.length,
    );
    if (timestampRows.length !== samples.length) {
      throw new Error(`quality governor window ${index} timestamp rows do not cover its GPU samples`);
    }
    for (const [frame, row] of timestampRows.entries()) {
      requireRecord(row, `quality-governor.json.windows[${index}].timestampRows[${frame}]`);
      const sceneMs = requireDatum(row.sceneMs, `quality-governor.json.windows[${index}].timestampRows[${frame}].sceneMs`, {
        unit: 'ms', labels: ['Measured'], minimum: 0,
      });
      const outputMs = requireDatum(row.outputMs, `quality-governor.json.windows[${index}].timestampRows[${frame}].outputMs`, {
        unit: 'ms', labels: ['Measured'], minimum: 0,
      });
      const totalMs = requireDatum(row.totalMs, `quality-governor.json.windows[${index}].timestampRows[${frame}].totalMs`, {
        unit: 'ms', labels: ['Derived'], minimum: 0,
      });
      requireRecomputed(totalMs, sceneMs + outputMs, `quality governor window ${index} frame ${frame} total`);
      requireRecomputed(samples[frame], totalMs, `quality governor window ${index} frame ${frame} GPU sample`);
    }
    const resolveResidual = requireDatum(
      window.lastFrameResolveResidual,
      `quality-governor.json.windows[${index}].lastFrameResolveResidual`,
      { unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0 },
    );
    if (resolveResidual > 0.001) throw new Error(`quality governor window ${index} timestamp resolve does not reconcile`);
    const visualError = requireDatum(window.visualError, `quality-governor.json.windows[${index}].visualError`, { minimum: 0 });
    const visualErrorGate = requireDatum(window.visualErrorGate, `quality-governor.json.windows[${index}].visualErrorGate`, {
      labels: ['Gated'], minimum: 0,
    });
    const edgeP95VisualError = requireDatum(
      window.edgeP95VisualError,
      `quality-governor.json.windows[${index}].edgeP95VisualError`,
      { minimum: 0 },
    );
    const edgeP95VisualErrorGate = requireDatum(
      window.edgeP95VisualErrorGate,
      `quality-governor.json.windows[${index}].edgeP95VisualErrorGate`,
      { labels: ['Gated'], minimum: 0 },
    );
    const residence = requireDatum(window.residence, `quality-governor.json.windows[${index}].residence`, { minimum: 0 });
    const cooldown = requireDatum(window.cooldown, `quality-governor.json.windows[${index}].cooldown`, { minimum: 0 });
    if (!Number.isInteger(residence) || !Number.isInteger(cooldown)) {
      throw new Error(`quality governor window ${index} counters must be integers`);
    }
    const edgeMaskPixels = requireDatum(window.edgeMaskPixels, `quality-governor.json.windows[${index}].edgeMaskPixels`, {
      labels: ['Measured'], minimum: 1,
    });
    if (edgeMaskPixels < 1) throw new Error(`quality governor window ${index} lacks a measured edge mask`);
    if (visualError > visualErrorGate || edgeP95VisualError > edgeP95VisualErrorGate) {
      throw new Error(`quality governor window ${index} exceeds its visual-error gate`);
    }
    requireString(window.decision, `quality-governor.json.windows[${index}].decision`);
    previousResultingTier = resultingTier;
  }
  const transitions = requireArray(governor.transitions, 'quality-governor.json.transitions', 1);
  const transitionWindows = new Set();
  for (const [index, transition] of transitions.entries()) {
    requireRecord(transition, `quality-governor.json.transitions[${index}]`);
    const windowIndex = requireDatum(transition.window, `quality-governor.json.transitions[${index}].window`, {
      labels: ['Measured'], minimum: 0,
    });
    if (!Number.isInteger(windowIndex) || windowIndex >= windows.length) {
      throw new Error(`quality governor transition ${index} references a missing window`);
    }
    if (transitionWindows.has(windowIndex)) throw new Error(`quality governor window ${windowIndex} has duplicate transitions`);
    transitionWindows.add(windowIndex);
    const from = requireString(transition.from, `quality-governor.json.transitions[${index}].from`);
    const to = requireString(transition.to, `quality-governor.json.transitions[${index}].to`);
    requireString(transition.cause, `quality-governor.json.transitions[${index}].cause`);
    if (!states.includes(from) || !states.includes(to) || from === to) {
      throw new Error(`quality governor transition ${index} is not a real declared-state change`);
    }
    const sourceWindow = windows[windowIndex];
    if (sourceWindow.measuredTier !== from || sourceWindow.resultingTier !== to) {
      throw new Error(`quality governor transition ${index} breaks source-window tier lineage`);
    }
    const transitionP95 = requireDatum(transition.gpuP95, `quality-governor.json.transitions[${index}].gpuP95`, {
      unit: 'ms', labels: ['Measured'], minimum: 0,
    });
    requireRecomputed(
      transitionP95,
      numericValue(sourceWindow.gpuP95, `quality-governor.json.windows[${windowIndex}].gpuP95`),
      `quality-governor.json.transitions[${index}].gpuP95`,
    );
    requireDatum(transition.rebuildCpuSubmission, `quality-governor.json.transitions[${index}].rebuildCpuSubmission`, {
      unit: 'ms', labels: ['Measured'], minimum: 0,
    });
    const rebuildGpu = requireDatum(transition.rebuildGpu, `quality-governor.json.transitions[${index}].rebuildGpu`, {
      unit: 'ms', labels: ['Measured'], minimum: 0,
    });
    const rebuildRow = requireRecord(
      transition.rebuildTimestampRow,
      `quality-governor.json.transitions[${index}].rebuildTimestampRow`,
    );
    const rebuildScene = requireDatum(rebuildRow.sceneMs, `quality-governor.json.transitions[${index}].rebuildTimestampRow.sceneMs`, {
      unit: 'ms', labels: ['Measured'], minimum: 0,
    });
    const rebuildOutput = requireDatum(rebuildRow.outputMs, `quality-governor.json.transitions[${index}].rebuildTimestampRow.outputMs`, {
      unit: 'ms', labels: ['Measured'], minimum: 0,
    });
    const rebuildTotal = requireDatum(rebuildRow.totalMs, `quality-governor.json.transitions[${index}].rebuildTimestampRow.totalMs`, {
      unit: 'ms', labels: ['Derived'], minimum: 0,
    });
    requireRecomputed(rebuildTotal, rebuildScene + rebuildOutput, `quality governor transition ${index} rebuild total`);
    requireRecomputed(rebuildGpu, rebuildTotal, `quality governor transition ${index} rebuild GPU time`);
    const transitionResidual = requireDatum(
      transition.lastFrameResolveResidual,
      `quality-governor.json.transitions[${index}].lastFrameResolveResidual`,
      { unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0 },
    );
    if (transitionResidual > 0.001) throw new Error(`quality governor transition ${index} timestamp resolve does not reconcile`);
    requireDatum(transition.fromResourceBytes, `quality-governor.json.transitions[${index}].fromResourceBytes`, {
      unit: 'byte', labels: ['Measured'], minimum: 0,
    });
    requireDatum(transition.toResourceBytes, `quality-governor.json.transitions[${index}].toResourceBytes`, {
      unit: 'byte', labels: ['Measured'], minimum: 0,
    });
  }
  const finalStableGpuP95 = requireDatum(governor.finalStableGpuP95, 'quality-governor.json.finalStableGpuP95', {
    unit: 'ms', labels: ['Measured'], minimum: 0,
  });
  requireRecomputed(
    finalStableGpuP95,
    numericValue(windows.at(-1).gpuP95, 'quality-governor final window p95'),
    'quality-governor.json.finalStableGpuP95',
  );
  const finalVisual = requireDatum(governor.finalStableVisualError, 'quality-governor.json.finalStableVisualError', { minimum: 0 });
  const visualGate = requireDatum(governor.visualErrorGate, 'quality-governor.json.visualErrorGate', {
    labels: ['Gated'], minimum: 0,
  });
  const finalEdge = requireDatum(governor.finalStableEdgeP95VisualError, 'quality-governor.json.finalStableEdgeP95VisualError', { minimum: 0 });
  const edgeGate = requireDatum(governor.edgeP95VisualErrorGate, 'quality-governor.json.edgeP95VisualErrorGate', {
    labels: ['Gated'], minimum: 0,
  });
  if (finalStableGpuP95 > target) throw new Error('quality governor settled above its GPU p95 target');
  if (finalVisual > visualGate) throw new Error('quality governor settled above its visual-error gate');
  if (finalEdge > edgeGate) throw new Error('quality governor settled above its edge visual-error gate');
  if (governor.verdict !== 'PASS') throw new Error('performance PASS requires a passing quality-governor trace');
}

export function assertPerformanceClaimEvidence(json, manifest) {
  const performanceClaimed = manifest?.claimVerdicts?.performanceCompliance === 'PASS'
    || manifest?.claimVerdicts?.gpuAttribution === 'PASS';
  if (!performanceClaimed) return true;

  const envelope = requireRecord(json['performance-envelope.json'], 'performance-envelope.json');
  const trace = requireRecord(json['frame-trace.json'], 'frame-trace.json');
  if (envelope.gpuTimingRequirement !== 'required') throw new Error('performance PASS requires GPU timing');
  const refreshPeriod = requireDatum(envelope.refreshPeriod, 'performance-envelope.json.refreshPeriod', {
    unit: 'ms', labels: ['Derived'], minimum: Number.MIN_VALUE,
  });
  const cpuGate = requireDatum(envelope.cpuP95Gate, 'performance-envelope.json.cpuP95Gate', {
    unit: 'ms', labels: ['Gated'], minimum: Number.MIN_VALUE,
  });
  const gpuGate = requireDatum(envelope.gpuP95Gate, 'performance-envelope.json.gpuP95Gate', {
    unit: 'ms', labels: ['Gated'], minimum: Number.MIN_VALUE,
  });
  const deadlineGate = requireDatum(envelope.deadlineMissRatioGate, 'performance-envelope.json.deadlineMissRatioGate', {
    unit: 'ratio', labels: ['Gated'], minimum: 0, maximum: 1,
  });

  validateTraceSegment(trace.warmup, 'frame-trace.json.warmup', refreshPeriod, {
    minimumCpuSamples: 30,
    minimumPresentationSamples: 1,
  });
  validateTraceSegment(trace.cold, 'frame-trace.json.cold', refreshPeriod, {
    minimumCpuSamples: 1,
    minimumPresentationSamples: 1,
  });
  const sustained = validateTraceSegment(trace.sustained, 'frame-trace.json.sustained', refreshPeriod, {
    minimumCpuSamples: 120,
    minimumPresentationSamples: 120,
    measuredPresentation: true,
  });
  if (trace.gpuTimingAvailable !== true) throw new Error('performance PASS requires available GPU timestamp queries');
  const sampleFrames = requireDatum(trace.sampleFrames, 'frame-trace.json.sampleFrames', {
    labels: ['Measured'], minimum: 120,
  });
  if (!Number.isInteger(sampleFrames)) throw new Error('frame-trace.json.sampleFrames must be an integer');
  const resolveCount = requireDatum(trace.timestampResolveCount, 'frame-trace.json.timestampResolveCount', {
    labels: ['Measured'], minimum: 1,
  });
  if (!Number.isInteger(resolveCount) || resolveCount >= sampleFrames) {
    throw new Error('GPU timestamps must be resolved in batches rather than once per frame');
  }
  const mappingCadence = requireString(trace.timestampMappingCadence, 'frame-trace.json.timestampMappingCadence');
  if (/per[- ]?frame/i.test(mappingCadence)) throw new Error('timestamp mapping may not run per frame');
  const gpuSamples = requirePopulation(trace.gpuSamples, 'frame-trace.json.gpuSamples', {
    labels: ['Derived', 'Measured'],
    minimum: sampleFrames,
  });
  if (gpuSamples.length !== sampleFrames) throw new Error('GPU sample population must equal sampleFrames');
  const gpuP50 = requireDatum(trace.gpuP50, 'frame-trace.json.gpuP50', {
    unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0,
  });
  const gpuP95 = requireDatum(trace.gpuP95, 'frame-trace.json.gpuP95', {
    unit: 'ms', labels: ['Derived', 'Measured'], minimum: 0,
  });
  requireRecomputed(gpuP50, percentile(gpuSamples, 0.5), 'frame-trace.json.gpuP50');
  requireRecomputed(gpuP95, percentile(gpuSamples, 0.95), 'frame-trace.json.gpuP95');
  const renderTimestamp = requireDatum(trace.renderTimestamp, 'frame-trace.json.renderTimestamp', {
    unit: 'ms', labels: ['Measured'], minimum: Number.MIN_VALUE,
  });
  if (!/timestamp/i.test(trace.renderTimestamp.source)) throw new Error('GPU p95 source must identify timestamp queries');
  requireRecomputed(renderTimestamp, gpuP95, 'frame-trace.json.renderTimestamp');
  const cadence = requireDatum(trace.presentationCadence, 'frame-trace.json.presentationCadence', {
    unit: 'frame/s', labels: ['Measured'], minimum: Number.MIN_VALUE,
  });
  if (!/requestAnimationFrame|rAF/i.test(trace.presentationCadence.source) || cadence <= 0) {
    throw new Error('performance PASS requires measured requestAnimationFrame presentation cadence');
  }
  const excluded = requireArray(trace.excludedPhases, 'frame-trace.json.excludedPhases', 2).join(' ');
  if (!/initialization/i.test(excluded) || !/compilation/i.test(excluded)) {
    throw new Error('performance trace must exclude initialization and compilation warm-up phases');
  }
  validateStageAttribution(trace.gpuStageAttribution, gpuSamples, sampleFrames);
  if (sustained.cpuP95 > cpuGate) throw new Error('performance CPU p95 exceeds its declared gate');
  if (gpuP95 > gpuGate) throw new Error('performance GPU p95 exceeds its declared gate');
  if (sustained.deadlineMissRatio > deadlineGate) throw new Error('performance deadline-miss ratio exceeds its declared gate');
  validateGovernor(json['quality-governor.json']);
  return true;
}

function linearSlope(values) {
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < count; index += 1) {
    covariance += (index - meanX) * (values[index] - meanY);
    variance += (index - meanX) ** 2;
  }
  return variance === 0 ? 0 : covariance / variance;
}

export function assertLifecycleClaimEvidence(json, manifest) {
  if (manifest?.claimVerdicts?.lifecycleStability !== 'PASS') return true;
  const loop = requireRecord(json['leak-loop.json'], 'leak-loop.json');
  const operations = requireArray(loop.operations, 'leak-loop.json.operations', 1).join(' ').toLowerCase();
  for (const operation of ['create', 'resize', 'mode', 'tier', 'dispose']) {
    if (!operations.includes(operation)) throw new Error(`lifecycle operation plan omits ${operation}`);
  }
  const cycles = requireDatum(loop.cycles, 'leak-loop.json.cycles', {
    labels: ['Measured'], minimum: 50, maximum: 100,
  });
  if (!Number.isInteger(cycles)) throw new Error('leak-loop.json.cycles must be an integer');
  const snapshots = requireArray(loop.cycleSnapshots, 'leak-loop.json.cycleSnapshots', cycles);
  if (snapshots.length !== cycles) throw new Error('lifecycle snapshot count must exactly equal cycles');
  const retainedTargets = [];
  const retainedStorage = [];
  for (const [index, snapshot] of snapshots.entries()) {
    requireRecord(snapshot, `leak-loop.json.cycleSnapshots[${index}]`);
    if (snapshot.rowType !== 'settled-lifecycle-cycle-v2' || snapshot.disposeStatus !== 'PASS') {
      throw new Error(`lifecycle cycle ${index} is not a successful typed settled row`);
    }
    const cycle = requireDatum(snapshot.cycle, `leak-loop.json.cycleSnapshots[${index}].cycle`, {
      labels: ['Measured'], minimum: 0,
    });
    if (cycle !== index) throw new Error(`lifecycle cycle ${index} has a discontinuous index`);
    for (const key of ['beforeRendererBytes', 'afterRendererBytes', 'targetBytes', 'storageBytes']) {
      requireDatum(snapshot[key], `leak-loop.json.cycleSnapshots[${index}].${key}`, {
        labels: ['Measured'], minimum: 0,
      });
    }
    if (numericValue(snapshot.afterRendererBytes, `leak-loop.json.cycleSnapshots[${index}].afterRendererBytes`) !== 0) {
      throw new Error(`lifecycle cycle ${index} retained renderer memory after disposal`);
    }
    const target = requireDatum(snapshot.retainedTargetBytes, `leak-loop.json.cycleSnapshots[${index}].retainedTargetBytes`, {
      labels: ['Measured'], minimum: 0,
    });
    const storage = requireDatum(snapshot.retainedStorageBytes, `leak-loop.json.cycleSnapshots[${index}].retainedStorageBytes`, {
      labels: ['Measured'], minimum: 0,
    });
    const settleFrames = requireDatum(snapshot.settleAnimationFrames, `leak-loop.json.cycleSnapshots[${index}].settleAnimationFrames`, {
      labels: ['Measured'], minimum: 2,
    });
    if (!Number.isInteger(settleFrames)) throw new Error(`lifecycle cycle ${index} settleAnimationFrames must be an integer`);
    const zeroCountFields = {
      retainedListenerCount: 'listener',
      retainedControlCount: 'control',
      retainedMaterialCount: 'material',
      postDisposeErrorCount: 'post-disposal error',
    };
    for (const [key, label] of Object.entries(zeroCountFields)) {
      const retained = requireDatum(snapshot[key], `leak-loop.json.cycleSnapshots[${index}].${key}`, {
        labels: ['Measured'], minimum: 0,
      });
      if (!Number.isInteger(retained) || retained !== 0) {
        throw new Error(`lifecycle cycle ${index} retained ${label} state`);
      }
    }
    const rendererStateDisposition = requireString(
      snapshot.rendererStateDisposition,
      `leak-loop.json.cycleSnapshots[${index}].rendererStateDisposition`,
    );
    if (!['RESTORED', 'OWNED_RENDERER_DISPOSED'].includes(rendererStateDisposition)) {
      throw new Error(`lifecycle cycle ${index} has no truthful renderer-state disposition`);
    }
    const rendererStateBeforeDigest = requireString(
      snapshot.rendererStateBeforeDigest,
      `leak-loop.json.cycleSnapshots[${index}].rendererStateBeforeDigest`,
    );
    const rendererStateAfterDigest = requireString(
      snapshot.rendererStateAfterDigest,
      `leak-loop.json.cycleSnapshots[${index}].rendererStateAfterDigest`,
    );
    if (![rendererStateBeforeDigest, rendererStateAfterDigest].every((value) => /^sha256:[0-9a-f]{64}$/.test(value))) {
      throw new Error(`lifecycle cycle ${index} has an invalid renderer-state snapshot digest`);
    }
    if (rendererStateDisposition === 'RESTORED' && rendererStateBeforeDigest !== rendererStateAfterDigest) {
      throw new Error(`lifecycle cycle ${index} did not restore its renderer-state snapshot`);
    }
    if (requireBoolean(snapshot.deviceLossObserved, `leak-loop.json.cycleSnapshots[${index}].deviceLossObserved`) !== false) {
      throw new Error(`lifecycle cycle ${index} observed device loss`);
    }
    if (target !== 0 || storage !== 0) throw new Error(`lifecycle cycle ${index} retained lab-owned GPU resources`);
    retainedTargets.push(target);
    retainedStorage.push(storage);
  }
  for (const resource of ['targetBytes', 'storageBytes']) {
    const before = requireDatum(loop.before?.[resource], `leak-loop.json.before.${resource}`, { minimum: 0 });
    const after = requireDatum(loop.after?.[resource], `leak-loop.json.after.${resource}`, { minimum: 0 });
    const gate = requireDatum(loop.gates?.[resource], `leak-loop.json.gates.${resource}`, {
      labels: ['Gated'], minimum: 0,
    });
    if (after - before > gate) throw new Error(`${resource} grew beyond its lifecycle gate`);
  }
  const targetSlope = requireDatum(loop.trend?.targetBytesPerCycle, 'leak-loop.json.trend.targetBytesPerCycle', {
    labels: ['Measured'],
  });
  const storageSlope = requireDatum(loop.trend?.storageBytesPerCycle, 'leak-loop.json.trend.storageBytesPerCycle', {
    labels: ['Measured'],
  });
  requireRecomputed(targetSlope, linearSlope(retainedTargets), 'leak-loop.json.trend.targetBytesPerCycle');
  requireRecomputed(storageSlope, linearSlope(retainedStorage), 'leak-loop.json.trend.storageBytesPerCycle');
  if (!Array.isArray(loop.deviceErrors) || loop.deviceErrors.length !== 0) {
    throw new Error('lifecycle evidence contains GPU device errors');
  }
  if (loop.verdict !== 'PASS') throw new Error('lifecycle PASS requires leak-loop.json verdict PASS');
  return true;
}
