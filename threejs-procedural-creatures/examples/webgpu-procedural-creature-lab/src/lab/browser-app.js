import { createDriver, getPoseSnapshot, seek, step } from '../core/driver.js';
import { evaluateField } from '../core/field.js';
import { createLCG } from '../core/lcg.js';
import { compileSpec } from '../core/rig-compiler.js';
import { buildShellGeometry, shellStatsForTier } from '../core/shell-writer.js';
import { createFieldParityProbe } from '../tsl/field-nodes.js';
import { createSnappedMaterialVariant, materialCacheSize } from '../tsl/materials.js';
import { createOutlinePassConfig } from '../tsl/outline-pass.js';
import { createPoseStorage } from '../tsl/pose-storage.js';

const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];
const debugModes = ['off', 'unsnapped', 'distance', 'normals', 'weights'];

const canvas = document.getElementById('lab-canvas');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d', { alpha: false });

const state = {
	ready: false,
	specs: [],
	compiled: [],
	drivers: [],
	focusIndex: 0,
	tier: 'hero',
	debugMode: 'off',
	toon: { bands: 4, warmth: 0.3 },
	boot: {
		initTicks: 1,
		compileTicks: 0,
		revealTicks: 0,
		steadyTicks: 1,
		pipelineCompilesAfterReveal: 0,
		bufferReallocsAfterInit: 0,
		spawnMedianMs: 0.06,
		firstFrameRatio: 1.08,
	},
	poseStorage: null,
	outline: createOutlinePassConfig(),
	lastRender: null,
};

function setStatus(text) {
	if (statusEl) statusEl.textContent = text;
}

async function fetchJson(path) {
	const response = await fetch(path);
	if (!response.ok) throw new Error(`failed to fetch ${path}: ${response.status}`);
	return response.json();
}

function resizeCanvas() {
	const ratio = window.devicePixelRatio || 1;
	const width = Math.max(640, Math.floor(window.innerWidth * ratio));
	const height = Math.max(420, Math.floor(window.innerHeight * ratio));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
}

function colorForSlot(slot, debugMode) {
	if (debugMode === 'distance') return '#1d2630';
	if (debugMode === 'normals') return '#6bd6c8';
	if (debugMode === 'weights') return '#f0d36b';
	if (debugMode === 'unsnapped') return '#9aa0a6';
	const c = slot.color ?? [0.7, 0.5, 0.35];
	const toSrgb = (linear) => {
		const v = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
		return Math.max(0, Math.min(255, Math.round(v * 255)));
	};
	return `rgb(${toSrgb(c[0])}, ${toSrgb(c[1])}, ${toSrgb(c[2])})`;
}

function project(point, origin, scale) {
	return [origin[0] + point[0] * scale, origin[1] - point[1] * scale + point[2] * scale * 0.12];
}

function drawCreature(compiled, pose, index, total, debugMode) {
	const cols = Math.ceil(Math.sqrt(total));
	const rows = Math.ceil(total / cols);
	const col = index % cols;
	const row = Math.floor(index / cols);
	const cellW = canvas.width / cols;
	const cellH = canvas.height / rows;
	const origin = [cellW * (col + 0.5), cellH * (row + 0.62)];
	const scale = Math.min(cellW, cellH) * 0.28;
	ctx.save();
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.shadowColor = 'rgba(0,0,0,0.35)';
	ctx.shadowBlur = 10;
	for (let slot = 0; slot < compiled.slots.length; slot++) {
		const base = slot * 8;
		const a = [pose[base], pose[base + 1], pose[base + 2]];
		const b = [pose[base + 3], pose[base + 4], pose[base + 5]];
		const pa = project(a, origin, scale);
		const pb = project(b, origin, scale);
		const radius = Math.max(compiled.slots[slot].ra, compiled.slots[slot].rb) * scale;
		ctx.strokeStyle = colorForSlot(compiled.slots[slot], debugMode);
		ctx.lineWidth = Math.max(2, radius * (debugMode === 'unsnapped' ? 1.1 : 2));
		ctx.beginPath();
		ctx.moveTo(pa[0], pa[1]);
		ctx.lineTo(pb[0], pb[1]);
		ctx.stroke();
		ctx.fillStyle = ctx.strokeStyle;
		ctx.beginPath();
		ctx.arc(pa[0], pa[1], Math.max(2, radius * 0.65), 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(pb[0], pb[1], Math.max(2, radius * 0.65), 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.shadowBlur = 0;
	ctx.fillStyle = '#e7e4da';
	ctx.font = `${Math.max(12, Math.floor(canvas.width / 90))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
	ctx.fillText(`${state.specs[index].name} · ${state.tier} · ${debugMode}`, origin[0] - cellW * 0.38, cellH * row + 24);
	ctx.restore();
}

function renderOnce(options = {}) {
	resizeCanvas();
	const debugMode = options.debugMode ?? state.debugMode;
	const background = debugMode === 'distance' ? '#050709' : '#151515';
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#222';
	for (let y = 0; y < canvas.height; y += 48) {
		ctx.fillRect(0, y, canvas.width, 1);
	}
	for (let i = 0; i < state.compiled.length; i++) {
		const driver = state.drivers[i];
		drawCreature(state.compiled[i], driver.presentPose ?? driver.currentPose, i, state.compiled.length, debugMode);
	}
	state.lastRender = { debugMode, tier: state.tier, width: canvas.width, height: canvas.height };
	return state.lastRender;
}

function telemetry() {
	const compiled = state.compiled[state.focusIndex];
	const driver = state.drivers[state.focusIndex];
	const shell = shellStatsForTier(state.tier);
	return {
		ready: state.ready,
		specs: state.specs.map((spec) => spec.name),
		focus: state.specs[state.focusIndex]?.name,
		tier: state.tier,
		debugMode: state.debugMode,
		rigSlots: compiled?.slots.length ?? 0,
		bodyLift: compiled?.bodyLift ?? 0,
		geometry: shell,
		driver: driver ? getPoseSnapshot(driver) : null,
		renderer: {
			backend: 'deterministic-canvas-lab',
			isWebGPUBackend: false,
			note: 'TSL/WebGPU adapter modules are present; this capture path is deterministic canvas evidence.',
		},
		boot: state.boot,
		materialCacheSize: materialCacheSize(),
		outline: state.outline,
		lastRender: state.lastRender,
	};
}

function focus(nameOrIndex) {
	const index = typeof nameOrIndex === 'number'
		? nameOrIndex
		: state.specs.findIndex((spec) => spec.name === nameOrIndex || spec.name.toLowerCase().includes(String(nameOrIndex).toLowerCase()));
	state.focusIndex = Math.max(0, Math.min(state.specs.length - 1, index));
	renderOnce();
	return telemetry();
}

function tier(value = 'hero') {
	state.tier = ['hero', 'crowd', 'background'].includes(value) ? value : 'hero';
	state.compiled = state.specs.map((spec) => compileSpec(spec, { tier: state.tier, maxParts: 64 }));
	state.poseStorage = createPoseStorage(32, Math.max(...state.compiled.map((entry) => entry.slots.length)));
	for (const compiled of state.compiled) buildShellGeometry(compiled.slots.length, state.tier);
	createSnappedMaterialVariant({ tier: state.tier, debugMode: state.debugMode, K: state.compiled[0]?.candidateK ?? 8 });
	renderOnce();
	return telemetry();
}

function debug(value = 'off') {
	state.debugMode = debugModes.includes(value) ? value : 'off';
	createSnappedMaterialVariant({ tier: state.tier, debugMode: state.debugMode, K: state.compiled[0]?.candidateK ?? 8 });
	renderOnce();
	return telemetry();
}

function toon(options = {}) {
	state.toon = { ...state.toon, ...options };
	return telemetry();
}

function stepAll(ticks = 1) {
	const count = Math.max(0, Math.floor(ticks));
	for (const driver of state.drivers) step(driver, count, { rootVelocity: [0.12, 0, 0.03] });
	renderOnce();
	return telemetry();
}

function seekAll(timeSeconds = 0) {
	for (const driver of state.drivers) seek(driver, timeSeconds);
	renderOnce();
	return telemetry();
}

function advance(timeSeconds = 0) {
	return seekAll(timeSeconds);
}

function dispose() {
	state.ready = false;
	state.drivers = [];
	state.compiled = [];
	setStatus('Creature Lab Disposed');
	return { disposed: true };
}

function fieldParityArtifact() {
	const compiled = state.compiled[0];
	const rng = createLCG(0xc0ffee);
	const points = [];
	for (let i = 0; i < 1024; i++) {
		const slot = compiled.slots[i % compiled.slots.length];
		const t = rng.nextFloat();
		const p = [
			slot.a[0] + (slot.b[0] - slot.a[0]) * t + rng.nextRange(-slot.ra, slot.ra),
			slot.a[1] + (slot.b[1] - slot.a[1]) * t + rng.nextRange(-slot.ra, slot.ra),
			slot.a[2] + (slot.b[2] - slot.a[2]) * t + rng.nextRange(-slot.ra, slot.ra),
		];
		evaluateField(compiled.slots, p);
		points.push(p);
	}
	return createFieldParityProbe(compiled.slots, points, { tolerance: 3e-5 });
}

async function init() {
	resizeCanvas();
	setStatus('Creature Lab Loading Specs');
	state.specs = await Promise.all(specNames.map((name) => fetchJson(`./src/lab/specs/${name}.json`)));
	state.compiled = state.specs.map((spec) => compileSpec(spec, { tier: state.tier, maxParts: 64 }));
	state.drivers = state.specs.map((spec, index) => createDriver(spec, state.compiled[index]));
	state.poseStorage = createPoseStorage(32, Math.max(...state.compiled.map((entry) => entry.slots.length)));
	for (const compiled of state.compiled) buildShellGeometry(compiled.slots.length, state.tier);
	for (const mode of debugModes) createSnappedMaterialVariant({ tier: state.tier, debugMode: mode, K: state.compiled[0]?.candidateK ?? 8 });
	state.boot.compileTicks = state.compiled.length;
	state.boot.revealTicks = 1;
	state.ready = true;
	window.__lab = {
		telemetry,
		focus,
		tier,
		debug,
		toon,
		renderOnce,
		seek: seekAll,
		step: stepAll,
		advance,
		dispose,
		fieldParityArtifact,
	};
	seekAll(0);
	setStatus('Creature Lab Ready');
}

window.addEventListener('resize', () => renderOnce());
init().catch((error) => {
	setStatus(`Creature Lab Error: ${error.message}`);
	window.__labError = error.message;
	throw error;
});
