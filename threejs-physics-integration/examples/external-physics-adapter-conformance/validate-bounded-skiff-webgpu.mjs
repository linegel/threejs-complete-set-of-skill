import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GPU_SKIFF_LAYOUT, GPU_SKIFF_PARAMETERS } from './bounded-skiff-webgpu.js';

const directory = dirname( fileURLToPath( import.meta.url ) );
const source = readFileSync( join( directory, 'bounded-skiff-webgpu.js' ), 'utf8' );
const app = readFileSync( join( directory, 'bounded-skiff-webgpu-app.js' ), 'utf8' );
const html = readFileSync( join( directory, 'canonical-targets/mechanism/bounded-gpu-skiff-reference/index.html' ), 'utf8' );

assert.equal( GPU_SKIFF_LAYOUT.stateRecords, 4, 'GPU coupled state layout drifted' );
assert.equal( GPU_SKIFF_LAYOUT.stateBytes, 64, 'GPU coupled state byte accounting drifted' );
assert.equal( GPU_SKIFF_PARAMETERS.fixedTimeStepSeconds, 1 / 120, 'GPU skiff fixed step drifted' );
assert.equal( GPU_SKIFF_PARAMETERS.boundedCorrectionIterations, 2, 'GPU coupling is not scheduler-bounded at two corrections' );
assert.equal( GPU_SKIFF_PARAMETERS.quadratureCount, 9, 'GPU hydrostatic quadrature drifted' );
assert.ok( GPU_SKIFF_PARAMETERS.rollRightingMomentNmPerRadian > 0 && GPU_SKIFF_PARAMETERS.pitchRightingMomentNmPerRadian > 0, 'GPU hull omits waterplane righting closure' );
assert.ok( GPU_SKIFF_PARAMETERS.rollDampingNmsPerRadian > 0 && GPU_SKIFF_PARAMETERS.pitchDampingNmsPerRadian > 0, 'GPU hull omits angular damping closure' );
assert.match( source, /bounded-skiff:predict-sample-react-correct-commit/, 'GPU compute stage has no auditable graph name' );
assert.match( source, /diagnosticReadbackOnly:\s*true/, 'GPU readback is not explicitly diagnostic-only' );
assert.match( source, /frameCriticalReadbackCount:\s*0/, 'GPU route does not prove zero frame-critical readback' );
assert.match( source, /waterModel:\s*'bounded-analytic-plus-local-perturbation; not-SWE'/, 'GPU water claim boundary is missing' );
assert.match( app, /renderer\.backend\?\.isWebGPUBackend !== true/, 'native WebGPU backend gate is missing' );
assert.match( app, /Math\.min\( devicePixelRatio, 1\.5 \)/, 'DPR cap is missing from the bounded route' );
assert.match( app, /closedSkiffHullGeometry/, 'closed skiff visual hull is missing' );
assert.match( html, /CAPTURE GPU DIAGNOSTICS/, 'explicit diagnostic readback control is missing' );
assert.match( html, /data-camera="hero"/, 'hero camera control is missing' );
assert.match( html, /data-camera="broadside"/, 'broadside camera control is missing' );
assert.match( html, /data-camera="overhead"/, 'overhead camera control is missing' );
assert.match( html, /it is not SWE, CFD, breaking, or planing physics/, 'visible claim boundary is missing' );

console.log( 'bounded skiff WebGPU source contract passed: 96 B hot state, 120 Hz, 2 corrections, 9 hull samples, 3 cameras' );
