const EVIDENCE_LABELS = new Set( [ 'Authored', 'Derived', 'Measured', 'Gated' ] );

export const INVARIANT_DOMAINS = Object.freeze( [
	'physical',
	'color',
	'temporal',
	'spatial',
	'ownership',
	'lifecycle'
] );

export const BRANCH_ORDER = Object.freeze( [
	'canonical-budget-reduction',
	'precomputed-static',
	'cpu-offline',
	'feature-removed',
	'maintained-legacy'
] );

export const FALLBACK_REASON = Object.freeze( {
	BLOCKED: 'WEBGPU_UNAVAILABLE_BLOCKER',
	CAPABILITY: 'CAPABILITY_TEST_REQUIRED',
	CANONICAL: 'CANONICAL_WEBGPU_OWNER_REQUIRED',
	COMPARISON: 'INVARIANT_LOSS_COMPARISON_READY',
	EXPLICIT: 'EXPLICIT_REQUEST_REQUIRED',
	INVARIANT: 'INVARIANT_PROOF_FAILED',
	LEGACY: 'LEGACY_MAINTENANCE_ACCEPTANCE_REQUIRED',
	ORDER: 'DOWNGRADE_ORDER_INVALID',
	SCHEMA: 'FALLBACK_SCHEMA_INVALID',
	SELECTED: 'EXPLICIT_FALLBACK_BRANCH_SELECTED',
	UNKNOWN: 'UNKNOWN_SCENARIO'
} );

function isRecord( value ) {

	return value !== null && typeof value === 'object' && ! Array.isArray( value );

}

function numericEvidence( record, path ) {

	if ( ! isRecord( record ) ) throw new TypeError( `${ path } must be a numeric-evidence record` );
	const keys = [ 'value', 'unit', 'label', 'source' ];
	if ( Object.keys( record ).length !== keys.length || keys.some( ( key ) => ! Object.hasOwn( record, key ) ) ) {

		throw new TypeError( `${ path } must contain only value, unit, label, and source` );

	}
	if ( typeof record.value !== 'number' || ! Number.isFinite( record.value ) ) throw new TypeError( `${ path}.value must be finite` );
	if ( ! EVIDENCE_LABELS.has( record.label ) ) throw new TypeError( `${ path}.label is invalid` );
	if ( String( record.unit ).trim() === '' || String( record.source ).trim() === '' ) throw new TypeError( `${ path} has an empty unit/source` );
	return record.value;

}

function verdict( status, code, message, details = {} ) {

	return { status, code, message, details };

}

function merge( base, patch ) {

	if ( Array.isArray( patch ) ) return patch.map( ( value ) => merge( undefined, value ) );
	if ( ! isRecord( patch ) ) return patch;
	const result = {};
	if ( isRecord( base ) ) {

		for ( const [ key, value ] of Object.entries( base ) ) result[ key ] = merge( undefined, value );

	}
	for ( const [ key, value ] of Object.entries( patch ) ) result[ key ] = merge( result[ key ], value );
	return result;

}

export function getFallbackScenario( catalog, id ) {

	const patch = catalog.scenarios.find( ( scenario ) => scenario.id === id );
	if ( ! patch ) {

		const error = new RangeError( `${ FALLBACK_REASON.UNKNOWN }: ${ id }` );
		error.code = FALLBACK_REASON.UNKNOWN;
		throw error;

	}
	const branch = catalog.branchDefinitions?.[ patch.desiredBranch ] ?? {};
	return merge( merge( catalog.scenarioDefaults ?? {}, branch ), patch );

}

function validateScenarioShape( scenario ) {

	const required = [
		'id', 'canonicalOwner', 'canonicalFeature', 'actualCapabilities', 'targetCapabilities',
		'desiredBranch', 'decisionTrace', 'invariants', 'budgetEvidence', 'screenshotTargets'
	];
	for ( const key of required ) {

		if ( ! Object.hasOwn( scenario, key ) ) return verdict( 'FAIL', FALLBACK_REASON.SCHEMA, `Scenario is missing ${ key }.`, { path: key } );

	}
	if ( scenario.canonicalOwner !== 'threejs-water-optics' || scenario.canonicalFeature !== 'bounded-water' ) {

		return verdict( 'FAIL', FALLBACK_REASON.SCHEMA, 'The harness must name the canonical bounded-water owner.', { path: 'canonicalOwner' } );

	}
	if ( ! Array.isArray( scenario.decisionTrace ) || ! Array.isArray( scenario.invariants ) || ! Array.isArray( scenario.screenshotTargets ) ) {

		return verdict( 'FAIL', FALLBACK_REASON.SCHEMA, 'Trace, invariant, and screenshot records must be arrays.' );

	}
	try {

		for ( const key of [ 'targetFrameMs', 'browserReserveMs', 'compositorReserveMs', 'cpuEnvelopeMs' ] ) {

			numericEvidence( scenario.budgetEvidence[ key ], `budgetEvidence.${ key }` );

		}

	} catch ( error ) {

		return verdict( 'FAIL', FALLBACK_REASON.SCHEMA, error.message, { path: 'budgetEvidence' } );

	}
	return null;

}

function validateDecisionTrace( scenario ) {

	if ( scenario.desiredBranch === null || scenario.desiredBranch === 'invariant-loss-comparison' ) return null;
	const selectedIndex = BRANCH_ORDER.indexOf( scenario.desiredBranch );
	if ( selectedIndex < 0 ) return verdict( 'FAIL', FALLBACK_REASON.ORDER, 'The requested branch is not in the quarantined decision order.' );
	if ( scenario.decisionTrace.length !== selectedIndex + 1 ) {

		return verdict( 'FAIL', FALLBACK_REASON.ORDER, 'Decision trace must visit each earlier branch exactly once before selection.' );

	}
	for ( let index = 0; index < scenario.decisionTrace.length; index ++ ) {

		const step = scenario.decisionTrace[ index ];
		if ( step.branch !== BRANCH_ORDER[ index ] ) return verdict( 'FAIL', FALLBACK_REASON.ORDER, 'Decision trace is not in canonical degradation order.', { index } );
		if ( ! Array.isArray( step.changedAxes ) || step.changedAxes.length !== 1 ) {

			return verdict( 'FAIL', FALLBACK_REASON.ORDER, 'Exactly one degradation axis must change in each decision step.', { index, changedAxes: step.changedAxes } );

		}
		if ( index === selectedIndex && step.outcome !== 'selected' ) return verdict( 'FAIL', FALLBACK_REASON.ORDER, 'The final decision step must select the requested branch.' );
		if ( index < selectedIndex && step.outcome !== 'rejected' ) return verdict( 'FAIL', FALLBACK_REASON.ORDER, 'Earlier decision steps must record why they were rejected.' );
		if ( String( step.reason ?? '' ).trim() === '' ) return verdict( 'FAIL', FALLBACK_REASON.ORDER, 'Every decision step requires a reason.' );

	}
	return null;

}

function canonicalHeight( x, z, time ) {

	const wind = 0.18 * Math.sin( 1.7 * x + 0.55 * z - 2.2 * time );
	const cross = 0.07 * Math.sin( - 0.8 * x + 2.3 * z - 1.45 * time + 0.6 );
	const radius = Math.hypot( x - 0.35, z + 0.2 );
	const ripple = 0.055 * Math.exp( - 1.8 * radius ) * Math.cos( 9 * radius - 3.1 * time );
	return wind + cross + ripple;

}

export function evaluateBoundedWaterSample( branch, x, z, time ) {

	switch ( branch ) {

		case 'canonical-budget-reduction':
			return canonicalHeight( x, z, time );
		case 'precomputed-static':
			return canonicalHeight( x, z, 0 );
		case 'cpu-offline':
			return canonicalHeight( x, z, Math.round( time * 4 ) / 4 );
		case 'feature-removed':
			return 0;
		case 'maintained-legacy':
			return 0.18 * Math.sin( 1.7 * x + 0.55 * z - 2.2 * time );
		default:
			throw new RangeError( `Unknown bounded-water branch: ${ branch }` );

	}

}

function p50( values ) {

	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	return sorted[ Math.floor( sorted.length * 0.5 ) ];

}

export function measureBoundedWaterBranch( branch, now = () => performance.now() ) {

	const sampleCount = 24;
	const times = [ 0, 0.37, 0.91, 1.73 ];
	let heightSquared = 0;
	let colorSquared = 0;
	let temporalSquared = 0;
	let maximum = 0;
	let count = 0;
	const runTimes = [];

	for ( let run = 0; run < 9; run ++ ) {

		const start = now();
		for ( const time of times ) {

			for ( let zIndex = 0; zIndex < sampleCount; zIndex ++ ) {

				const z = - 2 + 4 * zIndex / ( sampleCount - 1 );
				for ( let xIndex = 0; xIndex < sampleCount; xIndex ++ ) {

					const x = - 2 + 4 * xIndex / ( sampleCount - 1 );
					const reference = canonicalHeight( x, z, time );
					const observed = evaluateBoundedWaterSample( branch, x, z, time );
					const error = observed - reference;
					const referenceT = Math.exp( - 0.85 * Math.max( 0.02, 0.35 + reference ) );
					const observedT = Math.exp( - 0.85 * Math.max( 0.02, 0.35 + observed ) );
					const temporalReference = canonicalHeight( x, z, time + 1 / 60 ) - reference;
					const temporalObserved = evaluateBoundedWaterSample( branch, x, z, time + 1 / 60 ) - observed;
					heightSquared += error * error;
					colorSquared += ( observedT - referenceT ) ** 2;
					temporalSquared += ( temporalObserved - temporalReference ) ** 2;
					maximum = Math.max( maximum, Math.abs( error ) );
					count ++;
				}
			}
		}
		runTimes.push( now() - start );

	}

	const repeatedCount = count;
	const metrics = {
		physical: Math.sqrt( heightSquared / repeatedCount ),
		color: Math.sqrt( colorSquared / repeatedCount ),
		temporal: Math.sqrt( temporalSquared / repeatedCount ),
		spatial: maximum,
		ownership: 0,
		lifecycle: 0
	};
	return {
		metrics,
		visibleLoss: {
			value: metrics.physical,
			unit: 'height-rmse',
			label: 'Measured',
			source: 'current runtime deterministic bounded-water oracle'
		},
		timing: {
			value: p50( runTimes ),
			unit: 'ms-per-oracle-sweep',
			label: 'Measured',
			source: 'current JavaScript runtime; CPU fixture only, not GPU timing'
		},
		sampleCount: sampleCount * sampleCount * times.length,
		runs: runTimes.length
	};

}

function validateInvariants( scenario, measurement ) {

	const domains = scenario.invariants.map( ( invariant ) => invariant.domain );
	if ( domains.length !== INVARIANT_DOMAINS.length || new Set( domains ).size !== INVARIANT_DOMAINS.length || INVARIANT_DOMAINS.some( ( domain ) => ! domains.includes( domain ) ) ) {

		return verdict( 'FAIL', FALLBACK_REASON.SCHEMA, 'Invariant ledger must contain each required domain exactly once.' );

	}

	const proofs = [];
	for ( const invariant of scenario.invariants ) {

		if ( ! [ 'preserved', 'weakened', 'removed' ].includes( invariant.status ) || ! invariant.diagnostic || ! invariant.metric ) {

			return verdict( 'FAIL', FALLBACK_REASON.SCHEMA, `Invariant ${ invariant.domain } lacks status, diagnostic, or metric.` );

		}
		if ( invariant.status === 'removed' ) {

			if ( invariant.claimRemoved !== true ) return verdict( 'FAIL', FALLBACK_REASON.INVARIANT, `Removed invariant ${ invariant.domain } still retains its canonical claim.` );
			proofs.push( { domain: invariant.domain, status: invariant.status, verdict: 'NOT_CLAIMED' } );
			continue;

		}
		let gate;
		try {

			gate = numericEvidence( invariant.gate, `invariants.${ invariant.domain }.gate` );

		} catch ( error ) {

			return verdict( 'FAIL', FALLBACK_REASON.SCHEMA, error.message );

		}
		const observed = measurement.metrics[ invariant.domain ];
		const passed = Number.isFinite( observed ) && observed <= gate;
		proofs.push( { domain: invariant.domain, status: invariant.status, observed, gate, verdict: passed ? 'PASS' : 'FAIL' } );
		if ( ! passed ) return verdict( 'FAIL', FALLBACK_REASON.INVARIANT, `${ invariant.domain } exceeds its frozen error gate.`, { proofs } );

	}
	return { proofs };

}

export function planFallback( scenario, options = {} ) {

	const shape = validateScenarioShape( scenario );
	if ( shape ) return shape;
	const explicitRequest = options.explicitRequest === true;

	if ( scenario.actualCapabilities.webgpu === true ) {

		return verdict( 'PASS', FALLBACK_REASON.CANONICAL, 'WebGPU is available; return to the canonical bounded-water owner and keep compatibility inactive.', {
			activated: false,
			owner: scenario.canonicalOwner,
			branch: 'canonical-budget-reduction'
		} );

	}

	if ( explicitRequest !== true ) {

		return verdict( 'BLOCKED', scenario.desiredBranch === null ? FALLBACK_REASON.BLOCKED : FALLBACK_REASON.EXPLICIT, 'WebGPU is unavailable and no explicit fallback-teaching request was supplied. No branch is activated.', {
			activated: false,
			owner: scenario.canonicalOwner
		} );

	}

	if ( scenario.desiredBranch === null ) return verdict( 'BLOCKED', FALLBACK_REASON.BLOCKED, 'The explicit request did not select a degradation branch.', { activated: false } );

	if ( scenario.desiredBranch === 'invariant-loss-comparison' ) {

		const branches = BRANCH_ORDER.slice( 1 ).map( ( branch ) => ( { branch, measurement: measureBoundedWaterBranch( branch ) } ) );
		return verdict( 'PASS', FALLBACK_REASON.COMPARISON, 'Compatibility representations were compared without selecting or activating a renderer branch.', {
			activated: false,
			branches
		} );

	}

	const trace = validateDecisionTrace( scenario );
	if ( trace ) return trace;
	if ( scenario.desiredBranch === 'maintained-legacy' ) {

		const maintenance = scenario.maintenance;
		if ( maintenance?.accepted !== true || ! maintenance.owner || ! Array.isArray( maintenance.requiredTests ) || maintenance.requiredTests.length === 0 ) {

			return verdict( 'FAIL', FALLBACK_REASON.LEGACY, 'A maintained legacy renderer requires explicit maintenance acceptance, owner, and test contract.' );

		}

	}

	const measurement = measureBoundedWaterBranch( scenario.desiredBranch, options.now );
	const invariantResult = validateInvariants( scenario, measurement );
	if ( invariantResult.status ) return invariantResult;

	return verdict( 'PASS', FALLBACK_REASON.SELECTED, 'The explicitly requested compatibility branch satisfies its branch-specific invariant gates.', {
		activated: true,
		branch: scenario.desiredBranch,
		canonicalOwner: scenario.canonicalOwner,
		decisionTrace: scenario.decisionTrace,
		invariantProofs: invariantResult.proofs,
		visibleLoss: measurement.visibleLoss,
		timing: measurement.timing,
		screenshotTargets: scenario.screenshotTargets
	} );

}
