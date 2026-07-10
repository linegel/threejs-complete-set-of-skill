const EXCLUSIVE_OWNER_KEYS = Object.freeze([
  'renderer',
  'renderPipeline',
  'toneMap',
  'outputTransform',
  'cameraState',
  'jitter',
  'exposure',
  'weather',
  'time',
]);

export function assertRuntimeOwnership(graph) {
  if (!graph || typeof graph !== 'object') throw new TypeError('runtime graph is required');
  if (!graph.owners || typeof graph.owners !== 'object') throw new TypeError('runtime graph owners are required');

  const errors = [];
  for (const key of EXCLUSIVE_OWNER_KEYS) {
    const owner = graph.owners[key];
    if (owner === undefined) continue;
    if (typeof owner !== 'string' || owner.length === 0 || owner.includes(',')) {
      errors.push(`${key} must have exactly one named owner`);
    }
  }

  const signalProducers = new Map();
  for (const signal of graph.signals ?? []) {
    if (!signal?.id || !signal?.producer) {
      errors.push('every runtime signal requires an id and producer');
      continue;
    }
    const previous = signalProducers.get(signal.id);
    if (previous && previous !== signal.producer) {
      errors.push(`signal ${signal.id} has duplicate producers: ${previous}, ${signal.producer}`);
    }
    signalProducers.set(signal.id, signal.producer);
  }

  if (!graph.finalToneMapOwner) errors.push('finalToneMapOwner is required');
  if (!graph.finalOutputTransformOwner) errors.push('finalOutputTransformOwner is required');
  if (errors.length > 0) throw new Error(`runtime ownership invalid:\n- ${errors.join('\n- ')}`);
  return true;
}
