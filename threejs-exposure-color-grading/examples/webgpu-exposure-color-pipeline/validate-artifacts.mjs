import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareGeneratedRgbaPngs } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';

const outputIndex = process.argv.indexOf( '--output' );
const repoRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '../../..' );
const output = resolve( outputIndex >= 0 ? process.argv[ outputIndex + 1 ] : resolve( repoRoot, 'artifacts/visual-validation/webgpu-exposure-color-pipeline-v2' ) );
const required = [
	'capture-contract.json',
	'pipeline-graph.json',
	'storage-resources.json',
	'mechanism-metrics.json',
	'exposure-readback.json',
	'images/final.design.png',
	'images/meter-source.png',
	'images/histogram-percentiles.png',
	'images/meter-mask.png',
	'images/tone-map.png',
	'images/lut.png',
	'images/gray-card.final.png',
	'images/adaptation.bright.png',
	'images/adaptation.recovery.png',
	'images/seed-0001.final.png',
	'images/seed-9e3779b9.final.png',
	'images/mask-baseline.final.png',
	'images/masked-ui.final.png'
];
for ( const path of required ) await access( resolve( output, path ) );
const pipeline = JSON.parse( await readFile( resolve( output, 'pipeline-graph.json' ), 'utf8' ) );
const contract = JSON.parse( await readFile( resolve( output, 'capture-contract.json' ), 'utf8' ) );
const resources = JSON.parse( await readFile( resolve( output, 'storage-resources.json' ), 'utf8' ) );
const metrics = JSON.parse( await readFile( resolve( output, 'mechanism-metrics.json' ), 'utf8' ) );
const readback = JSON.parse( await readFile( resolve( output, 'exposure-readback.json' ), 'utf8' ) );
if ( contract.schemaVersion !== 2 || ! [ 'correctness', 'performance' ].includes( contract.profile ) ) throw new Error( 'Exposure capture contract is invalid.' );
if ( pipeline.finalToneMapOwner !== 'toneMapping() node' ) throw new Error( 'Artifact has the wrong tone-map owner.' );
if ( pipeline.finalOutputTransformOwner !== 'renderOutput() node' ) throw new Error( 'Artifact has the wrong output-transform owner.' );
if ( ! resources.resources.some( ( resource ) => resource.id === 'histogram-counters' ) ) throw new Error( 'Full-tier artifact omitted histogram storage.' );
if ( metrics.verdict !== 'INSUFFICIENT_EVIDENCE' && metrics.verdict !== 'PASS' ) throw new Error( `Invalid metrics verdict ${ metrics.verdict }.` );
const [ keyLuminance, targetEV, currentEV ] = readback.gray.floatState;
if ( ! [ keyLuminance, targetEV, currentEV ].every( Number.isFinite ) ) throw new Error( 'Exposure GPU readback contains non-finite state.' );
if ( Math.abs( keyLuminance - readback.cpuOracle.keyLuminance ) > 0.005 ) throw new Error( `Gray-card GPU/CPU key mismatch: ${ keyLuminance }.` );
if ( Math.abs( targetEV - readback.cpuOracle.targetEV ) > 0.05 ) throw new Error( `Gray-card target EV mismatch: ${ targetEV }.` );
const histogramState = readback.gray.histogramState;
const histogramPrefix = readback.gray.histogramPrefix;
if ( ! histogramState || ! histogramPrefix ) throw new Error( 'Full-tier GPU readback omitted weighted histogram state.' );
if ( histogramState[ 0 ] <= 0 || histogramPrefix.at( - 1 ) !== histogramState[ 0 ] ) throw new Error( 'Weighted histogram prefix does not reconcile with its GPU total.' );
if ( readback.gray.dispatchCounts.meterStages <= 0 ) throw new Error( 'GPU readback reports no meter dispatches.' );
if ( ! ( readback.bright.floatState[ 1 ] < readback.gray.floatState[ 1 ] ) ) throw new Error( 'Bright-window target EV did not move downward.' );
if ( Math.abs( readback.recovery.floatState[ 2 ] ) >= Math.abs( readback.bright.floatState[ 2 ] ) ) throw new Error( 'Exposure recovery did not move current EV toward gray-card calibration.' );
const seedDifference = compareGeneratedRgbaPngs(
	await readFile( resolve( output, 'images/seed-0001.final.png' ) ),
	await readFile( resolve( output, 'images/seed-9e3779b9.final.png' ) )
);
if ( seedDifference.ratio <= 0.001 || seedDifference.maxChannelDelta <= 2 ) throw new Error( 'Baseline and stress exposure seeds are visually identical.' );
const maskImageDifference = compareGeneratedRgbaPngs(
	await readFile( resolve( output, 'images/mask-baseline.final.png' ) ),
	await readFile( resolve( output, 'images/masked-ui.final.png' ) )
);
if ( maskImageDifference.ratio <= 0.001 || maskImageDifference.maxChannelDelta <= 8 ) throw new Error( 'Masked UI fixture is not visibly present.' );
const maskedUiTargetDelta = Math.abs( readback.maskBaseline.floatState[ 1 ] - readback.maskedUi.floatState[ 1 ] );
if ( ! Number.isFinite( maskedUiTargetDelta ) || maskedUiTargetDelta > 0.03 ) throw new Error( `Excluded UI perturbed target EV by ${ maskedUiTargetDelta }.` );
console.log( JSON.stringify( { pass: true, output, metricVerdict: metrics.verdict, gpuReadbackOracle: { keyLuminance, targetEV, currentEV, weightedHistogramTotal: histogramState[ 0 ] }, seedDifference, meteringMask: { targetEvDelta: maskedUiTargetDelta, imageDifference: maskImageDifference } }, null, 2 ) );
