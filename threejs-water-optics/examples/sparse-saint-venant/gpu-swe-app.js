import { Color, InstancedMesh, Matrix4, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, color, float, instanceIndex, mix, positionLocal, select, vec3 } from 'three/tsl';
import { deriveSweGpuContract } from './gpu-swe-contract.js';
import { createGpuSparseSweOwner } from './gpu-swe-owner.js';
import { finiteDepthAngularFrequency } from './offshore-boundary.js';
import { commitSparseTiles, createSparseTileDomain, prepareSparseTileCommit } from './sparse-tile-domain.js';

const params = new URLSearchParams( location.search );
const tierId = params.get( 'tier' ) ?? 'budgeted';
const contract = deriveSweGpuContract( tierId );
const receiverCapacityKgPerM2 = 0.6;
const canvas = document.getElementById( 'lab-canvas' );
const status = document.getElementById( 'status' );
const diagnosticButton = document.getElementById( 'diagnostic' );
const rollbackButton = document.getElementById( 'rollback' );
const sustainedButton = document.getElementById( 'sustained' );
const renderer = new WebGPURenderer( { canvas, antialias: false, trackTimestamp: false } );
renderer.setPixelRatio( Math.min( devicePixelRatio, tierId === 'full' ? 1.5 : 1 ) );
const scene = new Scene();
scene.background = new Color( 0x071d2a );
const camera = new PerspectiveCamera( 42, 1, 0.01, 100 );
const controls = new OrbitControls( camera, canvas );
controls.enableDamping = true;
let residentFrame = { centerX: 0, centerZ: 0, spanMeters: 4 };

function setCamera( cameraId ) {

	const { centerX, centerZ, spanMeters } = residentFrame;
	if ( cameraId === 'top' ) camera.position.set( centerX, spanMeters * 2.2, centerZ + 0.001 );
	else if ( cameraId === 'profile' ) camera.position.set( centerX + spanMeters * 2.2, spanMeters * 0.45, centerZ + 0.01 );
	else camera.position.set( centerX + spanMeters * 1.3, spanMeters * 1.1, centerZ + spanMeters * 1.3 );
	controls.target.set( centerX, 0, centerZ );
	controls.update();

}

addEventListener( 'keydown', ( event ) => {

	if ( event.key === '1' ) setCamera( 'hero' );
	if ( event.key === '2' ) setCamera( 'top' );
	if ( event.key === '3' ) setCamera( 'profile' );

} );

const sparseDomain = createSparseTileDomain( {
	tilesX: contract.tier.logicalTilesX,
	tilesZ: contract.tier.logicalTilesZ,
	tileSize: contract.tier.tileSize,
	capacityTiles: contract.tier.capacityTiles,
	deactivationTicks: 8
} );
const activationReasons = [
	{ tileX: 0, tileZ: 2, wetCellCount: contract.tier.tileSize ** 2 },
	{ tileX: 1, tileZ: 2, wetCellCount: contract.tier.tileSize ** 2 },
	{ tileX: 2, tileZ: 2, wetCellCount: contract.tier.tileSize ** 2 },
	{ tileX: 1, tileZ: 3, wetCellCount: Math.floor( contract.tier.tileSize ** 2 * 0.5 ) }
];
const sparseCommit = commitSparseTiles( sparseDomain, prepareSparseTileCommit( sparseDomain, activationReasons ) );
const totalCellsX = contract.tier.logicalTilesX * contract.tier.tileSize;
const totalCellsZ = contract.tier.logicalTilesZ * contract.tier.tileSize;

function initialCondition( { globalCellX, globalCellZ } ) {

	const normalizedX = ( globalCellX + 0.5 - contract.tier.tileSize * 1.6 ) / contract.tier.tileSize;
	const normalizedZ = ( globalCellZ + 0.5 - contract.tier.tileSize * 2.6 ) / contract.tier.tileSize;
	const island = 0.115 * Math.exp( -( normalizedX * normalizedX * 5 + normalizedZ * normalizedZ * 7 ) );
	const bedElevationMeters = -0.105 + island + normalizedX * 0.012;
	const freeSurface = 0;
	const depthMeters = Math.max( 0, freeSurface - bedElevationMeters );
	return { depthMeters, xDischargeM2ps: depthMeters * 0.08, zDischargeM2ps: 0, bedElevationMeters };

}

let owner;
let pausedForDiagnostic = false;
let priorTime = null;
let frameCount = 0;
let stoppedByGpuError = false;
const gpuErrors = [];
let lastDiagnosticSummary = '';
let display = null;
let appDisposed = false;

function resize() {

	const width = Math.max( canvas.clientWidth, 1 );
	const height = Math.max( canvas.clientHeight, 1 );
	const dpr = renderer.getPixelRatio();
	if ( canvas.width !== Math.round( width * dpr ) || canvas.height !== Math.round( height * dpr ) ) renderer.setSize( width, height, false );
	camera.aspect = width / height;
	camera.updateProjectionMatrix();

}

function buildDisplayMesh() {

	const geometry = new PlaneGeometry( contract.tier.cellSizeMeters * 0.94, contract.tier.cellSizeMeters * 0.94, 1, 1 );
	geometry.rotateX( -Math.PI / 2 );
	const material = new MeshBasicNodeMaterial();
	const stateIndex = owner.displayIndexNode.element( instanceIndex.toUint() );
	const state = owner.committedStateNode.element( stateIndex );
	const foamCoverage = owner.foamCommittedNode.element( stateIndex );
	const obstacleFraction = owner.obstacleNode.element( stateIndex ).x;
	const receiverCoverage = clamp( owner.receiverCommittedNode.element( stateIndex ).div( receiverCapacityKgPerM2 ), 0, 1 );
	const depthRatio = clamp( state.x.div( float( contract.tier.maximumDepthMeters ) ), 0, 1 );
	const baseWetColor = mix( color( 0x45e0e8 ), color( 0x0756a8 ), depthRatio );
	const wetColor = mix( baseWetColor, color( 0x2a877e ), receiverCoverage.mul( float( 1 ).sub( depthRatio ) ).mul( 0.35 ) );
	const foamedWaterColor = mix( mix( wetColor, color( 0x263b43 ), obstacleFraction.mul( 0.8 ) ), color( 0xf4fbf1 ), clamp( foamCoverage.mul( 1.4 ), 0, 1 ) );
	const baseDryColor = mix( color( 0xc6a56c ), color( 0x426653 ), clamp( state.w.add( 0.12 ).mul( 5 ), 0, 1 ) );
	const dryColor = mix( baseDryColor, color( 0x304f3d ), receiverCoverage.mul( 0.7 ) );
	material.colorNode = select( state.x.lessThan( -1e-6 ), color( 0xff00cc ), select( state.x.greaterThan( 1e-5 ), foamedWaterColor, dryColor ) );
	// positionLocal already contains the InstancedMesh transform when the custom
	// position node is assigned; positionGeometry would collapse every cell to
	// the source plane at the origin in r185.
	material.positionNode = positionLocal.add( vec3( 0, state.x.add( state.w ), 0 ) );
	const mesh = new InstancedMesh( geometry, material, owner.initial.residentCellCount );
	const matrix = new Matrix4();
	for ( let instance = 0; instance < owner.initial.residentCellCount; instance += 1 ) {

		const cell = owner.initial.displayCells[ instance ];
		const worldX = ( cell.globalCellX + 0.5 - totalCellsX * 0.5 ) * contract.tier.cellSizeMeters;
		const worldZ = ( cell.globalCellZ + 0.5 - totalCellsZ * 0.5 ) * contract.tier.cellSizeMeters;
		matrix.makeTranslation( worldX, 0, worldZ );
		mesh.setMatrixAt( instance, matrix );

	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.frustumCulled = false;
	return mesh;

}

function measureResidentFrame() {

	const points = owner.initial.displayCells.map( ( cell ) => ( {
		x: ( cell.globalCellX + 0.5 - totalCellsX * 0.5 ) * contract.tier.cellSizeMeters,
		z: ( cell.globalCellZ + 0.5 - totalCellsZ * 0.5 ) * contract.tier.cellSizeMeters
	} ) );
	const xValues = points.map( ( point ) => point.x );
	const zValues = points.map( ( point ) => point.z );
	const minX = Math.min( ...xValues );
	const maxX = Math.max( ...xValues );
	const minZ = Math.min( ...zValues );
	const maxZ = Math.max( ...zValues );
	return Object.freeze( {
		centerX: ( minX + maxX ) * 0.5,
		centerZ: ( minZ + maxZ ) * 0.5,
		spanMeters: Math.max( maxX - minX + contract.tier.cellSizeMeters, maxZ - minZ + contract.tier.cellSizeMeters, 0.4 )
	} );

}

async function captureDiagnostic() {

	pausedForDiagnostic = true;
	diagnosticButton.disabled = true;
	diagnosticButton.textContent = 'Reading committed state…';
	try {

		const diagnostic = await owner.captureDiagnostics();
		lastDiagnosticSummary = `ledger gen ${ diagnostic.committedGeneration } · wet ${ diagnostic.wetCells } · invalid ${ diagnostic.invalidCells } · negative ${ diagnostic.negativeDepthCells } · accepted ${ diagnostic.acceptedCommits } · rejected ${ diagnostic.rejectedCommits } · interaction seq ${ diagnostic.committedInteractionSequence } / batches ${ diagnostic.committedInteractionBatches } / impulse q x ${ diagnostic.interactionImpulseXPositiveQuanta - diagnostic.interactionImpulseXNegativeQuanta } z ${ diagnostic.interactionImpulseZPositiveQuanta - diagnostic.interactionImpulseZNegativeQuanta } · receiver seq ${ diagnostic.committedReceiverExchangeSequence } / batches ${ diagnostic.committedReceiverExchangeBatches } / wet ${ diagnostic.receiverWetCells } / coverage q ${ diagnostic.receiverCoverageQuanta } / transfer depth q ${ diagnostic.receiverTransferDepthQuanta } / invalid ${ diagnostic.receiverInvalidCells } / runoff q ${ diagnostic.receiverRunoffQuanta } · obstacle cells ${ diagnostic.activeObstacleCells } / reaction q x ${ diagnostic.obstacleReactionXPositiveQuanta - diagnostic.obstacleReactionXNegativeQuanta } z ${ diagnostic.obstacleReactionZPositiveQuanta - diagnostic.obstacleReactionZNegativeQuanta } / energy q ${ diagnostic.obstacleDissipatedEnergyQuanta } / committed reaction q x ${ diagnostic.committedObstacleReactionXPositiveQuanta - diagnostic.committedObstacleReactionXNegativeQuanta } z ${ diagnostic.committedObstacleReactionZPositiveQuanta - diagnostic.committedObstacleReactionZNegativeQuanta } / committed steps ${ diagnostic.committedObstacleSteps } / committed energy q ${ diagnostic.committedObstacleDissipatedEnergyQuanta } · foam ${ diagnostic.foamCoveredCells } cells / ${ diagnostic.foamCoverageQuanta } coverage q / ${ diagnostic.foamSourceRateQuanta } source q / clamps ${ diagnostic.foamClampCells } · depth q prior ${ diagnostic.priorDepthQuanta } / candidate ${ diagnostic.candidateDepthQuanta } · net flux ${ diagnostic.netFluxInfluxDepthQuanta } in / ${ diagnostic.netFluxOutfluxDepthQuanta } out · boundary ${ diagnostic.boundaryInfluxDepthQuanta } in / ${ diagnostic.boundaryOutfluxDepthQuanta } out · internal residual ${ diagnostic.internalFluxCancellationDepthQuanta }`;
		status.textContent = `READY · NATIVE WEBGPU · ${ tierId.toUpperCase() } · ${ lastDiagnosticSummary }`;
		return diagnostic;

	} finally {

		diagnosticButton.disabled = false;
		diagnosticButton.textContent = 'Capture committed-state diagnostic';
		pausedForDiagnostic = false;

	}

}

async function runRollbackMutation() {

	pausedForDiagnostic = true;
	diagnosticButton.disabled = true;
	rollbackButton.disabled = true;
	rollbackButton.textContent = 'Proving rollback…';
	try {

		const before = await owner.captureDiagnostics();
		owner.dispatchRollbackMutationProbe();
		const after = await owner.captureDiagnostics();
		const rollbackPassed = after.negativeDepthCells >= 1
			&& after.committedGeneration === before.committedGeneration
			&& after.acceptedCommits === before.acceptedCommits
			&& after.rejectedCommits === before.rejectedCommits + 1
			&& after.committedReceiverExchangeSequence === before.committedReceiverExchangeSequence
			&& after.committedReceiverExchangeBatches === before.committedReceiverExchangeBatches
			&& after.committedObstacleSteps === before.committedObstacleSteps
			&& after.committedObstacleDissipatedEnergyQuanta === before.committedObstacleDissipatedEnergyQuanta;
		if ( ! rollbackPassed ) throw new Error( `rollback mutation was admitted: before=${ JSON.stringify( before ) } after=${ JSON.stringify( after ) }` );
		lastDiagnosticSummary = `ROLLBACK PASS · injected negative ${ after.negativeDepthCells } · generation held ${ after.committedGeneration } · accepted held ${ after.acceptedCommits } · rejected ${ before.rejectedCommits }→${ after.rejectedCommits }`;
		status.textContent = `READY · NATIVE WEBGPU · ${ tierId.toUpperCase() } · ${ lastDiagnosticSummary }`;
		return Object.freeze( { passed: true, before, after } );

	} finally {

		diagnosticButton.disabled = false;
		rollbackButton.disabled = false;
		rollbackButton.textContent = 'Run rollback mutation';
		pausedForDiagnostic = false;

	}

}

async function runSustainedDiagnostic( presentationFrames = 120 ) {

	if ( ! Number.isInteger( presentationFrames ) || presentationFrames < 60 || presentationFrames > 240 ) throw new Error( 'sustained presentation frames must be an integer in [60, 240]' );
	for ( const button of [ diagnosticButton, rollbackButton, sustainedButton ] ) button.disabled = true;
	sustainedButton.textContent = `Running ${ presentationFrames } frames…`;
	pausedForDiagnostic = true;
	try {

		const before = await owner.captureDiagnostics();
		const descriptionBefore = owner.describe();
		pausedForDiagnostic = false;
		const startMilliseconds = performance.now();
		for ( let frame = 0; frame < presentationFrames; frame += 1 ) await new Promise( ( resolve ) => requestAnimationFrame( resolve ) );
		const elapsedMilliseconds = performance.now() - startMilliseconds;
		pausedForDiagnostic = true;
		const after = await owner.captureDiagnostics();
		const descriptionAfter = owner.describe();
		const passed = after.invalidCells === 0 && after.negativeDepthCells === 0
			&& after.rejectedCommits === before.rejectedCommits
			&& after.committedGeneration > before.committedGeneration
			&& after.committedReceiverExchangeSequence === before.committedReceiverExchangeSequence
			&& after.committedReceiverExchangeBatches === before.committedReceiverExchangeBatches
			&& after.committedObstacleSteps > before.committedObstacleSteps
			&& descriptionAfter.frameCriticalReadbackCount === 0
			&& gpuErrors.length === 0;
		if ( ! passed ) throw new Error( `sustained diagnostic failed: before=${ JSON.stringify( before ) } after=${ JSON.stringify( after ) } errors=${ JSON.stringify( gpuErrors ) }` );
		lastDiagnosticSummary = `SUSTAIN PASS · ${ presentationFrames } presentation frames / ${ ( elapsedMilliseconds / 1000 ).toFixed( 2 ) } s · generations +${ after.committedGeneration - before.committedGeneration } · dispatches +${ descriptionAfter.dispatchCount - descriptionBefore.dispatchCount } · invalid 0 · negative 0 · rejected +0 · 0 frame readbacks · GPU time NOT CLAIMED`;
		status.textContent = `READY · NATIVE WEBGPU · ${ tierId.toUpperCase() } · ${ lastDiagnosticSummary }`;
		return Object.freeze( { passed: true, presentationFrames, elapsedMilliseconds, before, after, descriptionBefore, descriptionAfter, gpuTimingClaim: null } );

	} finally {

		pausedForDiagnostic = false;
		for ( const button of [ diagnosticButton, rollbackButton, sustainedButton ] ) button.disabled = false;
		sustainedButton.textContent = 'Run 120-frame sustain';

	}

}

function formatGpuError( event ) {

	return `${ event.error?.constructor?.name ?? 'GPUError' }: ${ event.error?.message ?? 'unknown uncaptured GPU error' }`;

}

async function disposeApp() {

	if ( appDisposed ) return Object.freeze( { passed: true, idempotent: true, owner: owner?.describe() ?? null } );
	appDisposed = true;
	pausedForDiagnostic = true;
	for ( const button of [ diagnosticButton, rollbackButton, sustainedButton ] ) button.disabled = true;
	renderer.setAnimationLoop( null );
	const device = renderer.backend.device;
	const before = owner.describe();
	await device.queue.onSubmittedWorkDone();
	owner.dispose();
	display?.geometry.dispose();
	display?.material.dispose();
	controls.dispose();
	renderer.dispose();
	const loss = await device.lost;
	if ( loss.reason !== 'destroyed' ) throw new Error( `owned WebGPU device disposal resolved as '${ loss.reason ?? 'unknown' }'` );
	const after = owner.describe();
	if ( after.disposed !== true ) throw new Error( 'GPU SWE owner did not enter disposed state' );
	return Object.freeze( {
		passed: true,
		idempotent: false,
		queueSettlement: 'GPUQueue.onSubmittedWorkDone-resolved',
		deviceLossReason: loss.reason,
		ownerBefore: before,
		ownerAfter: after,
		gpuErrors: Object.freeze( [ ...gpuErrors ] )
	} );

}

async function verifyNativeBootstrap( device ) {

	status.textContent = 'VERIFYING NATIVE WEBGPU COMPUTE GRAPH…';
	let interactionRollbackProof = null;
	if ( params.get( 'interactionRollback' ) === '1' ) {

		owner.dispatchRollbackMutationProbe();
		await device.queue.onSubmittedWorkDone();
		const rejected = await owner.captureDiagnostics();
		if ( rejected.negativeDepthCells < 1 || rejected.committedGeneration !== 0 || rejected.acceptedCommits !== 0 || rejected.rejectedCommits !== 1
			|| rejected.committedInteractionBatches !== 0 || rejected.committedInteractionSequence !== 0
			|| rejected.committedReceiverExchangeBatches !== 0 || rejected.committedReceiverExchangeSequence !== 0
			|| rejected.committedObstacleSteps !== 0 || rejected.committedObstacleDissipatedEnergyQuanta !== 0 ) throw new Error( `joint interaction/receiver/obstacle rollback bootstrap mutation escaped: ${ JSON.stringify( rejected ) }` );
		interactionRollbackProof = Object.freeze( { rejected } );

	}
	owner.dispatchFixedStep();
	await device.queue.onSubmittedWorkDone();
	if ( gpuErrors.length > 0 ) throw new Error( gpuErrors[ 0 ] );
	const diagnostic = await owner.captureDiagnostics();
	if ( gpuErrors.length > 0 ) throw new Error( gpuErrors[ 0 ] );
	const expectedRejectedCommits = interactionRollbackProof === null ? 0 : 1;
	if ( diagnostic.invalidCells !== 0 || diagnostic.negativeDepthCells !== 0 || diagnostic.committedGeneration !== 1 || diagnostic.acceptedCommits !== 1 || diagnostic.rejectedCommits !== expectedRejectedCommits
		|| diagnostic.committedInteractionBatches !== 1 || diagnostic.committedInteractionSequence !== 1
		|| diagnostic.committedReceiverExchangeBatches !== 1 || diagnostic.committedReceiverExchangeSequence !== 1 || diagnostic.receiverInvalidCells !== 0
		|| diagnostic.committedObstacleSteps !== 1 ) {

		throw new Error( `bootstrap transaction rejected: ${ JSON.stringify( diagnostic ) }` );

	}
	return Object.freeze( { ...diagnostic, interactionRollbackProof } );

}

async function boot() {

	await renderer.init();
	if ( renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Sparse Saint-Venant route requires native WebGPU' );
	const device = renderer.backend.device;
	device.addEventListener( 'uncapturederror', ( event ) => {

		const message = formatGpuError( event );
		gpuErrors.push( message );
		stoppedByGpuError = true;
		status.textContent = `FAILED GPU: ${ message }`;

	} );
	device.lost.then( ( info ) => {

		if ( info.reason === 'destroyed' ) return;
		const message = `device lost (${ info.reason ?? 'unknown' }): ${ info.message ?? 'no detail' }`;
		gpuErrors.push( message );
		stoppedByGpuError = true;
		status.textContent = `FAILED GPU: ${ message }`;

	} );
	const boundaryDepthMeters = 0.105;
	const boundaryWavenumber = 0.6;
	const boundaryOmega = finiteDepthAngularFrequency( { wavenumberRadPerMeter: boundaryWavenumber, depthMeters: boundaryDepthMeters } );
	const gridOriginXMeters = -totalCellsX * contract.tier.cellSizeMeters * 0.5;
	const gridOriginZMeters = -totalCellsZ * contract.tier.cellSizeMeters * 0.5;
	const sourceCellX = contract.tier.tileSize * 0.75 + 0.25;
	const sourceCellZ = contract.tier.tileSize * 2.5 + 0.25;
	const sourcePointMeters = [ gridOriginXMeters + ( sourceCellX + 0.5 ) * contract.tier.cellSizeMeters, 0, gridOriginZMeters + ( sourceCellZ + 0.5 ) * contract.tier.cellSizeMeters ];
	const denseCellCount = totalCellsX * totalCellsZ;
	const receiverMask = new Uint8Array( denseCellCount );
	const receiverAvailableCapacityKgPerM2 = new Float64Array( denseCellCount );
	for ( let globalCellZ = 0; globalCellZ < totalCellsZ; globalCellZ += 1 ) for ( let globalCellX = 0; globalCellX < totalCellsX; globalCellX += 1 ) {

		const denseIndex = globalCellZ * totalCellsX + globalCellX;
		const { depthMeters } = initialCondition( { globalCellX, globalCellZ } );
		const isCoastalReceiver = depthMeters >= 0.01 && depthMeters <= 0.045;
		receiverMask[ denseIndex ] = isCoastalReceiver ? 1 : 0;
		receiverAvailableCapacityKgPerM2[ denseIndex ] = isCoastalReceiver ? receiverCapacityKgPerM2 : 0;

	}
	owner = createGpuSparseSweOwner( renderer, {
		tierId,
		preparedCommit: sparseCommit,
		initialCondition,
		interactionBatch: {
			sequence: 1,
			waterDensityKgPerM3: 1025,
			originXMeters: gridOriginXMeters,
			originZMeters: gridOriginZMeters,
			balanceReferencePointMeters: [ 0, 0, 0 ],
			interactions: [ {
				interactionId: 'diagnostic-skiff-panel-impulse', applicationLedgerKey: 'diagnostic-skiff-panel-impulse:1', applicationIntervalKey: 'sparse-swe:0..1', role: 'source',
				targetStateEquation: 'saint-venant-horizontal-momentum',
				payload: { tag: 'pointImpulse', timeSemantics: 'interval-integrated', linearImpulseNs: [ 1, 0, -0.35 ], applicationPointMeters: sourcePointMeters }
			} ]
		},
		receiverExchange: {
			sequence: 1,
			receiverMask,
			receiverAvailableCapacityKgPerM2,
			capacityKgPerM2: receiverCapacityKgPerM2,
			waterDensityKgPerM3: 1025,
			uptakeRateKgPerM2S: 18,
			lossRatePerSecond: 0.015,
			wetDepthThresholdMeters: 0.01,
			minimumRetainedDepthMeters: 0.005,
			waterOwnerId: 'sparse-swe-water',
			waterStateVersion: 'water:0',
			receiverOwnerId: 'coastal-sand-liquid',
			receiverMomentumOwnerId: 'coastal-terrain-momentum',
			receiverStateVersion: 'coastal-sand:0',
			applicationIntervalKey: 'coastal-clock:0..1',
			commitGroupId: 'water-receiver:0..1'
		},
		obstacleField: {
			normalDragRatePerSecond: 10,
			tangentDragRatePerSecond: 0.8,
			waterDensityKgPerM3: 1025,
			reactionOwnerId: 'coastal-breakwater-momentum',
			sample: ( { globalCellX, globalCellZ } ) => {

				const pilingX = Math.round( contract.tier.tileSize * 0.75 );
				const firstZ = Math.round( contract.tier.tileSize * 2.2 );
				const lastZ = Math.round( contract.tier.tileSize * 2.9 );
				return globalCellX === pilingX && globalCellZ >= firstZ && globalCellZ <= lastZ ? { fraction: 0.68, normalX: 1, normalZ: 0 } : null;

			}
		},
		openBoundary: {
			side: 'west',
			mode: { modeId: 'minimum-tier-normal-swell', waveVectorRadPerMeter: [ boundaryWavenumber, 0 ], wavenumberRadPerMeter: boundaryWavenumber, amplitudeMeters: 0.015, phaseAtReferenceRadians: 0, intrinsicAngularFrequencyRadPerSecond: boundaryOmega },
			meanCurrentMps: [ 0.08, 0 ], characteristicDepthMeters: boundaryDepthMeters, surfaceDatumMeters: 0,
			phaseReferenceSeconds: 0,
			gridOriginMeters: [ gridOriginXMeters, gridOriginZMeters ],
			reflectionAmplitudeGate: 0.02
		}
	} );
	residentFrame = measureResidentFrame();
	setCamera( params.get( 'camera' ) ?? 'hero' );
	display = buildDisplayMesh();
	scene.add( display );
	const bootstrapDiagnostic = await verifyNativeBootstrap( device );
	diagnosticButton.disabled = false;
	rollbackButton.disabled = false;
	sustainedButton.disabled = false;
	diagnosticButton.addEventListener( 'click', captureDiagnostic );
	rollbackButton.addEventListener( 'click', runRollbackMutation );
	sustainedButton.addEventListener( 'click', () => runSustainedDiagnostic() );
	window.__sparseSwe = Object.freeze( { ready: true, owner, contract, sparseCommit, setCamera, captureDiagnostic, runRollbackMutation, runSustainedDiagnostic, dispose: disposeApp, bootstrapDiagnostic, gpuErrors } );
	const interactionRollbackSummary = bootstrapDiagnostic.interactionRollbackProof === null ? '' : ` · joint rollback held interaction seq ${ bootstrapDiagnostic.interactionRollbackProof.rejected.committedInteractionSequence} / receiver seq ${ bootstrapDiagnostic.interactionRollbackProof.rejected.committedReceiverExchangeSequence } then retry committed interaction seq ${ bootstrapDiagnostic.committedInteractionSequence } / receiver seq ${ bootstrapDiagnostic.committedReceiverExchangeSequence }`;
	status.textContent = `READY · NATIVE WEBGPU · ${ tierId.toUpperCase() } · verified gen ${ bootstrapDiagnostic.committedGeneration } · ${ owner.initial.residentTileCount }/${ contract.tier.logicalTilesX * contract.tier.logicalTilesZ } tiles · ${ owner.initial.residentCellCount } cells · ${ contract.totalLogicalBytes } logical bytes${ interactionRollbackSummary }`;
	renderer.setAnimationLoop( ( time ) => {

		resize();
		const deltaSeconds = priorTime === null ? contract.tier.fixedTimeStepSeconds : Math.min( 0.1, ( time - priorTime ) / 1000 );
		priorTime = time;
		if ( ! pausedForDiagnostic && ! stoppedByGpuError ) owner.advancePresentationDelta( deltaSeconds );
		controls.update();
		renderer.render( scene, camera );
		frameCount += 1;
		if ( ! pausedForDiagnostic && ! stoppedByGpuError && frameCount % 45 === 0 ) {

			const description = owner.describe();
			status.textContent = `READY · NATIVE WEBGPU · ${ tierId.toUpperCase() } · tick ${ description.submittedTicks } · ${ description.residentTileCount } tiles · ${ description.residentCellCount } cells · ${ description.dispatchCount } dispatches · 0 frame readbacks${ lastDiagnosticSummary ? ` · ${ lastDiagnosticSummary }` : '' }`;

		}

	} );
	if ( params.get( 'lifecycle' ) === 'dispose' ) requestAnimationFrame( () => requestAnimationFrame( async () => {

		try {

			const evidence = await disposeApp();
			window.__sparseSweLifecycle = evidence;
			status.textContent = `DISPOSE PASS · queue settled · owner disposed ${ evidence.ownerAfter.disposed } · device loss ${ evidence.deviceLossReason } · delayed GPU errors ${ evidence.gpuErrors.length }`;

		} catch ( error ) {

			status.textContent = `DISPOSE FAILED: ${ error.message }`;
			window.__sparseSweLifecycle = Object.freeze( { passed: false, error: error.message } );
			throw error;

		}

	} ) );

}

boot().catch( ( error ) => {

	status.textContent = `FAILED: ${ error.message }`;
	window.__sparseSwe = Object.freeze( { ready: false, error: error.message } );
	throw error;

} );
