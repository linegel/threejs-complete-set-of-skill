import { sha256Hex } from './physical-evidence-common.js';

export const CORRECTNESS_CAPTURE_RECIPE_SCHEMA_VERSION = 1;
export const CORRECTNESS_CAPTURE_RECIPE_KIND = 'validation-harness-correctness-capture-recipe-v1';

const PARENT_ROUTE = {
	kind: 'tier',
	id: 'webgpu-correctness'
};

const TRANSACTION = {
	owner: 'validation-subject',
	scope: 'subject-internal',
	restorePolicy: 'restore-entry-state',
	parentRouteMutationAllowed: false
};

function deepFreeze( value ) {

	if ( value === null || typeof value !== 'object' || Object.isFrozen( value ) ) return value;
	for ( const child of Object.values( value ) ) deepFreeze( child );
	return Object.freeze( value );

}

function timeline( { resetHistoryCause = null, stepSeconds = [] } = {} ) {

	return {
		initialTimeSeconds: 0,
		resetHistoryCause,
		stepSeconds: [ ...stepSeconds ]
	};

}

function recipe( id, filename, target, overrides = {} ) {

	const state = {
		scenario: 'browser-capture',
		tier: 'webgpu-correctness',
		mode: target,
		camera: 'design',
		seed: 0x00000001,
		timeSeconds: 0,
		viewport: {
			width: 1200,
			height: 800,
			dpr: 1
		},
		timeline: timeline(),
		...( overrides.state ?? {} )
	};
	if ( overrides.state?.viewport ) state.viewport = { ...overrides.state.viewport };
	if ( overrides.state?.timeline ) state.timeline = { ...overrides.state.timeline, stepSeconds: [ ...overrides.state.timeline.stepSeconds ] };

	return deepFreeze( {
		schemaVersion: CORRECTNESS_CAPTURE_RECIPE_SCHEMA_VERSION,
		recipeKind: CORRECTNESS_CAPTURE_RECIPE_KIND,
		id,
		parentRoute: { ...PARENT_ROUTE },
		transaction: { ...TRANSACTION },
		capture: {
			filename,
			target,
			readback: 'render-target-rgba8'
		},
		effectiveState: state,
		expectedSceneScale: overrides.expectedSceneScale ?? 1
	} );

}

const RECIPES = [
	recipe( 'final.design', 'final.design.png', 'final' ),
	recipe( 'no-post.design', 'no-post.design.png', 'no-post' ),
	recipe( 'diagnostic.normal', 'diagnostic.normal.png', 'normal' ),
	recipe( 'diagnostic.emissive', 'diagnostic.emissive.png', 'emissive' ),
	recipe( 'camera.near', 'camera.near.png', 'final', { state: { camera: 'near' } } ),
	recipe( 'camera.design', 'camera.design.png', 'final' ),
	recipe( 'camera.far', 'camera.far.png', 'final', { state: { camera: 'far' } } ),
	recipe( 'seed-0001.final', 'seed-0001.final.png', 'final' ),
	recipe( 'seed-9e3779b9.final', 'seed-9e3779b9.final.png', 'final', { state: { seed: 0x9e3779b9 } } ),
	recipe( 'temporal.t000', 'temporal.t000.png', 'final', {
		state: { timeline: timeline( { resetHistoryCause: 'correctness-capture' } ) }
	} ),
	recipe( 'temporal.t001', 'temporal.t001.png', 'final', {
		state: {
			timeSeconds: 1 / 60,
			timeline: timeline( { resetHistoryCause: 'correctness-capture', stepSeconds: [ 1 / 60 ] } )
		}
	} ),
	recipe( 'odd-size.final', 'odd-size.final.png', 'final', {
		state: { viewport: { width: 641, height: 359, dpr: 1 } }
	} ),
	recipe( 'tier.target-performance.final', 'tier.target-performance.final.png', 'final', {
		state: {
			scenario: 'timing-and-governor',
			tier: 'target-performance',
			viewport: { width: 1920, height: 1080, dpr: 1 }
		},
		expectedSceneScale: 1
	} ),
	recipe( 'tier.governor-stress.final', 'tier.governor-stress.final.png', 'final', {
		state: {
			scenario: 'timing-and-governor',
			tier: 'governor-stress',
			viewport: { width: 1920, height: 1080, dpr: 1 }
		},
		expectedSceneScale: 0.5
	} )
];

export const CORRECTNESS_CAPTURE_RECIPE_IDS = Object.freeze( RECIPES.map( ( entry ) => entry.id ) );
export const CORRECTNESS_CAPTURE_RECIPES = Object.freeze( RECIPES );

const RECIPE_BY_ID = new Map( RECIPES.map( ( entry ) => [ entry.id, entry ] ) );
if ( RECIPE_BY_ID.size !== RECIPES.length ) throw new Error( 'Correctness capture recipe IDs must be unique.' );

export function getCorrectnessCaptureRecipe( id ) {

	if ( typeof id !== 'string' || RECIPE_BY_ID.has( id ) === false ) throw new Error( `Unknown correctness capture recipe "${ String( id ) }".` );
	return RECIPE_BY_ID.get( id );

}

export async function correctnessCaptureRecipeDigest( id ) {

	return sha256Hex( getCorrectnessCaptureRecipe( id ) );

}

export async function correctnessCaptureRecipeSetDigest() {

	return sha256Hex( {
		schemaVersion: CORRECTNESS_CAPTURE_RECIPE_SCHEMA_VERSION,
		recipeKind: CORRECTNESS_CAPTURE_RECIPE_KIND,
		recipes: CORRECTNESS_CAPTURE_RECIPES
	} );

}

export async function verifyCorrectnessCaptureRecipeDigest( id, expectedDigest ) {

	if ( /^sha256:[0-9a-f]{64}$/.test( expectedDigest ?? '' ) === false ) throw new Error( 'Expected correctness capture recipe digest must be a sha256: digest.' );
	const actualDigest = await correctnessCaptureRecipeDigest( id );
	if ( actualDigest !== expectedDigest ) throw new Error( `Correctness capture recipe ${ id } digest mismatch: expected ${ expectedDigest }, observed ${ actualDigest }.` );
	return true;

}
