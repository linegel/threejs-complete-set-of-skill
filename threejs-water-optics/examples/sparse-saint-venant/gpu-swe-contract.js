export const SWE_GPU_EXECUTION_DECISION = Object.freeze( {
	problemId: 'native-gpu-sparse-swe-execution',
	axes: Object.freeze( [ 'canonicalFlux', 'rollbackTruth', 'sparseTraffic', 'gpuPortability', 'diagnosticClarity' ] ),
	selectedCandidateId: 'separate-face-flux-transaction',
	candidates: Object.freeze( [
		Object.freeze( { id: 'fused-workgroup-tile', family: 'workgroup-fused tile update', scores: [ 2, 4, 5, 4, 2 ], hardGate: 'fail:cross-workgroup-face-ownership' } ),
		Object.freeze( { id: 'atomic-face-scatter', family: 'face kernels atomically scatter cell updates', scores: [ 3, 2, 3, 2, 2 ], hardGate: 'fail:nondeterministic-float-reduction' } ),
		Object.freeze( { id: 'dense-storage-texture', family: 'dense StorageTexture finite-volume update', scores: [ 4, 4, 1, 5, 4 ], hardGate: 'fail:sparse-domain-contract' } ),
		Object.freeze( { id: 'cpu-oracle-upload', family: 'CPU float64 solve with per-step GPU upload', scores: [ 5, 3, 1, 3, 4 ], hardGate: 'fail:gpu-authority-and-upload-tail' } ),
		Object.freeze( { id: 'external-free-surface-adapter', family: 'external free-surface solver adapter', scores: [ 4, 4, 3, 2, 3 ], hardGate: 'fail:unnecessary-external-owner' } ),
		Object.freeze( { id: 'separate-face-flux-transaction', family: 'halo, canonical face flux, cell gather, validation, GPU commit', scores: [ 5, 5, 4, 5, 5 ], hardGate: 'pass' } )
	] )
} );

export const SWE_GPU_TIERS = Object.freeze( {
	full: Object.freeze( { tileSize: 16, capacityTiles: 32, logicalTilesX: 8, logicalTilesZ: 6, cellSizeMeters: 0.16, fixedTimeStepSeconds: 1 / 144, maximumDepthMeters: 0.45, maximumVelocityMps: 1.25, maximumCatchUpSteps: 2, cflGate: 0.35 } ),
	budgeted: Object.freeze( { tileSize: 12, capacityTiles: 24, logicalTilesX: 8, logicalTilesZ: 6, cellSizeMeters: 0.22, fixedTimeStepSeconds: 1 / 72, maximumDepthMeters: 0.32, maximumVelocityMps: 0.85, maximumCatchUpSteps: 2, cflGate: 0.35 } ),
	minimum: Object.freeze( { tileSize: 8, capacityTiles: 16, logicalTilesX: 8, logicalTilesZ: 6, cellSizeMeters: 0.32, fixedTimeStepSeconds: 1 / 36, maximumDepthMeters: 0.20, maximumVelocityMps: 0.50, maximumCatchUpSteps: 1, cflGate: 0.35 } )
} );

export const SWE_GPU_LAYOUT = Object.freeze( {
	state: Object.freeze( { type: 'vec4<f32>', channels: Object.freeze( [ 'depthMeters', 'xDischargeM2ps', 'zDischargeM2ps', 'bedElevationMeters' ] ), copies: 2 } ),
	faceFlux: Object.freeze( { type: 'vec4<f32>', channels: Object.freeze( [ 'massFluxM2ps', 'normalMomentumFluxM3ps2', 'tangentMomentumFluxM3ps2', 'reserved' ] ), orientations: 2 } ),
	hydrostaticCorrection: Object.freeze( { type: 'vec2<f32>', channels: Object.freeze( [ 'leftOrSouthMomentumCorrectionM3ps2', 'rightOrNorthMomentumCorrectionM3ps2' ] ), orientations: 2 } ),
	descriptor: Object.freeze( { type: 'vec4<i32>', channels: Object.freeze( [ 'logicalTileX', 'logicalTileZ', 'roleCode', 'resident' ] ) } ),
	diagnostic: Object.freeze( { type: 'u32', channels: Object.freeze( [ 'invalidCells', 'negativeDepthCells', 'wetCells', 'priorDepthQuanta', 'candidateDepthQuanta', 'committedGeneration', 'acceptedCommits', 'rejectedCommits' ] ) } )
} );

export function resolveSweGpuTier( tierId ) {

	const tier = SWE_GPU_TIERS[ tierId ];
	if ( ! tier ) throw new Error( `unknown sparse SWE GPU tier '${ tierId }'` );
	return tier;

}

export function deriveSweGpuContract( tierId, gravityMps2 = 9.80665 ) {

	const tier = resolveSweGpuTier( tierId );
	const maximumSignalMps = tier.maximumVelocityMps + Math.sqrt( gravityMps2 * tier.maximumDepthMeters );
	const maximumRatePerSecond = maximumSignalMps * ( 2 / tier.cellSizeMeters );
	const stableTimeStepSeconds = tier.cflGate / maximumRatePerSecond;
	const paddedSize = tier.tileSize + 2;
	const stateRecords = tier.capacityTiles * paddedSize * paddedSize;
	const xFaceRecords = tier.capacityTiles * ( tier.tileSize + 1 ) * tier.tileSize;
	const zFaceRecords = tier.capacityTiles * tier.tileSize * ( tier.tileSize + 1 );
	const resourceBytes = Object.freeze( {
		statePingPong: stateRecords * 16 * 2,
		xFaceFlux: xFaceRecords * 16,
		zFaceFlux: zFaceRecords * 16,
		xHydrostaticCorrection: xFaceRecords * 8,
		zHydrostaticCorrection: zFaceRecords * 8,
		descriptors: tier.capacityTiles * 16,
		logicalLookup: tier.logicalTilesX * tier.logicalTilesZ * 4,
		displayIndices: tier.capacityTiles * tier.tileSize * tier.tileSize * 4,
		diagnostics: SWE_GPU_LAYOUT.diagnostic.channels.length * 4
	} );
	const totalLogicalBytes = Object.values( resourceBytes ).reduce( ( sum, bytes ) => sum + bytes, 0 );
	return Object.freeze( {
		tierId,
		tier,
		gravityMps2,
		maximumSignalMps,
		maximumRatePerSecond,
		stableTimeStepSeconds,
		cflRatio: tier.fixedTimeStepSeconds / stableTimeStepSeconds * tier.cflGate,
		paddedSize,
		stateRecords,
		xFaceRecords,
		zFaceRecords,
		resourceBytes,
		totalLogicalBytes,
		dispatchOrder: Object.freeze( [ 'reset-validation', 'halo-and-boundary', 'x-face-flux', 'z-face-flux', 'cell-update', 'candidate-validation', 'atomic-commit' ] )
	} );

}

export function validateSweGpuContract( contract ) {

	if ( SWE_GPU_EXECUTION_DECISION.candidates.length < 5 ) throw new Error( 'SWE GPU execution compares fewer than five architectures' );
	if ( new Set( SWE_GPU_EXECUTION_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size !== SWE_GPU_EXECUTION_DECISION.candidates.length ) throw new Error( 'SWE GPU execution candidate families are not distinct' );
	if ( SWE_GPU_EXECUTION_DECISION.selectedCandidateId !== 'separate-face-flux-transaction' ) throw new Error( 'SWE GPU execution winner drifted' );
	if ( SWE_GPU_EXECUTION_DECISION.candidates.find( ( candidate ) => candidate.id === SWE_GPU_EXECUTION_DECISION.selectedCandidateId )?.hardGate !== 'pass' ) throw new Error( 'SWE GPU execution winner fails its hard gate' );
	if ( contract.tier.fixedTimeStepSeconds > contract.stableTimeStepSeconds ) throw new Error( `SWE ${ contract.tierId } fixed step exceeds its derived unsplit CFL bound` );
	if ( contract.dispatchOrder.join( '>' ) !== 'reset-validation>halo-and-boundary>x-face-flux>z-face-flux>cell-update>candidate-validation>atomic-commit' ) throw new Error( 'SWE GPU dispatch dependency order drifted' );
	if ( contract.resourceBytes.statePingPong !== contract.stateRecords * 16 * 2 ) throw new Error( 'SWE state ping-pong byte accounting drifted' );
	if ( contract.xFaceRecords !== contract.tier.capacityTiles * ( contract.tier.tileSize + 1 ) * contract.tier.tileSize ) throw new Error( 'SWE x-face ownership count drifted' );
	if ( contract.zFaceRecords !== contract.tier.capacityTiles * contract.tier.tileSize * ( contract.tier.tileSize + 1 ) ) throw new Error( 'SWE z-face ownership count drifted' );
	if ( ! Number.isSafeInteger( contract.totalLogicalBytes ) || contract.totalLogicalBytes <= 0 ) throw new Error( 'SWE GPU logical resource total is invalid' );
	return true;

}
