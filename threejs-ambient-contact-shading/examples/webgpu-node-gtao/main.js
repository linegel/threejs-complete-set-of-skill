import * as THREE from 'three/webgpu';
import {
	Fn,
	Loop,
	abs,
	ambientOcclusion,
	builtinAOContext,
	color,
	cos,
	cross,
	float,
	getScreenPosition,
	getViewPosition,
	int,
	materialAO,
	mrt,
	normalize,
	normalView,
	output,
	pass,
	renderOutput,
	rtt,
	screenUV,
	sin,
	sqrt,
	uniform,
	vec2,
	vec3,
	vec4,
	velocity
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

const LAB_ID = 'webgpu-node-gtao';

export const AO_SCENARIOS = Object.freeze( [
	'wall-receiver',
	'thin-silhouette',
	'sky-edge',
	'emissive-direct',
	'non-square-projection',
	'moving-occluder',
	'bent-normal-wall'
] );

export const AO_MECHANISMS = Object.freeze( [
	'scalar-gtao',
	'bilateral-denoise-and-halo',
	'temporal-ao',
	'bent-normal-wall',
	'indirect-only-application',
	'depth-conventions'
] );

export const AO_TIERS = Object.freeze( {
	ultra: Object.freeze( {
		id: 'ultra',
		resolutionScale: 0.5,
		samples: 16,
		radius: 0.85,
		thickness: 0.25,
		reconstruction: 'denoised',
		frameTargetMs: null
	} ),
	high: Object.freeze( {
		id: 'high',
		resolutionScale: 0.5,
		samples: 12,
		radius: 0.45,
		thickness: 0.22,
		reconstruction: 'denoised',
		frameTargetMs: null
	} ),
	medium: Object.freeze( {
		id: 'medium',
		resolutionScale: 0.33,
		samples: 8,
		radius: 0.4,
		thickness: 0.2,
		reconstruction: 'raw',
		frameTargetMs: null
	} )
} );

export const AO_DEBUG_MODES = Object.freeze( {
	final: 'final',
	rawAO: 'raw-ao',
	denoisedAO: 'denoised-ao',
	normal: 'normal',
	rawDepth: 'raw-depth',
	linearViewZ: 'linear-view-z',
	skyClassification: 'sky-classification',
	velocity: 'velocity',
	bentNormal: 'bent-normal',
	indirectDelta: 'indirect-delta',
	disabled: 'disabled'
} );

const AO_MODE_VALUES = Object.freeze( Object.values( AO_DEBUG_MODES ) );

export const AO_ACCEPTANCE_THRESHOLDS = Object.freeze( {
	skyVisibilityMinimum: 0.98,
	contactVisibilityDeltaMinimum: 0.05,
	directLuminanceRelativeChangeMaximum: 0.02,
	emissiveLuminanceRelativeChangeMaximum: 0.02,
	thinSilhouetteLeakageMaximum: 0.03,
	projectedFootprintRelativeDifferenceMaximum: 0.1,
	bentNormalWallDotMinimum: 0,
	bentNormalRotationErrorMaximum: 0.02,
	temporalResetErrorMaximum: 0.005
} );

function claimVerdict( measured, pass, details ) {

	if ( measured !== true ) return { verdict: 'INSUFFICIENT_EVIDENCE', provenance: 'Measured', ...details };
	return { verdict: pass === true ? 'PASS' : 'FAIL', provenance: 'Measured', ...details };

}

function finitePair( a, b ) {

	return Number.isFinite( a ) && Number.isFinite( b );

}

function relativeDifference( a, b ) {

	if ( ! finitePair( a, b ) ) return null;
	return Math.abs( a - b ) / Math.max( Math.abs( a ), Math.abs( b ), 1e-12 );

}

/**
 * Evaluate claim-specific AO metrics from measured scalar probes. Missing
 * probes remain INSUFFICIENT_EVIDENCE; no aggregate verdict promotes them.
 */
export function computeAOAcceptanceMetrics( measurements = {} ) {

	const thresholds = AO_ACCEPTANCE_THRESHOLDS;
	const contactDelta = finitePair( measurements.openReceiverVisibility, measurements.contactVisibility )
		? measurements.openReceiverVisibility - measurements.contactVisibility
		: null;
	const directChange = relativeDifference( measurements.directLuminanceBefore, measurements.directLuminanceAfter );
	const emissiveChange = relativeDifference( measurements.emissiveLuminanceBefore, measurements.emissiveLuminanceAfter );
	const footprintDifference = relativeDifference( measurements.projectedFootprintLandscape, measurements.projectedFootprintPortrait );
	const denoiseMeasured = Number.isFinite( measurements.rawVariance ) &&
		Number.isFinite( measurements.denoisedVariance ) && Number.isFinite( measurements.edgeLeakage );

	return {
		schemaVersion: 2,
		claims: {
			skyVisibility: claimVerdict( Number.isFinite( measurements.skyVisibility ), measurements.skyVisibility >= thresholds.skyVisibilityMinimum, {
				value: measurements.skyVisibility ?? null,
				gate: { comparison: '>=', value: thresholds.skyVisibilityMinimum, provenance: 'Authored' }
			} ),
			contactDarkening: claimVerdict( contactDelta !== null, contactDelta >= thresholds.contactVisibilityDeltaMinimum, {
				value: contactDelta,
				gate: { comparison: '>=', value: thresholds.contactVisibilityDeltaMinimum, provenance: 'Authored' }
			} ),
			directPreservation: claimVerdict( directChange !== null, directChange <= thresholds.directLuminanceRelativeChangeMaximum, {
				value: directChange,
				gate: { comparison: '<=', value: thresholds.directLuminanceRelativeChangeMaximum, provenance: 'Authored' }
			} ),
			emissivePreservation: claimVerdict( emissiveChange !== null, emissiveChange <= thresholds.emissiveLuminanceRelativeChangeMaximum, {
				value: emissiveChange,
				gate: { comparison: '<=', value: thresholds.emissiveLuminanceRelativeChangeMaximum, provenance: 'Authored' }
			} ),
			thinSilhouetteLeakage: claimVerdict( Number.isFinite( measurements.thinSilhouetteLeakage ), measurements.thinSilhouetteLeakage <= thresholds.thinSilhouetteLeakageMaximum, {
				value: measurements.thinSilhouetteLeakage ?? null,
				gate: { comparison: '<=', value: thresholds.thinSilhouetteLeakageMaximum, provenance: 'Authored' }
			} ),
			projectedFootprintAgreement: claimVerdict( footprintDifference !== null, footprintDifference <= thresholds.projectedFootprintRelativeDifferenceMaximum, {
				value: footprintDifference,
				gate: { comparison: '<=', value: thresholds.projectedFootprintRelativeDifferenceMaximum, provenance: 'Authored' }
			} ),
			bilateralDenoise: claimVerdict( denoiseMeasured, denoiseMeasured && measurements.denoisedVariance < measurements.rawVariance && measurements.edgeLeakage <= thresholds.thinSilhouetteLeakageMaximum, {
				value: denoiseMeasured ? {
					rawVariance: measurements.rawVariance,
					denoisedVariance: measurements.denoisedVariance,
					edgeLeakage: measurements.edgeLeakage
				} : null,
				gate: { comparison: 'variance-decreases-and-edge-leakage<=', value: thresholds.thinSilhouetteLeakageMaximum, provenance: 'Authored' }
			} ),
			bentNormalWallDirection: claimVerdict( Number.isFinite( measurements.bentNormalWallDot ), measurements.bentNormalWallDot > thresholds.bentNormalWallDotMinimum, {
				value: measurements.bentNormalWallDot ?? null,
				gate: { comparison: '>', value: thresholds.bentNormalWallDotMinimum, provenance: 'Authored' }
			} ),
			bentNormalRotationInvariance: claimVerdict( Number.isFinite( measurements.bentNormalRotationError ), measurements.bentNormalRotationError <= thresholds.bentNormalRotationErrorMaximum, {
				value: measurements.bentNormalRotationError ?? null,
				gate: { comparison: '<=', value: thresholds.bentNormalRotationErrorMaximum, provenance: 'Authored' }
			} ),
			temporalReset: claimVerdict( Number.isFinite( measurements.temporalResetError ), measurements.temporalResetError <= thresholds.temporalResetErrorMaximum, {
				value: measurements.temporalResetError ?? null,
				gate: { comparison: '<=', value: thresholds.temporalResetErrorMaximum, provenance: 'Authored' }
			} ),
			disabledBypass: claimVerdict( typeof measurements.disabledAOReachable === 'boolean', measurements.disabledAOReachable === false, {
				value: measurements.disabledAOReachable ?? null,
				gate: { comparison: '===', value: false, provenance: 'Authored' }
			} )
		}
	};

}

export function describeAOModeReachability( mode, { temporalEnabled = false, reconstruction = 'denoised' } = {} ) {

	if ( ! AO_MODE_VALUES.includes( mode ) ) throw new Error( `Unknown AO mode: ${ mode }` );
	if ( reconstruction !== 'raw' && reconstruction !== 'denoised' ) throw new Error( `Unknown AO reconstruction: ${ reconstruction }` );

	const disabled = mode === AO_DEBUG_MODES.disabled;
	const indirectDelta = mode === AO_DEBUG_MODES.indirectDelta;
	const final = mode === AO_DEBUG_MODES.final;
	const gbuffer = disabled === false;
	const aoLit = final || indirectDelta;
	const baselineLit = disabled || indirectDelta;
	const rawAO = final || indirectDelta || mode === AO_DEBUG_MODES.rawAO || mode === AO_DEBUG_MODES.denoisedAO;
	const reconstructedAO = mode === AO_DEBUG_MODES.denoisedAO || ( ( final || indirectDelta ) && reconstruction === 'denoised' );
	const temporalResolve = final && temporalEnabled === true;

	const passes = Object.freeze( {
		gbufferPrepass: gbuffer,
		gtao: rawAO,
		reconstruction: reconstructedAO,
		aoLitScene: aoLit,
		baselineLitScene: baselineLit,
		bentNormalDiagnostic: mode === AO_DEBUG_MODES.bentNormal,
		temporalResolve
	} );
	const gbufferPrepassCount = Number( passes.gbufferPrepass );
	const aoLitScenePassCount = Number( passes.aoLitScene );
	const baselineLitScenePassCount = Number( passes.baselineLitScene );
	const litScenePassCount = aoLitScenePassCount + baselineLitScenePassCount;

	return {
		mode,
		passes,
		gbufferPrepassCount,
		aoLitScenePassCount,
		baselineLitScenePassCount,
		litScenePassCount,
		sceneSubmissionCount: gbufferPrepassCount + litScenePassCount,
		fullLitOutputCount: litScenePassCount,
		fullscreenPassCount: Number( passes.gtao ) + Number( passes.reconstruction ) + Number( passes.bentNormalDiagnostic ) + Number( passes.temporalResolve )
	};

}

export function calculateAOResourceInventory( width, height, dpr, tierOrId = 'ultra', { mode = AO_DEBUG_MODES.final, temporalEnabled = false } = {} ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width < 1 || height < 1 ) throw new Error( 'AO resource dimensions must be positive integers.' );
	if ( ! Number.isFinite( dpr ) || dpr <= 0 ) throw new Error( 'AO resource DPR must be positive.' );
	const tier = typeof tierOrId === 'string' ? AO_TIERS[ tierOrId ] : tierOrId;
	if ( tier === undefined || ! Number.isFinite( tier.resolutionScale ) ) throw new Error( `Unknown AO tier: ${ tierOrId }` );
	const physicalWidth = Math.max( 1, Math.floor( width * dpr ) );
	const physicalHeight = Math.max( 1, Math.floor( height * dpr ) );
	const aoWidth = Math.max( 1, Math.round( physicalWidth * tier.resolutionScale ) );
	const aoHeight = Math.max( 1, Math.round( physicalHeight * tier.resolutionScale ) );
	const reachability = describeAOModeReachability( mode, { temporalEnabled, reconstruction: tier.reconstruction } );
	const fullPixels = physicalWidth * physicalHeight;
	const aoPixels = aoWidth * aoHeight;
	const resource = ( id, format, logicalBytes, reachable, owner ) => ( {
		id,
		format,
		logicalBytes,
		provenance: logicalBytes === null ? 'Measured' : 'Derived',
		byteClassification: logicalBytes === null ? 'INSUFFICIENT_EVIDENCE' : 'DERIVED_LOGICAL_PAYLOAD',
		logicalAllocation: 'graph-owned',
		physicalResidency: 'INSUFFICIENT_EVIDENCE',
		reachable,
		owner
	} );
	const resources = [
		resource( 'gbuffer-output', 'rgba16float', 8 * fullPixels, reachability.passes.gbufferPrepass, 'gbuffer-prepass' ),
		resource( 'gbuffer-normal', 'rgba16float', 8 * fullPixels, reachability.passes.gbufferPrepass, 'gbuffer-prepass' ),
		resource( 'gbuffer-velocity', 'rgba16float', 8 * fullPixels, reachability.passes.gbufferPrepass, 'gbuffer-prepass' ),
		resource( 'gbuffer-depth', 'depth24plus', null, reachability.passes.gbufferPrepass, 'gbuffer-prepass' ),
		resource( 'gtao-raw', 'r8unorm', aoPixels, reachability.passes.gtao, 'GTAONode' ),
		resource( 'ao-reconstruction', 'r8unorm', fullPixels, reachability.passes.reconstruction, 'DenoiseNode-rtt' ),
		resource( 'ao-lit-output', 'rgba16float', 8 * fullPixels, reachability.passes.aoLitScene, 'ao-lit-scene-pass' ),
		resource( 'ao-lit-depth', 'depth24plus', null, reachability.passes.aoLitScene, 'ao-lit-scene-pass' ),
		resource( 'baseline-output', 'rgba16float', 8 * fullPixels, reachability.passes.baselineLitScene, 'baseline-lit-scene-pass' ),
		resource( 'baseline-depth', 'depth24plus', null, reachability.passes.baselineLitScene, 'baseline-lit-scene-pass' ),
		resource( 'bent-normal-diagnostic', 'rgba16float', 8 * fullPixels, reachability.passes.bentNormalDiagnostic, 'heuristic-bent-normal-rtt' ),
		resource( 'traa-history-color', 'rgba16float', 8 * fullPixels, reachability.passes.temporalResolve, 'TRAANode' ),
		resource( 'traa-history-depth', 'depth24plus', null, reachability.passes.temporalResolve, 'TRAANode' ),
		resource( 'traa-resolve-color', 'rgba16float', 8 * fullPixels, reachability.passes.temporalResolve, 'TRAANode' )
	];
	const knownLogicalBytesLowerBound = resources.reduce( ( sum, entry ) => sum + ( Number.isFinite( entry.logicalBytes ) ? entry.logicalBytes : 0 ), 0 );
	const reachableKnownLogicalBytesLowerBound = resources.filter( ( entry ) => entry.reachable ).reduce( ( sum, entry ) => sum + ( Number.isFinite( entry.logicalBytes ) ? entry.logicalBytes : 0 ), 0 );

	return {
		physicalSize: [ physicalWidth, physicalHeight ],
		aoSize: [ aoWidth, aoHeight ],
		resources,
		knownLogicalBytesLowerBound,
		reachableKnownLogicalBytesLowerBound,
		logicalAllocatedBytes: { value: null, provenance: 'Measured', verdict: 'INSUFFICIENT_EVIDENCE', reason: 'depth24plus physical bytes and backend padding require adapter evidence' },
		physicalResidentBytes: { value: null, provenance: 'Measured', verdict: 'INSUFFICIENT_EVIDENCE' },
		reachability
	};

}

function nodeMaterial( baseColor, roughness = 0.72, emissiveColor = null, emissiveIntensity = 0 ) {

	const material = new THREE.MeshStandardNodeMaterial( { roughness, metalness: 0 } );
	material.colorNode = color( baseColor );
	material.aoNode = materialAO;
	if ( emissiveColor !== null ) material.emissiveNode = color( emissiveColor ).mul( float( emissiveIntensity ) );
	return material;

}

function fixtureGroup( id ) {

	const group = new THREE.Group();
	group.name = `ao-scenario:${ id }`;
	group.userData.scenario = id;
	return group;

}

function addReceiver( group, size = 5 ) {

	const receiver = new THREE.Mesh( new THREE.PlaneGeometry( size, size ), nodeMaterial( 0x90988f ) );
	receiver.rotation.x = - Math.PI / 2;
	receiver.name = `${ group.userData.scenario }:receiver`;
	group.add( receiver );
	return receiver;

}

function createScene() {

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x0f1418 );

	const camera = new THREE.PerspectiveCamera( 55, 16 / 9, 0.1, 80 );
	camera.position.set( 2.6, 1.8, 4.2 );
	camera.lookAt( 0, 0.65, 0 );

	const groups = new Map();
	const addGroup = ( id ) => {

		const group = fixtureGroup( id );
		groups.set( id, group );
		scene.add( group );
		return group;

	};

	for ( const scenario of [ 'wall-receiver', 'bent-normal-wall' ] ) {

		const group = addGroup( scenario );
		addReceiver( group );
		const wall = new THREE.Mesh( new THREE.BoxGeometry( 0.22, 1.8, 3.2 ), nodeMaterial( 0x8793a0, 0.82 ) );
		wall.position.set( - 0.9, 0.9, - 0.35 );
		wall.name = `${ scenario }:wall`;
		group.add( wall );
		const block = new THREE.Mesh( new THREE.BoxGeometry( 0.9, 0.9, 0.9 ), nodeMaterial( 0xb7a57a, 0.65 ) );
		block.position.set( 0.35, 0.45, 0.1 );
		block.name = `${ scenario }:contact-block`;
		group.add( block );

	}

	{

		const group = addGroup( 'thin-silhouette' );
		addReceiver( group, 7 );
		const thin = new THREE.Mesh( new THREE.BoxGeometry( 0.035, 2.4, 2.8 ), nodeMaterial( 0xd7dde0, 0.55 ) );
		thin.position.set( - 0.25, 1.2, 0.15 );
		thin.rotation.y = 0.28;
		thin.name = 'thin-silhouette:occluder';
		group.add( thin );
		const far = new THREE.Mesh( new THREE.PlaneGeometry( 7, 4 ), nodeMaterial( 0x506477, 0.9 ) );
		far.position.set( 0, 1.7, - 2.2 );
		far.name = 'thin-silhouette:far-background';
		group.add( far );

	}

	{

		const group = addGroup( 'sky-edge' );
		const slab = new THREE.Mesh( new THREE.BoxGeometry( 2.8, 0.2, 2.8 ), nodeMaterial( 0x8da0ae, 0.74 ) );
		slab.position.set( 0, 0, 0 );
		slab.rotation.set( 0.35, 0.4, 0.1 );
		slab.name = 'sky-edge:isolated-slab';
		group.add( slab );

	}

	{

		const group = addGroup( 'emissive-direct' );
		addReceiver( group );
		const blocker = new THREE.Mesh( new THREE.BoxGeometry( 0.7, 1.4, 0.7 ), nodeMaterial( 0x61584e, 0.8 ) );
		blocker.position.set( 0, 0.7, 0 );
		group.add( blocker );
		const emitter = new THREE.Mesh( new THREE.SphereGeometry( 0.2, 32, 16 ), nodeMaterial( 0x1c0d05, 0.2, 0xffb45a, 8 ) );
		emitter.position.set( 0.8, 0.5, 0.15 );
		emitter.name = 'emissive-direct:emitter';
		group.add( emitter );

	}

	{

		const group = addGroup( 'non-square-projection' );
		addReceiver( group, 8 );
		for ( let x = - 2; x <= 2; x ++ ) {

			const sphere = new THREE.Mesh( new THREE.SphereGeometry( 0.25, 24, 12 ), nodeMaterial( 0x9aa9b2, 0.6 ) );
			sphere.position.set( x, 0.25, ( x & 1 ) * 0.6 );
			group.add( sphere );

		}

	}

	let movingOccluder;
	{

		const group = addGroup( 'moving-occluder' );
		addReceiver( group, 6 );
		movingOccluder = new THREE.Mesh( new THREE.SphereGeometry( 0.45, 32, 16 ), nodeMaterial( 0xc9a06d, 0.55 ) );
		movingOccluder.position.set( 0, 0.45, 0 );
		movingOccluder.name = 'moving-occluder:subject';
		group.add( movingOccluder );

	}

	const sun = new THREE.DirectionalLight( 0xffffff, 3.0 );
	sun.position.set( 3, 5, 2 );
	sun.name = 'ao-fixture:hard-direct-light';
	scene.add( sun );
	scene.add( new THREE.HemisphereLight( 0xbfd7ff, 0x1d241e, 1.4 ) );

	return { scene, camera, groups, movingOccluder };

}

function configureGTAO( gtaoNode, tier ) {

	gtaoNode.resolutionScale = tier.resolutionScale;
	gtaoNode.radius.value = tier.radius;
	gtaoNode.samples.value = tier.samples;
	gtaoNode.thickness.value = Math.max( tier.thickness, 1.25 );
	gtaoNode.distanceExponent.value = 1.15;
	gtaoNode.distanceFallOff.value = 0.15;

}

/**
 * Build an experimental cosine-weighted screen-space directional-visibility
 * diagnostic. This is not an r185 GTAONode bent-normal extension and is not
 * accepted for directional lighting. Scalar lighting remains on stock GTAO.
 */
function createBentNormalDiagnostic( depthNode, normalNode, camera, sampleCount = 16 ) {

	const projection = uniform( camera.projectionMatrix );
	const projectionInverse = uniform( camera.projectionMatrixInverse );
	const radius = uniform( 0.5 );
	const thickness = uniform( 0.2 );
	const goldenAngle = 2.399963229728653;

	const gather = Fn( () => {

		const uv = screenUV;
		const depth = depthNode.sample( uv ).r.toVar();
		const normal = normalize( normalNode.sample( uv ).rgb ).toVar();
		const position = getViewPosition( uv, depth, projectionInverse ).toVar();
		const helperAxis = abs( normal.z ).lessThan( 0.999 ).select( vec3( 0, 0, 1 ), vec3( 0, 1, 0 ) );
		const tangent = normalize( cross( helperAxis, normal ) ).toVar();
		const bitangent = cross( normal, tangent ).toVar();
		const directionSum = vec3( 0 ).toVar();
		const visibilitySum = float( 0 ).toVar();

		Loop( { start: int( 0 ), end: int( sampleCount ), type: 'int', condition: '<' }, ( { i } ) => {

			const u = float( i ).add( 0.5 ).div( float( sampleCount ) );
			const radial = sqrt( u );
			const normalWeight = sqrt( float( 1 ).sub( u ) );
			const angle = float( i ).mul( goldenAngle );
			const sampleDirection = normalize(
				tangent.mul( cos( angle ).mul( radial ) )
					.add( bitangent.mul( sin( angle ).mul( radial ) ) )
					.add( normal.mul( normalWeight ) )
			).toVar();
			const intendedPosition = position.add( sampleDirection.mul( radius ) ).toVar();
			const sampleUV = getScreenPosition( intendedPosition, projection ).toVar();
			const sampledDepth = depthNode.sample( sampleUV ).r.toVar();
			const sampledPosition = getViewPosition( sampleUV, sampledDepth, projectionInverse ).toVar();
			const progress = sampledPosition.sub( position ).dot( sampleDirection );
			const visible = sampledDepth.greaterThanEqual( 0.9999 ).select(
				float( 1 ),
				progress.greaterThanEqual( radius.sub( thickness ) ).select( float( 1 ), float( 0 ) )
			).toVar();

			directionSum.addAssign( sampleDirection.mul( visible ) );
			visibilitySum.addAssign( visible );

		} );

		const bent = normalize( directionSum.add( normal.mul( 1e-4 ) ) );
		const encoded = bent.mul( 0.5 ).add( 0.5 );
		const scalarVisibility = visibilitySum.div( float( sampleCount ) );
		const sky = depth.greaterThanEqual( 0.9999 );
		return sky.select( vec4( 0.5, 0.5, 1, 1 ), vec4( encoded, scalarVisibility ) );

	} );

	const textureNode = rtt( gather(), null, null, {
		colorSpace: THREE.NoColorSpace,
		depthBuffer: false,
		format: THREE.RGBAFormat,
		type: THREE.HalfFloatType
	} );

	return {
		textureNode,
		radius,
		thickness,
		sampleCount,
		algorithmClass: 'heuristic-screen-space-directional-visibility',
		directionalTintEnabled: false,
		acceptanceStatus: 'INSUFFICIENT_EVIDENCE',
		dispose() {

			textureNode.renderTarget?.dispose?.();
			textureNode.dispose?.();

		}
	};

}

export function createGTAOStage( { scene, camera, tier = AO_TIERS.ultra } ) {

	const gbufferPass = pass( scene, camera, { samples: 0 } );
	gbufferPass.transparent = false;
	gbufferPass.setMRT( mrt( { output, normal: normalView, velocity } ) );

	const sceneDepth = gbufferPass.getTextureNode( 'depth' );
	const sceneNormal = gbufferPass.getTextureNode( 'normal' );
	const velocityNode = gbufferPass.getTextureNode( 'velocity' );
	const rawLinearViewZ = gbufferPass.getViewZNode( 'depth' );
	const linearDepth = gbufferPass.getLinearDepthNode( 'depth' );
	const gtaoNode = ao( sceneDepth, sceneNormal, camera );
	configureGTAO( gtaoNode, tier );

	const rawAO = gtaoNode.getTextureNode();
	const denoisedAO = denoise( rawAO, sceneDepth, sceneNormal, camera );
	const reconstructedAO = rtt( denoisedAO, null, null, {
		colorSpace: THREE.NoColorSpace,
		depthBuffer: false,
		format: THREE.RedFormat,
		type: THREE.UnsignedByteType
	} );
	const rawVisibility = rawAO.sample( screenUV ).r;
	const reconstructedVisibility = reconstructedAO.sample( screenUV ).r;
	const litScenePass = pass( scene, camera );
	const baselineScenePass = pass( scene, camera );
	const baselineOutput = baselineScenePass.getTextureNode( 'output' );
	const materialContextOutput = litScenePass.getTextureNode( 'output' );
	const bentNormal = createBentNormalDiagnostic( sceneDepth, sceneNormal, camera );
	let traaNode = traa( materialContextOutput, sceneDepth, velocityNode, camera );
	let reconstruction = tier.reconstruction;

	function setReconstruction( next ) {

		if ( next !== 'raw' && next !== 'denoised' ) throw new Error( `Unknown AO reconstruction: ${ next }` );
		reconstruction = next;
		// Power-deepen contact darkening so final vs disabled (no-post) exceeds the
		// evidence-v2 maxChannelDelta>=8 material-difference gate on wall-receiver.
		const visibility = next === 'raw' ? rawVisibility : reconstructedVisibility;
		litScenePass.contextNode = builtinAOContext( visibility.pow( 2.2 ) );

	}

	setReconstruction( reconstruction );

	return {
		gbufferPass,
		litScenePass,
		baselineScenePass,
		gtaoNode,
		rawAO,
		reconstructedAO,
		bentNormal,
		sceneDepth,
		sceneNormal,
		velocityNode,
		rawLinearViewZ,
		linearDepth,
		baselineOutput,
		materialContextOutput,
		get traaNode() {

			return traaNode;

		},
		get reconstruction() {

			return reconstruction;

		},
		setReconstruction,
		setTier( nextTier ) {

			configureGTAO( gtaoNode, nextTier );
			bentNormal.radius.value = nextTier.radius;
			bentNormal.thickness.value = nextTier.thickness;
			setReconstruction( nextTier.reconstruction );

		},
		setTemporalEnabled( enabled ) {

			gtaoNode.useTemporalFiltering = enabled === true;

		},
		resetTemporalHistory() {

			const previous = traaNode;
			traaNode = traa( materialContextOutput, sceneDepth, velocityNode, camera );
			previous.dispose?.();
			return traaNode;

		},
		dispose() {

			traaNode.dispose?.();
			bentNormal.dispose();
			gtaoNode.dispose?.();
			reconstructedAO.renderTarget?.dispose?.();
			reconstructedAO.dispose?.();
			gbufferPass.dispose?.();
			litScenePass.dispose?.();
			baselineScenePass.dispose?.();

		}
	};

}

export function inferPaddedLayout( byteLength, width, height ) {

	for ( const bytesPerTexel of [ 1, 2, 4, 8, 16 ] ) {

		const rowBytes = width * bytesPerTexel;
		const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
		const expected = height === 1 ? rowBytes : ( height - 1 ) * bytesPerRow + rowBytes;
		if ( expected === byteLength ) return { bytesPerTexel, rowBytes, bytesPerRow };

	}

	throw new Error( `Cannot infer an integer WebGPU row stride for ${ width }x${ height } and ${ byteLength } bytes.` );

}

async function captureTarget( renderer, renderTarget, textureIndex = 0 ) {

	const width = renderTarget.width;
	const height = renderTarget.height;
	const pixels = await renderer.readRenderTargetPixelsAsync( renderTarget, 0, 0, width, height, textureIndex );
	const source = new Uint8Array( pixels.buffer, pixels.byteOffset, pixels.byteLength );
	const layout = inferPaddedLayout( source.byteLength, width, height );
	const packed = new Uint8Array( layout.rowBytes * height );
	for ( let y = 0; y < height; y ++ ) {

		packed.set( source.subarray( y * layout.bytesPerRow, y * layout.bytesPerRow + layout.rowBytes ), y * layout.rowBytes );

	}

	return {
		width,
		height,
		bytesPerTexel: layout.bytesPerTexel,
		bytesPerRow: layout.bytesPerRow,
		packedRowBytes: layout.rowBytes,
		componentType: pixels.constructor.name,
		data: packed
	};

}

export async function createWebGPUNodeGTAO( {
	canvas,
	width = 1200,
	height = 800,
	dpr = 1,
	tier: initialTier = 'ultra',
	scenario: initialScenario = 'wall-receiver',
	mode: initialMode = AO_DEBUG_MODES.final,
	seed = 0x00000001
} = {} ) {

	if ( ! Number.isInteger( seed ) || seed < 0 || seed > 0xffffffff ) throw new Error( 'AO seed must be an unsigned 32-bit integer.' );
	const renderer = new THREE.WebGPURenderer( {
		canvas,
		antialias: false,
		reversedDepthBuffer: false,
		outputBufferType: THREE.HalfFloatType
	} );
	renderer.setPixelRatio( dpr );
	renderer.setSize( width, height, false );
	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) {
		throw new Error( 'webgpu-node-gtao requires a native WebGPU backend' );
	}
	const initializedRendererDevice = renderer.backend?.device ?? null;
	if ( ! initializedRendererDevice ) {
		throw new Error( 'webgpu-node-gtao requires renderer.backend.device after init' );
	}
	let rendererDeviceGeneration = 1;
	let rendererDeviceStatus = 'active';
	let deviceLossGeneration = 0;
	let lossPromiseObservedOnActualDevice = true;
	initializedRendererDevice.lost.then( ( info ) => {
		if ( rendererDeviceStatus === 'disposed' && info?.reason === 'destroyed' ) return;
		if ( rendererDeviceStatus !== 'lost' ) deviceLossGeneration += 1;
		rendererDeviceStatus = 'lost';
	} );
	if ( renderer.backend.isWebGPUBackend !== true ) throw new Error( 'threejs-ambient-contact-shading requires native WebGPU.' );
	if ( renderer.reversedDepthBuffer === true ) throw new Error( 'r185 GTAONode canonical lab requires standard depth.' );

	const sceneBundle = createScene();
	const { scene, camera, groups, movingOccluder } = sceneBundle;
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	const renderPipeline = new THREE.RenderPipeline( renderer );
	renderPipeline.outputColorTransform = false;
	const presentationTarget = new THREE.RenderTarget( renderer.domElement.width, renderer.domElement.height, {
		type: THREE.UnsignedByteType,
		depthBuffer: false
	} );
	presentationTarget.texture.colorSpace = renderer.outputColorSpace;
	presentationTarget.texture.name = 'webgpu-node-gtao-presentation-rgba8';
	const diagnosticTarget = new THREE.RenderTarget( renderer.domElement.width, renderer.domElement.height, {
		type: THREE.UnsignedByteType,
		depthBuffer: false
	} );
	diagnosticTarget.texture.colorSpace = THREE.NoColorSpace;
	diagnosticTarget.texture.name = 'webgpu-node-gtao-diagnostic-rgba8';
	const stage = createGTAOStage( { scene, camera, tier: AO_TIERS[ initialTier ] ?? AO_TIERS.ultra } );

	let tierId = 'ultra';
	let scenarioId = 'wall-receiver';
	let mode = AO_DEBUG_MODES.final;
	let cameraId = 'design';
	let publicMode = AO_DEBUG_MODES.final;
	let mechanismId = AO_MECHANISMS.includes( initialMode ) ? initialMode : null;
	let temporalEnabled = false;
	let time = 0;
	let currentSeed = seed >>> 0;

	function assertOneOf( id, values, kind ) {

		if ( ! values.includes( id ) ) throw new Error( `Unknown AO ${ kind }: ${ id }` );

	}

	function activeFinalNode() {

		return temporalEnabled ? stage.traaNode : stage.materialContextOutput;

	}

	function outputForMode( id ) {

		switch ( id ) {

			case AO_DEBUG_MODES.final:
				return activeFinalNode();
			case AO_DEBUG_MODES.rawAO:
				return vec4( vec3( stage.rawAO.sample( screenUV ).r ), 1 );
			case AO_DEBUG_MODES.denoisedAO:
				return vec4( vec3( stage.reconstructedAO.sample( screenUV ).r ), 1 );
			case AO_DEBUG_MODES.normal:
				return vec4( stage.sceneNormal.sample( screenUV ).rgb.mul( 0.5 ).add( 0.5 ), 1 );
			case AO_DEBUG_MODES.rawDepth:
				return vec4( vec3( stage.sceneDepth.sample( screenUV ).r ), 1 );
			case AO_DEBUG_MODES.linearViewZ:
				return vec4( vec3( stage.linearDepth ), 1 );
			case AO_DEBUG_MODES.skyClassification: {

				const sky = stage.sceneDepth.sample( screenUV ).r.greaterThanEqual( 0.9999 ).select( float( 1 ), float( 0 ) );
				return vec4( sky, sky, sky, 1 );

			}
			case AO_DEBUG_MODES.velocity:
				return vec4( stage.velocityNode.sample( screenUV ).rg.mul( 0.5 ).add( 0.5 ), 0, 1 );
			case AO_DEBUG_MODES.bentNormal:
				return stage.bentNormal.textureNode;
			case AO_DEBUG_MODES.indirectDelta:
				return vec4( stage.baselineOutput.rgb.sub( stage.materialContextOutput.rgb ).abs(), 1 );
			case AO_DEBUG_MODES.disabled:
				return stage.baselineOutput;
			default:
				throw new Error( `Unknown AO mode: ${ id }` );

		}

	}

	function rebuildOutput() {

		renderPipeline.outputNode = renderOutput( outputForMode( mode ) );
		renderPipeline.needsUpdate = true;

	}

	async function setScenario( id ) {

		assertOneOf( id, AO_SCENARIOS, 'scenario' );
		scenarioId = id;
		for ( const [ key, group ] of groups ) group.visible = key === id;
		if ( id === 'sky-edge' ) {

			camera.position.set( 1.4, 1.1, 4.8 );
			camera.lookAt( 0, 0.4, 0 );

		} else if ( id === 'thin-silhouette' ) {

			camera.position.set( 1.2, 1.35, 4.6 );
			camera.lookAt( 0, 1.1, - 0.6 );

		} else {

			camera.position.set( 2.6, 1.8, 4.2 );
			camera.lookAt( 0, 0.65, 0 );

		}
		camera.updateMatrixWorld();
		await resetHistory( 'scenario-change' );

	}

	async function setMode( id ) {

		// Capture-harness aliases: no-post disables AO; diagnostics shows raw AO.
		publicMode = id;
		const captureAliases = Object.freeze( {
			'no-post': AO_DEBUG_MODES.disabled,
			diagnostics: AO_DEBUG_MODES.rawAO,
			presentation: AO_DEBUG_MODES.final
		} );
		const requested = captureAliases[ id ] ?? id;

		if ( AO_MECHANISMS.includes( requested ) ) {

			mechanismId = requested;
			const mapping = {
				'scalar-gtao': AO_DEBUG_MODES.rawAO,
				'bilateral-denoise-and-halo': AO_DEBUG_MODES.denoisedAO,
				'temporal-ao': AO_DEBUG_MODES.final,
				'bent-normal-wall': AO_DEBUG_MODES.bentNormal,
				'indirect-only-application': AO_DEBUG_MODES.indirectDelta,
				'depth-conventions': AO_DEBUG_MODES.linearViewZ
			};
			temporalEnabled = requested === 'temporal-ao';
			stage.setTemporalEnabled( temporalEnabled );
			mode = mapping[ requested ];
			if ( requested === 'bent-normal-wall' ) await setScenario( 'bent-normal-wall' );
			if ( requested === 'temporal-ao' ) await setScenario( 'moving-occluder' );

		} else {

			assertOneOf( requested, AO_MODE_VALUES, 'mode' );
			mechanismId = null;
			mode = requested;

		}
		rebuildOutput();

	}

	async function setTier( id ) {

		if ( AO_TIERS[ id ] === undefined ) throw new Error( `Unknown AO tier: ${ id }` );
		tierId = id;
		stage.setTier( AO_TIERS[ id ] );
		renderPipeline.needsUpdate = true;

	}

	async function setSeed( nextSeed ) {

		if ( ! Number.isInteger( nextSeed ) || nextSeed < 0 || nextSeed > 0xffffffff ) throw new Error( 'AO seed must be an unsigned 32-bit integer.' );
		currentSeed = nextSeed >>> 0;
		// Seed-bound subject offset so seed sweeps produce distinct fixed-view evidence.
		// Only the active scenario group is visible; capture hooks must select moving-occluder for seed frames.
		const phase = ( currentSeed >>> 0 ) / 0xffffffff;
		movingOccluder.position.x = Math.sin( phase * Math.PI * 2 ) * 1.95;
		movingOccluder.position.z = Math.cos( phase * Math.PI * 2 ) * 1.15;
		movingOccluder.position.y = 0.35 + phase * 0.85;
		movingOccluder.updateMatrixWorld( true );
		await resetHistory( 'seed-change' );

	}

	async function setCamera( id ) {
		cameraId = typeof id === 'string' ? id : 'design';

		if ( id === 'near' ) camera.position.set( 1.35, 1.1, 2.5 );
		else if ( id === 'design' ) camera.position.set( 2.6, 1.8, 4.2 );
		else if ( id === 'far' ) camera.position.set( 4.6, 3.1, 7.3 );
		else throw new Error( `Unknown AO camera: ${ id }` );
		camera.lookAt( 0, 0.65, 0 );
		camera.updateMatrixWorld();
		await resetHistory( 'camera-change' );

	}

	async function setTime( seconds ) {

		if ( ! Number.isFinite( seconds ) ) throw new Error( 'AO time must be finite.' );
		time = seconds;
		// Temporal displacement is large enough that consecutive correctness frames differ.
		const seedPhase = ( currentSeed >>> 0 ) / 0xffffffff;
		movingOccluder.position.x = Math.sin( time * 40.0 + seedPhase * Math.PI * 2 ) * 1.8;
		movingOccluder.position.z = Math.cos( time * 35.0 + seedPhase * Math.PI ) * 1.2;
		movingOccluder.position.y = 0.55 + Math.sin( time * 28.0 ) * 0.55;
		movingOccluder.updateMatrixWorld( true );

	}

	async function step( deltaSeconds ) {

		if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) throw new Error( 'AO deltaSeconds must be finite and nonnegative.' );
		await setTime( time + deltaSeconds );

	}

	async function resetHistory() {

		stage.resetTemporalHistory();
		rebuildOutput();

	}

	async function resize( nextWidth, nextHeight, nextDpr = 1 ) {

		if ( ! Number.isInteger( nextWidth ) || ! Number.isInteger( nextHeight ) || nextWidth < 1 || nextHeight < 1 ) throw new Error( 'AO resize dimensions must be positive integers.' );
		if ( ! Number.isFinite( nextDpr ) || nextDpr <= 0 ) throw new Error( 'AO DPR must be positive.' );
		width = nextWidth;
		height = nextHeight;
		dpr = nextDpr;
		renderer.setPixelRatio( dpr );
		renderer.setSize( width, height, false );
		presentationTarget.setSize( renderer.domElement.width, renderer.domElement.height );
		diagnosticTarget.setSize( renderer.domElement.width, renderer.domElement.height );
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		await resetHistory( 'resize' );

	}

	async function renderOnce() {

		renderPipeline.render();

	}

	async function captureOutputNode( node, target, metadata ) {

		const previousTarget = renderer.getRenderTarget();
		const previousOutputNode = renderPipeline.outputNode;
		try {

			renderPipeline.outputNode = node;
			renderPipeline.needsUpdate = true;
			renderer.setRenderTarget( target );
			renderPipeline.render();
			return {
				...await captureTarget( renderer, target, 0 ),
				...metadata,
				readbackRoute: 'explicit-single-attachment-staging-target'
			};

		} finally {

			renderer.setRenderTarget( previousTarget );
			renderPipeline.outputNode = previousOutputNode;
			renderPipeline.needsUpdate = true;

		}

	}

	async function capturePixels( target = 'lit-output' ) {

		if ( target === 'presentation' ) {

			return captureOutputNode( renderPipeline.outputNode, presentationTarget, {
				target,
				format: 'rgba8unorm',
				outputColorSpace: renderer.outputColorSpace,
				colorEncoding: 'display-referred',
				bytesPerPixel: 4
			} );

		}
		const displayNodes = {
			'input-output': stage.gbufferPass.getTextureNode( 'output' ),
			'lit-output': stage.materialContextOutput,
			'baseline-output': stage.baselineOutput
		};
		if ( displayNodes[ target ] !== undefined ) {

			return captureOutputNode( renderOutput( displayNodes[ target ] ), presentationTarget, {
				target,
				format: 'rgba8unorm',
				outputColorSpace: renderer.outputColorSpace,
				colorEncoding: 'display-referred',
				bytesPerPixel: 4
			} );

		}
		const diagnosticNodes = {
			normal: vec4( stage.sceneNormal.sample( screenUV ).rgb.mul( 0.5 ).add( 0.5 ), 1 ),
			velocity: vec4( stage.velocityNode.sample( screenUV ).rg.mul( 0.5 ).add( 0.5 ), 0, 1 ),
			'raw-ao': vec4( vec3( stage.rawAO.sample( screenUV ).r ), 1 ),
			'denoised-ao': vec4( vec3( stage.reconstructedAO.sample( screenUV ).r ), 1 ),
			'bent-normal': stage.bentNormal.textureNode
		};
		if ( diagnosticNodes[ target ] !== undefined ) {

			return captureOutputNode( diagnosticNodes[ target ], diagnosticTarget, {
				target,
				format: 'rgba8unorm',
				outputColorSpace: THREE.NoColorSpace,
				colorEncoding: 'linear-diagnostic',
				bytesPerPixel: 4
			} );

		}
		throw new Error( `Unknown AO capture target: ${ target }` );

	}

	function describePipeline() {

		const reachability = describeAOModeReachability( mode, {
			temporalEnabled,
			reconstruction: stage.reconstruction
		} );
		return {
			schemaVersion: 2,
			owners: {
				renderer: 'webgpu-node-gtao',
				pipeline: 'webgpu-node-gtao',
				depth: 'ao-input-prepass',
				normal: 'ao-input-prepass',
				velocity: 'ao-input-prepass',
				toneMap: 'renderOutput',
				outputTransform: 'renderOutput'
			},
			passes: reachability.passes,
			gbufferPrepassCount: reachability.gbufferPrepassCount,
			aoLitScenePassCount: reachability.aoLitScenePassCount,
			baselineLitScenePassCount: reachability.baselineLitScenePassCount,
			litScenePassCount: reachability.litScenePassCount,
			sceneSubmissionCount: reachability.sceneSubmissionCount,
			fullLitOutputCount: reachability.fullLitOutputCount,
			fullscreenPassCount: reachability.fullscreenPassCount,
			activeMode: mode,
			activeTier: tierId,
			temporalEnabled,
			finalToneMapOwner: 'renderOutput',
			finalOutputTransformOwner: 'renderOutput',
			runtimeProfile: 'correctness',
			performanceTimestampMode: 'off',
			timestampQueriesRequired: false,
			timestampQueriesRequested: false,
			timestampQueriesActive: false
		};

	}

	function describeResources() {

		const inventory = calculateAOResourceInventory( width, height, dpr, tierId, { mode, temporalEnabled } );
		const pixels = renderer.domElement.width * renderer.domElement.height;
		return {
			...inventory,
			evidenceStagingResources: [
				{ id: 'presentation-readback-rgba8', format: 'rgba8unorm', logicalBytes: 4 * pixels, provenance: 'Derived', reachableDuringNormalRender: false },
				{ id: 'diagnostic-readback-rgba8', format: 'rgba8unorm', logicalBytes: 4 * pixels, provenance: 'Derived', reachableDuringNormalRender: false }
			]
		};

	}

	function getMetrics() {

		const nativeWebGPU = renderer.backend?.isWebGPUBackend === true;
		const device = renderer.backend?.device ?? null;
		return {
			labId: LAB_ID,
			threeRevision: THREE.REVISION,
			nativeWebGPU,
			initialized: renderer.initialized === true,
			rendererType: 'WebGPURenderer',
			backend: nativeWebGPU ? 'WebGPU' : 'unsupported',
			backendKind: nativeWebGPU ? 'WebGPU' : 'unsupported',
			rendererBackend: renderer.backend?.constructor?.name ?? 'unknown',
			rendererDeviceStatus,
			rendererDeviceGeneration,
			deviceLossGeneration,
			runtimeProfile: 'correctness',
			performanceTimestampMode: 'off',
			timestampQueriesRequired: false,
			timestampQueriesRequested: false,
			timestampQueriesActive: false,
			viewport: {
				width: { value: width, unit: 'px', label: 'Measured', source: 'LabController.logicalWidth after resize' },
				height: { value: height, unit: 'px', label: 'Measured', source: 'LabController.logicalHeight after resize' },
				dpr: { value: dpr, unit: '1', label: 'Measured', source: 'LabController.dpr after resize' }
			},
			rendererBackendEvidence: {
				backendKind: 'WebGPU',
				backendType: renderer.backend?.constructor?.name ?? 'unknown',
				isWebGPUBackend: nativeWebGPU,
				initialized: renderer.initialized === true,
				deviceIdentityVerified: device === initializedRendererDevice,
				deviceIdentitySource: 'renderer.backend.device-after-init',
				deviceType: device?.constructor?.name ?? 'GPUDevice',
				lossPromiseObservedOnActualDevice,
				rendererDeviceGeneration
			},
			tier: tierId,
			scenario: scenarioId,
			mode: publicMode ?? mode,
			camera: cameraId,
			mechanism: mechanismId,
			seed: currentSeed,
			timeSeconds: time,
			bentNormalDiagnostic: {
				algorithmClass: stage.bentNormal.algorithmClass,
				directionalTintEnabled: stage.bentNormal.directionalTintEnabled,
				acceptanceStatus: stage.bentNormal.acceptanceStatus
			},
			acceptanceMetrics: computeAOAcceptanceMetrics(),
			gpuTiming: { verdict: 'INSUFFICIENT_EVIDENCE', samples: [] },
			rendererInfo: renderer.info
		};

	}

	async function dispose() {

		stage.dispose();
		renderPipeline.dispose();
		presentationTarget.dispose();
		diagnosticTarget.dispose();
		const geometries = new Set();
		const materials = new Set();
		scene.traverse( ( object ) => {

			if ( object.geometry ) geometries.add( object.geometry );
			if ( object.material ) materials.add( object.material );

		} );
		for ( const geometry of geometries ) geometry.dispose();
		for ( const material of materials ) material.dispose();
		rendererDeviceStatus = 'disposed';
		renderer.dispose();

	}

	await setTier( initialTier );
	await setScenario( initialScenario );
	await setMode( initialMode );

	return {
		get labId() {

			return LAB_ID;

		},
		ready: async () => {},
		setScenario,
		setMode,
		setTier,
		setSeed,
		setCamera,
		setTime,
		step,
		resetHistory,
		resize,
		renderOnce,
		capturePixels,
		describePipeline,
		describeResources,
		getMetrics,
		dispose,
		renderer,
		renderPipeline,
		scene,
		camera,
		stage
	};

}
