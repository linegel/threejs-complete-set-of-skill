import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertNonBlankGeneratedPng,
	compareGeneratedRgbaPngs,
	decodeGeneratedRgbaPixels
} from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';

function assert( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

const outputIndex = process.argv.indexOf( '--output' );
const repoRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '../../..' );
const output = resolve( outputIndex >= 0 ? process.argv[ outputIndex + 1 ] : resolve( repoRoot, 'artifacts/visual-validation/webgpu-image-pipeline-v2' ) );
const required = [
	'capture-contract.json',
	'pipeline-before-reset.json',
	'pipeline-graph.json',
	'resident-resources.json',
	'renderer-info.json',
	'mechanism-metrics.json',
	'exposure-readback.json',
	'images/final.design.png',
	'images/no-post.design.png',
	'images/diagnostics.mosaic.png',
	'images/depth.raw.png',
	'images/depth.view-z.png',
	'images/depth.linear-view-z.png',
	'images/normal.png',
	'images/emissive.png',
	'images/ao.diagnostic-only.png',
	'images/bloom.png',
	'images/exposure.png',
	'images/velocity.static.png',
	'images/velocity.moving-positive-x.png',
	'images/temporal.current.png',
	'images/temporal.history.png',
	'images/temporal.resolved.png',
	'images/temporal.after-reset.current.png',
	'images/temporal.after-reset.resolved.png',
	'images/camera.near.png',
	'images/camera.design.png',
	'images/camera.far.png',
	'images/seed-0001.final.png',
	'images/seed-9e3779b9.final.png',
	'images/temporal.t000.png',
	'images/temporal.t001.png',
	'images/odd-641x359.final.png'
];
for ( const path of required ) await access( resolve( output, path ) );

async function json( path ) {

	return JSON.parse( await readFile( resolve( output, path ), 'utf8' ) );

}

async function png( path ) {

	const buffer = await readFile( resolve( output, path ) );
	return { buffer, ...decodeGeneratedRgbaPixels( buffer ) };

}

function meanAbsoluteRgbDelta( a, b ) {

	assert( a.width === b.width && a.height === b.height, 'Image comparison extent mismatch.' );
	let sum = 0;
	for ( let index = 0; index < a.pixels.length; index += 4 ) {

		sum += Math.abs( a.pixels[ index ] - b.pixels[ index ] );
		sum += Math.abs( a.pixels[ index + 1 ] - b.pixels[ index + 1 ] );
		sum += Math.abs( a.pixels[ index + 2 ] - b.pixels[ index + 2 ] );

	}
	return sum / ( a.width * a.height * 3 );

}

function velocityStatistics( image ) {

	let absoluteDeviation = 0;
	let active = 0;
	let signedX = 0;
	let positiveX = 0;
	let negativeX = 0;
	for ( let index = 0; index < image.pixels.length; index += 4 ) {

		const dx = image.pixels[ index ] - 128;
		const dy = image.pixels[ index + 1 ] - 128;
		absoluteDeviation += Math.abs( dx ) + Math.abs( dy );
		if ( Math.abs( dx ) + Math.abs( dy ) > 6 ) {

			active += 1;
			signedX += dx;
			if ( dx > 0 ) positiveX += dx;
			else negativeX -= dx;

		}

	}
	const pixels = image.width * image.height;
	return {
		meanAbsoluteDeviation: absoluteDeviation / ( pixels * 2 ),
		active,
		activeRatio: active / pixels,
		meanActiveX: active > 0 ? signedX / active : 0,
		positiveX,
		negativeX
	};

}

function depthOracle( raw, encodedViewZ, descriptor ) {

	assert( raw.width === encodedViewZ.width && raw.height === encodedViewZ.height, 'Depth diagnostic extents differ.' );
	const near = descriptor.near;
	const far = descriptor.far;
	assert( Number.isFinite( near ) && Number.isFinite( far ) && near > 0 && far > near, 'Invalid captured camera clip planes.' );
	const clearCode = descriptor.reversedDepthBuffer ? 0 : 255;
	let samples = 0;
	let sumError = 0;
	let maxError = 0;
	for ( let index = 0; index < raw.pixels.length; index += 4 ) {

		const rawCode = raw.pixels[ index ];
		if ( Math.abs( rawCode - clearCode ) <= 2 ) continue;
		const depth = rawCode / 255;
		const viewZ = descriptor.reversedDepthBuffer
			? near * far / ( ( near - far ) * depth - near )
			: near * far / ( ( far - near ) * depth - far );
		const normalizedDistance = Math.min( 1, Math.max( 0, ( - viewZ - near ) / ( far - near ) ) );
		const expected = ( 1 - normalizedDistance ) * 255;
		const error = Math.abs( encodedViewZ.pixels[ index ] - expected );
		if ( Number.isFinite( error ) ) {

			samples += 1;
			sumError += error;
			maxError = Math.max( maxError, error );

		}

	}
	return { samples, meanCodeError: samples > 0 ? sumError / samples : Infinity, maxCodeError: maxError };

}

const contract = await json( 'capture-contract.json' );
const beforeReset = await json( 'pipeline-before-reset.json' );
const pipeline = await json( 'pipeline-graph.json' );
const resources = await json( 'resident-resources.json' );
const renderer = await json( 'renderer-info.json' );
const metrics = await json( 'mechanism-metrics.json' );
const exposure = await json( 'exposure-readback.json' );
assert( contract.schemaVersion === 2, 'Capture contract is not schema v2.' );
assert( [ 'correctness', 'performance' ].includes( contract.profile ), `Unknown capture profile ${ contract.profile }.` );
assert( renderer.isWebGPUBackend === true, 'Artifact renderer is not a native WebGPU backend.' );
assert( pipeline.owners.renderer === 'canonical-image-pipeline', 'Artifact has the wrong renderer owner.' );
assert( pipeline.finalToneMapOwner === 'exposure-color-stage/toneMapping()', 'Artifact has the wrong tone-map owner.' );
assert( pipeline.finalOutputTransformOwner === 'exposure-color-stage/renderOutput()', 'Artifact has the wrong output-transform owner.' );
assert( pipeline.sceneSubmissions.filter( ( pass ) => pass.id === 'scenePass' ).reduce( ( sum, pass ) => sum + pass.count, 0 ) === 1, 'Primary graph does not have exactly one scene submission.' );
assert( pipeline.ao?.node === 'GTAONode' && pipeline.ao.application === 'diagnostic-only' && pipeline.ao.finalReachable === false, 'AO was promoted beyond the evidence-supported diagnostic boundary.' );
assert( beforeReset.temporal?.node === 'TRAANode', 'Temporal evidence does not use TRAANode.' );
assert( beforeReset.temporal?.historyDiagnostic === 'TRAANode.history', 'Temporal evidence does not reach the actual TRAANode history target.' );
assert( beforeReset.temporal?.resolvedDiagnostic === 'TRAANode.resolve', 'Temporal evidence does not reach the TRAANode resolve.' );
assert( pipeline.resetLog?.some( ( event ) => event.cause === contract.temporalResetCause && event.freshHistoryRequired === true ), 'Captured reset cause did not rebuild fresh temporal history.' );
assert( pipeline.dispatchCounts?.adaptation > 0 && pipeline.dispatchCounts?.meterStages > 0, 'Runtime graph reports no exposure compute work.' );
assert( pipeline.computeDispatches.includes( 'adaptExposureState' ) && pipeline.computeDispatches.length >= 4, 'Runtime compute dispatch inventory is incomplete.' );
assert( resources.attachments.includes( 'depth' ) && resources.attachments.includes( 'velocity' ), 'Runtime attachment inventory omitted depth or velocity.' );
assert( resources.attachmentRecords.every( ( attachment ) => attachment.owner === 'scenePass' && attachment.physicalBytes === null ), 'Attachment ownership or unmeasured physical-byte policy is inaccurate.' );
assert( resources.drawingBuffer.width === contract.viewport.width && resources.drawingBuffer.height === contract.viewport.height, 'Runtime drawing-buffer inventory disagrees with the capture contract.' );
assert( resources.persistentPrivateTargets.some( ( target ) => target.id === 'TRAANode.history' ), 'Runtime resource inventory omitted temporal history.' );
assert( resources.exposure?.storageBytes?.totalBytes > 0, 'Runtime resource inventory omitted exposure storage.' );
assert( resources.knownStorageBytes === resources.exposure.storageBytes.totalBytes, 'Known storage-byte ledger does not reconcile.' );
assert( resources.physicalResidencyVerdict === 'INSUFFICIENT_EVIDENCE', 'Unknown private allocations were presented as measured residency.' );
assert( metrics.captureProfile === contract.profile, 'Capture profile and metrics disagree.' );
assert( metrics.verdict === 'INSUFFICIENT_EVIDENCE', 'Correctness capture silently promoted unmeasured performance.' );
assert( exposure.floatState?.slice( 0, 3 ).every( Number.isFinite ), 'Integrated exposure state contains non-finite values.' );
assert( exposure.histogramState?.[ 0 ] > 0 && exposure.histogramPrefix?.at( - 1 ) === exposure.histogramState[ 0 ], 'Integrated weighted histogram readback does not reconcile.' );

const finalImage = await png( 'images/final.design.png' );
const diagnosticMosaic = await png( 'images/diagnostics.mosaic.png' );
const expectedExtent = contract.profile === 'performance' ? [ 1920, 1080 ] : [ 1200, 800 ];
assert( finalImage.width === expectedExtent[ 0 ] && finalImage.height === expectedExtent[ 1 ], 'Primary capture extent does not match its profile.' );
assertNonBlankGeneratedPng( finalImage.buffer, 'final.design.png' );
assertNonBlankGeneratedPng( diagnosticMosaic.buffer, 'diagnostics.mosaic.png' );
const mosaicDifference = compareGeneratedRgbaPngs( finalImage.buffer, diagnosticMosaic.buffer );
assert( mosaicDifference.ratio > 0.1 && mosaicDifference.maxChannelDelta > 8, 'Diagnostic mosaic duplicates the final image.' );

const oddImage = await png( 'images/odd-641x359.final.png' );
assert( oddImage.width === 641 && oddImage.height === 359, 'Odd-size readback does not cover 641x359.' );
assertNonBlankGeneratedPng( oddImage.buffer, 'odd-641x359.final.png' );

const baselineSeed = await png( 'images/seed-0001.final.png' );
const stressSeed = await png( 'images/seed-9e3779b9.final.png' );
const seedDifference = compareGeneratedRgbaPngs( baselineSeed.buffer, stressSeed.buffer );
assert( seedDifference.ratio > 0.001 && seedDifference.maxChannelDelta > 2, 'Baseline and stress seeds do not select distinct deterministic fixtures.' );

const rawDepth = await png( 'images/depth.raw.png' );
const viewZ = await png( 'images/depth.view-z.png' );
const linearDepth = await png( 'images/depth.linear-view-z.png' );
assertNonBlankGeneratedPng( rawDepth.buffer, 'depth.raw.png' );
assertNonBlankGeneratedPng( viewZ.buffer, 'depth.view-z.png' );
assertNonBlankGeneratedPng( linearDepth.buffer, 'depth.linear-view-z.png' );
assert( meanAbsoluteRgbDelta( rawDepth, viewZ ) > 0.5, 'View-Z diagnostic is indistinguishable from raw perspective depth.' );
const depthReconstruction = depthOracle( rawDepth, viewZ, pipeline.depth );
assert( depthReconstruction.samples > 1000, 'Depth reconstruction oracle has too few geometry samples.' );
assert( depthReconstruction.meanCodeError <= 8, `GPU view-Z reconstruction disagrees with the CPU projection oracle: ${ depthReconstruction.meanCodeError } code values.` );

const staticVelocity = await png( 'images/velocity.static.png' );
const movingVelocity = await png( 'images/velocity.moving-positive-x.png' );
const staticVelocityStats = velocityStatistics( staticVelocity );
const movingVelocityStats = velocityStatistics( movingVelocity );
assert( staticVelocityStats.meanAbsoluteDeviation <= 2.5, `Static velocity is not approximately zero: ${ staticVelocityStats.meanAbsoluteDeviation } code values.` );
assert( movingVelocityStats.activeRatio >= 0.001, 'Moving subject produced no measurable velocity coverage.' );
assert( movingVelocityStats.meanActiveX > 0 && movingVelocityStats.positiveX > movingVelocityStats.negativeX, 'Moving-positive-X fixture has the wrong signed velocity.' );
assert( meanAbsoluteRgbDelta( staticVelocity, movingVelocity ) > 0.05, 'Static and moving velocity diagnostics are indistinguishable.' );

const temporalCurrent = await png( 'images/temporal.current.png' );
const temporalHistory = await png( 'images/temporal.history.png' );
const temporalResolved = await png( 'images/temporal.resolved.png' );
for ( const [ label, image ] of [ [ 'current', temporalCurrent ], [ 'history', temporalHistory ], [ 'resolved', temporalResolved ] ] ) assertNonBlankGeneratedPng( image.buffer, `temporal.${ label }.png` );
assert( meanAbsoluteRgbDelta( temporalCurrent, temporalHistory ) > 0.02, 'Temporal history is a renamed current-frame capture.' );
const resetCurrent = await png( 'images/temporal.after-reset.current.png' );
const resetResolved = await png( 'images/temporal.after-reset.resolved.png' );
assertNonBlankGeneratedPng( resetCurrent.buffer, 'temporal.after-reset.current.png' );
assertNonBlankGeneratedPng( resetResolved.buffer, 'temporal.after-reset.resolved.png' );
const resetDelta = meanAbsoluteRgbDelta( resetCurrent, resetResolved );
assert( resetDelta <= 8, `First resolved frame after reset retained stale history: mean RGB delta ${ resetDelta }.` );
const temporalT000 = await png( 'images/temporal.t000.png' );
const temporalT001 = await png( 'images/temporal.t001.png' );
const temporalStepDifference = compareGeneratedRgbaPngs( temporalT000.buffer, temporalT001.buffer );
assert( temporalStepDifference.differingPixels > 50 && temporalStepDifference.maxChannelDelta > 0, 'Temporal sequence does not advance the authored motion state.' );

console.log( JSON.stringify( {
	pass: true,
	output,
	profile: contract.profile,
	runtimeVerdict: metrics.verdict,
	depthReconstruction,
	velocity: { static: staticVelocityStats, moving: movingVelocityStats },
	temporal: { historyCurrentMeanDelta: meanAbsoluteRgbDelta( temporalCurrent, temporalHistory ), resetCurrentResolvedMeanDelta: resetDelta },
	seedDifference,
	temporalStepDifference,
	diagnosticMosaicDifference: mosaicDifference
}, null, 2 ) );
