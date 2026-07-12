const EVIDENCE_LABELS = new Set( [ 'Authored', 'Derived', 'Measured', 'Gated' ] );

export const CANONICAL_SKILL_INVENTORY = Object.freeze( [
	'threejs-ambient-contact-shading',
	'threejs-black-holes-and-space-effects',
	'threejs-bloom',
	'threejs-camera-controls-and-rigs',
	'threejs-choose-skills',
	'threejs-compatibility-fallbacks',
	'threejs-debugging',
	'threejs-dynamic-surface-effects',
	'threejs-exposure-color-grading',
	'threejs-image-pipeline',
	'threejs-object-sculptor',
	'threejs-particles-trails-and-effects',
	'threejs-physics-integration',
	'threejs-procedural-buildings-and-cities',
	'threejs-procedural-creatures',
	'threejs-procedural-fields',
	'threejs-procedural-geometry',
	'threejs-procedural-materials',
	'threejs-procedural-motion-systems',
	'threejs-procedural-planets',
	'threejs-procedural-vegetation',
	'threejs-rain-snow-and-wet-surfaces',
	'threejs-scalable-real-time-shadows',
	'threejs-sky-atmosphere-and-haze',
	'threejs-spectral-ocean',
	'threejs-visual-validation',
	'threejs-volumetric-clouds',
	'threejs-water-optics'
] );

export const ROUTE_REASON = Object.freeze( {
	ACCEPTED: 'ROUTE_ACCEPTED',
	BACKEND: 'BACKEND_WEBGPU_REQUIRED',
	BUDGET: 'BUDGET_EXCEEDS_TARGET',
	DUPLICATE_OWNER: 'DUPLICATE_EXCLUSIVE_OWNER',
	FABRICATED_TIER: 'FABRICATED_TIER',
	FALLBACK: 'AUTOMATIC_FALLBACK_FORBIDDEN',
	INVENTORY: 'INVENTORY_DRIFT',
	POST_ORDER: 'POST_BEFORE_PHYSICAL_CAUSE',
	ROUTE_AWAY: 'UNSUPPORTED_CAUSE_REQUIRES_ROUTE_AWAY',
	SCHEMA: 'INVALID_ROUTE_SCHEMA',
	UNKNOWN_SCENARIO: 'UNKNOWN_SCENARIO'
} );

function isRecord( value ) {

	return value !== null && typeof value === 'object' && ! Array.isArray( value );

}

function reject( code, path, message, details = {} ) {

	return {
		verdict: 'FAIL',
		code,
		path,
		message,
		details
	};

}

function accept( details ) {

	return {
		verdict: 'PASS',
		code: ROUTE_REASON.ACCEPTED,
		path: null,
		message: 'The route satisfies inventory, capability, ownership, ordering, tier-provenance, and budget gates.',
		details
	};

}

export function readNumericEvidence( record, path ) {

	if ( ! isRecord( record ) ) throw new TypeError( `${ path } must be a numeric-evidence record` );
	const keys = [ 'value', 'unit', 'label', 'source' ];
	for ( const key of keys ) {

		if ( ! Object.hasOwn( record, key ) ) throw new TypeError( `${ path } is missing ${ key }` );

	}
	if ( Object.keys( record ).length !== keys.length ) throw new TypeError( `${ path } has unknown numeric-evidence fields` );
	if ( typeof record.value !== 'number' || ! Number.isFinite( record.value ) ) throw new TypeError( `${ path }.value must be finite` );
	if ( ! EVIDENCE_LABELS.has( record.label ) ) throw new TypeError( `${ path }.label is invalid` );
	if ( String( record.unit ).trim() === '' || String( record.source ).trim() === '' ) throw new TypeError( `${ path} has an empty unit/source` );
	return record.value;

}

function validateFixtureSchema( fixture ) {

	if ( ! isRecord( fixture ) ) return reject( ROUTE_REASON.SCHEMA, 'fixture', 'Fixture must be an object.' );
	const required = [
		'id', 'observedCapabilities', 'observedInventory', 'route', 'requiredSignals',
		'ownershipClaims', 'performance', 'tierSelection', 'expected'
	];
	for ( const key of required ) {

		if ( ! Object.hasOwn( fixture, key ) ) return reject( ROUTE_REASON.SCHEMA, key, `Fixture is missing ${ key}.` );

	}
	if ( ! ( Array.isArray( fixture.observedInventory ) || fixture.observedInventory === '$catalog' ) || ! Array.isArray( fixture.route.selectedSkills ) ) {

		return reject( ROUTE_REASON.SCHEMA, 'observedInventory', 'Inventory and selectedSkills must be arrays.' );

	}
	if ( ! Array.isArray( fixture.requiredSignals ) || ! Array.isArray( fixture.ownershipClaims ) ) {

		return reject( ROUTE_REASON.SCHEMA, 'requiredSignals', 'Signal and ownership claims must be arrays.' );

	}
	if ( ! Array.isArray( fixture.performance.stages ) ) {

		return reject( ROUTE_REASON.SCHEMA, 'performance.stages', 'Stage budgets must be an array.' );

	}
	return null;

}

function validateInventory( fixture, canonicalInventory ) {

	const inventory = fixture.observedInventory === '$catalog' ? canonicalInventory : fixture.observedInventory;
	const observed = [ ...new Set( inventory ) ].sort();
	const canonical = [ ...canonicalInventory ].sort();
	const selectedUnknown = fixture.route.selectedSkills.filter( ( skill ) => ! canonicalInventory.includes( skill ) );
	if ( observed.length !== inventory.length || JSON.stringify( observed ) !== JSON.stringify( canonical ) || selectedUnknown.length > 0 ) {

		return reject( ROUTE_REASON.INVENTORY, 'observedInventory', `Observed and selected skills must be the exact live ${ canonicalInventory.length }-skill inventory.`, {
			canonical,
			observed,
			selectedUnknown
		} );

	}
	return null;

}

function validateBackendAndFallback( fixture ) {

	if ( fixture.route.selectedSkills.includes( 'threejs-compatibility-fallbacks' ) && fixture.route.explicitFallbackRequest !== true ) {

		return reject( ROUTE_REASON.FALLBACK, 'route.explicitFallbackRequest', 'Compatibility teaching requires an explicit request; capability detection cannot activate it.' );

	}
	if ( fixture.observedCapabilities.webgpu !== true ) {

		return reject( ROUTE_REASON.BACKEND, 'observedCapabilities.webgpu', 'Canonical routing remains blocked until native WebGPU is available.' );

	}
	return null;

}

function validateOwnership( fixture ) {

	const owners = new Map();
	for ( const claim of fixture.ownershipClaims ) {

		if ( ! isRecord( claim ) || typeof claim.semantic !== 'string' || typeof claim.owner !== 'string' ) {

			return reject( ROUTE_REASON.SCHEMA, 'ownershipClaims', 'Ownership claims require semantic and owner strings.' );

		}
		const prior = owners.get( claim.semantic );
		if ( prior && prior !== claim.owner ) {

			return reject( ROUTE_REASON.DUPLICATE_OWNER, `ownershipClaims.${ claim.semantic }`, `${ claim.semantic } has more than one exclusive owner.`, {
				owners: [ prior, claim.owner ]
			} );

		}
		owners.set( claim.semantic, claim.owner );

	}

	for ( const signal of fixture.requiredSignals ) {

		if ( ! isRecord( signal ) || ! signal.id || ! signal.producer || ! Array.isArray( signal.consumers ) || signal.consumers.length === 0 ) {

			return reject( ROUTE_REASON.SCHEMA, 'requiredSignals', 'Every allocated signal needs one producer and at least one consumer.' );

		}

	}
	return null;

}

function validateCauseOrdering( fixture ) {

	if ( fixture.route.postConsumersSelected === true && fixture.route.physicalCauseReady !== true ) {

		return reject( ROUTE_REASON.POST_ORDER, 'route.physicalCauseReady', 'A post consumer cannot be routed before its physical source signal exists.' );

	}
	return null;

}

function validateRouteAway( fixture ) {

	if ( fixture.route.unsupportedCause === null ) return null;
	if ( ! isRecord( fixture.route.routeAway ) || fixture.route.routeAway.supported !== false || ! fixture.route.routeAway.externalOwner ) {

		return reject( ROUTE_REASON.ROUTE_AWAY, 'route.routeAway', 'Unsupported causes must be handed to an explicit external/official owner, not assigned a fabricated pack skill.' );

	}
	if ( fixture.route.selectedSkills.includes( fixture.route.routeAway.externalOwner ) ) {

		return reject( ROUTE_REASON.ROUTE_AWAY, 'route.selectedSkills', 'An external route-away owner cannot be inserted into the local skill inventory.' );

	}
	return null;

}

function validateTierProvenance( fixture, tierCatalog ) {

	const selection = fixture.tierSelection;
	if ( selection === null ) return null;
	const sourceTiers = tierCatalog[ selection.owner ] ?? [];
	if ( ! sourceTiers.includes( selection.id ) || selection.provenance !== 'owner-manifest' ) {

		return reject( ROUTE_REASON.FABRICATED_TIER, 'tierSelection', 'The router may select only tiers declared by the owning implementation manifest.', {
			available: sourceTiers,
			selected: selection.id,
			provenance: selection.provenance
		} );

	}
	return null;

}

function validateBudget( fixture ) {

	let targetFrameMs;
	let stageBudgetMs;
	try {

		targetFrameMs = readNumericEvidence( fixture.performance.targetFrameMs, 'performance.targetFrameMs' );
		stageBudgetMs = fixture.performance.stages.reduce( ( sum, stage, index ) => {

			return sum + readNumericEvidence( stage.budgetMs, `performance.stages[${ index }].budgetMs` );

		}, 0 );

	} catch ( error ) {

		return reject( ROUTE_REASON.SCHEMA, 'performance', error.message );

	}
	if ( stageBudgetMs > targetFrameMs + Number.EPSILON ) {

		return reject( ROUTE_REASON.BUDGET, 'performance.stages', 'Declared stage budgets exceed targetFrameMs; the router cannot fabricate a cheaper tier.', {
			targetFrameMs,
			stageBudgetMs,
			overrunMs: stageBudgetMs - targetFrameMs
		} );

	}
	return { targetFrameMs, stageBudgetMs };

}

export function evaluateRoute( fixture, catalog ) {

	const canonicalInventory = catalog?.skillInventory ?? CANONICAL_SKILL_INVENTORY;
	const tierCatalog = catalog?.tierCatalog ?? {};
	const gates = [
		() => validateFixtureSchema( fixture ),
		() => validateInventory( fixture, canonicalInventory ),
		() => validateBackendAndFallback( fixture ),
		() => validateOwnership( fixture ),
		() => validateCauseOrdering( fixture ),
		() => validateRouteAway( fixture ),
		() => validateTierProvenance( fixture, tierCatalog )
	];

	for ( const gate of gates ) {

		const result = gate();
		if ( result ) return result;

	}

	const budget = validateBudget( fixture );
	if ( budget?.verdict === 'FAIL' ) return budget;

	return accept( {
		selectedSkills: [ ...fixture.route.selectedSkills ],
		primaryOwner: fixture.route.primaryOwner,
		targetFrameMs: budget.targetFrameMs,
		stageBudgetMs: budget.stageBudgetMs,
		headroomMs: budget.targetFrameMs - budget.stageBudgetMs,
		ownership: Object.fromEntries( fixture.ownershipClaims.map( ( claim ) => [ claim.semantic, claim.owner ] ) ),
		signalIds: fixture.requiredSignals.map( ( signal ) => signal.id )
	} );

}

export function getScenario( catalog, id ) {

	const patch = catalog.routes.find( ( route ) => route.id === id );
	if ( ! patch ) {

		const error = new RangeError( `${ ROUTE_REASON.UNKNOWN_SCENARIO }: ${ id }` );
		error.code = ROUTE_REASON.UNKNOWN_SCENARIO;
		throw error;

	}
	return mergeFixture( catalog.routeDefaults ?? {}, patch );

}

export function evaluateScenario( catalog, id ) {

	return evaluateRoute( getScenario( catalog, id ), catalog );

}

function mergeFixture( base, patch ) {

	if ( Array.isArray( patch ) ) return patch.map( ( value ) => mergeFixture( undefined, value ) );
	if ( ! isRecord( patch ) ) return patch;
	const result = {};
	if ( isRecord( base ) ) {

		for ( const [ key, value ] of Object.entries( base ) ) result[ key ] = mergeFixture( undefined, value );

	}
	for ( const [ key, value ] of Object.entries( patch ) ) {

		result[ key ] = mergeFixture( result[ key ], value );

	}
	return result;

}
