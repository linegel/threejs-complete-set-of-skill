import { readFile } from 'node:fs/promises';

import { assertLabelledNumerics, numericValue, validateNumericArray, validateNumericDatum } from '../numeric-evidence.js';
import { assertDistinctBundleFiles, resolveConfinedPath } from '../path-confinement.js';
import { assertNonBlankGeneratedPng, compareGeneratedRgbaPngs } from '../png.js';
import { getAlignedReadbackLayout } from '../readback.js';

export const EVIDENCE_SCHEMA_VERSION = 2;

export const CLAIM_VERDICTS = Object.freeze( [
	'PASS',
	'FAIL',
	'INSUFFICIENT_EVIDENCE',
	'NOT_CLAIMED'
] );

export const REQUIRED_V2_ARTIFACTS = Object.freeze( [
	'visual-contract.json',
	'evidence-manifest.json',
	'renderer-info.json',
	'pipeline-graph.json',
	'performance-envelope.json',
	'frame-trace.json',
	'quality-governor.json',
	'render-targets.json',
	'storage-resources.json',
	'resident-resources.json',
	'bandwidth-model.json',
	'visual-errors.json',
	'leak-loop.json',
	'mechanism-metrics.json'
] );

export const REQUIRED_V2_IMAGES = Object.freeze( [
	'images/final.design.png',
	'images/no-post.design.png',
	'images/diagnostics.mosaic.png',
	'images/camera.near.png',
	'images/camera.design.png',
	'images/camera.far.png',
	'images/seed-0001.final.png',
	'images/seed-9e3779b9.final.png',
	'images/temporal.t000.png',
	'images/temporal.t001.png'
] );

const CLAIM_CLASSES = Object.freeze( [
	'visualCorrectness',
	'mechanismCorrectness',
	'performanceCompliance',
	'gpuAttribution',
	'lifecycleStability'
] );

const OWNERSHIP_SINGLETONS = new Set( [
	'renderer',
	'render-pipeline',
	'tone-map',
	'output-transform'
] );

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) {

		throw new Error( `${ label } must be an object.` );

	}

}

function requireArray( value, label, minimumLength = 0 ) {

	if ( Array.isArray( value ) === false || value.length < minimumLength ) {

		throw new Error( `${ label } must be an array with at least ${ minimumLength } entries.` );

	}

}

function requireString( value, label ) {

	if ( typeof value !== 'string' || value.length === 0 ) throw new Error( `${ label } must be a non-empty string.` );

}

function requireBoolean( value, label ) {

	if ( typeof value !== 'boolean' ) throw new Error( `${ label } must be a boolean.` );

}

function requireKeys( object, keys, label ) {

	requireObject( object, label );
	for ( const key of keys ) {

		if ( Object.hasOwn( object, key ) === false ) throw new Error( `${ label } is missing required field "${ key }".` );

	}

}

function requireSchemaVersion( artifact, label ) {

	requireObject( artifact, label );
	if ( artifact.schemaVersion !== EVIDENCE_SCHEMA_VERSION ) {

		throw new Error( `${ label}.schemaVersion must equal ${ EVIDENCE_SCHEMA_VERSION }.` );

	}

}

function requireVerdict( value, label ) {

	if ( CLAIM_VERDICTS.includes( value ) === false ) {

		throw new Error( `${ label } must be PASS, FAIL, INSUFFICIENT_EVIDENCE, or NOT_CLAIMED.` );

	}

}

function requireLabelledArtifact( artifact, label ) {

	requireSchemaVersion( artifact, label );
	assertLabelledNumerics( artifact );

}

function validateClaimVerdicts( verdicts, bundleKind ) {

	requireKeys( verdicts, CLAIM_CLASSES, 'evidence-manifest.json.claimVerdicts' );

	for ( const claim of CLAIM_CLASSES ) {

		requireVerdict( verdicts[ claim ], `claimVerdicts.${ claim }` );

		if ( bundleKind === 'contract-fixture' && verdicts[ claim ] !== 'NOT_CLAIMED' ) {

			throw new Error( `Contract fixture cannot claim ${ claim }; its verdict must be NOT_CLAIMED.` );

		}

	}

}

function validateVisualContract( contract ) {

	requireLabelledArtifact( contract, 'visual-contract.json' );
	requireKeys( contract, [
		'contractRevision', 'subject', 'identity', 'invariants', 'requiredImages',
		'requiredDiagnostics', 'requiredMetrics', 'blockingFailures', 'allowedDivergences',
		'performanceClaims', 'imageComparisons'
	], 'visual-contract.json' );

	requireString( contract.contractRevision, 'visual-contract.json.contractRevision' );
	requireString( contract.subject, 'visual-contract.json.subject' );
	requireArray( contract.identity, 'visual-contract.json.identity', 1 );
	requireArray( contract.invariants, 'visual-contract.json.invariants', 1 );
	requireArray( contract.requiredImages, 'visual-contract.json.requiredImages', 1 );

	if ( contract.requiredImages.length === 1 && contract.requiredImages[ 0 ] === 'images/final.design.png' ) {

		throw new Error( 'final-only evidence is invalid; no-post and diagnostic captures are mandatory.' );

	}

	for ( const image of REQUIRED_V2_IMAGES ) {

		if ( contract.requiredImages.includes( image ) === false ) throw new Error( `visual-contract.json is missing required image ${ image }.` );

	}

	if ( contract.requiredImages.includes( 'images/no-post.design.png' ) === false ) {

		throw new Error( 'A final-only evidence contract is invalid; no-post and diagnostic evidence are mandatory.' );

	}

	for ( const [ index, invariant ] of contract.invariants.entries() ) {

		const label = `visual-contract.json.invariants[${ index }]`;
		requireKeys( invariant, [ 'id', 'statement', 'domain', 'truthSource', 'diagnostic', 'metric', 'gate', 'requiredArtifacts', 'blockingFailure' ], label );
		for ( const key of [ 'id', 'statement', 'domain', 'truthSource', 'diagnostic', 'metric', 'blockingFailure' ] ) requireString( invariant[ key ], `${ label }.${ key }` );
		validateNumericDatum( invariant.gate, `${ label }.gate` );
		requireArray( invariant.requiredArtifacts, `${ label }.requiredArtifacts`, 1 );

	}

	requireKeys( contract.performanceClaims, [ 'gpuTimingRequirement', 'claims' ], 'visual-contract.json.performanceClaims' );
	if ( [ 'required', 'not-claimed' ].includes( contract.performanceClaims.gpuTimingRequirement ) === false ) {

		throw new Error( 'visual-contract.json.performanceClaims.gpuTimingRequirement must be required or not-claimed.' );

	}

	requireArray( contract.imageComparisons, 'visual-contract.json.imageComparisons', 1 );
	for ( const [ index, comparison ] of contract.imageComparisons.entries() ) {

		const label = `visual-contract.json.imageComparisons[${ index }]`;
		requireKeys( comparison, [ 'id', 'baseline', 'candidate', 'maxDifferingRatio' ], label );
		requireString( comparison.id, `${ label }.id` );
		requireString( comparison.baseline, `${ label }.baseline` );
		requireString( comparison.candidate, `${ label }.candidate` );
		validateNumericDatum( comparison.maxDifferingRatio, `${ label }.maxDifferingRatio` );

	}

}

function validateEvidenceManifest( manifest ) {

	requireLabelledArtifact( manifest, 'evidence-manifest.json' );
	requireKeys( manifest, [
		'bundleKind', 'publishable', 'skill', 'sceneId', 'threeRevision', 'evidenceBundleId',
		'targetId', 'device', 'browser', 'os', 'gpuAdapter', 'displayRefresh',
		'targetPresentationRate', 'renderer', 'backend', 'qualityState', 'viewport',
		'camera', 'seed', 'time', 'assets', 'colorPipeline', 'stochasticMasks',
		'knownCompromises', 'pipelineGraphDigest', 'claimVerdicts'
	], 'evidence-manifest.json' );

	if ( [ 'browser-capture', 'contract-fixture' ].includes( manifest.bundleKind ) === false ) throw new Error( 'Unknown evidence bundleKind.' );
	requireBoolean( manifest.publishable, 'evidence-manifest.json.publishable' );
	if ( manifest.bundleKind === 'contract-fixture' && manifest.publishable !== false ) throw new Error( 'Fixture-only bundle cannot be publishable.' );
	if ( manifest.bundleKind === 'browser-capture' && manifest.publishable !== true ) throw new Error( 'Browser capture bundle must explicitly mark publishable true.' );
	if ( manifest.skill !== 'threejs-visual-validation' ) throw new Error( 'evidence-manifest.json skill id is wrong.' );
	if ( manifest.threeRevision !== '0.185.1' ) throw new Error( 'Canonical v2 evidence requires Three 0.185.1.' );
	for ( const key of [ 'sceneId', 'evidenceBundleId', 'targetId', 'device', 'browser', 'os', 'renderer', 'qualityState', 'seed', 'pipelineGraphDigest' ] ) requireString( manifest[ key ], `evidence-manifest.json.${ key }` );
	validateNumericDatum( manifest.displayRefresh, 'evidence-manifest.json.displayRefresh' );
	validateNumericDatum( manifest.targetPresentationRate, 'evidence-manifest.json.targetPresentationRate' );
	requireKeys( manifest.backend, [ 'isWebGPUBackend', 'initialized', 'timestampAvailable', 'unavailableReason', 'features', 'limits', 'deviceLostObserved', 'uncapturedErrors' ], 'evidence-manifest.json.backend' );
	requireBoolean( manifest.backend.isWebGPUBackend, 'evidence-manifest.json.backend.isWebGPUBackend' );
	requireBoolean( manifest.backend.initialized, 'evidence-manifest.json.backend.initialized' );
	requireBoolean( manifest.backend.timestampAvailable, 'evidence-manifest.json.backend.timestampAvailable' );

	if ( manifest.bundleKind === 'browser-capture' && ( manifest.backend.isWebGPUBackend !== true || manifest.backend.initialized !== true ) ) {

		throw new Error( 'Canonical browser capture requires initialized native WebGPU.' );

	}

	requireKeys( manifest.viewport, [ 'width', 'height', 'dpr' ], 'evidence-manifest.json.viewport' );
	for ( const key of [ 'width', 'height', 'dpr' ] ) validateNumericDatum( manifest.viewport[ key ], `evidence-manifest.json.viewport.${ key }` );
	requireKeys( manifest.camera, [ 'bookmark', 'matrixWorld', 'projectionMatrix', 'near', 'far' ], 'evidence-manifest.json.camera' );
	requireString( manifest.camera.bookmark, 'evidence-manifest.json.camera.bookmark' );
	validateNumericArray( manifest.camera.matrixWorld, 'evidence-manifest.json.camera.matrixWorld' );
	validateNumericArray( manifest.camera.projectionMatrix, 'evidence-manifest.json.camera.projectionMatrix' );
	validateNumericDatum( manifest.camera.near, 'evidence-manifest.json.camera.near' );
	validateNumericDatum( manifest.camera.far, 'evidence-manifest.json.camera.far' );
	requireKeys( manifest.time, [ 'fixed', 'seconds', 'frame' ], 'evidence-manifest.json.time' );
	requireBoolean( manifest.time.fixed, 'evidence-manifest.json.time.fixed' );
	validateNumericDatum( manifest.time.seconds, 'evidence-manifest.json.time.seconds' );
	validateNumericDatum( manifest.time.frame, 'evidence-manifest.json.time.frame' );
	validateClaimVerdicts( manifest.claimVerdicts, manifest.bundleKind );

}

function validateRendererInfo( rendererInfo, manifest ) {

	requireLabelledArtifact( rendererInfo, 'renderer-info.json' );
	requireKeys( rendererInfo, [
		'threeRevision', 'renderer', 'backend', 'outputColorSpace', 'toneMapping',
		'toneMappingExposure', 'sampleCount', 'depthMode', 'outputBufferType',
		'compatibilityMode', 'timestampSupport', 'adapterFeatures', 'adapterLimits',
		'initializationState', 'deviceErrors', 'rendererInfoSnapshots'
	], 'renderer-info.json' );
	if ( rendererInfo.threeRevision !== manifest.threeRevision ) throw new Error( 'renderer-info.json Three revision disagrees with manifest.' );
	if ( manifest.bundleKind === 'browser-capture' && rendererInfo.backend !== 'WebGPU' ) throw new Error( 'renderer-info.json does not record WebGPU backend.' );

}

function validatePipelineGraph( graph, manifest ) {

	requireLabelledArtifact( graph, 'pipeline-graph.json' );
	requireKeys( graph, [
		'graphDigest', 'owners', 'ownerClaims', 'signals', 'sceneSubmissions',
		'computeDispatches', 'resources', 'finalToneMapOwner',
		'finalOutputTransformOwner', 'captureRoutes'
	], 'pipeline-graph.json' );
	if ( graph.graphDigest !== manifest.pipelineGraphDigest ) throw new Error( 'stale-pipeline-graph: manifest digest does not match pipeline-graph.json.' );
	requireString( graph.finalToneMapOwner, 'pipeline-graph.json.finalToneMapOwner' );
	requireString( graph.finalOutputTransformOwner, 'pipeline-graph.json.finalOutputTransformOwner' );
	if ( graph.finalToneMapOwner === 'duplicate' || graph.finalOutputTransformOwner === 'duplicate' ) throw new Error( 'duplicate-output-owner is forbidden.' );
	requireArray( graph.ownerClaims, 'pipeline-graph.json.ownerClaims', 4 );
	for ( const [ index, claim ] of graph.ownerClaims.entries() ) {

		const label = `pipeline-graph.json.ownerClaims[${ index }]`;
		requireKeys( claim, [ 'semantic', 'owner', 'producerCount' ], label );
		requireString( claim.semantic, `${ label }.semantic` );
		requireString( claim.owner, `${ label }.owner` );
		validateNumericDatum( claim.producerCount, `${ label }.producerCount` );
		if ( OWNERSHIP_SINGLETONS.has( claim.semantic ) && numericValue( claim.producerCount, `${ label }.producerCount` ) !== 1 ) {

			throw new Error( `duplicate-output-owner: ${ claim.semantic } must have exactly one producer.` );

		}

	}

	requireKeys( graph.captureRoutes, [ 'final', 'no-post', 'diagnostics' ], 'pipeline-graph.json.captureRoutes' );
	for ( const mode of [ 'final', 'no-post', 'diagnostics' ] ) {

		requireKeys( graph.captureRoutes[ mode ], [ 'mode', 'outputNodeId' ], `pipeline-graph.json.captureRoutes.${ mode }` );
		if ( graph.captureRoutes[ mode ].mode !== mode ) throw new Error( `false-diagnostic-route: ${ mode } route does not select ${ mode } mode.` );

	}

	if ( graph.captureRoutes.diagnostics.outputNodeId === graph.captureRoutes.final.outputNodeId ) {

		throw new Error( 'false-diagnostic-route: diagnostics output node equals final output node.' );

	}

}

function validatePerformance( envelope, trace, manifest, contract ) {

	requireLabelledArtifact( envelope, 'performance-envelope.json' );
	requireLabelledArtifact( trace, 'frame-trace.json' );
	requireKeys( envelope, [
		'gpuTimingRequirement', 'refreshPeriod', 'browserMainThreadReserve',
		'compositorGpuReserve', 'cpuSafetyReserve', 'gpuSafetyReserve',
		'cpuSceneEnvelope', 'gpuSceneEnvelope', 'cpuP95Gate', 'gpuP95Gate',
		'deadlineMissRatioGate'
	], 'performance-envelope.json' );
	if ( envelope.gpuTimingRequirement !== contract.performanceClaims.gpuTimingRequirement ) throw new Error( 'GPU timing requirement drifted between contract and envelope.' );
	requireKeys( trace, [ 'clockSource', 'warmup', 'cold', 'sustained', 'gpuTimingAvailable', 'renderTimestamp', 'computeTimestamp', 'presentationCadence', 'excludedPhases' ], 'frame-trace.json' );
	requireBoolean( trace.gpuTimingAvailable, 'frame-trace.json.gpuTimingAvailable' );

	for ( const segmentName of [ 'warmup', 'cold', 'sustained' ] ) {

		const segment = trace[ segmentName ];
		requireKeys( segment, [ 'cpuSamples', 'presentationSamples', 'cpuP50', 'cpuP95', 'presentationP95', 'deadlineMissRatio' ], `frame-trace.json.${ segmentName }` );
		validateNumericArray( segment.cpuSamples, `frame-trace.json.${ segmentName }.cpuSamples` );
		validateNumericArray( segment.presentationSamples, `frame-trace.json.${ segmentName }.presentationSamples` );
		for ( const key of [ 'cpuP50', 'cpuP95', 'presentationP95', 'deadlineMissRatio' ] ) validateNumericDatum( segment[ key ], `frame-trace.json.${ segmentName }.${ key }` );

	}

	const cpuP95 = numericValue( trace.sustained.cpuP95, 'frame-trace.json.sustained.cpuP95' );
	const cpuGate = numericValue( envelope.cpuP95Gate, 'performance-envelope.json.cpuP95Gate' );
	if ( cpuP95 > cpuGate ) throw new Error( `p95-overrun: CPU sustained p95 ${ cpuP95 } exceeds gate ${ cpuGate }.` );

	if ( envelope.gpuTimingRequirement === 'required' ) {

		if ( trace.gpuTimingAvailable !== true || trace.renderTimestamp === null ) {

			if ( manifest.claimVerdicts.gpuAttribution !== 'INSUFFICIENT_EVIDENCE' ) {

				throw new Error( 'missing-timestamp: required GPU timing must yield INSUFFICIENT_EVIDENCE.' );

			}

		} else {

			validateNumericDatum( trace.renderTimestamp, 'frame-trace.json.renderTimestamp' );
			if ( trace.computeTimestamp !== null ) validateNumericDatum( trace.computeTimestamp, 'frame-trace.json.computeTimestamp' );
			if ( manifest.claimVerdicts.gpuAttribution !== 'PASS' ) throw new Error( 'Timestamp-backed GPU attribution must use claim verdict PASS.' );

		}

	}

}

function validateQualityGovernor( governor ) {

	requireLabelledArtifact( governor, 'quality-governor.json' );
	requireKeys( governor, [ 'enabled', 'states', 'inputMetric', 'filter', 'hysteresis', 'minimumResidence', 'transitions', 'settledState', 'oscillationDetected' ], 'quality-governor.json' );
	requireBoolean( governor.enabled, 'quality-governor.json.enabled' );
	requireBoolean( governor.oscillationDetected, 'quality-governor.json.oscillationDetected' );
	if ( governor.oscillationDetected ) throw new Error( 'governor-oscillation: quality governor did not settle.' );
	if ( governor.states.includes( governor.settledState ) === false ) throw new Error( 'Quality governor settled outside declared states.' );

}

function readTaggedInteger( datum, label ) {

	const value = numericValue( datum, label );
	if ( Number.isInteger( value ) === false ) throw new Error( `${ label } must be an integer.` );
	return value;

}

function validateRenderTargets( targets ) {

	requireLabelledArtifact( targets, 'render-targets.json' );
	requireKeys( targets, [ 'targets', 'totalResidentBytes', 'peakTransientBytes' ], 'render-targets.json' );
	requireArray( targets.targets, 'render-targets.json.targets', 1 );
	for ( const [ index, target ] of targets.targets.entries() ) {

		const label = `render-targets.json.targets[${ index }]`;
		requireKeys( target, [ 'name', 'owner', 'semantic', 'width', 'height', 'format', 'bytesPerTexel', 'sampleCount', 'memoryBytes', 'lifetime', 'loadOp', 'storeOp', 'readback' ], label );
		const width = readTaggedInteger( target.width, `${ label }.width` );
		const height = readTaggedInteger( target.height, `${ label }.height` );
		const bytesPerTexel = readTaggedInteger( target.bytesPerTexel, `${ label }.bytesPerTexel` );
		const expected = getAlignedReadbackLayout( width, height, bytesPerTexel );
		requireKeys( target.readback, [ 'rowBytes', 'bytesPerRow', 'minimumByteLength', 'fullyPaddedByteLength', 'alignment' ], `${ label }.readback` );
		for ( const key of [ 'rowBytes', 'bytesPerRow', 'minimumByteLength', 'fullyPaddedByteLength', 'alignment' ] ) {

			const actual = readTaggedInteger( target.readback[ key ], `${ label }.readback.${ key }` );
			if ( actual !== expected[ key ] ) throw new Error( `bad-padded-stride: ${ label }.readback.${ key } does not match WebGPU alignment.` );

		}

	}

}

function validateResourceArtifact( artifact, label, requiredKeys ) {

	requireLabelledArtifact( artifact, label );
	requireKeys( artifact, requiredKeys, label );

}

function validateVisualErrors( visualErrors ) {

	requireLabelledArtifact( visualErrors, 'visual-errors.json' );
	requireKeys( visualErrors, [ 'metrics', 'spatialErrorMaps', 'worstCaseArtifacts' ], 'visual-errors.json' );
	requireArray( visualErrors.metrics, 'visual-errors.json.metrics', 1 );
	for ( const [ index, metric ] of visualErrors.metrics.entries() ) {

		const label = `visual-errors.json.metrics[${ index }]`;
		requireKeys( metric, [ 'id', 'domain', 'truthSource', 'alignment', 'mask', 'measured', 'gate', 'verdict', 'worstCaseArtifact' ], label );
		validateNumericDatum( metric.measured, `${ label }.measured` );
		validateNumericDatum( metric.gate, `${ label }.gate` );
		requireVerdict( metric.verdict, `${ label }.verdict` );
		if ( numericValue( metric.measured, `${ label }.measured` ) > numericValue( metric.gate, `${ label }.gate` ) || metric.verdict === 'FAIL' ) {

			throw new Error( `visual-error-overrun: metric ${ metric.id } exceeded its frozen gate.` );

		}

	}

}

function validateLeakLoop( leakLoop, manifest ) {

	requireLabelledArtifact( leakLoop, 'leak-loop.json' );
	requireKeys( leakLoop, [ 'operations', 'cycles', 'before', 'after', 'trend', 'gates', 'allowedCachePlateaus', 'deviceErrors', 'verdict' ], 'leak-loop.json' );
	validateNumericDatum( leakLoop.cycles, 'leak-loop.json.cycles' );
	requireVerdict( leakLoop.verdict, 'leak-loop.json.verdict' );

	if ( manifest.bundleKind === 'browser-capture' ) {

		const cycles = numericValue( leakLoop.cycles, 'leak-loop.json.cycles' );
		if ( cycles < 50 || cycles > 100 ) throw new Error( 'Lifecycle evidence must cover 50-100 cycles.' );

	}

	for ( const resource of [ 'targetBytes', 'storageBytes' ] ) {

		const before = numericValue( leakLoop.before[ resource ], `leak-loop.json.before.${ resource }` );
		const after = numericValue( leakLoop.after[ resource ], `leak-loop.json.after.${ resource }` );
		const allowedGrowth = numericValue( leakLoop.gates[ resource ], `leak-loop.json.gates.${ resource }` );
		if ( after - before > allowedGrowth ) {

			const prefix = resource === 'targetBytes' ? 'target-leak' : 'storage-leak';
			throw new Error( `${ prefix }: ${ resource } grew beyond its frozen gate.` );

		}

	}

	if ( leakLoop.deviceErrors.length > 0 ) throw new Error( 'Lifecycle evidence contains device errors.' );

}

async function evaluateImages( artifactDir, contract ) {

	const nonblankImages = {};
	for ( const imagePath of contract.requiredImages ) {

		const confined = await resolveConfinedPath( artifactDir, imagePath, { label: `required image ${ imagePath }` } );
		nonblankImages[ imagePath ] = assertNonBlankGeneratedPng( await readFile( confined ), imagePath );

	}

	const comparisons = [];
	for ( const comparison of contract.imageComparisons ) {

		const paths = await assertDistinctBundleFiles( artifactDir, comparison.baseline, comparison.candidate, `image comparison ${ comparison.id }` );
		const diff = compareGeneratedRgbaPngs( await readFile( paths.baseline ), await readFile( paths.candidate ) );
		const gate = numericValue( comparison.maxDifferingRatio, `image comparison ${ comparison.id }.maxDifferingRatio` );
		if ( diff.ratio > gate ) throw new Error( `Image comparison ${ comparison.id } exceeded its frozen gate.` );
		comparisons.push( { id: comparison.id, ratio: diff.ratio, gate, verdict: 'PASS' } );

	}

	const finalPath = await resolveConfinedPath( artifactDir, 'images/final.design.png', { label: 'final image' } );
	const diagnosticsPath = await resolveConfinedPath( artifactDir, 'images/diagnostics.mosaic.png', { label: 'diagnostics image' } );
	const diagnosticDiff = compareGeneratedRgbaPngs( await readFile( finalPath ), await readFile( diagnosticsPath ) );
	if ( diagnosticDiff.ratio < 0.01 ) throw new Error( 'false-diagnostic-route: diagnostics mosaic does not materially differ from final output.' );

	return { nonblankImages, comparisons, diagnosticDifferingRatio: diagnosticDiff.ratio };

}

export async function readV2BundleArtifacts( artifactDir ) {

	const artifacts = {};
	for ( const file of REQUIRED_V2_ARTIFACTS ) {

		const path = await resolveConfinedPath( artifactDir, file, { label: file } );
		artifacts[ file ] = JSON.parse( await readFile( path, 'utf8' ) );

	}

	return artifacts;

}

export async function validateV2ArtifactBundle( artifactDir ) {

	const artifacts = await readV2BundleArtifacts( artifactDir );
	const contract = artifacts[ 'visual-contract.json' ];
	const manifest = artifacts[ 'evidence-manifest.json' ];
	const rendererInfo = artifacts[ 'renderer-info.json' ];
	const graph = artifacts[ 'pipeline-graph.json' ];
	const envelope = artifacts[ 'performance-envelope.json' ];
	const trace = artifacts[ 'frame-trace.json' ];
	const governor = artifacts[ 'quality-governor.json' ];
	const renderTargets = artifacts[ 'render-targets.json' ];
	const storageResources = artifacts[ 'storage-resources.json' ];
	const residentResources = artifacts[ 'resident-resources.json' ];
	const bandwidth = artifacts[ 'bandwidth-model.json' ];
	const visualErrors = artifacts[ 'visual-errors.json' ];
	const leakLoop = artifacts[ 'leak-loop.json' ];
	const mechanismMetrics = artifacts[ 'mechanism-metrics.json' ];

	validateVisualContract( contract );
	validateEvidenceManifest( manifest );
	validateRendererInfo( rendererInfo, manifest );
	validatePipelineGraph( graph, manifest );
	validatePerformance( envelope, trace, manifest, contract );
	validateQualityGovernor( governor );
	validateRenderTargets( renderTargets );
	validateResourceArtifact( storageResources, 'storage-resources.json', [ 'resources', 'totalResidentBytes', 'dispatchOwnership', 'synchronization', 'resetPolicy' ] );
	validateResourceArtifact( residentResources, 'resident-resources.json', [ 'textures', 'geometry', 'buffers', 'histories', 'staging', 'readback', 'pipelineEstimate', 'residentBytes', 'peakLiveTransientBytes', 'uploadChurnPerFrame' ] );
	validateResourceArtifact( bandwidth, 'bandwidth-model.json', [ 'passes', 'lowerBoundBytesPerFrame', 'upperBoundBytesPerFrame', 'bytesPerSecond', 'assumptions', 'hardwareCountersAvailable', 'verdict' ] );
	validateVisualErrors( visualErrors );
	validateLeakLoop( leakLoop, manifest );
	validateResourceArtifact( mechanismMetrics, 'mechanism-metrics.json', [ 'subjectAdapter', 'runtimeReachability', 'metrics', 'verdicts' ] );
	const imageEvidence = await evaluateImages( artifactDir, contract );

	return {
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		bundleKind: manifest.bundleKind,
		publishable: manifest.publishable,
		sceneId: manifest.sceneId,
		claimVerdicts: manifest.claimVerdicts,
		requiredArtifacts: [ ...REQUIRED_V2_ARTIFACTS ],
		requiredImages: contract.requiredImages,
		imageEvidence
	};

}
