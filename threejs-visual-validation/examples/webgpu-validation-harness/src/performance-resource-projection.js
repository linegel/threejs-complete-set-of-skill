import { HARDWARE_PERFORMANCE_CONTRACT, HARDWARE_PERFORMANCE_ROUTE_PLAN } from './in-app-evidence-plan.js';
import { parseLedgerBoundCanonicalJson } from './ledger-bound-json.js';
import { assertLabelledNumerics, numericDatum, NumericLabel } from './numeric-evidence.js';
import { createRuntimeGovernorTrace, createRuntimePerformanceTrace } from './physical-performance-trace.js';

const CORRECTNESS_ARTIFACT_PATHS = Object.freeze( [
	'renderer-info.json',
	'render-targets.json',
	'resident-resources.json',
	'bandwidth-model.json'
] );
const M = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.MEASURED, source );
const D = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.DERIVED, source );
const G = ( value, unit, source ) => numericDatum( value, unit, NumericLabel.GATED, source );

function fail( message ) {

	throw new Error( message );

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) fail( `${ label } must be an object.` );
	return value;

}

function deepFreeze( value ) {

	if ( value && typeof value === 'object' && Object.isFrozen( value ) === false ) {

		for ( const entry of Object.values( value ) ) deepFreeze( entry );
		Object.freeze( value );

	}
	return value;

}

function measuredIdentity( value, source ) {

	if ( typeof value === 'number' ) return M( value, 'adapter-property', source );
	if ( Array.isArray( value ) ) return value.map( ( entry ) => measuredIdentity( entry, source ) );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.entries( value ).map( ( [ key, entry ] ) => [ key, measuredIdentity( entry, source ) ] ) );
	return value;

}

function parseCorrectnessArtifacts( inputs ) {

	const supplied = requireObject( inputs, 'Correctness artifact inputs' );
	const documents = {};
	const bindings = {};
	for ( const path of CORRECTNESS_ARTIFACT_PATHS ) {

		const input = requireObject( supplied[ path ], `Correctness artifact input ${ path }` );
		const parsed = parseLedgerBoundCanonicalJson( {
			label: `Correctness ${ path }`,
			bytes: input.bytes,
			ledgerEntry: input.ledgerEntry,
			expectedPath: path,
			expectedKind: 'normative-json'
		} );
		if ( parsed.document?.schemaVersion !== 2 ) fail( `Correctness ${ path } must use schemaVersion 2.` );
		documents[ path ] = parsed.document;
		bindings[ path ] = { sha256: parsed.sha256, byteLength: parsed.byteLength };

	}
	return { documents, bindings };

}

function assertIdentityJoin( correctnessIdentity, verifiedPerformance, rendererInfo ) {

	const performanceIdentity = verifiedPerformance.record?.immutableBuild;
	for ( const key of [ 'sourceClosureHash', 'buildRevision', 'threeRevision' ] ) {

		if ( typeof correctnessIdentity[ key ] !== 'string' || correctnessIdentity[ key ].length === 0 ) fail( `Correctness identity omits ${ key }.` );
		if ( performanceIdentity?.[ key ] !== correctnessIdentity[ key ] ) fail( `Performance and correctness ${ key } differ.` );

	}
	if ( correctnessIdentity.threeRevision !== '0.185.1' || rendererInfo.threeRevision !== '0.185.1' ) fail( 'Performance resource projection requires Three 0.185.1 in both lanes.' );
	if ( rendererInfo.captureProfile !== 'correctness' ) fail( 'Correctness renderer-info.json must retain captureProfile=correctness.' );
	if ( rendererInfo.timestampSupport !== false ) fail( 'Correctness renderer-info.json must retain timestampSupport=false.' );

}

function targetIndex( resources, label ) {

	const rows = resources?.renderTargets;
	if ( Array.isArray( rows ) === false || rows.length !== 5 ) fail( `${ label } must contain the five validated render-target resources.` );
	const index = new Map();
	for ( const target of rows ) {

		if ( typeof target?.semantic !== 'string' || index.has( target.semantic ) ) fail( `${ label } contains an invalid or duplicate resource semantic.` );
		index.set( target.semantic, target );

	}
	return index;

}

function assertTierBindingMatchesRoute( binding, route, tier ) {

	const routeTargets = targetIndex( route.resources, `Performance route ${ tier } resources` );
	const boundTargets = [ binding.resources?.captureTarget, ...( binding.resources?.sceneMrt ?? [] ) ];
	if ( boundTargets.length !== 4 ) fail( `Tier visual evidence ${ tier } does not bind capture plus three scene-MRT resources.` );
	for ( const bound of boundTargets ) {

		const routeTarget = routeTargets.get( bound?.semantic );
		if ( routeTarget === undefined ) fail( `Tier visual evidence ${ tier } binds an unknown resource semantic.` );
		for ( const field of [ 'semantic', 'owner', 'targetName', 'width', 'height', 'format', 'bytes', 'logicalBytes', 'liveBytes', 'liveness' ] ) {

			if ( bound[ field ] !== routeTarget[ field ] ) fail( `Tier visual evidence ${ tier } resource ${ bound.semantic}.${ field } differs from the hardware route inventory.` );

		}

	}
}

function projectTarget( target, tier ) {

	const source = `validated hardware route tier/${ tier } LabController.describeResources`;
	return {
		semantic: target.semantic,
		owner: target.owner,
		targetName: target.targetName,
		textureUuid: target.textureUuid,
		format: target.format,
		liveness: target.liveness,
		width: M( target.width, 'pixel', source ),
		height: M( target.height, 'pixel', source ),
		depth: M( target.depth, 'texel-layer', source ),
		sampleCount: M( target.sampleCount, 'sample/pixel', source ),
		bytesPerTexel: M( target.bytesPerTexel, 'byte/texel', source ),
		bytes: D( target.bytes, 'byte', `${ target.width } x ${ target.height } x ${ target.depth } x ${ target.sampleCount } x ${ target.bytesPerTexel }` ),
		logicalBytes: D( target.logicalBytes, 'byte', 'validated target byte formula' ),
		liveBytes: M( target.liveBytes, 'byte', source )
	};

}

function projectTierInventory( route, plan ) {

	const source = `validated hardware route ${ plan.key }`;
	const targets = route.resources.renderTargets.map( ( target ) => projectTarget( target, plan.id ) );
	return {
		tier: plan.id,
		routeKey: plan.key,
		resourceDigest: route.resourceDigest,
		viewport: {
			width: G( plan.startup.width, 'pixel', 'immutable hardware performance route lock' ),
			height: G( plan.startup.height, 'pixel', 'immutable hardware performance route lock' ),
			dpr: G( plan.startup.dpr, 'ratio', 'immutable hardware performance route lock' )
		},
		targets,
		trackedRenderTargetBytes: D( route.resources.trackedRenderTargetBytes, 'byte', `${ source } target live-byte sum` ),
		nonTargetResidency: {
			status: 'NOT_CLAIMED',
			reason: 'This projection claims only the validated target inventory; complete non-target and renderer-internal residency is unavailable.'
		}
	};

}

function projectBandwidthTier( inventory, refreshPeriodMs ) {

	const bytes = inventory.trackedRenderTargetBytes.value;
	const presentationRate = 1000 / refreshPeriodMs;
	return {
		tier: inventory.tier,
		logicalLowerBoundBytesPerFrame: D( bytes, 'byte/frame', 'one logical store per validated lab-owned render target' ),
		logicalUpperBoundBytesPerFrame: D( bytes * 2, 'byte/frame', 'conservative logical load-plus-store bound' ),
		presentationRate: D( presentationRate, 'frame/s', '1000 ms/s divided by measured refresh p50' ),
		logicalLowerBoundBytesPerSecond: D( bytes * presentationRate, 'byte/s', 'logical lower bound bytes/frame multiplied by derived presentation rate' ),
		hardwareCountersAvailable: false,
		verdict: 'INSUFFICIENT_EVIDENCE'
	};

}

function projectCorrectnessArtifactBinding( binding, path ) {

	return {
		sha256: binding.sha256,
		byteLength: M( binding.byteLength, 'byte', `correctness evidence-manifest ledger entry for ${ path }` )
	};

}

export function projectValidationHarnessPerformanceResources( input ) {

	const verifiedPerformance = requireObject( input?.verifiedPerformance, 'Verified performance input' );
	const correctnessIdentity = requireObject( input?.correctnessIdentity, 'Correctness identity' );
	createRuntimePerformanceTrace( verifiedPerformance );
	const tierEvidence = parseLedgerBoundCanonicalJson( {
		label: 'Tier visual evidence',
		bytes: input.tierVisualEvidenceBytes,
		ledgerEntry: input.tierVisualEvidenceLedgerEntry,
		expectedPath: 'tier-visual-evidence.json',
		expectedKind: 'supplementary-json'
	} );
	createRuntimeGovernorTrace( verifiedPerformance, tierEvidence.document );
	const correctness = parseCorrectnessArtifacts( input.correctnessArtifacts );
	assertIdentityJoin( correctnessIdentity, verifiedPerformance, correctness.documents[ 'renderer-info.json' ] );

	const routesByTier = new Map( verifiedPerformance.record.routes.map( ( route ) => [ route.id, route ] ) );
	const tierBindings = {
		'target-performance': tierEvidence.document.binding.reference,
		'governor-stress': tierEvidence.document.binding.candidate
	};
	const inventories = HARDWARE_PERFORMANCE_ROUTE_PLAN.map( ( plan ) => {

		const route = routesByTier.get( plan.id );
		if ( route === undefined ) fail( `Verified hardware performance record omits ${ plan.key }.` );
		assertTierBindingMatchesRoute( tierBindings[ plan.id ], route, plan.id );
		return projectTierInventory( route, plan );

	} );
	const refreshPeriodMs = verifiedPerformance.record.refresh.p50.value;
	const record = verifiedPerformance.record;
	const rendererPerformanceLane = {
		profile: 'performance',
		automationSurface: record.automationSurface,
		adapterClass: record.adapter.adapterClass,
		adapterIdentity: measuredIdentity( record.adapter.identity, 'hardware performance session adapter identity' ),
		browser: measuredIdentity( record.browser, 'hardware performance session browser identity' ),
		viewport: {
			width: G( HARDWARE_PERFORMANCE_CONTRACT.viewport.width.value, 'pixel', 'hardware performance contract' ),
			height: G( HARDWARE_PERFORMANCE_CONTRACT.viewport.height.value, 'pixel', 'hardware performance contract' ),
			dpr: G( HARDWARE_PERFORMANCE_CONTRACT.viewport.dpr.value, 'ratio', 'hardware performance contract' )
		},
		refresh: structuredClone( record.refresh ),
		timestampSupport: true,
		colorContract: { resourceFormat: 'rgba8unorm-srgb', copyFormat: 'rgba8unorm', outputColorSpace: 'srgb' },
		captureSession: {
			documentSha256: verifiedPerformance.sourceDocumentSha256,
			recordSha256: verifiedPerformance.recordSha256,
			servedLedgerSha256: verifiedPerformance.servedLedgerSha256
		},
		sourceClosureHash: correctnessIdentity.sourceClosureHash,
		buildRevision: correctnessIdentity.buildRevision,
		threeRevision: correctnessIdentity.threeRevision
	};
	const transition = record.governor.trace.transitions[ 0 ];
	const performanceTransition = {
		from: transition.from,
		to: transition.to,
		fromResourceBytes: M( transition.fromResourceBytes, 'byte', 'hardware governor transition pre-rebuild target inventory' ),
		toResourceBytes: M( transition.toResourceBytes, 'byte', 'hardware governor transition post-rebuild target inventory' ),
		peakSimultaneousLiveBytes: {
			status: 'NOT_CLAIMED',
			value: null,
			reason: 'The current WebGPU/Three instrumentation does not expose simultaneous old/new internal target liveness during the rebuild.'
		}
	};
	const projectedSections = {
		rendererPerformanceLane,
		inventories,
		performanceTransition,
		bandwidthTiers: inventories.map( ( inventory ) => projectBandwidthTier( inventory, refreshPeriodMs ) )
	};
	for ( const value of Object.values( projectedSections ) ) assertLabelledNumerics( value, { allowedBarePaths: [] } );

	const artifacts = {
		'renderer-info.json': {
			...structuredClone( correctness.documents[ 'renderer-info.json' ] ),
			correctnessLaneArtifact: projectCorrectnessArtifactBinding( correctness.bindings[ 'renderer-info.json' ], 'renderer-info.json' ),
			performanceLane: rendererPerformanceLane
		},
		'render-targets.json': {
			...structuredClone( correctness.documents[ 'render-targets.json' ] ),
			correctnessLaneArtifact: projectCorrectnessArtifactBinding( correctness.bindings[ 'render-targets.json' ], 'render-targets.json' ),
			performanceTierInventories: inventories,
			performanceTransition
		},
		'resident-resources.json': {
			...structuredClone( correctness.documents[ 'resident-resources.json' ] ),
			correctnessLaneArtifact: projectCorrectnessArtifactBinding( correctness.bindings[ 'resident-resources.json' ], 'resident-resources.json' ),
			performanceTierInventories: inventories.map( ( inventory ) => ( {
				tier: inventory.tier,
				resourceDigest: inventory.resourceDigest,
				trackedRenderTargetBytes: inventory.trackedRenderTargetBytes,
				targets: inventory.targets.map( ( target ) => ( { semantic: target.semantic, textureUuid: target.textureUuid, liveBytes: target.liveBytes } ) ),
				nonTargetResidency: inventory.nonTargetResidency
			} ) ),
			opaqueRendererInternalResidency: {
				status: 'NOT_CLAIMED',
				reason: 'No WebGPU API exposes complete physical renderer-internal residency.'
			}
		},
		'bandwidth-model.json': {
			...structuredClone( correctness.documents[ 'bandwidth-model.json' ] ),
			correctnessLaneArtifact: projectCorrectnessArtifactBinding( correctness.bindings[ 'bandwidth-model.json' ], 'bandwidth-model.json' ),
			performanceTierModels: projectedSections.bandwidthTiers,
			hardwareBandwidthVerdict: 'NOT_CLAIMED'
		}
	};
	return deepFreeze( {
		artifacts,
		projectionBinding: {
			performanceSessionDocumentSha256: verifiedPerformance.sourceDocumentSha256,
			performanceRecordSha256: verifiedPerformance.recordSha256,
			performanceServedLedgerSha256: verifiedPerformance.servedLedgerSha256,
			tierVisualEvidenceSha256: tierEvidence.sha256,
			correctnessArtifacts: correctness.bindings,
			sourceClosureHash: correctnessIdentity.sourceClosureHash,
			buildRevision: correctnessIdentity.buildRevision,
			threeRevision: correctnessIdentity.threeRevision
		}
	} );

}
