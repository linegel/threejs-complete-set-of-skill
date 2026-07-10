const EVIDENCE_LABELS = new Set( [ 'Authored', 'Derived', 'Measured', 'Gated' ] );
const ACCEPTED_STATUS = new Set( [ 'accepted', 'complete' ] );

export const LOCKED_TIERS = Object.freeze( [ 'hero', 'balanced', 'budgeted' ] );
export const REQUIRED_EXCLUSIVE_OWNERS = Object.freeze( [
	'renderer',
	'final-render-pipeline',
	'tone-map',
	'output-transform',
	'quality-governor',
	'timebase',
	'camera-jitter'
] );

export const INTEGRATION_REASON = Object.freeze( {
	ACCEPTED: 'CONTRACT_VALID',
	ADAPTER: 'ADAPTER_REQUIREMENT_INVALID',
	BUDGET: 'STAGE_BUDGET_EXCEEDS_TARGET',
	COUNT: 'RUNTIME_COUNT_MISMATCH',
	DUPLICATE_OWNER: 'DUPLICATE_EXCLUSIVE_OWNER',
	INCOMPLETE: 'ADAPTERS_OR_RUNTIME_EVIDENCE_INCOMPLETE',
	OWNER: 'REQUIRED_OWNER_MISSING',
	SCHEMA: 'INTEGRATION_SCHEMA_INVALID',
	SIGNAL: 'RUNTIME_SIGNAL_INVALID',
	TIER: 'LOCKED_TIER_INVALID',
	UNKNOWN_TIER: 'UNKNOWN_TIER'
} );

function isRecord( value ) {

	return value !== null && typeof value === 'object' && ! Array.isArray( value );

}

function fail( code, path, message, details = {} ) {

	return { verdict: 'FAIL', code, path, message, details };

}

function readEvidence( record, path ) {

	if ( ! isRecord( record ) ) throw new TypeError( `${ path } must be a numeric-evidence record` );
	const keys = [ 'value', 'unit', 'label', 'source' ];
	if ( Object.keys( record ).length !== keys.length || keys.some( ( key ) => ! Object.hasOwn( record, key ) ) ) {

		throw new TypeError( `${ path } must contain only value, unit, label, and source` );

	}
	if ( typeof record.value !== 'number' || ! Number.isFinite( record.value ) ) throw new TypeError( `${ path }.value must be finite` );
	if ( ! EVIDENCE_LABELS.has( record.label ) ) throw new TypeError( `${ path }.label is invalid` );
	if ( String( record.unit ).trim() === '' || String( record.source ).trim() === '' ) throw new TypeError( `${ path} has an empty unit/source` );
	return record.value;

}

function validateOwners( contract ) {

	if ( ! Array.isArray( contract.owners ) ) return fail( INTEGRATION_REASON.SCHEMA, 'owners', 'Owners must be an array.' );
	const claims = new Map();
	for ( const [ index, claim ] of contract.owners.entries() ) {

		if ( ! isRecord( claim ) || ! claim.semantic || ! claim.owner || claim.exclusive !== true ) {

			return fail( INTEGRATION_REASON.OWNER, `owners[${ index }]`, 'Every integration owner must be explicit and exclusive.' );

		}
		const previous = claims.get( claim.semantic );
		if ( previous && previous !== claim.owner ) {

			return fail( INTEGRATION_REASON.DUPLICATE_OWNER, `owners.${ claim.semantic }`, `${ claim.semantic } has multiple owners.`, {
				owners: [ previous, claim.owner ]
			} );

		}
		claims.set( claim.semantic, claim.owner );

	}
	for ( const semantic of REQUIRED_EXCLUSIVE_OWNERS ) {

		if ( ! claims.has( semantic ) ) return fail( INTEGRATION_REASON.OWNER, `owners.${ semantic }`, `Missing exclusive owner for ${ semantic }.` );

	}
	if ( claims.get( 'tone-map' ) !== claims.get( 'output-transform' ) ) {

		return fail( INTEGRATION_REASON.OWNER, 'owners.output-transform', 'Tone map and output transform must remain under the one final-image owner.' );

	}
	return { claims };

}

function validateSignals( contract, ownerClaims ) {

	if ( ! Array.isArray( contract.signals ) ) return fail( INTEGRATION_REASON.SCHEMA, 'signals', 'Signals must be an array.' );
	const signalIds = new Set();
	const knownOwners = new Set( ownerClaims.values() );
	for ( const [ index, signal ] of contract.signals.entries() ) {

		if ( ! isRecord( signal ) || typeof signal.id !== 'string' || signal.id === '' ) return fail( INTEGRATION_REASON.SIGNAL, `signals[${ index }]`, 'Signal id is required.' );
		if ( signalIds.has( signal.id ) ) return fail( INTEGRATION_REASON.SIGNAL, `signals.${ signal.id }`, 'Signal ids must be unique.' );
		signalIds.add( signal.id );
		if ( typeof signal.producer !== 'string' || signal.producer === '' || Array.isArray( signal.producer ) ) {

			return fail( INTEGRATION_REASON.SIGNAL, `signals.${ signal.id }.producer`, 'Each signal must have exactly one producer.' );

		}
		if ( ! knownOwners.has( signal.producer ) ) return fail( INTEGRATION_REASON.SIGNAL, `signals.${ signal.id }.producer`, 'Signal producer is not an owner in the runtime graph.' );
		if ( ! Array.isArray( signal.consumers ) || signal.consumers.length === 0 || new Set( signal.consumers ).size !== signal.consumers.length ) {

			return fail( INTEGRATION_REASON.SIGNAL, `signals.${ signal.id }.consumers`, 'Each allocated signal needs one or more unique consumers.' );

		}

	}
	return { signalIds };

}

function validateRuntimeRecords( contract, ownerClaims ) {

	const knownOwners = new Set( ownerClaims.values() );
	for ( const kind of [ 'sceneSubmissions', 'computeDispatches' ] ) {

		if ( ! Array.isArray( contract[ kind ] ) ) return fail( INTEGRATION_REASON.SCHEMA, kind, `${ kind } must be an array.` );
		const ids = new Set();
		for ( const [ index, record ] of contract[ kind ].entries() ) {

			if ( ! record.id || ids.has( record.id ) || ! knownOwners.has( record.owner ) ) {

				return fail( INTEGRATION_REASON.SCHEMA, `${ kind }[${ index }]`, `${ kind } records require unique ids and known owners.` );

			}
			ids.add( record.id );

		}

	}
	if ( contract.submissionCounts ) {

		try {

			const prepass = readEvidence( contract.submissionCounts.gbufferPrepassCount, 'submissionCounts.gbufferPrepassCount' );
			const lit = readEvidence( contract.submissionCounts.litScenePassCount, 'submissionCounts.litScenePassCount' );
			const total = readEvidence( contract.submissionCounts.sceneSubmissionCount, 'submissionCounts.sceneSubmissionCount' );
			const fullLit = readEvidence( contract.submissionCounts.fullLitOutputCount, 'submissionCounts.fullLitOutputCount' );
			if ( prepass + lit !== total || fullLit !== lit || total !== contract.sceneSubmissions.length ) {

				return fail( INTEGRATION_REASON.COUNT, 'submissionCounts', 'Scene submission counts do not reconcile with the runtime graph.' );

			}

		} catch ( error ) {

			return fail( INTEGRATION_REASON.SCHEMA, 'submissionCounts', error.message );

		}

	}
	return null;

}

function validateTiers( contract ) {

	if ( ! Array.isArray( contract.tiers ) || contract.tiers.map( ( tier ) => tier.id ).join( ',' ) !== LOCKED_TIERS.join( ',' ) ) {

		return fail( INTEGRATION_REASON.TIER, 'tiers', 'Integration tiers must be exactly hero, balanced, and budgeted in descending order.' );

	}
	const summaries = [];
	for ( const tier of contract.tiers ) {

		if ( ! Array.isArray( tier.stageBudgets ) || ! Array.isArray( tier.degradationFromPrevious ) || ! Array.isArray( tier.preservedInvariants ) ) {

			return fail( INTEGRATION_REASON.TIER, `tiers.${ tier.id }`, 'Tier budgets, degradation, and invariant arrays are required.' );

		}
		if ( tier.id !== 'hero' && tier.degradationFromPrevious.length === 0 ) return fail( INTEGRATION_REASON.TIER, `tiers.${ tier.id }.degradationFromPrevious`, 'Lower tiers must state their degradation.' );
		if ( tier.preservedInvariants.length === 0 ) return fail( INTEGRATION_REASON.TIER, `tiers.${ tier.id }.preservedInvariants`, 'Every tier must preserve named invariants.' );
		let target;
		let total = 0;
		try {

			target = readEvidence( tier.targetFrameMs, `tiers.${ tier.id }.targetFrameMs` );
			const stageIds = new Set();
			for ( const [ index, stage ] of tier.stageBudgets.entries() ) {

				if ( ! stage.id || stageIds.has( stage.id ) ) throw new TypeError( `tiers.${ tier.id }.stageBudgets[${ index }] has a duplicate/empty id` );
				stageIds.add( stage.id );
				total += readEvidence( stage.budgetMs, `tiers.${ tier.id }.stageBudgets.${ stage.id }.budgetMs` );

			}

		} catch ( error ) {

			return fail( INTEGRATION_REASON.SCHEMA, `tiers.${ tier.id }`, error.message );

		}
		if ( total > target + Number.EPSILON ) {

			return fail( INTEGRATION_REASON.BUDGET, `tiers.${ tier.id }.stageBudgets`, 'Stage gates exceed targetFrameMs; a cheaper tier cannot be fabricated.', {
				tier: tier.id,
				targetFrameMs: target,
				stageBudgetMs: total,
				overrunMs: total - target
			} );

		}
		summaries.push( { id: tier.id, targetFrameMs: target, stageBudgetMs: total, headroomMs: target - total } );

	}
	return { summaries };

}

function validateAdapters( contract ) {

	if ( ! Array.isArray( contract.adapterRequirements ) || contract.adapterRequirements.length === 0 ) {

		return fail( INTEGRATION_REASON.ADAPTER, 'adapterRequirements', 'At least one stable adapter requirement is required.' );

	}
	const ids = new Set();
	const missing = [];
	const available = [];
	for ( const [ index, adapter ] of contract.adapterRequirements.entries() ) {

		if ( ! adapter.id || ids.has( adapter.id ) || ! contract.skills.includes( adapter.skill ) ) {

			return fail( INTEGRATION_REASON.ADAPTER, `adapterRequirements[${ index }]`, 'Adapter ids must be unique and name an included skill.' );

		}
		ids.add( adapter.id );
		if ( ! [ 'available', 'missing' ].includes( adapter.sourceStatus ) || ! adapter.requiredExport ) {

			return fail( INTEGRATION_REASON.ADAPTER, `adapterRequirements.${ adapter.id }`, 'Adapter requires a sourceStatus and stable export name.' );

		}
		if ( adapter.sourceStatus === 'available' ) {

			if ( ! adapter.module ) return fail( INTEGRATION_REASON.ADAPTER, `adapterRequirements.${ adapter.id }.module`, 'Available adapter requires a module path.' );
			available.push( adapter.id );

		} else {

			missing.push( adapter.id );

		}

	}
	if ( ACCEPTED_STATUS.has( contract.status ) && missing.length > 0 ) {

		return fail( INTEGRATION_REASON.INCOMPLETE, 'status', 'An accepted integration cannot have missing adapters.', { missing } );

	}
	return { missing, available };

}

export function validateIntegrationContract( contract ) {

	if ( ! isRecord( contract ) || contract.schemaVersion !== 2 || typeof contract.id !== 'string' ) {

		return fail( INTEGRATION_REASON.SCHEMA, 'contract', 'Integration contract must be schema v2 with an id.' );

	}
	for ( const key of [ 'status', 'skills', 'modes', 'cameras', 'seeds', 'owners', 'signals', 'sceneSubmissions', 'computeDispatches', 'tiers', 'adapterRequirements', 'qualityGovernor', 'runtimeEvidence' ] ) {

		if ( ! Object.hasOwn( contract, key ) ) return fail( INTEGRATION_REASON.SCHEMA, key, `Integration contract is missing ${ key}.` );

	}
	if ( ! Array.isArray( contract.skills ) || contract.skills.length === 0 || new Set( contract.skills ).size !== contract.skills.length ) return fail( INTEGRATION_REASON.SCHEMA, 'skills', 'Skills must be a nonempty unique array.' );
	for ( const [ key, values ] of [ [ 'modes', contract.modes ], [ 'cameras', contract.cameras ], [ 'seeds', contract.seeds ] ] ) {

		if ( ! Array.isArray( values ) || values.length === 0 || new Set( values ).size !== values.length ) return fail( INTEGRATION_REASON.SCHEMA, key, `${ key } must be nonempty and unique.` );

	}
	const owners = validateOwners( contract );
	if ( owners.verdict === 'FAIL' ) return owners;
	const signals = validateSignals( contract, owners.claims );
	if ( signals.verdict === 'FAIL' ) return signals;
	const runtime = validateRuntimeRecords( contract, owners.claims );
	if ( runtime ) return runtime;
	const tiers = validateTiers( contract );
	if ( tiers.verdict === 'FAIL' ) return tiers;
	const adapters = validateAdapters( contract );
	if ( adapters.verdict === 'FAIL' ) return adapters;
	if ( contract.qualityGovernor.performanceBasis !== 'sustained-measured-p95-with-hysteresis-and-cooldown' ) {

		return fail( INTEGRATION_REASON.SCHEMA, 'qualityGovernor.performanceBasis', 'Quality governors require sustained measured p95, hysteresis, and cooldown.' );

	}
	if ( contract.runtimeEvidence.currentAdapterTiming !== 'INSUFFICIENT_EVIDENCE' ) {

		return fail( INTEGRATION_REASON.SCHEMA, 'runtimeEvidence.currentAdapterTiming', 'Static integration contracts cannot claim current-adapter timing.' );

	}

	const ready = adapters.missing.length === 0 && contract.runtimeEvidence.nativeWebGPU === 'PASS' && contract.runtimeEvidence.renderTargetReadback === 'PASS';
	return {
		verdict: 'PASS',
		code: ready ? INTEGRATION_REASON.ACCEPTED : INTEGRATION_REASON.INCOMPLETE,
		path: null,
		message: ready ? 'Integration contract and runtime evidence are complete.' : 'Static contract is valid, but missing adapters or runtime evidence keep the integration incomplete.',
		details: {
			ready,
			missingAdapters: adapters.missing,
			availableAdapters: adapters.available,
			tiers: tiers.summaries,
			ownerCount: owners.claims.size,
			signalCount: signals.signalIds.size
		}
	};

}

export function getLockedTier( contract, tierId ) {

	const tier = contract.tiers.find( ( candidate ) => candidate.id === tierId );
	if ( ! tier ) {

		const error = new RangeError( `${ INTEGRATION_REASON.UNKNOWN_TIER }: ${ tierId }` );
		error.code = INTEGRATION_REASON.UNKNOWN_TIER;
		throw error;

	}
	return tier;

}

export function describeRuntimeGraph( contract, tierId ) {

	const tier = getLockedTier( contract, tierId );
	const owners = Object.fromEntries( contract.owners.map( ( claim ) => [ claim.semantic, claim.owner ] ) );
	return {
		owners,
		signals: contract.signals,
		sceneSubmissions: contract.sceneSubmissions,
		computeDispatches: contract.computeDispatches,
		resources: contract.resources ?? [],
		finalToneMapOwner: owners[ 'tone-map' ],
		finalOutputTransformOwner: owners[ 'output-transform' ],
		tier
	};

}

export async function loadAvailableAdapterFactories( contract, resolveModule = defaultResolveModule ) {

	const loaded = new Map();
	const missing = [];
	const errors = [];
	for ( const adapter of contract.adapterRequirements ) {

		if ( adapter.sourceStatus !== 'available' ) {

			missing.push( { id: adapter.id, requiredExport: adapter.requiredExport, expectedModule: adapter.expectedModule ?? null } );
			continue;

		}
		try {

			const module = await resolveModule( adapter.module );
			const factory = module[ adapter.requiredExport ];
			if ( typeof factory !== 'function' ) throw new TypeError( `${ adapter.requiredExport } is not a function export` );
			loaded.set( adapter.id, { requirement: adapter, factory } );

		} catch ( error ) {

			errors.push( { id: adapter.id, message: error instanceof Error ? error.message : String( error ) } );

		}

	}
	return { loaded, missing, errors, ready: missing.length === 0 && errors.length === 0 };

}

async function defaultResolveModule( repoRelativePath ) {

	const url = new URL( `../../${ repoRelativePath }`, import.meta.url );
	return import( /* @vite-ignore */ url.href );

}

export function createDuplicateOwnerMutation( contract, semantic = 'output-transform', owner = 'mutation-private-owner' ) {

	const mutated = structuredClone( contract );
	mutated.owners.push( { semantic, owner, exclusive: true } );
	return mutated;

}
