import { createHash } from 'node:crypto';

import { HARDWARE_PERFORMANCE_CONTRACT } from './in-app-evidence-plan.js';
import { stableStringify } from './physical-evidence-common.js';
import { hashPhysicalRecord, validateHardwarePerformanceSession } from './physical-session-validator.js';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const R185_RENDER_UID = /^r:(\d+):(\d+):f(\d+)$/;

function fail( message ) {

	throw new Error( message );

}

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function percentile( samples, quantile ) {

	const ordered = [ ...samples ].sort( ( left, right ) => left - right );
	const position = ( ordered.length - 1 ) * quantile;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	return lower === upper ? ordered[ lower ] : ordered[ lower ] + ( ordered[ upper ] - ordered[ lower ] ) * ( position - lower );

}

function deepFreeze( value ) {

	if ( value && typeof value === 'object' && Object.isFrozen( value ) === false ) {

		for ( const entry of Object.values( value ) ) deepFreeze( entry );
		Object.freeze( value );

	}
	return value;

}

function parseRenderUid( uid, label ) {

	const match = R185_RENDER_UID.exec( uid ?? '' );
	if ( match === null ) fail( `${ label } does not match the Three r185 render timestamp UID contract.` );
	const parsed = {
		uid,
		frameCall: Number( match[ 1 ] ),
		contextId: Number( match[ 2 ] ),
		frameId: Number( match[ 3 ] )
	};
	if ( [ parsed.frameCall, parsed.contextId, parsed.frameId ].some( ( value ) => Number.isSafeInteger( value ) === false ) ) fail( `${ label } exceeds the safe integer identity range.` );
	return parsed;

}

function requireVerifiedPerformanceInput( verified ) {

	if ( verified === null || typeof verified !== 'object' || Array.isArray( verified ) ) fail( 'Runtime performance mapping requires a verified imported wrapper.' );
	const sourceBytes = verified.sourceBytes;
	if ( sourceBytes instanceof Uint8Array === false || sourceBytes.byteLength < 1 ) fail( 'Verified performance input omits its exact wrapper bytes.' );
	let wrapper;
	try {

		wrapper = JSON.parse( Buffer.from( sourceBytes ).toString( 'utf8' ) );

	} catch ( error ) {

		fail( `Verified performance wrapper bytes are invalid JSON: ${ error.message }` );

	}
	const record = verified.record;
	if ( record?.profile !== 'performance' ) fail( 'Runtime performance mapping requires profile=performance.' );
	const validation = validateHardwarePerformanceSession( record );
	const recordSha256 = hashPhysicalRecord( record );
	const sourceDocumentSha256 = sha256( sourceBytes );
	if ( stableStringify( wrapper.record ) !== stableStringify( record ) ) fail( 'Verified performance record differs from its retained wrapper bytes.' );
	if ( stableStringify( wrapper.validation ) !== stableStringify( validation ) || stableStringify( verified.validation ) !== stableStringify( validation ) ) fail( 'Verified performance validation summary is stale.' );
	if ( wrapper.recordSha256 !== recordSha256 || verified.recordSha256 !== recordSha256 ) fail( 'Verified performance semantic record hash is stale.' );
	if ( verified.sourceDocumentSha256 !== sourceDocumentSha256 || verified.sourceDocumentByteLength !== sourceBytes.byteLength ) fail( 'Verified performance wrapper byte binding is stale.' );
	if ( stableStringify( wrapper.laneReference ) !== stableStringify( verified.laneReference ) ) fail( 'Verified performance lane reference differs from its retained wrapper.' );
	if ( verified.laneReference?.profile !== 'performance' || verified.laneReference?.adapterClass !== 'hardware' ) fail( 'Verified performance lane is not a hardware performance lane.' );
	const servedLedgerBytes = Buffer.from( stableStringify( record.serving.entries ) );
	const servedLedgerSha256 = sha256( servedLedgerBytes );
	if (
		verified.servedLedgerSha256 !== servedLedgerSha256 ||
		verified.servedLedgerByteLength !== servedLedgerBytes.byteLength ||
		Buffer.from( verified.servedLedgerBytes ?? [] ).equals( servedLedgerBytes ) === false
	) fail( 'Verified performance served-byte ledger binding is stale.' );
	for ( const value of [ verified.sourceDocumentSha256, verified.recordSha256, verified.servedLedgerSha256 ] ) if ( SHA256.test( value ?? '' ) === false ) fail( 'Verified performance input contains an invalid SHA-256 identity.' );
	return record;

}

function mapTimestampSegment( segment, label ) {

	const batches = segment.gpuTimestampBatches;
	if ( Array.isArray( batches ) === false || batches.length === 0 ) fail( `${ label } has no timestamp batches.` );
	const warmupCpuSamples = [];
	const cpuSamples = [];
	const gpuSamples = [];
	const timestampRows = [];
	const sceneSamples = [];
	const outputSamples = [];
	const seenUids = new Set();
	const seenFrameCalls = new Set();
	let contextIds = null;
	let timestampResolveCount = 0;
	let maximumResolveResidualMs = 0;

	for ( const [ batchIndex, batch ] of batches.entries() ) {

		const batchLabel = `${ label }.gpuTimestampBatches[${ batchIndex }]`;
		if ( batch.mappingCadence !== 'once-per-batch' || batch.independentPerFrameTotalsAvailable !== false ) fail( `${ batchLabel } violates the batched derived-total contract.` );
		const frameCount = batch.sampleFrames?.value;
		const warmupFrameCount = batch.warmupFrames?.value;
		const resolveCount = batch.resolveCount?.value;
		if ( Number.isInteger( frameCount ) === false || frameCount < 1 || Number.isInteger( warmupFrameCount ) === false || warmupFrameCount < 1 ) fail( `${ batchLabel } has invalid frame counts.` );
		if ( Number.isInteger( resolveCount ) === false || resolveCount < 1 || resolveCount >= frameCount ) fail( `${ batchLabel } has invalid timestamp resolve coverage.` );
		const batchWarmup = batch.warmupCpuSamples?.values;
		const batchCpu = batch.cpuSamples?.values;
		const batchGpu = batch.gpuSamples?.values;
		const rows = batch.timestampRows;
		if ( batchWarmup?.length !== warmupFrameCount || batchCpu?.length !== frameCount || batchGpu?.length !== frameCount || rows?.length !== frameCount ) fail( `${ batchLabel } population counts do not match their declared frames.` );
		if ( [ ...batchWarmup, ...batchCpu, ...batchGpu ].some( ( value ) => Number.isFinite( value ) === false || value < 0 ) ) fail( `${ batchLabel } contains a nonfinite or negative timing sample.` );
		const declaredContexts = batch.stageContextIds;
		if ( Number.isInteger( declaredContexts?.[ 'scene-mrt' ] ) === false || Number.isInteger( declaredContexts?.[ 'final-output' ] ) === false || declaredContexts[ 'scene-mrt' ] === declaredContexts[ 'final-output' ] ) fail( `${ batchLabel } lacks two distinct declared render contexts.` );
		if ( contextIds === null ) contextIds = { 'scene-mrt': declaredContexts[ 'scene-mrt' ], 'final-output': declaredContexts[ 'final-output' ] };
		if ( stableStringify( declaredContexts ) !== stableStringify( contextIds ) ) fail( `${ batchLabel } changed render-context identity within the mapped segment.` );

		let previousFrameId = null;
		for ( let rowIndex = 0; rowIndex < rows.length; rowIndex ++ ) {

			const row = rows[ rowIndex ];
			const rowLabel = `${ batchLabel }.timestampRows[${ rowIndex }]`;
			if ( Number.isInteger( row?.frameId ) === false || row.frameId < 0 ) fail( `${ rowLabel } has an invalid frameId.` );
			const scene = parseRenderUid( row.sceneUid, `${ rowLabel }.sceneUid` );
			const output = parseRenderUid( row.outputUid, `${ rowLabel }.outputUid` );
			if ( scene.frameId !== row.frameId || output.frameId !== row.frameId ) fail( `${ rowLabel } UID frame identity differs from frameId.` );
			if ( scene.contextId !== contextIds[ 'scene-mrt' ] || output.contextId !== contextIds[ 'final-output' ] ) fail( `${ rowLabel } UID render context differs from the declared stage context.` );
			if ( scene.frameCall !== output.frameCall + 1 || scene.uid === output.uid ) fail( `${ rowLabel } does not bind the outer final-output call followed by the nested scene-mrt call.` );
			if ( previousFrameId !== null && row.frameId < previousFrameId ) fail( `${ batchLabel } frame IDs regress in capture order.` );
			previousFrameId = row.frameId;
			if ( seenFrameCalls.has( scene.frameCall ) || seenFrameCalls.has( output.frameCall ) || seenUids.has( scene.uid ) || seenUids.has( output.uid ) ) fail( `${ rowLabel } duplicates a timestamp or render-call identity.` );
			seenFrameCalls.add( scene.frameCall );
			seenFrameCalls.add( output.frameCall );
			seenUids.add( scene.uid );
			seenUids.add( output.uid );
			for ( const key of [ 'sceneMs', 'outputMs', 'totalMs' ] ) if ( Number.isFinite( row[ key ] ) === false || row[ key ] < 0 ) fail( `${ rowLabel }.${ key } must be finite and nonnegative.` );
			const totalMs = row.sceneMs + row.outputMs;
			if ( Math.abs( row.totalMs - totalMs ) > 1e-9 || Math.abs( batchGpu[ rowIndex ] - totalMs ) > 1e-9 ) fail( `${ rowLabel } stage, total, and bound GPU sample do not reconcile.` );
			if ( row.totalProvenance !== 'Derived' || row.independentPerFrameTotalAvailable !== false || row.residualMs !== null ) fail( `${ rowLabel } overclaims an independent per-frame total.` );
			sceneSamples.push( row.sceneMs );
			outputSamples.push( row.outputMs );
			timestampRows.push( structuredClone( row ) );

		}
		if ( Number.isFinite( batch.lastFrameResolveResidualMs ) === false || batch.lastFrameResolveResidualMs < 0 || batch.lastFrameResolveResidualMs > 0.001 ) fail( `${ batchLabel } final-frame resolve residual does not reconcile.` );
		warmupCpuSamples.push( ...batchWarmup );
		cpuSamples.push( ...batchCpu );
		gpuSamples.push( ...batchGpu );
		timestampResolveCount += resolveCount;
		maximumResolveResidualMs = Math.max( maximumResolveResidualMs, batch.lastFrameResolveResidualMs );

	}
	return {
		batchCount: batches.length,
		warmupCpuSamples,
		cpuSamples,
		gpuSamples,
		gpuStageSamples: { 'scene-mrt': sceneSamples, 'final-output': outputSamples },
		timestampRows,
		timestampResolveCount,
		maximumResolveResidualMs
	};

}

export function createRuntimePerformanceTrace( verified ) {

	const record = requireVerifiedPerformanceInput( verified );
	const cold = mapTimestampSegment( record.cold, 'cold' );
	const sustainedWindowIndex = record.sustainedWindows.length - 1;
	const sustainedWindow = record.sustainedWindows[ sustainedWindowIndex ];
	const sustained = mapTimestampSegment( sustainedWindow, `sustainedWindows[${ sustainedWindowIndex }]` );
	const presentationSamples = [ ...sustainedWindow.presentationSamples.values ];
	const deadlineIntervalMs = HARDWARE_PERFORMANCE_CONTRACT.deadlineThreshold.value;
	const trace = {
		adapterClass: record.adapter.adapterClass,
		warmupCpuSamples: [ ...cold.warmupCpuSamples ],
		coldCpuSamples: [ ...cold.cpuSamples ],
		coldGpuSamples: [ ...cold.gpuSamples ],
		coldPresentationSamples: [ ...record.cold.presentationSamples.values ],
		coldCpuP50: percentile( cold.cpuSamples, 0.5 ),
		coldCpuP95: percentile( cold.cpuSamples, 0.95 ),
		coldGpuP50: percentile( cold.gpuSamples, 0.5 ),
		coldGpuP95: percentile( cold.gpuSamples, 0.95 ),
		coldPresentationP50: percentile( record.cold.presentationSamples.values, 0.5 ),
		coldPresentationP95: percentile( record.cold.presentationSamples.values, 0.95 ),
		coldSampleFrames: cold.cpuSamples.length,
		coldTimestampResolveCount: cold.timestampResolveCount,
		sustainedWindowIndex,
		sustainedWindowCount: record.sustainedWindows.length,
		sampleFrames: sustained.cpuSamples.length,
		timestampResolveCount: sustained.timestampResolveCount,
		timestampMappingCadence: 'once-per-batch',
		cpuSamples: [ ...sustained.cpuSamples ],
		gpuSamples: [ ...sustained.gpuSamples ],
		presentationSamples,
		deadlineIntervalMs,
		cpuP50: percentile( sustained.cpuSamples, 0.5 ),
		cpuP95: percentile( sustained.cpuSamples, 0.95 ),
		gpuP50: percentile( sustained.gpuSamples, 0.5 ),
		gpuP95: percentile( sustained.gpuSamples, 0.95 ),
		presentationP50: percentile( presentationSamples, 0.5 ),
		presentationP95: percentile( presentationSamples, 0.95 ),
		deadlineMissRatio: presentationSamples.filter( ( value ) => value > deadlineIntervalMs ).length / presentationSamples.length,
		gpuStageSamples: sustained.gpuStageSamples,
		gpuStageP50: {
			'scene-mrt': percentile( sustained.gpuStageSamples[ 'scene-mrt' ], 0.5 ),
			'final-output': percentile( sustained.gpuStageSamples[ 'final-output' ], 0.5 )
		},
		gpuStageP95: {
			'scene-mrt': percentile( sustained.gpuStageSamples[ 'scene-mrt' ], 0.95 ),
			'final-output': percentile( sustained.gpuStageSamples[ 'final-output' ], 0.95 )
		},
		timestampRows: sustained.timestampRows,
		independentPerFrameTotalsAvailable: false,
		lastFrameResolveResidualMs: sustained.maximumResolveResidualMs,
		timestampReconciliationScope: `maximum final-frame resolve residual across ${ sustained.batchCount } batches in the final sustained window; per-frame totals remain Derived`
	};
	return deepFreeze( trace );

}
