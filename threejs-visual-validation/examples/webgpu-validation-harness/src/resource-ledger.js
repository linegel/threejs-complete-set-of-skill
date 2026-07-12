import {
	AlphaFormat,
	ByteType,
	DepthFormat,
	DepthStencilFormat,
	FloatType,
	HalfFloatType,
	IntType,
	NoColorSpace,
	RedFormat,
	RedIntegerFormat,
	RGFormat,
	RGIntegerFormat,
	RGBFormat,
	RGBIntegerFormat,
	RGBAFormat,
	RGBAIntegerFormat,
	ShortType,
	SRGBColorSpace,
	UnsignedByteType,
	UnsignedInt101111Type,
	UnsignedInt248Type,
	UnsignedInt5999Type,
	UnsignedIntType,
	UnsignedShort4444Type,
	UnsignedShort5551Type,
	UnsignedShortType
} from 'three';

const REQUIRED_TARGET_SEMANTICS = Object.freeze( [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] );

const TYPE_INFO = new Map( [
	[ ByteType, { name: 'ByteType', bytesPerChannel: 1, suffix: 'sint' } ],
	[ UnsignedByteType, { name: 'UnsignedByteType', bytesPerChannel: 1, suffix: 'unorm' } ],
	[ ShortType, { name: 'ShortType', bytesPerChannel: 2, suffix: 'sint' } ],
	[ UnsignedShortType, { name: 'UnsignedShortType', bytesPerChannel: 2, suffix: 'uint' } ],
	[ IntType, { name: 'IntType', bytesPerChannel: 4, suffix: 'sint' } ],
	[ UnsignedIntType, { name: 'UnsignedIntType', bytesPerChannel: 4, suffix: 'uint' } ],
	[ FloatType, { name: 'FloatType', bytesPerChannel: 4, suffix: 'float' } ],
	[ HalfFloatType, { name: 'HalfFloatType', bytesPerChannel: 2, suffix: 'float' } ],
	[ UnsignedShort4444Type, { name: 'UnsignedShort4444Type', packedBytes: 2, suffix: 'unorm' } ],
	[ UnsignedShort5551Type, { name: 'UnsignedShort5551Type', packedBytes: 2, suffix: 'unorm' } ],
	[ UnsignedInt248Type, { name: 'UnsignedInt248Type', packedBytes: 4, suffix: 'uint' } ],
	[ UnsignedInt5999Type, { name: 'UnsignedInt5999Type', packedBytes: 4, suffix: 'float' } ],
	[ UnsignedInt101111Type, { name: 'UnsignedInt101111Type', packedBytes: 4, suffix: 'float' } ]
] );

const FORMAT_INFO = new Map( [
	[ AlphaFormat, { name: 'AlphaFormat', channels: 1, prefix: 'a' } ],
	[ RedFormat, { name: 'RedFormat', channels: 1, prefix: 'r' } ],
	[ RedIntegerFormat, { name: 'RedIntegerFormat', channels: 1, prefix: 'r' } ],
	[ RGFormat, { name: 'RGFormat', channels: 2, prefix: 'rg' } ],
	[ RGIntegerFormat, { name: 'RGIntegerFormat', channels: 2, prefix: 'rg' } ],
	[ RGBFormat, { name: 'RGBFormat', channels: 3, prefix: 'rgb' } ],
	[ RGBIntegerFormat, { name: 'RGBIntegerFormat', channels: 3, prefix: 'rgb' } ],
	[ RGBAFormat, { name: 'RGBAFormat', channels: 4, prefix: 'rgba' } ],
	[ RGBAIntegerFormat, { name: 'RGBAIntegerFormat', channels: 4, prefix: 'rgba' } ],
	[ DepthFormat, { name: 'DepthFormat', channels: 1, prefix: 'depth' } ],
	[ DepthStencilFormat, { name: 'DepthStencilFormat', channels: 1, prefix: 'depth-stencil' } ]
] );

const EXPECTED_TARGET_TYPES = Object.freeze( {
	output: { type: HalfFloatType, format: RGBAFormat, colorSpace: NoColorSpace, gpuFormat: 'rgba16float' },
	normal: { type: HalfFloatType, format: RGBAFormat, colorSpace: NoColorSpace, gpuFormat: 'rgba16float' },
	emissive: { type: HalfFloatType, format: RGBAFormat, colorSpace: NoColorSpace, gpuFormat: 'rgba16float' },
	depth: { type: FloatType, format: DepthFormat, colorSpace: NoColorSpace, gpuFormat: 'depth32float' },
	'capture-target': { type: UnsignedByteType, format: RGBAFormat, colorSpace: SRGBColorSpace, gpuFormat: 'rgba8unorm-srgb' }
} );

function requireRecord( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) throw new TypeError( `${ label } must be an object.` );
	return value;

}

function requirePositiveInteger( value, label ) {

	if ( Number.isInteger( value ) === false || value <= 0 ) throw new TypeError( `${ label } must be a positive integer.` );
	return value;

}

function requireNonnegativeInteger( value, label ) {

	if ( Number.isInteger( value ) === false || value < 0 ) throw new TypeError( `${ label } must be a nonnegative integer.` );
	return value;

}

function sum( values ) {

	return values.reduce( ( total, value ) => total + value, 0 );

}

function textureLayout( texture, label ) {

	if ( texture === null || typeof texture !== 'object' || texture.isTexture !== true ) throw new TypeError( `${ label } must be an actual Three.js Texture.` );
	if ( typeof texture.uuid !== 'string' || texture.uuid.length === 0 ) throw new TypeError( `${ label } must expose a texture UUID.` );
	const typeInfo = TYPE_INFO.get( texture.type );
	const formatInfo = FORMAT_INFO.get( texture.format );
	if ( typeInfo === undefined ) throw new Error( `${ label } uses unsupported texture type ${ texture.type }.` );
	if ( formatInfo === undefined ) throw new Error( `${ label } uses unsupported texture format ${ texture.format }.` );
	const bytesPerTexel = typeInfo.packedBytes ?? typeInfo.bytesPerChannel * formatInfo.channels;
	let gpuFormat;
	if ( texture.format === DepthFormat && texture.type === FloatType ) gpuFormat = 'depth32float';
	else if ( texture.format === DepthStencilFormat && texture.type === UnsignedInt248Type ) gpuFormat = 'depth24plus-stencil8';
	else gpuFormat = `${ formatInfo.prefix }${ ( typeInfo.packedBytes ?? typeInfo.bytesPerChannel * 8 ) }${ typeInfo.suffix }`;
	if ( gpuFormat === 'rgba8unorm' && texture.colorSpace === SRGBColorSpace ) gpuFormat = 'rgba8unorm-srgb';
	return { typeInfo, formatInfo, bytesPerTexel, gpuFormat };

}

function runtimeMemoryRecord( renderer, object, logicalBytes, label ) {

	const memoryMap = renderer.info?.memoryMap;
	if ( memoryMap instanceof Map === false ) return { status: 'NOT_EXPOSED', bytes: null, source: 'renderer.info.memoryMap unavailable' };
	if ( memoryMap.has( object ) === false ) return { status: 'NOT_RESIDENT', bytes: null, source: 'renderer.info.memoryMap has no identity entry' };
	const value = memoryMap.get( object );
	const bytes = typeof value === 'number' ? value : value?.size;
	if ( Number.isInteger( bytes ) === false || bytes < 0 ) throw new Error( `${ label } renderer.info.memoryMap byte record is invalid.` );
	if ( bytes !== logicalBytes ) throw new Error( `${ label } renderer.info.memoryMap bytes ${ bytes } do not match the derived logical bytes ${ logicalBytes }.` );
	return {
		status: 'MEASURED',
		bytes,
		source: 'renderer.info.memoryMap identity lookup',
		memoryClass: typeof value === 'object' && typeof value?.type === 'string' ? value.type : 'textures'
	};

}

function requireRenderTarget( value, label ) {

	if ( value === null || typeof value !== 'object' || value.isRenderTarget !== true ) throw new TypeError( `${ label } must be an actual Three.js RenderTarget.` );
	requirePositiveInteger( value.width, `${ label }.width` );
	requirePositiveInteger( value.height, `${ label }.height` );
	requirePositiveInteger( value.depth, `${ label }.depth` );
	requireNonnegativeInteger( value.samples, `${ label }.samples` );
	if ( value.samples > 1 ) throw new Error( `${ label } enables MSAA; the validation ledger cannot claim opaque multisample backend residency.` );
	return value;

}

function targetRecord( { renderer, target, texture, semantic, owner } ) {

	requireRenderTarget( target, `${ semantic } render target` );
	if ( texture.renderTarget !== target ) throw new Error( `${ semantic } texture does not belong to the declared render target identity.` );
	if ( texture.image?.width !== target.width || texture.image?.height !== target.height || ( texture.image?.depth ?? 1 ) !== target.depth ) throw new Error( `${ semantic } texture extent drifts from its render target.` );
	if ( texture.generateMipmaps === true || texture.mipmaps?.length > 0 ) throw new Error( `${ semantic } texture unexpectedly allocates mip levels.` );
	const expected = EXPECTED_TARGET_TYPES[ semantic ];
	const layout = textureLayout( texture, `${ semantic } texture` );
	if ( texture.type !== expected.type || texture.format !== expected.format || layout.gpuFormat !== expected.gpuFormat ) throw new Error( `${ semantic } texture type/format drifted from ${ expected.gpuFormat }.` );
	if ( texture.colorSpace !== expected.colorSpace ) throw new Error( `${ semantic } texture colorSpace drifted from the canonical contract.` );
	const sampleCount = Math.max( 1, target.samples );
	const bytes = target.width * target.height * target.depth * layout.bytesPerTexel * sampleCount;
	return {
		name: semantic,
		semantic,
		owner,
		targetUuid: null,
		targetName: typeof target.name === 'string' && target.name.length > 0 ? target.name : null,
		targetIdentityAvailability: 'NOT_EXPOSED_BY_THREE_RENDER_TARGET',
		textureUuid: texture.uuid,
		textureName: typeof texture.name === 'string' ? texture.name : '',
		width: target.width,
		height: target.height,
		depth: target.depth,
		type: layout.typeInfo.name,
		typeValue: texture.type,
		threeFormat: layout.formatInfo.name,
		threeFormatValue: texture.format,
		format: layout.gpuFormat,
		colorSpace: texture.colorSpace,
		sampleCount,
		bytesPerTexel: layout.bytesPerTexel,
		bytes,
		logicalBytes: bytes,
		liveBytes: bytes,
		byteAccounting: 'derived from actual texture type, format, extent, depth, and sample count',
		runtimeMemory: runtimeMemoryRecord( renderer, texture, bytes, `${ semantic } texture` ),
		liveness: 'live'
	};

}

function runtimeMemoryRecordFromCandidates( renderer, candidates, logicalBytes, label ) {

	const memoryMap = renderer.info?.memoryMap;
	if ( memoryMap instanceof Map === false ) return { status: 'NOT_EXPOSED', bytes: null, source: 'renderer.info.memoryMap unavailable' };
	const residentCandidates = [ ...new Set( candidates ) ].filter( ( candidate ) => memoryMap.has( candidate ) );
	if ( residentCandidates.length === 0 ) return { status: 'NOT_RESIDENT', bytes: null, source: 'renderer.info.memoryMap has no allocation/view identity entry' };
	if ( residentCandidates.length > 1 ) throw new Error( `${ label } has multiple renderer.info.memoryMap entries for one shared allocation.` );
	return runtimeMemoryRecord( renderer, residentCandidates[ 0 ], logicalBytes, label );

}

function geometryAllocationIdentity( allocation ) {

	if ( allocation.isInterleavedBuffer === true ) {

		if ( typeof allocation.uuid !== 'string' || allocation.uuid.length === 0 ) throw new Error( 'InterleavedBuffer allocation has no UUID.' );
		return `interleaved-buffer:${ allocation.uuid }`;

	}
	if ( Number.isInteger( allocation.id ) === false ) throw new Error( 'BufferAttribute allocation has no numeric runtime ID.' );
	return `buffer-attribute:${ allocation.id }`;

}

function attributeView( geometry, slot, attribute, kind, allocationRegistry ) {

	if ( attribute === null || typeof attribute !== 'object' || ( attribute.isBufferAttribute !== true && attribute.isInterleavedBufferAttribute !== true ) ) throw new TypeError( `${ geometry.type}.${ slot } must be an actual Three.js buffer attribute view.` );
	const allocation = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
	const array = allocation.array;
	if ( ArrayBuffer.isView( array ) === false ) throw new Error( `${ geometry.type}.${ slot } has no typed-array allocation.` );
	let allocationRecord = allocationRegistry.get( allocation );
	if ( allocationRecord === undefined ) {

		allocationRecord = {
			id: geometryAllocationIdentity( allocation ),
			allocationType: allocation.constructor.name,
			arrayType: array.constructor.name,
			usage: allocation.usage,
			bytes: array.byteLength,
			logicalBytes: array.byteLength,
			liveBytes: array.byteLength,
			bindings: [],
			candidates: new Set( [ allocation ] ),
			liveness: 'live'
		};
		allocationRegistry.set( allocation, allocationRecord );

	}
	allocationRecord.candidates.add( attribute );
	const bindingId = `${ geometry.uuid }:${ kind }:${ slot }`;
	allocationRecord.bindings.push( bindingId );
	return {
		bindingId,
		kind,
		slot,
		allocationId: allocationRecord.id,
		attributeName: typeof attribute.name === 'string' ? attribute.name : '',
		attributeType: attribute.constructor.name,
		itemSize: attribute.itemSize,
		count: attribute.count,
		normalized: attribute.normalized === true,
		offset: attribute.isInterleavedBufferAttribute ? attribute.offset : 0,
		stride: attribute.isInterleavedBufferAttribute ? allocation.stride : attribute.itemSize
	};

}

function geometryRecord( geometry, index, allocationRegistry ) {

	if ( geometry === null || typeof geometry !== 'object' || geometry.isBufferGeometry !== true ) throw new TypeError( `geometries[${ index }] must be an actual Three.js BufferGeometry.` );
	if ( typeof geometry.uuid !== 'string' || geometry.uuid.length === 0 ) throw new TypeError( `geometries[${ index }] must expose a UUID.` );
	const attributeViews = Object.entries( geometry.attributes ).sort( ( [ a ], [ b ] ) => a.localeCompare( b ) ).map( ( [ slot, attribute ] ) => attributeView( geometry, slot, attribute, 'attribute', allocationRegistry ) );
	if ( attributeViews.length === 0 ) throw new Error( `${ geometry.type } has no runtime attributes.` );
	const indexView = geometry.index === null ? null : attributeView( geometry, 'index', geometry.index, 'index', allocationRegistry );
	return {
		uuid: geometry.uuid,
		name: typeof geometry.name === 'string' ? geometry.name : '',
		type: geometry.type,
		owner: typeof geometry.userData?.owner === 'string' && geometry.userData.owner.length > 0 ? geometry.userData.owner : 'validation-scene',
		attributeViews,
		indexView,
		allocationIds: [ ...new Set( [ ...attributeViews.map( ( view ) => view.allocationId ), ...( indexView === null ? [] : [ indexView.allocationId ] ) ] ) ].sort(),
		liveness: 'live'
	};

}

function finalizeGeometryAllocations( renderer, allocationRegistry ) {

	return [ ...allocationRegistry.values() ].map( ( allocation ) => {

		const runtimeMemory = runtimeMemoryRecordFromCandidates( renderer, allocation.candidates, allocation.logicalBytes, allocation.id );
		return {
			id: allocation.id,
			allocationType: allocation.allocationType,
			arrayType: allocation.arrayType,
			usage: allocation.usage,
			bytes: allocation.bytes,
			logicalBytes: allocation.logicalBytes,
			liveBytes: allocation.liveBytes,
			bindings: [ ...allocation.bindings ].sort(),
			runtimeMemory,
			liveness: allocation.liveness
		};

	} ).sort( ( a, b ) => a.id.localeCompare( b.id ) );

}

function sceneMrtRecord( scenePass ) {

	const mrt = scenePass.getMRT?.();
	if ( mrt === null || typeof mrt !== 'object' || mrt.isMRTNode !== true ) throw new Error( 'scenePass must own an actual MRTNode.' );
	if ( typeof mrt.uuid !== 'string' || mrt.uuid.length === 0 ) throw new Error( 'scenePass MRTNode must expose a UUID.' );
	const semantics = Object.keys( mrt.outputNodes ?? {} ).sort();
	if ( semantics.join( '\u0000' ) !== [ 'output', 'normal', 'emissive' ].sort().join( '\u0000' ) ) throw new Error( 'scenePass MRTNode must produce exactly output, normal, and emissive.' );
	const outputObjects = new Set();
	const outputUuids = new Set();
	const outputs = semantics.map( ( semantic ) => {

		const node = mrt.get( semantic );
		if ( node === null || typeof node !== 'object' || node.isNode !== true || typeof node.uuid !== 'string' || typeof node.type !== 'string' ) throw new Error( `scenePass MRT ${ semantic } output must be an actual Node identity.` );
		if ( outputObjects.has( node ) || outputUuids.has( node.uuid ) ) throw new Error( `scenePass MRT ${ semantic } output aliases another semantic node.` );
		outputObjects.add( node );
		outputUuids.add( node.uuid );
		return { semantic, nodeUuid: node.uuid, nodeType: node.type };

	} );
	return { uuid: mrt.uuid, type: mrt.type, outputs, liveness: 'live' };

}

function timestampResources( renderer ) {

	const pools = renderer.backend?.timestampQueryPool;
	if ( pools === null || typeof pools !== 'object' ) return { querySets: [], buffers: [] };
	const querySets = [];
	const buffers = [];
	for ( const [ poolType, pool ] of Object.entries( pools ).sort( ( [ a ], [ b ] ) => a.localeCompare( b ) ) ) {

		if ( pool === null || typeof pool !== 'object' ) continue;
		const maxQueries = requirePositiveInteger( pool.maxQueries, `timestamp ${ poolType }.maxQueries` );
		const querySetId = typeof pool.querySet?.label === 'string' && pool.querySet.label.length > 0 ? pool.querySet.label : null;
		querySets.push( {
			id: querySetId,
			identityAvailability: querySetId === null ? 'INSUFFICIENT_EVIDENCE' : 'ACTUAL_GPU_OBJECT_LABEL',
			poolType,
			maxQueries,
			byteAccounting: 'NOT_CLAIMED',
			reason: 'GPUQuerySet exposes query capacity, not implementation residency bytes.',
			liveness: pool.isDisposed === true ? 'disposed' : 'live'
		} );
		for ( const [ component, buffer ] of [ [ 'resolve-buffer', pool.resolveBuffer ], [ 'result-buffer', pool.resultBuffer ] ] ) {

			if ( buffer === null || typeof buffer !== 'object' ) throw new Error( `timestamp ${ poolType } ${ component } is unavailable.` );
			const id = typeof buffer.label === 'string' && buffer.label.length > 0 ? buffer.label : null;
			const bytes = requirePositiveInteger( buffer.size, `timestamp ${ poolType } ${ component }.size` );
			buffers.push( {
				id,
				identityAvailability: id === null ? 'INSUFFICIENT_EVIDENCE' : 'ACTUAL_GPU_OBJECT_LABEL',
				poolType,
				component,
				bytes,
				logicalBytes: bytes,
				liveBytes: pool.isDisposed === true ? 0 : bytes,
				runtimeMemory: { status: 'NOT_EXPOSED', bytes: null, source: 'actual GPUBuffer.size; renderer.info.memoryMap does not track timestamp buffers' },
				liveness: pool.isDisposed === true ? 'disposed' : 'live'
			} );

		}

	}
	return { querySets, buffers };

}

function readbackResources( renderer ) {

	const memoryMap = renderer.info?.memoryMap;
	if ( memoryMap instanceof Map === false ) return [];
	const result = [];
	for ( const [ resource, value ] of memoryMap ) {

		if ( resource?.isReadbackBuffer !== true ) continue;
		const bytes = value?.size;
		if ( Number.isInteger( bytes ) === false || bytes < 0 || bytes !== resource.maxByteLength ) throw new Error( 'Readback buffer renderer.info.memoryMap bytes do not match maxByteLength.' );
		const id = typeof resource.name === 'string' && resource.name.length > 0 ? resource.name : null;
		result.push( {
			id,
			identityAvailability: id === null ? 'INSUFFICIENT_EVIDENCE' : 'ACTUAL_READBACK_BUFFER_NAME',
			bytes,
			logicalBytes: bytes,
			liveBytes: bytes,
			runtimeMemory: { status: 'MEASURED', bytes, source: 'renderer.info.memoryMap identity lookup', memoryClass: value.type },
			liveness: 'live'
		} );

	}
	return result.sort( ( a, b ) => String( a.id ).localeCompare( String( b.id ) ) );

}

function memoryCompleteness( records ) {

	const runtimeRecords = records.map( ( record ) => record.runtimeMemory );
	if ( runtimeRecords.length === 0 ) return 'COMPLETE_EMPTY_CLASS';
	if ( runtimeRecords.every( ( record ) => record.status === 'MEASURED' ) ) return 'COMPLETE';
	if ( runtimeRecords.every( ( record ) => record.status === 'NOT_EXPOSED' ) ) return 'NOT_EXPOSED';
	return 'PARTIAL';

}

function classSummary( records, { allowNotClaimed = false } = {} ) {

	const identitiesComplete = records.every( ( record ) => typeof record.textureUuid === 'string' || typeof record.uuid === 'string' || typeof record.id === 'string' );
	const livenessComplete = records.every( ( record ) => record.liveness === 'live' );
	const runtimeMemoryCompleteness = memoryCompleteness( records );
	let verdict = 'PASS';
	if ( identitiesComplete === false || livenessComplete === false || runtimeMemoryCompleteness === 'PARTIAL' ) verdict = 'INSUFFICIENT_EVIDENCE';
	else if ( records.length === 0 && allowNotClaimed ) verdict = 'NOT_CLAIMED';
	return {
		identityCompleteness: identitiesComplete ? 'COMPLETE' : 'PARTIAL',
		logicalByteCompleteness: 'COMPLETE',
		runtimeMemoryCompleteness,
		livenessCompleteness: livenessComplete ? 'COMPLETE' : 'PARTIAL',
		verdict
	};

}

function unclaimedIdentityClassSummary( records ) {

	const identitiesComplete = records.every( ( record ) => typeof record.id === 'string' && record.id.length > 0 );
	const livenessComplete = records.every( ( record ) => record.liveness === 'live' );
	return {
		identityCompleteness: identitiesComplete ? 'COMPLETE' : 'PARTIAL',
		logicalByteCompleteness: 'NOT_CLAIMED',
		runtimeMemoryCompleteness: 'NOT_CLAIMED',
		livenessCompleteness: livenessComplete ? 'COMPLETE' : 'PARTIAL',
		verdict: 'NOT_CLAIMED'
	};

}

function stableSerialize( value ) {

	if ( value === null || typeof value !== 'object' ) return JSON.stringify( value );
	if ( Array.isArray( value ) ) return `[${ value.map( stableSerialize ).join( ',' ) }]`;
	return `{${ Object.keys( value ).sort().map( ( key ) => `${ JSON.stringify( key ) }:${ stableSerialize( value[ key ] ) }` ).join( ',' ) }}`;

}

function fnv1a64( value ) {

	let hash = 0xcbf29ce484222325n;
	for ( let index = 0; index < value.length; index ++ ) {

		hash ^= BigInt( value.charCodeAt( index ) );
		hash = BigInt.asUintN( 64, hash * 0x100000001b3n );

	}
	return `fnv1a64:${ hash.toString( 16 ).padStart( 16, '0' ) }`;

}

function predecessorRuntimeMemory( record, state ) {

	return state === 'live' ? record.runtimeMemory : record.lastLiveRuntimeMemory;

}

function identityClosureRecord( ledger ) {

	return {
		sceneMrt: {
			uuid: ledger.sceneMrt.uuid,
			type: ledger.sceneMrt.type,
			outputs: [ ...ledger.sceneMrt.outputs ].sort( ( a, b ) => a.semantic.localeCompare( b.semantic ) )
		},
		renderTargets: ledger.renderTargets.map( ( record ) => ( {
			semantic: record.semantic,
			owner: record.owner,
			textureUuid: record.textureUuid,
			textureName: record.textureName,
			width: record.width,
			height: record.height,
			depth: record.depth,
			format: record.format,
			colorSpace: record.colorSpace,
			sampleCount: record.sampleCount,
			logicalBytes: record.logicalBytes,
			runtimeMemory: predecessorRuntimeMemory( record, ledger.state )
		} ) ).sort( ( a, b ) => a.semantic.localeCompare( b.semantic ) ),
		geometries: ledger.geometries.map( ( geometry ) => ( {
			uuid: geometry.uuid,
			name: geometry.name,
			type: geometry.type,
			owner: geometry.owner,
			attributeViews: [ ...geometry.attributeViews ].sort( ( a, b ) => a.bindingId.localeCompare( b.bindingId ) ),
			indexView: geometry.indexView,
			allocationIds: [ ...geometry.allocationIds ].sort()
		} ) ).sort( ( a, b ) => a.uuid.localeCompare( b.uuid ) ),
		geometryAllocations: ledger.geometryAllocations.map( ( record ) => ( {
			id: record.id,
			allocationType: record.allocationType,
			arrayType: record.arrayType,
			usage: record.usage,
			logicalBytes: record.logicalBytes,
			bindings: [ ...record.bindings ].sort(),
			runtimeMemory: predecessorRuntimeMemory( record, ledger.state )
		} ) ).sort( ( a, b ) => a.id.localeCompare( b.id ) ),
		timestampQuerySets: ledger.transientResources.timestampQuerySets.map( ( record ) => ( {
			id: record.id,
			poolType: record.poolType,
			maxQueries: record.maxQueries,
			byteAccounting: record.byteAccounting
		} ) ).sort( ( a, b ) => String( a.id ).localeCompare( String( b.id ) ) ),
		timestampBuffers: ledger.transientResources.timestampBuffers.map( ( record ) => ( {
			id: record.id,
			poolType: record.poolType,
			component: record.component,
			logicalBytes: record.logicalBytes,
			runtimeMemory: predecessorRuntimeMemory( record, ledger.state )
		} ) ).sort( ( a, b ) => String( a.id ).localeCompare( String( b.id ) ) ),
		readbackBuffers: ledger.transientResources.readbackBuffers.map( ( record ) => ( {
			id: record.id,
			logicalBytes: record.logicalBytes,
			runtimeMemory: predecessorRuntimeMemory( record, ledger.state )
		} ) ).sort( ( a, b ) => String( a.id ).localeCompare( String( b.id ) ) )
	};

}

function identityClosureDigest( ledger ) {

	return fnv1a64( stableSerialize( identityClosureRecord( ledger ) ) );

}

function ensureUniqueRuntimeIdentities( rows, idField, label ) {

	const identities = new Set();
	for ( const row of rows ) {

		const identity = row[ idField ];
		if ( typeof identity !== 'string' || identity.length === 0 ) continue;
		if ( identities.has( identity ) ) throw new Error( `${ label } aliases runtime identity ${ identity }.` );
		identities.add( identity );

	}

}

function updateTotals( ledger ) {

	const renderTargetLiveBytes = sum( ledger.renderTargets.map( ( record ) => record.liveBytes ) );
	const geometryLiveBytes = sum( ledger.geometryAllocations.map( ( record ) => record.liveBytes ) );
	const timestampLiveBytes = sum( ledger.transientResources.timestampBuffers.map( ( record ) => record.liveBytes ) );
	const readbackLiveBytes = sum( ledger.transientResources.readbackBuffers.map( ( record ) => record.liveBytes ) );
	ledger.trackedRenderTargetBytes = renderTargetLiveBytes;
	ledger.trackedGeometryBytes = geometryLiveBytes;
	ledger.trackedTransientBytes = timestampLiveBytes + readbackLiveBytes;
	ledger.trackedLiveBytes = renderTargetLiveBytes + geometryLiveBytes + timestampLiveBytes + readbackLiveBytes;
	ledger.trackedLogicalBytes = sum( ledger.renderTargets.map( ( record ) => record.logicalBytes ) ) + sum( ledger.geometryAllocations.map( ( record ) => record.logicalBytes ) ) + sum( ledger.transientResources.timestampBuffers.map( ( record ) => record.logicalBytes ) ) + sum( ledger.transientResources.readbackBuffers.map( ( record ) => record.logicalBytes ) );

}

function validateRuntimeMemoryState( runtimeMemory, state, label ) {

	requireRecord( runtimeMemory, `${ label }.runtimeMemory` );
	const liveStatuses = new Set( [ 'MEASURED', 'NOT_RESIDENT', 'NOT_EXPOSED' ] );
	if ( state === 'live' && liveStatuses.has( runtimeMemory.status ) === false ) throw new Error( `${ label } has an invalid live runtime-memory state.` );
	if ( state === 'disposed' && runtimeMemory.status !== 'UNAVAILABLE_AFTER_DISPOSE' ) throw new Error( `${ label } must make runtime memory unavailable after disposal.` );
	if ( runtimeMemory.status === 'MEASURED' ) requireNonnegativeInteger( runtimeMemory.bytes, `${ label }.runtimeMemory.bytes` );
	else if ( runtimeMemory.bytes !== null ) throw new Error( `${ label } cannot report bytes for ${ runtimeMemory.status } runtime memory.` );

}

function validateAllocationLiveness( allocation, state, label ) {

	requireNonnegativeInteger( allocation.logicalBytes, `${ label }.logicalBytes` );
	requireNonnegativeInteger( allocation.liveBytes, `${ label }.liveBytes` );
	if ( allocation.bytes !== allocation.logicalBytes ) throw new Error( `${ label } bytes do not match logicalBytes.` );
	if ( state === 'live' && allocation.liveness !== 'live' ) throw new Error( `Live resource ledger contains a non-live ${ label } identity.` );
	if ( state === 'disposed' && allocation.liveness !== 'disposed' ) throw new Error( `Disposed resource ledger contains a non-disposed ${ label } identity.` );
	if ( state === 'live' && allocation.liveBytes !== allocation.logicalBytes ) throw new Error( `Live ${ label } bytes must equal logical bytes.` );
	if ( state === 'disposed' && allocation.liveBytes !== 0 ) throw new Error( `Disposed ${ label } identities must report zero live bytes.` );
	validateRuntimeMemoryState( allocation.runtimeMemory, state, label );
	if ( state === 'disposed' ) {

		validateRuntimeMemoryState( allocation.lastLiveRuntimeMemory, 'live', `${ label }.lastLiveRuntimeMemory` );
		if ( allocation.lastLiveRuntimeMemory.status === 'MEASURED' && allocation.lastLiveRuntimeMemory.bytes !== allocation.logicalBytes ) throw new Error( `Disposed ${ label } last-live runtime bytes do not reconcile.` );

	}

}

function requireEqualClassSummary( actual, expected, label ) {

	requireRecord( actual, label );
	for ( const key of [ 'identityCompleteness', 'logicalByteCompleteness', 'runtimeMemoryCompleteness', 'livenessCompleteness', 'verdict' ] ) {

		if ( actual[ key ] !== expected[ key ] ) throw new Error( `${ label }.${ key } does not reconcile with its resource class.` );

	}

}

export function validateValidationResourceLedger( ledger ) {

	requireRecord( ledger, 'resource ledger' );
	if ( ledger.schemaVersion !== 1 ) throw new Error( 'Resource ledger schemaVersion must be 1.' );
	if ( ledger.state !== 'live' && ledger.state !== 'disposed' ) throw new Error( 'Resource ledger state must be live or disposed.' );
	if ( Array.isArray( ledger.renderTargets ) === false || Array.isArray( ledger.geometries ) === false || Array.isArray( ledger.geometryAllocations ) === false ) throw new TypeError( 'Resource ledger target, geometry, and geometry-allocation inventories must be arrays.' );
	requireRecord( ledger.transientResources, 'resource ledger transientResources' );
	requireRecord( ledger.classSummaries, 'resource ledger classSummaries' );
	requireRecord( ledger.sceneMrt, 'resource ledger sceneMrt' );
	if ( Array.isArray( ledger.transientResources.timestampQuerySets ) === false || Array.isArray( ledger.transientResources.timestampBuffers ) === false || Array.isArray( ledger.transientResources.readbackBuffers ) === false ) throw new TypeError( 'Transient resource inventories must be arrays.' );
	const semantics = ledger.renderTargets.map( ( record ) => record.semantic ).sort();
	if ( semantics.join( '\u0000' ) !== [ ...REQUIRED_TARGET_SEMANTICS ].sort().join( '\u0000' ) ) throw new Error( 'Resource ledger must contain exactly output, normal, emissive, depth, and capture-target textures.' );
	if ( typeof ledger.sceneMrt.uuid !== 'string' || ledger.sceneMrt.type !== 'MRTNode' ) throw new Error( 'Resource ledger sceneMrt identity is invalid.' );
	if ( ledger.sceneMrt.liveness !== ledger.state ) throw new Error( 'Resource ledger sceneMrt liveness does not match the ledger state.' );
	const mrtSemantics = ledger.sceneMrt.outputs?.map( ( output ) => output.semantic ).sort();
	if ( Array.isArray( mrtSemantics ) === false || mrtSemantics.join( '\u0000' ) !== [ 'output', 'normal', 'emissive' ].sort().join( '\u0000' ) ) throw new Error( 'Resource ledger sceneMrt output inventory is incomplete.' );
	ensureUniqueRuntimeIdentities( ledger.sceneMrt.outputs, 'nodeUuid', 'sceneMrt outputs' );
	ensureUniqueRuntimeIdentities( ledger.renderTargets, 'textureUuid', 'Render targets' );
	ensureUniqueRuntimeIdentities( ledger.geometries, 'uuid', 'Geometries' );
	ensureUniqueRuntimeIdentities( ledger.geometryAllocations, 'id', 'Geometry allocations' );
	ensureUniqueRuntimeIdentities( ledger.transientResources.timestampQuerySets, 'id', 'Timestamp query sets' );
	ensureUniqueRuntimeIdentities( ledger.transientResources.timestampBuffers, 'id', 'Timestamp buffers' );
	ensureUniqueRuntimeIdentities( ledger.transientResources.readbackBuffers, 'id', 'Readback resources' );

	const allRecords = [ ...ledger.renderTargets, ...ledger.geometryAllocations, ...ledger.transientResources.timestampBuffers, ...ledger.transientResources.readbackBuffers ];
	for ( const record of allRecords ) {

		validateAllocationLiveness( record, ledger.state, `resource ${ record.id ?? record.semantic }` );

	}
	for ( const querySet of ledger.transientResources.timestampQuerySets ) {

		if ( querySet.byteAccounting !== 'NOT_CLAIMED' || Object.hasOwn( querySet, 'bytes' ) || Object.hasOwn( querySet, 'logicalBytes' ) || Object.hasOwn( querySet, 'liveBytes' ) ) throw new Error( 'Timestamp query-set residency bytes must remain explicitly NOT_CLAIMED.' );
		if ( ledger.state === 'live' && querySet.liveness !== 'live' ) throw new Error( 'Live resource ledger contains a non-live timestamp query set.' );
		if ( ledger.state === 'disposed' && querySet.liveness !== 'disposed' ) throw new Error( 'Disposed resource ledger contains a non-disposed timestamp query set.' );
		requirePositiveInteger( querySet.maxQueries, 'timestamp query-set maxQueries' );

	}
	for ( const target of ledger.renderTargets ) {

		const expected = EXPECTED_TARGET_TYPES[ target.semantic ];
		if ( target.format !== expected.gpuFormat || target.typeValue !== expected.type || target.threeFormatValue !== expected.format ) throw new Error( `${ target.semantic } target type/format evidence drifted.` );
		const expectedBytes = target.width * target.height * target.depth * target.bytesPerTexel * target.sampleCount;
		if ( target.logicalBytes !== expectedBytes || target.bytes !== expectedBytes ) throw new Error( `${ target.semantic } target byte accounting mismatch.` );
		if ( target.runtimeMemory.status === 'MEASURED' && target.runtimeMemory.bytes !== expectedBytes ) throw new Error( `${ target.semantic } runtime memory mismatch.` );

	}
	const allocationById = new Map( ledger.geometryAllocations.map( ( allocation ) => [ allocation.id, allocation ] ) );
	const observedBindings = new Map();
	for ( const geometry of ledger.geometries ) {

		if ( geometry.liveness !== ledger.state ) throw new Error( `${ geometry.type } geometry liveness does not match the ledger state.` );
		if ( Array.isArray( geometry.attributeViews ) === false || geometry.attributeViews.length === 0 ) throw new Error( `${ geometry.type } has no attribute views.` );
		const views = [ ...geometry.attributeViews, ...( geometry.indexView === null ? [] : [ geometry.indexView ] ) ];
		const expectedAllocationIds = [ ...new Set( views.map( ( view ) => view.allocationId ) ) ].sort();
		if ( expectedAllocationIds.join( '\u0000' ) !== geometry.allocationIds.join( '\u0000' ) ) throw new Error( `${ geometry.type } allocationIds do not close over its views.` );
		for ( const view of views ) {

			if ( allocationById.has( view.allocationId ) === false ) throw new Error( `${ geometry.type }.${ view.slot } references an unknown allocation.` );
			if ( observedBindings.has( view.bindingId ) ) throw new Error( `Geometry binding identity ${ view.bindingId } is duplicated.` );
			observedBindings.set( view.bindingId, view.allocationId );

		}

	}
	for ( const allocation of ledger.geometryAllocations ) {

		const expectedBindings = [ ...observedBindings ].filter( ( [ , allocationId ] ) => allocationId === allocation.id ).map( ( [ bindingId ] ) => bindingId ).sort();
		if ( expectedBindings.length === 0 || expectedBindings.join( '\u0000' ) !== allocation.bindings.join( '\u0000' ) ) throw new Error( `Geometry allocation ${ allocation.id } binding closure does not reconcile.` );
		if ( allocation.runtimeMemory.status === 'MEASURED' && allocation.runtimeMemory.bytes !== allocation.logicalBytes ) throw new Error( `Geometry allocation ${ allocation.id } runtime memory mismatch.` );

	}
	const expectedRenderTargetLiveBytes = sum( ledger.renderTargets.map( ( record ) => record.liveBytes ) );
	const expectedGeometryLiveBytes = sum( ledger.geometryAllocations.map( ( record ) => record.liveBytes ) );
	const expectedTimestampLiveBytes = sum( ledger.transientResources.timestampBuffers.map( ( record ) => record.liveBytes ) );
	const expectedReadbackLiveBytes = sum( ledger.transientResources.readbackBuffers.map( ( record ) => record.liveBytes ) );
	const expectedTransientLiveBytes = expectedTimestampLiveBytes + expectedReadbackLiveBytes;
	const expectedLiveBytes = expectedRenderTargetLiveBytes + expectedGeometryLiveBytes + expectedTransientLiveBytes;
	const expectedLogicalBytes = sum( allRecords.map( ( record ) => record.logicalBytes ) );
	if ( ledger.trackedRenderTargetBytes !== expectedRenderTargetLiveBytes ) throw new Error( 'Resource ledger trackedRenderTargetBytes does not reconcile with live target identities.' );
	if ( ledger.trackedGeometryBytes !== expectedGeometryLiveBytes ) throw new Error( 'Resource ledger trackedGeometryBytes does not reconcile with live geometry identities.' );
	if ( ledger.trackedTransientBytes !== expectedTransientLiveBytes ) throw new Error( 'Resource ledger trackedTransientBytes does not reconcile with live transient identities.' );
	if ( ledger.trackedLiveBytes !== expectedLiveBytes ) throw new Error( 'Resource ledger trackedLiveBytes does not reconcile with live identities.' );
	if ( ledger.trackedLogicalBytes !== expectedLogicalBytes ) throw new Error( 'Resource ledger trackedLogicalBytes does not reconcile with retained identities.' );
	requireNonnegativeInteger( ledger.trackedPeakLiveBytes, 'trackedPeakLiveBytes' );
	if ( ledger.trackedPeakLiveBytes < ledger.trackedLiveBytes ) throw new Error( 'Resource ledger peak live bytes cannot be lower than current live bytes.' );
	if ( ledger.state === 'disposed' && ledger.trackedLiveBytes !== 0 ) throw new Error( 'Disposed resource ledger must have zero tracked live bytes.' );
	if ( ledger.state === 'disposed' && allRecords.length === 0 ) throw new Error( 'Disposed resource ledger must retain the identities it disposed.' );
	if ( ledger.opaqueRendererInternalResidency?.status !== 'NOT_CLAIMED' ) throw new Error( 'Opaque renderer-internal residency must remain NOT_CLAIMED.' );
	if ( ledger.state === 'live' ) {

		requireEqualClassSummary( ledger.classSummaries.renderTargets, classSummary( ledger.renderTargets ), 'classSummaries.renderTargets' );
		requireEqualClassSummary( ledger.classSummaries.geometryAllocations, classSummary( ledger.geometryAllocations ), 'classSummaries.geometryAllocations' );
		requireEqualClassSummary( ledger.classSummaries.timestampQuerySets, unclaimedIdentityClassSummary( ledger.transientResources.timestampQuerySets ), 'classSummaries.timestampQuerySets' );
		requireEqualClassSummary( ledger.classSummaries.timestampBuffers, classSummary( ledger.transientResources.timestampBuffers, { allowNotClaimed: true } ), 'classSummaries.timestampBuffers' );
		requireEqualClassSummary( ledger.classSummaries.readbackBuffers, classSummary( ledger.transientResources.readbackBuffers ), 'classSummaries.readbackBuffers' );
		const measuredBytes = sum( [ ...ledger.renderTargets, ...ledger.geometryAllocations, ...ledger.transientResources.readbackBuffers ].filter( ( record ) => record.runtimeMemory.status === 'MEASURED' ).map( ( record ) => record.runtimeMemory.bytes ) );
		if ( ledger.rendererInfoMemory?.status === 'MEASURED' && ( Number.isInteger( ledger.rendererInfoMemory.totalBytes ) === false || ledger.rendererInfoMemory.totalBytes < measuredBytes ) ) throw new Error( 'rendererInfoMemory.totalBytes is lower than the reconciled identity-keyed memoryMap bytes.' );
		if ( ledger.identityClosureDigest !== identityClosureDigest( ledger ) ) throw new Error( 'Live resource ledger identity-closure digest does not match its runtime records.' );

	} else {

		requireRecord( ledger.lastLiveClassSummaries, 'lastLiveClassSummaries' );
		if ( ledger.predecessorIdentityClosureDigest !== ledger.identityClosureDigest ) throw new Error( 'Disposed ledger is not bound to its exact live predecessor digest.' );
		if ( ledger.identityClosureDigest !== identityClosureDigest( ledger ) ) throw new Error( 'Disposed resource identities or last-live records drifted from the predecessor digest.' );
		for ( const [ className, summary ] of Object.entries( ledger.classSummaries ) ) {

			if ( summary.livenessCompleteness !== 'DISPOSED_IDENTITIES_RETAINED' ) throw new Error( `classSummaries.${ className } does not retain disposed liveness evidence.` );
			const predecessor = ledger.lastLiveClassSummaries[ className ];
			if ( predecessor === undefined || summary.verdict !== predecessor.verdict || summary.identityCompleteness !== predecessor.identityCompleteness || summary.logicalByteCompleteness !== predecessor.logicalByteCompleteness || summary.runtimeMemoryCompleteness !== predecessor.runtimeMemoryCompleteness ) throw new Error( `classSummaries.${ className } drifted from the live predecessor.` );

		}
		if ( ledger.disposalObservation?.verdict !== 'PASS' || ledger.disposalObservation.memoryMapSize !== 0 || ledger.disposalObservation.memoryTotalBytes !== 0 ) throw new Error( 'Disposed ledger lacks an observed zero-residency renderer.info snapshot.' );

	}
	return ledger;

}

/**
 * Derive the validation resource ledger from the actual Three.js runtime
 * objects. No target, geometry, or transient identity is synthesized from
 * dimensions or descriptor strings.
 */
export function buildValidationResourceLedger( { renderer, scenePass, captureTarget, geometries, previousLedger = null } ) {

	if ( renderer === null || typeof renderer !== 'object' || renderer.isWebGPURenderer !== true ) throw new TypeError( 'renderer must be an actual WebGPURenderer.' );
	if ( scenePass === null || typeof scenePass !== 'object' || scenePass.isPassNode !== true ) throw new TypeError( 'scenePass must be an actual Three.js PassNode.' );
	const sceneTarget = requireRenderTarget( scenePass.renderTarget, 'scenePass.renderTarget' );
	requireRenderTarget( captureTarget, 'captureTarget' );
	if ( Array.isArray( geometries ) === false || geometries.length === 0 ) throw new TypeError( 'geometries must be a non-empty array of actual BufferGeometry objects.' );
	if ( previousLedger !== null ) validateValidationResourceLedger( previousLedger );

	const sceneTextureByName = new Map();
	for ( const texture of sceneTarget.textures ) {

		if ( typeof texture.name !== 'string' || texture.name.length === 0 ) throw new Error( 'Every scene MRT texture must have its actual semantic name.' );
		if ( sceneTextureByName.has( texture.name ) ) throw new Error( `Scene MRT aliases semantic ${ texture.name }.` );
		sceneTextureByName.set( texture.name, texture );

	}
	for ( const semantic of [ 'output', 'normal', 'emissive' ] ) {

		if ( sceneTextureByName.has( semantic ) === false ) throw new Error( `Scene MRT omits required ${ semantic } texture.` );

	}
	if ( sceneTextureByName.size !== 3 ) throw new Error( 'Scene MRT must expose exactly output, normal, and emissive textures.' );
	if ( sceneTarget.depthTexture === null ) throw new Error( 'Scene pass omits the required depth texture.' );
	if ( captureTarget.textures.length !== 1 || captureTarget.depthTexture !== null || captureTarget.depthBuffer !== false ) throw new Error( 'Capture target must expose exactly one color texture and no depth allocation.' );

	const targetInputs = [
		...([ 'output', 'normal', 'emissive' ].map( ( semantic ) => ( { target: sceneTarget, texture: sceneTextureByName.get( semantic ), semantic, owner: 'scene-pass' } ) )),
		{ target: sceneTarget, texture: sceneTarget.depthTexture, semantic: 'depth', owner: 'scene-pass' },
		{ target: captureTarget, texture: captureTarget.texture, semantic: 'capture-target', owner: 'validation-capture' }
	];
	const targetObjects = new Set();
	const targetUuids = new Set();
	for ( const input of targetInputs ) {

		if ( targetObjects.has( input.texture ) || targetUuids.has( input.texture.uuid ) ) throw new Error( `${ input.semantic } aliases another required texture allocation.` );
		targetObjects.add( input.texture );
		targetUuids.add( input.texture.uuid );

	}
	const renderTargets = targetInputs.map( ( input ) => targetRecord( { renderer, ...input } ) );
	const sceneMrt = sceneMrtRecord( scenePass );
	const geometryObjects = new Set();
	const geometryUuids = new Set();
	const geometryAllocationRegistry = new Map();
	const geometryRecords = geometries.map( ( geometry, index ) => {

		if ( geometryObjects.has( geometry ) || geometryUuids.has( geometry?.uuid ) ) throw new Error( `geometries[${ index }] aliases another geometry identity.` );
		geometryObjects.add( geometry );
		geometryUuids.add( geometry.uuid );
		return geometryRecord( geometry, index, geometryAllocationRegistry );

	} );
	const geometryAllocations = finalizeGeometryAllocations( renderer, geometryAllocationRegistry );
	const { querySets: timestampQuerySets, buffers: timestampBuffers } = timestampResources( renderer );
	const readbackBuffers = readbackResources( renderer );
	const ledger = {
		schemaVersion: 1,
		state: 'live',
		accountingScope: 'lab-owned-render-targets-geometry-and-exposed-transients',
		completeness: 'PARTIAL',
		inventoryCompleteness: 'COMPLETE_LAB_IDENTITIES_OPAQUE_BACKEND_EXCLUDED',
		renderTargets,
		sceneMrt,
		geometries: geometryRecords,
		geometryAllocations,
		storageResources: [],
		transientResources: { timestampQuerySets, timestampBuffers, readbackBuffers },
		classSummaries: {
			renderTargets: classSummary( renderTargets ),
			geometryAllocations: classSummary( geometryAllocations ),
			timestampQuerySets: unclaimedIdentityClassSummary( timestampQuerySets ),
			timestampBuffers: classSummary( timestampBuffers, { allowNotClaimed: true } ),
			readbackBuffers: classSummary( readbackBuffers )
		},
		rendererInfoMemory: {
			status: renderer.info?.memoryMap instanceof Map ? 'MEASURED' : 'NOT_EXPOSED',
			totalBytes: Number.isInteger( renderer.info?.memory?.total ) ? renderer.info.memory.total : null,
			source: 'renderer.info.memory and identity-keyed renderer.info.memoryMap'
		},
		labOwnedNonTargetResources: geometryRecords.map( ( geometry ) => ( { kind: 'geometry', id: geometry.uuid, byteAccounting: 'DERIVED_AND_RUNTIME_RECONCILED_WHEN_RESIDENT' } ) ),
		opaqueRendererInternalResidency: {
			status: 'NOT_CLAIMED',
			reason: 'Backend pipelines, bind groups, samplers, implicit multisample storage, caches, and allocations without renderer.info.memoryMap identities are opaque.'
		},
		readbackPolicy: 'capture texture is the explicit sink; transient ReadbackBuffer identities are reported only when renderer.info.memoryMap exposes them'
	};
	updateTotals( ledger );
	ledger.trackedPeakLiveBytes = Math.max( ledger.trackedLiveBytes, previousLedger?.trackedPeakLiveBytes ?? 0 );
	ledger.identityClosureDigest = identityClosureDigest( ledger );
	return validateValidationResourceLedger( ledger );

}

function markRuntimeUnavailableAfterDispose( record ) {

	record.lastLiveRuntimeMemory = record.runtimeMemory;
	record.runtimeMemory = { status: 'UNAVAILABLE_AFTER_DISPOSE', bytes: null, source: 'retained disposed identity; renderer residency no longer live' };
	record.liveBytes = 0;
	record.liveness = 'disposed';

}

/**
 * Produce the post-disposal snapshot from a previously observed live ledger.
 * Identities and logical sizes are retained; only live byte counts become zero.
 */
export function emptyValidationResourceLedger( { renderer, previousLedger } = {} ) {

	if ( renderer === null || typeof renderer !== 'object' || renderer.isWebGPURenderer !== true ) throw new TypeError( 'Post-disposal observation requires the actual WebGPURenderer.' );
	validateValidationResourceLedger( previousLedger );
	if ( previousLedger.state !== 'live' ) throw new Error( 'Post-disposal observation requires an exact live predecessor ledger.' );
	if ( renderer.info?.memoryMap instanceof Map === false ) throw new Error( 'Post-disposal observation requires renderer.info.memoryMap.' );
	const memoryMapSize = renderer.info.memoryMap.size;
	const memory = renderer.info.memory;
	if ( memory === null || typeof memory !== 'object' ) throw new Error( 'Post-disposal observation requires renderer.info.memory counters.' );
	const memoryCounters = Object.fromEntries( Object.entries( memory ).filter( ( [ , value ] ) => typeof value === 'number' ).sort( ( [ a ], [ b ] ) => a.localeCompare( b ) ) );
	if ( Object.keys( memoryCounters ).length === 0 || Object.values( memoryCounters ).some( ( value ) => Number.isFinite( value ) === false || value !== 0 ) || memoryMapSize !== 0 ) throw new Error( 'Renderer still exposes live memory after disposal.' );
	const ledger = structuredClone( previousLedger );
	ledger.state = 'disposed';
	ledger.predecessorIdentityClosureDigest = previousLedger.identityClosureDigest;
	ledger.lastLiveClassSummaries = structuredClone( previousLedger.classSummaries );
	ledger.sceneMrt.liveness = 'disposed';
	for ( const target of ledger.renderTargets ) markRuntimeUnavailableAfterDispose( target );
	for ( const geometry of ledger.geometries ) geometry.liveness = 'disposed';
	for ( const allocation of ledger.geometryAllocations ) markRuntimeUnavailableAfterDispose( allocation );
	for ( const querySet of ledger.transientResources.timestampQuerySets ) querySet.liveness = 'disposed';
	for ( const resource of ledger.transientResources.timestampBuffers ) markRuntimeUnavailableAfterDispose( resource );
	for ( const resource of ledger.transientResources.readbackBuffers ) markRuntimeUnavailableAfterDispose( resource );
	for ( const summary of Object.values( ledger.classSummaries ) ) {

		summary.livenessCompleteness = 'DISPOSED_IDENTITIES_RETAINED';

	}
	ledger.rendererInfoMemory = { status: 'MEASURED_POST_DISPOSE', totalBytes: memory.total, source: 'actual renderer.info after renderer disposal' };
	ledger.disposalObservation = {
		verdict: 'PASS',
		memoryMapSize,
		memoryTotalBytes: memory.total,
		memoryCounters,
		source: 'actual WebGPURenderer.info observed after disposal'
	};
	ledger.opaqueRendererInternalResidency = {
		status: 'NOT_CLAIMED',
		reason: 'Renderer.info zeroes are observed, but opaque backend residency beyond renderer.info remains unclaimed.'
	};
	ledger.readbackPolicy = 'unavailable after disposal; exact predecessor capture and readback identities retained';
	updateTotals( ledger );
	return validateValidationResourceLedger( ledger );

}
