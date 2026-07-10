import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const PARTITION_FIXTURE_ID = 'measure-and-commodity-closure';
const PARTITION_GROUP_ID = 'body-water-impact-partition-group-42';
const PHYSICAL_IMPACT_PARENT_ID = 'body-water-impact-parent-42';
const SUPPORT_CHART_ID = 'body-water-impact-support-chart';
const SUPPORT_CHART_REVISION = 'body-water-impact-support-chart-v1';
const MEASURE_UNIT = 'square-meter';
const LENGTH_UNIT = 'metre';
const LINEAR_MOMENTUM_UNIT = 'newton-second';
const ANGULAR_MOMENTUM_UNIT = 'newton-metre-second';
const VECTOR_COMMODITIES = Object.freeze( [ 'linearMomentumNs', 'angularMomentumNms' ] );

function canonicalJson( value ) {

	if ( Array.isArray( value ) ) return `[${ value.map( canonicalJson ).join( ',' ) }]`;
	if ( value !== null && typeof value === 'object' ) return `{${ Object.keys( value ).sort().map( ( key ) => `${ JSON.stringify( key ) }:${ canonicalJson( value[ key ] ) }` ).join( ',' ) }}`;
	return JSON.stringify( value );

}

function fallbackDigest( value ) {

	return `sha256:${ createHash( 'sha256' ).update( canonicalJson( value ) ).digest( 'hex' ) }`;

}

function partitionApi( h ) {

	for ( const name of [ 'clone', 'evidence', 'fixtureError', 'requireAbiRecord' ] ) assert.equal( typeof h?.[ name ], 'function', `partition fixture helper h.${ name } is required` );
	return {
		clone: h.clone,
		evidence: h.evidence,
		error: h.fixtureError,
		requireRecord: h.requireAbiRecord,
		digest: h.sha256Canonical ?? fallbackDigest
	};

}

function finiteQuantityValue( quantity, expectedUnit, label ) {

	assert.ok( quantity !== null && typeof quantity === 'object' && ! Array.isArray( quantity ), `${ label } must be labelled quantitative evidence` );
	assert.equal( quantity.unit, expectedUnit, `${ label } has unit ${ quantity.unit }, expected ${ expectedUnit }` );
	assert.ok( typeof quantity.value === 'number' && Number.isFinite( quantity.value ), `${ label }.value must be finite` );
	return quantity.value;

}

function finiteEvidenceValue( quantity, label ) {

	assert.ok( quantity !== null && typeof quantity === 'object' && ! Array.isArray( quantity ), `${ label } must be labelled quantitative evidence` );
	assert.ok( typeof quantity.value === 'number' && Number.isFinite( quantity.value ), `${ label }.value must be finite` );
	return quantity.value;

}

function exactUniqueSet( actual, expected, label ) {

	assert.ok( Array.isArray( actual ), `${ label } must be an array` );
	assert.equal( new Set( actual ).size, actual.length, `${ label } contains duplicates` );
	assert.deepEqual( [ ...actual ].sort(), [ ...expected ].sort(), `${ label } does not close exactly` );

}

function addVector( target, source, label ) {

	assert.ok( Array.isArray( source ) && source.length === 3, `${ label } must be a three-vector` );
	for ( let axis = 0; axis < 3; axis ++ ) {

		assert.ok( typeof source[ axis ] === 'number' && Number.isFinite( source[ axis ] ), `${ label }[${ axis }] must be finite` );
		target[ axis ] += source[ axis ];

	}
	return target;

}

function inventoryForRecords( records, label ) {

	const inventory = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ] };
	for ( const record of records ) {

		assert.equal( record?.payload?.tag, 'momentumTransfer', `${ label} interaction ${ record?.interactionId ?? '<unknown>' } is not an interval-integrated momentum transfer` );
		assert.equal( record.payload.timeSemantics, 'interval-integrated', `${ label} interaction ${ record.interactionId } has incompatible time semantics` );
		addVector( inventory.linearMomentumNs, record.payload.linearMomentumNs, `${ label}.${ record.interactionId }.linearMomentumNs` );
		addVector( inventory.angularMomentumNms, record.payload.angularMomentumNms, `${ label}.${ record.interactionId }.angularMomentumNms` );

	}
	return inventory;

}

function assertInventoryNear( actual, expected, tolerances, label ) {

	assert.deepEqual( Object.keys( actual ).sort(), [ ...VECTOR_COMMODITIES ].sort(), `${ label } has missing or extra commodities` );
	for ( const commodity of VECTOR_COMMODITIES ) {

		assert.ok( Array.isArray( actual[ commodity ] ) && actual[ commodity ].length === 3, `${ label}.${ commodity } must be a three-vector` );
		const tolerance = commodity === 'linearMomentumNs' ? tolerances.linearMomentum : tolerances.angularMomentum;
		for ( let axis = 0; axis < 3; axis ++ ) {

			const difference = Math.abs( actual[ commodity ][ axis ] - expected[ commodity ][ axis ] );
			assert.ok( difference <= tolerance, `${ label}.${ commodity }[${ axis }] fails closure by ${ difference }` );

		}

	}

}

function recordDigest( api, record, digestKey ) {

	const payload = api.clone( record );
	delete payload[ digestKey ];
	return api.digest( payload );

}

function rectangle( api, partitionId, uMinMeters, uMaxExclusiveMeters ) {

	return {
		kind: 'half-open-axis-aligned-rectangle',
		chartId: SUPPORT_CHART_ID,
		chartRevision: SUPPORT_CHART_REVISION,
		uIntervalMeters: {
			minInclusive: api.evidence( uMinMeters, LENGTH_UNIT, 'Derived', `${ partitionId } partition support` ),
			maxExclusive: api.evidence( uMaxExclusiveMeters, LENGTH_UNIT, 'Derived', `${ partitionId } partition support` )
		},
		vIntervalMeters: {
			minInclusive: api.evidence( 0, LENGTH_UNIT, 'Authored', 'partition fixture chart domain' ),
			maxExclusive: api.evidence( 1, LENGTH_UNIT, 'Authored', 'partition fixture chart domain' )
		},
		boundaryConvention: '[min,max) on both axes'
	};

}

function rectangleMeasure( geometry, label ) {

	assert.equal( geometry?.kind, 'half-open-axis-aligned-rectangle', `${ label } must use the exact rectangle support representation` );
	const uMin = finiteQuantityValue( geometry.uIntervalMeters?.minInclusive, LENGTH_UNIT, `${ label }.uIntervalMeters.minInclusive` );
	const uMax = finiteQuantityValue( geometry.uIntervalMeters?.maxExclusive, LENGTH_UNIT, `${ label }.uIntervalMeters.maxExclusive` );
	const vMin = finiteQuantityValue( geometry.vIntervalMeters?.minInclusive, LENGTH_UNIT, `${ label }.vIntervalMeters.minInclusive` );
	const vMax = finiteQuantityValue( geometry.vIntervalMeters?.maxExclusive, LENGTH_UNIT, `${ label }.vIntervalMeters.maxExclusive` );
	const uWidth = uMax - uMin;
	const vWidth = vMax - vMin;
	assert.ok( uWidth > 0 && vWidth > 0, `${ label } has nonpositive support measure` );
	return uWidth * vWidth;

}

function rectangleBounds( geometry, label ) {

	rectangleMeasure( geometry, label );
	return {
		uMin: geometry.uIntervalMeters.minInclusive.value,
		uMax: geometry.uIntervalMeters.maxExclusive.value,
		vMin: geometry.vIntervalMeters.minInclusive.value,
		vMax: geometry.vIntervalMeters.maxExclusive.value
	};

}

function assertNear( actual, expected, tolerance, label ) {

	const difference = Math.abs( actual - expected );
	assert.ok( difference <= tolerance, `${ label } differs by ${ difference }` );

}

function rectangleInteriorOverlapMeasure( a, b ) {

	const uOverlap = Math.max( 0, Math.min( a.uIntervalMeters.maxExclusive.value, b.uIntervalMeters.maxExclusive.value ) - Math.max( a.uIntervalMeters.minInclusive.value, b.uIntervalMeters.minInclusive.value ) );
	const vOverlap = Math.max( 0, Math.min( a.vIntervalMeters.maxExclusive.value, b.vIntervalMeters.maxExclusive.value ) - Math.max( a.vIntervalMeters.minInclusive.value, b.vIntervalMeters.minInclusive.value ) );
	return uOverlap * vOverlap;

}

function parentRecordDigest( api, parent, parentSupportGeometry ) {

	const parentPayload = api.clone( parent );
	delete parentPayload.sourceContentDigest;
	return api.digest( { parent: parentPayload, parentSupportGeometry } );

}

function supportChartDescriptor( api, exchange, totalMeasureSquareMetres ) {

	return {
		chartId: SUPPORT_CHART_ID,
		owner: 'route-physics-coordinator',
		anchorPhysicsFrameId: exchange.physicsFrameId,
		physicsOriginEpoch: exchange.physicsOriginEpoch,
		transformRevision: exchange.transformRevision,
		chartRevision: SUPPORT_CHART_REVISION,
		coordinateUnitsAndRanges: {
			u: { unit: LENGTH_UNIT, minInclusive: api.evidence( 0, LENGTH_UNIT, 'Authored', 'impact support chart domain' ), maxExclusive: api.evidence( totalMeasureSquareMetres, LENGTH_UNIT, 'Derived', 'parent area divided by unit v-width' ) },
			v: { unit: LENGTH_UNIT, minInclusive: api.evidence( 0, LENGTH_UNIT, 'Authored', 'impact support chart domain' ), maxExclusive: api.evidence( 1, LENGTH_UNIT, 'Authored', 'impact support chart unit-width domain' ) }
		},
		forwardMap: 'r(u,v)=origin+u*e_u+v*e_v in the registered physics frame',
		inverseMap: 'orthogonal projection onto registered (e_u,e_v) basis within the half-open validity domain',
		jacobian: api.evidence( [ 1, 0, 0, 1 ], 'metre-per-chart-coordinate-matrix2', 'Authored', 'affine impact support chart' ),
		metricTensor: api.evidence( [ 1, 0, 0, 1 ], 'square-meter-per-square-chart-coordinate-matrix2', 'Derived', 'J-transpose times J' ),
		orientation: 'right-handed e_u cross e_v equals the footprint normal',
		validityDomain: rectangle( api, 'parent-chart-domain', 0, totalMeasureSquareMetres ),
		singularitiesAndSeams: 'none inside the half-open registered domain',
		curvatureAndLinearizationError: api.error( LENGTH_UNIT, 1e-12, 'affine impact support chart' )
	};

}

function registerSupportChart( api, context, exchange, totalMeasureSquareMetres ) {

	assert.ok( context?.chartRegistry?.chartsById && typeof context.chartRegistry.chartsById === 'object', 'partition fixture requires PhysicsContext.chartRegistry.chartsById' );
	assert.equal( context.chartRegistry.anchorFrameRegistryRevision, context.physicsFrameRegistry.registryRevision, 'partition support chart registry anchors another frame-registry revision' );
	const descriptor = supportChartDescriptor( api, exchange, totalMeasureSquareMetres );
	const existing = context.chartRegistry.chartsById[ SUPPORT_CHART_ID ];
	if ( existing ) assert.deepEqual( existing, descriptor, `registered support chart ${ SUPPORT_CHART_ID } conflicts with the partition fixture` );
	else context.chartRegistry.chartsById[ SUPPORT_CHART_ID ] = api.clone( descriptor );
	return context.chartRegistry.chartsById[ SUPPORT_CHART_ID ];

}

function makePartitionFootprint( api, prototype, fields ) {

	const footprint = api.clone( prototype );
	footprint.footprintId = `body-water-impact-${ fields.partitionId }-footprint`;
	footprint.kind = 'area';
	footprint.supportGeometry = rectangle( api, fields.partitionId, fields.uMinMeters, fields.uMaxExclusiveMeters );
	footprint.chartId = SUPPORT_CHART_ID;
	footprint.measureUnit = MEASURE_UNIT;
	footprint.representedMeasure = api.evidence( fields.measureSquareMetres, MEASURE_UNIT, 'Derived', `${ fields.partitionId } half-open support width times height` );
	footprint.distributionKind = 'extensive-distributed';
	footprint.kernel = `normalized compact partition kernel ${ fields.partitionId }`;
	footprint.kernelUnit = 'inverse-square-meter';
	footprint.normalizationTarget = 'unity';
	footprint.normalizationIntegral = api.evidence( 1, 'ratio', 'Gated', `${ fields.partitionId } exact partition quadrature` );
	footprint.quadrature = {
		kind: 'exact-half-open-rectangle',
		physicalJacobian: api.evidence( 1, 'ratio', 'Derived', `${ fields.partitionId } affine chart Jacobian` ),
		representedArea: api.evidence( fields.measureSquareMetres, MEASURE_UNIT, 'Derived', `${ fields.partitionId } exact rectangle quadrature` )
	};
	footprint.approximationError = api.error( MEASURE_UNIT, 1e-12, `${ fields.partitionId } partition quadrature` );
	return footprint;

}

function selectExchange( route ) {

	assert.ok( Array.isArray( route?.physicsInteractions ) && route.physicsInteractions.length > 0, 'partition fixture requires a physical SurfaceExchange' );
	return route.physicsInteractions.find( ( exchange ) => exchange.exchangeId === 'body-water-exchange' ) ?? route.physicsInteractions[ 0 ];

}

function selectPartitionGroups( exchange ) {

	assert.ok( exchange.interactions.length >= 2 && exchange.reactions.length >= 2, 'partition fixture requires at least two source and two reaction interactions' );
	const fore = [ exchange.interactions[ 0 ], exchange.reactions[ 0 ] ];
	const aft = [ exchange.interactions[ 1 ], exchange.reactions[ 1 ] ];
	const assigned = new Set( [ ...fore, ...aft ].map( ( record ) => record.interactionId ) );
	for ( const record of [ ...exchange.interactions.slice( 2 ), ...exchange.reactions.slice( 2 ) ] ) ( fore.length <= aft.length ? fore : aft ).push( record );
	assert.equal( new Set( [ ...fore, ...aft ].map( ( record ) => record.interactionId ) ).size, fore.length + aft.length, 'partition fixture reuses a child interaction' );
	assert.equal( assigned.size + exchange.interactions.slice( 2 ).length + exchange.reactions.slice( 2 ).length, fore.length + aft.length, 'partition fixture omits an interaction' );
	return [ { partitionId: 'fore', records: fore }, { partitionId: 'aft', records: aft } ];

}

/** Attach one nonempty, spatially disjoint physical-impact partition family. */
export function buildPhysicalImpactPartitionBundle( h, route ) {

	const api = partitionApi( h );
	const exchange = selectExchange( route );
	const context = route.physicsContext;
	assert.ok( context && exchange.contextId === context.contextId, 'partition fixture exchange/context mismatch' );
	const records = [ ...exchange.interactions, ...exchange.reactions ];
	const recordIds = records.map( ( record ) => record.interactionId );
	exactUniqueSet( recordIds, recordIds, 'partition fixture interaction IDs' );
	const prototypeFootprint = records[ 0 ]?.footprint;
	const priorParent = exchange.physicalImpactParents?.find( ( parent ) => parent.physicalImpactParentId === PHYSICAL_IMPACT_PARENT_ID );
	assert.equal( prototypeFootprint?.measureUnit, MEASURE_UNIT, 'partition prototype footprint does not use the schema-canonical area unit' );
	const totalMeasureSquareMetres = priorParent ? finiteQuantityValue( priorParent.totalFootprintMeasure, MEASURE_UNIT, 'prior partition parent measure' ) : finiteEvidenceValue( prototypeFootprint?.representedMeasure, 'partition prototype representedMeasure' );
	assert.ok( totalMeasureSquareMetres > 0, 'partition parent measure must be positive' );
	registerSupportChart( api, context, exchange, totalMeasureSquareMetres );
	const parentSupportGeometry = rectangle( api, 'physical-impact-parent', 0, totalMeasureSquareMetres );
	const firstMeasure = totalMeasureSquareMetres * 5 / 12;
	const groupSpecs = selectPartitionGroups( exchange ).map( ( group, index ) => ( {
		...group,
		measureSquareMetres: index === 0 ? firstMeasure : totalMeasureSquareMetres - firstMeasure,
		uMinMeters: index === 0 ? 0 : firstMeasure,
		uMaxExclusiveMeters: index === 0 ? firstMeasure : totalMeasureSquareMetres
	} ) );
	const closureGroupId = exchange.conservationGroups?.[ 0 ]?.conservationGroupId;
	assert.ok( typeof closureGroupId === 'string' && closureGroupId.length > 0, 'partition fixture requires a conservation closure group' );
	const partitionIds = groupSpecs.map( ( group ) => group.partitionId );
	const visualChildrenById = {};
	const physicalImpactPartitions = groupSpecs.map( ( group ) => {

		const membership = {
			parentExchangeId: exchange.exchangeId,
			parentInteractionIds: [ ...recordIds ],
			partitionGroupId: PARTITION_GROUP_ID,
			partitionId: group.partitionId,
			partitionMeasure: api.evidence( group.measureSquareMetres, MEASURE_UNIT, 'Derived', `${ group.partitionId } exact half-open support measure` ),
			closureGroupId
		};
		const partitionFootprint = makePartitionFootprint( api, prototypeFootprint, group );
		for ( const record of group.records ) {

			record.partitionMembership = api.clone( membership );
			record.footprint = api.clone( partitionFootprint );

		}
		const visualChildId = `visual-foam-${ group.partitionId }-42`;
		visualChildrenById[ visualChildId ] = {
			visualChildId,
			sourcePartitionId: group.partitionId,
			owner: '$threejs-particles-trails-and-effects',
			authority: 'visual-only',
			physicalAuthority: false,
			canApplyPhysicalPayload: false,
			interactionApplicationLedgerIds: [],
			payloadInventory: {}
		};
		const partition = {
			physicalImpactPartitionId: `body-water-impact-partition-record-${ group.partitionId }-42`,
			physicalImpactParentId: PHYSICAL_IMPACT_PARENT_ID,
			membership,
			childInteractionIds: group.records.map( ( record ) => record.interactionId ),
			partitionFootprint,
			partitionPayloadInventory: inventoryForRecords( group.records, `partition ${ group.partitionId }` ),
			visualChildIds: [ visualChildId ],
			partitionContentDigest: 'pending'
		};
		partition.partitionContentDigest = recordDigest( api, partition, 'partitionContentDigest' );
		return partition;

	} );
	const parent = {
		physicalImpactParentId: PHYSICAL_IMPACT_PARENT_ID,
		contextId: context.contextId,
		parentExchangeId: exchange.exchangeId,
		parentInteractionIds: recordIds,
		applicationInterval: api.clone( exchange.applicationInterval ),
		physicsFrameId: exchange.physicsFrameId,
		physicsOriginEpoch: exchange.physicsOriginEpoch,
		transformRevision: exchange.transformRevision,
		partitionGroupId: PARTITION_GROUP_ID,
		partitionIds,
		totalFootprintMeasure: api.evidence( totalMeasureSquareMetres, MEASURE_UNIT, 'Derived', 'sum of exact fore and aft half-open support measures' ),
		conservedPayloadInventory: inventoryForRecords( records, 'physical impact parent' ),
		closureGroupId,
		sourceContentDigest: 'pending'
	};
	parent.sourceContentDigest = parentRecordDigest( api, parent, parentSupportGeometry );
	exchange.physicalImpactParents = [ parent ];
	exchange.physicalImpactPartitions = physicalImpactPartitions;
	return {
		fixtureId: PARTITION_FIXTURE_ID,
		exchangeId: exchange.exchangeId,
		supportCoordinateClosureBound: api.evidence( 1e-12, LENGTH_UNIT, 'Gated', 'half-open support endpoint closure gate' ),
		measureClosureBound: api.evidence( 1e-9, MEASURE_UNIT, 'Gated', 'partition quadrature closure gate' ),
		linearMomentumClosureBound: api.evidence( 1e-12, LINEAR_MOMENTUM_UNIT, 'Gated', 'signed linear-momentum partition closure gate' ),
		angularMomentumClosureBound: api.evidence( 1e-12, ANGULAR_MOMENTUM_UNIT, 'Gated', 'signed angular-momentum partition closure gate' ),
		physicalImpactParents: exchange.physicalImpactParents,
		physicalImpactPartitions: exchange.physicalImpactPartitions,
		parentSupportGeometryById: { [ parent.physicalImpactParentId ]: parentSupportGeometry },
		interactionRecordsById: Object.fromEntries( records.map( ( record ) => [ record.interactionId, record ] ) ),
		visualChildrenById
	};

}

function validateVisualChildren( route, bundle, partitionIds ) {

	const visualIds = bundle.physicalImpactPartitions.flatMap( ( partition ) => partition.visualChildIds );
	exactUniqueSet( visualIds, Object.keys( bundle.visualChildrenById ), 'visual-child inventory' );
	const physicalInteractionIds = new Set( Object.keys( bundle.interactionRecordsById ) );
	const applicationInteractionIds = new Set( Object.values( route.physicsInteractionApplicationLedgers ?? {} ).map( ( ledger ) => ledger.interactionId ) );
	for ( const [ key, visual ] of Object.entries( bundle.visualChildrenById ) ) {

		assert.equal( key, visual.visualChildId, `visual child registry key ${ key } mismatch` );
		assert.ok( partitionIds.has( visual.sourcePartitionId ), `visual child ${ key } references an unknown partition` );
		assert.equal( visual.authority, 'visual-only', `visual child ${ key} claims physical authority` );
		assert.equal( visual.physicalAuthority, false, `visual child ${ key} claims physical authority` );
		assert.equal( visual.canApplyPhysicalPayload, false, `visual child ${ key} can apply physical payload` );
		assert.deepEqual( visual.interactionApplicationLedgerIds, [], `visual child ${ key} enters an application ledger` );
		assert.deepEqual( visual.payloadInventory, {}, `visual child ${ key} duplicates a physical payload inventory` );
		assert.ok( ! physicalInteractionIds.has( key ) && ! applicationInteractionIds.has( key ), `visual child ${ key} aliases a physical interaction identity` );

	}

}

function validateGeometryChartReference( geometry, chart, label ) {

	assert.deepEqual( [ geometry.chartId, geometry.chartRevision ], [ chart.chartId, chart.chartRevision ], `${ label } does not resolve the registered support chart revision` );
	return rectangleBounds( geometry, label );

}

function validateExactRectangleUnion( parentGeometry, childGeometries, coordinateTolerance, measureTolerance, label ) {

	const parentBounds = rectangleBounds( parentGeometry, `${ label }.parentSupportGeometry` );
	const children = childGeometries.map( ( entry ) => ( { ...entry, bounds: rectangleBounds( entry.geometry, `${ entry.label }.supportGeometry` ) } ) );
	for ( const child of children ) {

		assert.ok( child.bounds.uMin >= parentBounds.uMin - coordinateTolerance && child.bounds.uMax <= parentBounds.uMax + coordinateTolerance, `${ child.label } is shifted outside the parent support on u` );
		assert.ok( child.bounds.vMin >= parentBounds.vMin - coordinateTolerance && child.bounds.vMax <= parentBounds.vMax + coordinateTolerance, `${ child.label } is shifted outside the parent support on v` );

	}
	for ( let first = 0; first < children.length; first ++ ) for ( let second = first + 1; second < children.length; second ++ ) {

		const overlap = rectangleInteriorOverlapMeasure( children[ first ].geometry, children[ second ].geometry );
		assert.ok( overlap <= measureTolerance, `${ children[ first ].label } and ${ children[ second ].label } have overlapping footprint interiors (${ overlap } ${ MEASURE_UNIT })` );

	}
	const ordered = [ ...children ].sort( ( a, b ) => a.bounds.uMin - b.bounds.uMin );
	assertNear( ordered[ 0 ].bounds.uMin, parentBounds.uMin, coordinateTolerance, `${ label } union does not begin at the parent u minimum` );
	assertNear( ordered.at( - 1 ).bounds.uMax, parentBounds.uMax, coordinateTolerance, `${ label } union does not end at the parent u maximum` );
	for ( const child of ordered ) {

		assertNear( child.bounds.vMin, parentBounds.vMin, coordinateTolerance, `${ child.label } does not span the parent v minimum` );
		assertNear( child.bounds.vMax, parentBounds.vMax, coordinateTolerance, `${ child.label } does not span the parent v maximum` );

	}
	for ( let index = 1; index < ordered.length; index ++ ) {

		const priorEnd = ordered[ index - 1 ].bounds.uMax;
		const nextStart = ordered[ index ].bounds.uMin;
		assert.ok( Math.abs( nextStart - priorEnd ) <= coordinateTolerance, `${ label } union has a gap between ${ ordered[ index - 1 ].label } and ${ ordered[ index ].label }` );

	}

}

/** Validate schema closure, disjoint support, commodity closure, and visual non-authority. */
export function validatePhysicalImpactPartitionBundle( h, route, bundle ) {

	const api = partitionApi( h );
	assert.equal( bundle?.fixtureId, PARTITION_FIXTURE_ID, 'partition bundle is not the canonical measure-and-commodity-closure fixture' );
	const exchange = selectExchange( route );
	assert.equal( bundle.exchangeId, exchange.exchangeId, 'partition bundle resolves another exchange' );
	const coordinateTolerance = finiteQuantityValue( bundle.supportCoordinateClosureBound, LENGTH_UNIT, 'supportCoordinateClosureBound' );
	const measureTolerance = finiteQuantityValue( bundle.measureClosureBound, MEASURE_UNIT, 'measureClosureBound' );
	const commodityTolerances = {
		linearMomentum: finiteQuantityValue( bundle.linearMomentumClosureBound, LINEAR_MOMENTUM_UNIT, 'linearMomentumClosureBound' ),
		angularMomentum: finiteQuantityValue( bundle.angularMomentumClosureBound, ANGULAR_MOMENTUM_UNIT, 'angularMomentumClosureBound' )
	};
	const chart = route.physicsContext?.chartRegistry?.chartsById?.[ SUPPORT_CHART_ID ];
	assert.ok( chart, `partition support chart ${ SUPPORT_CHART_ID } is not registered in PhysicsContext` );
	api.requireRecord( chart, 'PhysicsChartDescriptor', `physicsContext.chartRegistry.chartsById.${ SUPPORT_CHART_ID }` );
	assert.deepEqual( [ chart.anchorPhysicsFrameId, chart.physicsOriginEpoch, chart.transformRevision, chart.chartRevision ], [ exchange.physicsFrameId, exchange.physicsOriginEpoch, exchange.transformRevision, SUPPORT_CHART_REVISION ], 'partition support chart frame/origin/transform/revision mismatch' );
	assert.ok( Array.isArray( bundle.physicalImpactParents ) && bundle.physicalImpactParents.length > 0, 'partition bundle has no PhysicalImpactParentRecord' );
	assert.ok( Array.isArray( bundle.physicalImpactPartitions ) && bundle.physicalImpactPartitions.length > 1, 'partition bundle must contain multiple physical partitions' );
	assert.ok( bundle.parentSupportGeometryById && typeof bundle.parentSupportGeometryById === 'object' && ! Array.isArray( bundle.parentSupportGeometryById ), 'partition bundle must serialize parentSupportGeometryById' );
	exactUniqueSet( Object.keys( bundle.parentSupportGeometryById ), bundle.physicalImpactParents.map( ( parent ) => parent.physicalImpactParentId ), 'parent support-geometry inventory' );
	const records = Object.values( bundle.interactionRecordsById ?? {} );
	assert.ok( records.length > 0, 'partition bundle has no child InteractionRecord inventory' );
	for ( const [ id, record ] of Object.entries( bundle.interactionRecordsById ) ) {

		assert.equal( id, record.interactionId, `partition interaction registry key ${ id } mismatch` );
		api.requireRecord( record, 'InteractionRecord', `partition.interactionRecordsById.${ id }` );

	}
	const partitionRecordIds = bundle.physicalImpactPartitions.map( ( partition ) => partition.physicalImpactPartitionId );
	exactUniqueSet( partitionRecordIds, partitionRecordIds, 'physical impact partition record IDs' );
	const allPartitionIds = new Set();
	const allChildInteractionIds = new Set();
	for ( const [ parentIndex, parent ] of bundle.physicalImpactParents.entries() ) {

		const parentLabel = `physicalImpactParents[${ parentIndex }]`;
		api.requireRecord( parent, 'PhysicalImpactParentRecord', parentLabel );
		assert.equal( parent.contextId, route.physicsContext.contextId, `${ parentLabel } context mismatch` );
		assert.equal( parent.parentExchangeId, exchange.exchangeId, `${ parentLabel } exchange mismatch` );
		assert.deepEqual( parent.applicationInterval, exchange.applicationInterval, `${ parentLabel } application interval mismatch` );
		assert.deepEqual( [ parent.physicsFrameId, parent.physicsOriginEpoch, parent.transformRevision ], [ exchange.physicsFrameId, exchange.physicsOriginEpoch, exchange.transformRevision ], `${ parentLabel } frame/origin/transform mismatch` );
		assert.ok( exchange.conservationGroups.some( ( group ) => group.conservationGroupId === parent.closureGroupId ), `${ parentLabel } closure group does not resolve` );
		const parentSupportGeometry = bundle.parentSupportGeometryById[ parent.physicalImpactParentId ];
		assert.ok( parentSupportGeometry, `${ parentLabel } has no serialized parent support geometry` );
		const parentBounds = validateGeometryChartReference( parentSupportGeometry, chart, `${ parentLabel }.supportGeometry` );
		const chartBounds = validateGeometryChartReference( chart.validityDomain, chart, `physicsContext.chartRegistry.chartsById.${ SUPPORT_CHART_ID }.validityDomain` );
		for ( const key of [ 'uMin', 'uMax', 'vMin', 'vMax' ] ) assertNear( parentBounds[ key ], chartBounds[ key ], coordinateTolerance, `${ parentLabel } support differs from registered chart validityDomain.${ key}` );
		exactUniqueSet( parent.parentInteractionIds, Object.keys( bundle.interactionRecordsById ), `${ parentLabel }.parentInteractionIds` );
		const partitions = bundle.physicalImpactPartitions.filter( ( partition ) => partition.physicalImpactParentId === parent.physicalImpactParentId );
		assert.ok( partitions.length > 1, `${ parentLabel } is missing a physical partition` );
		exactUniqueSet( partitions.map( ( partition ) => partition.membership.partitionId ), parent.partitionIds, `${ parentLabel }.partitionIds` );
		let partitionMeasureSum = 0;
		const partitionInventorySum = { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ] };
		const geometries = [];
		for ( const [ partitionIndex, partition ] of partitions.entries() ) {

			const label = `${ parentLabel }.partitions[${ partitionIndex }]`;
			api.requireRecord( partition, 'PhysicalImpactPartitionRecord', label );
			api.requireRecord( partition.membership, 'InteractionPartitionMembership', `${ label }.membership` );
			const membership = partition.membership;
			assert.equal( membership.parentExchangeId, parent.parentExchangeId, `${ label } membership exchange mismatch` );
			exactUniqueSet( membership.parentInteractionIds, parent.parentInteractionIds, `${ label }.membership.parentInteractionIds` );
			assert.deepEqual( [ membership.partitionGroupId, membership.closureGroupId ], [ parent.partitionGroupId, parent.closureGroupId ], `${ label } membership group/closure mismatch` );
			assert.ok( ! allPartitionIds.has( membership.partitionId ), `${ label } duplicates partition ID ${ membership.partitionId }` );
			allPartitionIds.add( membership.partitionId );
			assert.equal( partition.physicalImpactParentId, parent.physicalImpactParentId, `${ label } parent ID mismatch` );
			assert.ok( partition.childInteractionIds.length > 0, `${ label } has no child interactions` );
			exactUniqueSet( partition.childInteractionIds, partition.childInteractionIds, `${ label }.childInteractionIds` );
			for ( const childId of partition.childInteractionIds ) {

				assert.ok( ! allChildInteractionIds.has( childId ), `${ label } overlaps another partition at child interaction ${ childId }` );
				allChildInteractionIds.add( childId );
				const child = bundle.interactionRecordsById[ childId ];
				assert.ok( child, `${ label } references missing child interaction ${ childId }` );
				assert.deepEqual( child.partitionMembership, membership, `${ label } child ${ childId } has another partition membership` );
				assert.deepEqual( child.footprint, partition.partitionFootprint, `${ label } child ${ childId } does not use the exact partition footprint` );

			}
			api.requireRecord( partition.partitionFootprint, 'InteractionFootprint', `${ label }.partitionFootprint` );
			assert.deepEqual( [ partition.partitionFootprint.physicsFrameId, partition.partitionFootprint.physicsOriginEpoch, partition.partitionFootprint.transformRevision ], [ parent.physicsFrameId, parent.physicsOriginEpoch, parent.transformRevision ], `${ label } footprint frame/origin/transform mismatch` );
			assert.equal( partition.partitionFootprint.chartId, chart.chartId, `${ label } footprint chartId does not resolve` );
			const membershipMeasure = finiteQuantityValue( membership.partitionMeasure, MEASURE_UNIT, `${ label }.membership.partitionMeasure` );
			const representedMeasure = finiteQuantityValue( partition.partitionFootprint.representedMeasure, MEASURE_UNIT, `${ label }.partitionFootprint.representedMeasure` );
			validateGeometryChartReference( partition.partitionFootprint.supportGeometry, chart, `${ label }.partitionFootprint.supportGeometry` );
			const geometricMeasure = rectangleMeasure( partition.partitionFootprint.supportGeometry, `${ label }.partitionFootprint.supportGeometry` );
			assert.ok( Math.abs( membershipMeasure - representedMeasure ) <= measureTolerance, `${ label } membership and footprint measures differ` );
			assert.ok( Math.abs( membershipMeasure - geometricMeasure ) <= measureTolerance, `${ label } support geometry does not realize its partition measure` );
			partitionMeasureSum += membershipMeasure;
			geometries.push( { label, geometry: partition.partitionFootprint.supportGeometry } );
			const children = partition.childInteractionIds.map( ( id ) => bundle.interactionRecordsById[ id ] );
			const expectedInventory = inventoryForRecords( children, label );
			assertInventoryNear( partition.partitionPayloadInventory, expectedInventory, commodityTolerances, `${ label }.partitionPayloadInventory` );
			for ( const commodity of VECTOR_COMMODITIES ) addVector( partitionInventorySum[ commodity ], partition.partitionPayloadInventory[ commodity ], `${ label }.partitionPayloadInventory.${ commodity }` );

		}
		validateExactRectangleUnion( parentSupportGeometry, geometries, coordinateTolerance, measureTolerance, parentLabel );
		const parentMeasure = finiteQuantityValue( parent.totalFootprintMeasure, MEASURE_UNIT, `${ parentLabel }.totalFootprintMeasure` );
		assert.ok( Math.abs( partitionMeasureSum - parentMeasure ) <= measureTolerance, `${ parentLabel } partition measures do not close to the parent` );
		assertNear( rectangleMeasure( parentSupportGeometry, `${ parentLabel }.supportGeometry` ), parentMeasure, measureTolerance, `${ parentLabel } support geometry measure` );
		assertInventoryNear( parent.conservedPayloadInventory, partitionInventorySum, commodityTolerances, `${ parentLabel }.conservedPayloadInventory` );
		const expectedParentInventory = inventoryForRecords( parent.parentInteractionIds.map( ( id ) => bundle.interactionRecordsById[ id ] ), parentLabel );
		assertInventoryNear( parent.conservedPayloadInventory, expectedParentInventory, commodityTolerances, `${ parentLabel }.sourcePayloadInventory` );
		assert.equal( parent.sourceContentDigest, parentRecordDigest( api, parent, parentSupportGeometry ), `${ parentLabel } source content digest mismatch` );

	}
	exactUniqueSet( [ ...allChildInteractionIds ], Object.keys( bundle.interactionRecordsById ), 'partition child-interaction union' );
	for ( const [ index, partition ] of bundle.physicalImpactPartitions.entries() ) assert.equal( partition.partitionContentDigest, recordDigest( api, partition, 'partitionContentDigest' ), `physicalImpactPartitions[${ index }] content digest mismatch` );
	validateVisualChildren( route, bundle, allPartitionIds );
	assert.deepEqual( bundle.physicalImpactParents, exchange.physicalImpactParents, 'route exchange/bundle physical-impact parent inventory differs' );
	assert.deepEqual( bundle.physicalImpactPartitions, exchange.physicalImpactPartitions, 'route exchange/bundle physical-impact partition inventory differs' );
	const exchangeRecordsById = Object.fromEntries( [ ...exchange.interactions, ...exchange.reactions ].map( ( record ) => [ record.interactionId, record ] ) );
	const bundleRecordsById = bundle.interactionRecordsById ?? {};
	exactUniqueSet( Object.keys( bundleRecordsById ), Object.keys( exchangeRecordsById ), 'route exchange/bundle interaction-record ID closure' );
	for ( const [ interactionId, record ] of Object.entries( bundleRecordsById ) ) assert.deepEqual( record, exchangeRecordsById[ interactionId ], `route exchange/bundle interaction record ${ interactionId } differs` );
	return true;

}

function mutated( hOrBundle, maybeBundle, mutator ) {

	const hasHelpers = typeof hOrBundle?.clone === 'function';
	const h = hasHelpers ? hOrBundle : null;
	const bundle = hasHelpers ? maybeBundle : hOrBundle;
	const copy = h?.clone ? h.clone( bundle ) : structuredClone( bundle );
	mutator( copy );
	return copy;

}

function synchronizePartitionChildren( bundle, partition ) {

	for ( const childId of partition.childInteractionIds ) {

		bundle.interactionRecordsById[ childId ].partitionMembership = structuredClone( partition.membership );
		bundle.interactionRecordsById[ childId ].footprint = structuredClone( partition.partitionFootprint );

	}

}

export function rejectPhysicalImpactPartitionOverlap( hOrBundle, maybeBundle ) {

	return mutated( hOrBundle, maybeBundle, ( bundle ) => {

		const [ first, second ] = bundle.physicalImpactPartitions;
		const firstGeometry = first.partitionFootprint.supportGeometry;
		const secondGeometry = second.partitionFootprint.supportGeometry;
		const width = secondGeometry.uIntervalMeters.maxExclusive.value - secondGeometry.uIntervalMeters.minInclusive.value;
		secondGeometry.uIntervalMeters.minInclusive.value = firstGeometry.uIntervalMeters.maxExclusive.value - 0.5;
		secondGeometry.uIntervalMeters.maxExclusive.value = secondGeometry.uIntervalMeters.minInclusive.value + width;
		synchronizePartitionChildren( bundle, second );

	} );

}

export function rejectPhysicalImpactPartitionOutsideParent( hOrBundle, maybeBundle ) {

	return mutated( hOrBundle, maybeBundle, ( bundle ) => {

		const partition = bundle.physicalImpactPartitions.at( - 1 );
		const geometry = partition.partitionFootprint.supportGeometry;
		geometry.uIntervalMeters.minInclusive.value += 0.5;
		geometry.uIntervalMeters.maxExclusive.value += 0.5;
		synchronizePartitionChildren( bundle, partition );

	} );

}

export function rejectPhysicalImpactPartitionGap( hOrBundle, maybeBundle ) {

	return mutated( hOrBundle, maybeBundle, ( bundle ) => {

		const partition = bundle.physicalImpactPartitions.at( - 1 );
		const geometry = partition.partitionFootprint.supportGeometry;
		geometry.uIntervalMeters.minInclusive.value += 0.5;
		const width = geometry.uIntervalMeters.maxExclusive.value - geometry.uIntervalMeters.minInclusive.value;
		const height = geometry.vIntervalMeters.maxExclusive.value - geometry.vIntervalMeters.minInclusive.value;
		const measure = width * height;
		partition.membership.partitionMeasure.value = measure;
		partition.partitionFootprint.representedMeasure.value = measure;
		partition.partitionFootprint.quadrature.representedArea.value = measure;
		synchronizePartitionChildren( bundle, partition );

	} );

}

export function rejectMissingPhysicalImpactPartition( hOrBundle, maybeBundle ) {

	return mutated( hOrBundle, maybeBundle, ( bundle ) => { bundle.physicalImpactPartitions.pop(); } );

}

export function rejectDetachedPhysicalImpactPartitionInventory( hOrBundle, maybeBundle ) {

	return mutated( hOrBundle, maybeBundle, ( bundle ) => { bundle.physicalImpactPartitions.reverse(); } );

}

export function rejectVisualChildAuthority( hOrBundle, maybeBundle ) {

	return mutated( hOrBundle, maybeBundle, ( bundle ) => {

		const visual = Object.values( bundle.visualChildrenById )[ 0 ];
		visual.authority = 'physical-payload-owner';
		visual.physicalAuthority = true;
		visual.canApplyPhysicalPayload = true;

	} );

}

export const physicalImpactPartitionRejectMutations = Object.freeze( {
	'overlap': rejectPhysicalImpactPartitionOverlap,
	'missing-partition': rejectMissingPhysicalImpactPartition,
	'detached-route-partition-inventory': rejectDetachedPhysicalImpactPartitionInventory,
	'visual-child-authority': rejectVisualChildAuthority,
	'shifted-outside-parent': rejectPhysicalImpactPartitionOutsideParent,
	'gap': rejectPhysicalImpactPartitionGap
} );
