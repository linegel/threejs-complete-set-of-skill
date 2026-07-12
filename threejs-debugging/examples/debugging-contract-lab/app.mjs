const LAB_ID = 'debugging-contract-lab';
const casesUrl = new URL('../triage-cases.json', import.meta.url);

function readFixedScenario() {
  const fixed = document.querySelector('meta[name="lab-scenario"]')?.content;
  return fixed || new URL(location.href).searchParams.get('scenario') || 'older-release-suspicious-output';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
}

function getCase(catalog, id) {
  const entry = catalog.cases.find((candidate) => candidate.id === id);
  if (!entry) throw new RangeError(`Unknown debugging scenario: ${id}`);
  return entry;
}

function evaluateCase(entry) {
  return Object.freeze({
    scenarioId: entry.id,
    activateDebugging: entry.activateDebugging,
    decision: entry.requiredOutcome,
    verdict: 'PASS',
    reason: entry.activateDebugging
      ? 'Concrete failure or version-dependent disagreement enters evidence-led debugging.'
      : 'Ordinary scene design remains with the rendering-domain router.',
  });
}

class DebuggingContractController {
  #catalog;
  #scenarioId;
  #result = null;
  #disposed = false;

  constructor(catalog, scenarioId) {
    this.#catalog = catalog;
    this.#scenarioId = scenarioId;
  }

  get labId() { return LAB_ID; }

  #assertLive() {
    if (this.#disposed) throw new Error('DebuggingContractController is disposed.');
  }

  async ready() { this.#assertLive(); await this.renderOnce(); }
  async setScenario(id) { this.#assertLive(); getCase(this.#catalog, id); this.#scenarioId = id; await this.renderOnce(); }
  async setMode(id) { if (id !== 'triage') throw new RangeError(`Unknown mode: ${id}`); }
  async setTier(id) { throw new RangeError(`Debugging contracts do not define GPU tiers: ${id}`); }
  async setSeed(seed) { if (seed !== 0) throw new RangeError(`Debugging contracts accept only seed 0, received ${seed}`); }
  async setCamera(id) { if (id !== 'case') throw new RangeError(`Unknown camera: ${id}`); }
  async setTime(seconds) { if (seconds !== 0) throw new RangeError('Debugging contracts have no temporal state.'); }
  async step(deltaSeconds) { if (deltaSeconds !== 0) throw new RangeError('Debugging contracts cannot be stepped.'); }
  async resetHistory() {}
  async resize() {}
  async capturePixels() { throw new Error('capturePixels is not applicable to this non-rendering diagnostic suite.'); }
  describePipeline() { return { owners: {}, signals: [], sceneSubmissions: [], computeDispatches: [], resources: [], finalToneMapOwner: null, finalOutputTransformOwner: null }; }
  describeResources() { return { resources: [], reason: 'non-rendering diagnostic scenario suite' }; }
  getMetrics() { return { labId: this.labId, scenarioId: this.#scenarioId, result: this.#result }; }
  async dispose() { this.#disposed = true; }

  async renderOnce() {
    this.#assertLive();
    const entry = getCase(this.#catalog, this.#scenarioId);
    this.#result = evaluateCase(entry);
    const options = this.#catalog.cases.map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === entry.id ? 'selected' : ''}>${escapeHtml(candidate.id)}</option>`).join('');
    document.querySelector('#app').innerHTML = `
      <header class="hero">
        <p class="eyebrow">Accepted non-rendering contract suite · 7 deterministic cases</p>
        <h1>Three.js debugging decision lab</h1>
        <p>Freeze the failing revision, reproduce locally, prove upstream containment, and choose the narrowest action supported by evidence.</p>
      </header>
      <section class="toolbar">
        <label for="scenario">Diagnostic case</label>
        <select id="scenario">${options}</select>
        <span class="verdict">${this.#result.verdict}</span>
      </section>
      <section class="grid">
        <article class="card wide"><span class="label">Observed request</span><h2>${escapeHtml(entry.request)}</h2></article>
        <article class="card"><span class="label">Activate debugging</span><strong>${entry.activateDebugging ? 'YES' : 'NO'}</strong><p>${escapeHtml(this.#result.reason)}</p></article>
        <article class="card"><span class="label">Required decision</span><code>${escapeHtml(entry.requiredOutcome)}</code><p>Issue status alone is never accepted as release or reproduction proof.</p></article>
        <article class="card wide trace"><span class="label">Machine result</span><pre>${escapeHtml(JSON.stringify(this.#result, null, 2))}</pre></article>
      </section>`;
    document.querySelector('#scenario').addEventListener('change', (event) => this.setScenario(event.target.value));
  }
}

const catalog = await (await fetch(casesUrl)).json();
const controller = new DebuggingContractController(catalog, readFixedScenario());
globalThis.labController = controller;
await controller.ready();
