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

export const SWE_INTERACTION_GPU_DECISION = Object.freeze( {
	problemId: 'exact-once-interaction-source-application',
	axes: Object.freeze( [ 'exactOnceTruth', 'momentClosure', 'gpuProducerCompatibility', 'mobileTraffic', 'rollbackClarity' ] ),
	selectedCandidateId: 'prepared-field-cell-gather',
	candidates: Object.freeze( [
		Object.freeze( { id: 'actor-writes-state', family: 'actor directly writes water state', scores: [ 0, 1, 3, 5, 0 ], hardGate: 'fail:second-state-owner' } ),
		Object.freeze( { id: 'cpu-state-patch-upload', family: 'CPU patches authoritative candidate cells', scores: [ 2, 4, 1, 2, 2 ], hardGate: 'fail:gpu-authority-and-transfer-tail' } ),
		Object.freeze( { id: 'atomic-point-scatter', family: 'GPU point records atomically scatter floating discharge', scores: [ 3, 4, 5, 3, 2 ], hardGate: 'fail:nondeterministic-float-accumulation' } ),
		Object.freeze( { id: 'cell-gathers-all-records', family: 'every cell gathers every point interaction', scores: [ 5, 5, 5, 1, 5 ], hardGate: 'fail:unbounded-record-times-cell-work' } ),
		Object.freeze( { id: 'extra-source-ping-pong', family: 'separate source application into another candidate buffer', scores: [ 5, 5, 5, 2, 5 ], hardGate: 'pass' } ),
		Object.freeze( { id: 'prepared-field-cell-gather', family: 'prepared conservative source field fused into one cell gather', scores: [ 5, 5, 5, 5, 5 ], hardGate: 'pass' } )
	] )
} );

export const SWE_INTERACTION_BINDING_DECISION = Object.freeze( {
	problemId: 'portable-eight-storage-buffer-source-path',
	axes: Object.freeze( [ 'portableBindingLimit', 'extraTraffic', 'extraDispatch', 'sourceClosure', 'producerCompatibility' ] ),
	selectedCandidateId: 'face-reserved-channel-pack',
	candidates: Object.freeze( [
		Object.freeze( { id: 'request-higher-limit', family: 'request adapter maximum storage-buffer limit', scores: [ 1, 5, 5, 5, 5 ], hardGate: 'fail:portable-default-limit' } ),
		Object.freeze( { id: 'extra-source-dispatch', family: 'separate source pass and extra candidate ping-pong', scores: [ 5, 2, 1, 5, 5 ], hardGate: 'pass' } ),
		Object.freeze( { id: 'state-channel-pack', family: 'pack source into conservative state channels', scores: [ 5, 5, 5, 2, 3 ], hardGate: 'fail:state-semantic-alias' } ),
		Object.freeze( { id: 'cell-record-regather', family: 'cell shader re-gathers compact point records', scores: [ 4, 2, 5, 5, 4 ], hardGate: 'fail:record-times-cell-tail' } ),
		Object.freeze( { id: 'face-reserved-channel-pack', family: 'carry prepared cell source through reserved canonical face channels', scores: [ 5, 5, 5, 5, 5 ], hardGate: 'pass' } )
	] )
} );

export const SWE_RECEIVER_GPU_DECISION = Object.freeze( {
	problemId: 'gpu-receiver-wetness-ownership',
	axes: Object.freeze( [ 'singleOwnerTruth', 'exchangeAtomicity', 'sparseIdentity', 'mobileTraffic', 'materialApplicability', 'recoveryClarity' ] ),
	selectedCandidateId: 'water-cell-aligned-buffer-owner',
	candidates: Object.freeze( [
		Object.freeze( { id: 'material-fragment-history', family: 'material shader privately integrates wetness', scores: [ 0, 0, 2, 5, 5, 1 ], hardGate: 'fail:material-becomes-state-owner' } ),
		Object.freeze( { id: 'screen-history', family: 'screen-space wetness history', scores: [ 0, 0, 1, 3, 4, 1 ], hardGate: 'fail:not-world-anchored' } ),
		Object.freeze( { id: 'cpu-grid-upload', family: 'CPU receiver grid with per-step GPU upload', scores: [ 5, 3, 4, 1, 5, 4 ], hardGate: 'fail:transfer-tail-and-gpu-transaction-split' } ),
		Object.freeze( { id: 'dense-storage-texture', family: 'dense world-space receiver StorageTexture', scores: [ 5, 5, 3, 2, 5, 5 ], hardGate: 'pass' } ),
		Object.freeze( { id: 'dirty-tile-atlas', family: 'independent sparse dirty receiver tiles', scores: [ 5, 4, 4, 4, 5, 4 ], hardGate: 'fail:duplicate-sparse-identity-and-halo-owner' } ),
		Object.freeze( { id: 'water-cell-aligned-buffer-owner', family: 'separate receiver state aligned to stable sparse water cells', scores: [ 5, 5, 5, 5, 5, 5 ], hardGate: 'pass' } )
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
	interactionSource: Object.freeze( { type: 'vec2<f32>', channels: Object.freeze( [ 'xDischargeIncrementM2ps', 'zDischargeIncrementM2ps' ] ) } ),
	receiverLiquid: Object.freeze( { type: 'f32', unit: 'kg m^-2', copies: 2 } ),
	inundationTransfer: Object.freeze( { type: 'f32', unit: 'kg m^-2', timeSemantics: 'interval-integrated' } ),
	diagnostic: Object.freeze( { type: 'u32', channels: Object.freeze( [ 'invalidCells', 'negativeDepthCells', 'wetCells', 'priorDepthQuanta', 'candidateDepthQuanta', 'committedGeneration', 'acceptedCommits', 'rejectedCommits', 'netFluxInfluxDepthQuanta', 'netFluxOutfluxDepthQuanta', 'boundaryInfluxDepthQuanta', 'boundaryOutfluxDepthQuanta', 'foamCoveredCells', 'foamSourceRateQuanta', 'foamClampCells', 'foamCoverageQuanta', 'interactionImpulseXPositiveQuanta', 'interactionImpulseXNegativeQuanta', 'interactionImpulseZPositiveQuanta', 'interactionImpulseZNegativeQuanta', 'committedInteractionBatches', 'committedInteractionSequence', 'receiverTransferDepthQuanta', 'receiverInvalidCells', 'receiverCandidateMassQuanta', 'committedReceiverExchangeBatches', 'committedReceiverExchangeSequence', 'receiverWetCells', 'receiverCoverageQuanta', 'receiverRunoffQuanta' ] ) } )
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
		foamPingPong: stateRecords * 4 * 2,
		interactionSource: stateRecords * 8,
		receiverLiquidPingPong: stateRecords * 4 * 2,
		inundationTransfer: stateRecords * 4,
		xFaceFlux: xFaceRecords * 16,
		zFaceFlux: zFaceRecords * 16,
		xHydrostaticCorrection: xFaceRecords * 8,
		zHydrostaticCorrection: zFaceRecords * 8,
		descriptors: tier.capacityTiles * 16,
		logicalLookup: tier.logicalTilesX * tier.logicalTilesZ * 4,
		displayIndices: tier.capacityTiles * tier.tileSize * tier.tileSize * 4,
		diagnostics: 30 * 4
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
		portableStorageBufferLimitPerStage: 8,
		storageBindingsPerStage: Object.freeze( { resetValidation: 1, haloAndBoundary: 4, xFaceFlux: 5, zFaceFlux: 5, cellUpdate: 8, receiverSurfaceExchange: 6, foamTransportReaction: 6, candidateValidation: 7, atomicCommit: 8 } ),
		dispatchOrder: Object.freeze( [ 'reset-validation', 'halo-and-boundary', 'x-face-flux', 'z-face-flux', 'cell-update', 'receiver-surface-exchange', 'foam-transport-reaction', 'candidate-validation', 'atomic-commit' ] )
	} );

}

export function validateSweGpuContract( contract ) {

	if ( SWE_GPU_EXECUTION_DECISION.candidates.length < 5 ) throw new Error( 'SWE GPU execution compares fewer than five architectures' );
	if ( new Set( SWE_GPU_EXECUTION_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size !== SWE_GPU_EXECUTION_DECISION.candidates.length ) throw new Error( 'SWE GPU execution candidate families are not distinct' );
	if ( SWE_GPU_EXECUTION_DECISION.selectedCandidateId !== 'separate-face-flux-transaction' ) throw new Error( 'SWE GPU execution winner drifted' );
	if ( SWE_GPU_EXECUTION_DECISION.candidates.find( ( candidate ) => candidate.id === SWE_GPU_EXECUTION_DECISION.selectedCandidateId )?.hardGate !== 'pass' ) throw new Error( 'SWE GPU execution winner fails its hard gate' );
	if ( SWE_INTERACTION_GPU_DECISION.candidates.length < 5 ) throw new Error( 'SWE interaction GPU execution compares fewer than five architectures' );
	if ( new Set( SWE_INTERACTION_GPU_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size !== SWE_INTERACTION_GPU_DECISION.candidates.length ) throw new Error( 'SWE interaction GPU candidate families are not distinct' );
	if ( SWE_INTERACTION_GPU_DECISION.selectedCandidateId !== 'prepared-field-cell-gather' ) throw new Error( 'SWE interaction GPU winner drifted' );
	if ( SWE_INTERACTION_GPU_DECISION.candidates.find( ( candidate ) => candidate.id === SWE_INTERACTION_GPU_DECISION.selectedCandidateId )?.hardGate !== 'pass' ) throw new Error( 'SWE interaction GPU winner fails its hard gate' );
	if ( SWE_INTERACTION_BINDING_DECISION.candidates.length < 5 ) throw new Error( 'SWE interaction binding decision compares fewer than five architectures' );
	if ( SWE_INTERACTION_BINDING_DECISION.selectedCandidateId !== 'face-reserved-channel-pack' ) throw new Error( 'SWE interaction binding winner drifted' );
	if ( SWE_INTERACTION_BINDING_DECISION.candidates.find( ( candidate ) => candidate.id === SWE_INTERACTION_BINDING_DECISION.selectedCandidateId )?.hardGate !== 'pass' ) throw new Error( 'SWE interaction binding winner fails its hard gate' );
	if ( SWE_RECEIVER_GPU_DECISION.candidates.length < 5 ) throw new Error( 'SWE receiver GPU decision compares fewer than five architectures' );
	if ( SWE_RECEIVER_GPU_DECISION.selectedCandidateId !== 'water-cell-aligned-buffer-owner' ) throw new Error( 'SWE receiver GPU winner drifted' );
	if ( SWE_RECEIVER_GPU_DECISION.candidates.find( ( candidate ) => candidate.id === SWE_RECEIVER_GPU_DECISION.selectedCandidateId )?.hardGate !== 'pass' ) throw new Error( 'SWE receiver GPU winner fails its hard gate' );
	if ( contract.tier.fixedTimeStepSeconds > contract.stableTimeStepSeconds ) throw new Error( `SWE ${ contract.tierId } fixed step exceeds its derived unsplit CFL bound` );
	if ( contract.dispatchOrder.join( '>' ) !== 'reset-validation>halo-and-boundary>x-face-flux>z-face-flux>cell-update>receiver-surface-exchange>foam-transport-reaction>candidate-validation>atomic-commit' ) throw new Error( 'SWE GPU dispatch dependency order drifted' );
	if ( contract.resourceBytes.statePingPong !== contract.stateRecords * 16 * 2 ) throw new Error( 'SWE state ping-pong byte accounting drifted' );
	if ( contract.resourceBytes.interactionSource !== contract.stateRecords * 8 ) throw new Error( 'SWE interaction source byte accounting drifted' );
	if ( contract.resourceBytes.receiverLiquidPingPong !== contract.stateRecords * 4 * 2 || contract.resourceBytes.inundationTransfer !== contract.stateRecords * 4 ) throw new Error( 'SWE receiver liquid byte accounting drifted' );
	if ( contract.resourceBytes.diagnostics !== SWE_GPU_LAYOUT.diagnostic.channels.length * 4 ) throw new Error( 'SWE diagnostic byte accounting drifted' );
	if ( Math.max( ...Object.values( contract.storageBindingsPerStage ) ) > contract.portableStorageBufferLimitPerStage ) throw new Error( 'SWE compute stage exceeds the portable storage-buffer binding limit' );
	if ( contract.xFaceRecords !== contract.tier.capacityTiles * ( contract.tier.tileSize + 1 ) * contract.tier.tileSize ) throw new Error( 'SWE x-face ownership count drifted' );
	if ( contract.zFaceRecords !== contract.tier.capacityTiles * contract.tier.tileSize * ( contract.tier.tileSize + 1 ) ) throw new Error( 'SWE z-face ownership count drifted' );
	if ( ! Number.isSafeInteger( contract.totalLogicalBytes ) || contract.totalLogicalBytes <= 0 ) throw new Error( 'SWE GPU logical resource total is invalid' );
	return true;

}
