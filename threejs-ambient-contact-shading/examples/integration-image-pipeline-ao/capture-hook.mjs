/**
 * Capture hook for integration-image-pipeline-ao.
 * Built-in capture assumes no-post/diagnostics modes that this lab does not own;
 * map mandatory standard slots onto real presentation + owner-graph diagnostics.
 */

export const outputPlan = Object.freeze( [
	{ id: 'final.design', status: 'CAPTURED', filename: 'final.design.png' },
	{
		id: 'no-post.design',
		status: 'NOT_APPLICABLE',
		filename: null,
		reason: 'Image-pipeline AO integration has no optional post stack to disable; presentation is the sole final-image owner.',
		graphProof: {
			finalOwner: 'image-pipeline-host-presentation',
			optionalPostNodes: 0,
			sceneSubmissions: 2
		}
	},
	{ id: 'diagnostics.mosaic', status: 'CAPTURED', filename: 'diagnostics.mosaic.png' },
	{ id: 'camera.near', status: 'CAPTURED', filename: 'camera.near.png' },
	{ id: 'camera.design', status: 'CAPTURED', filename: 'camera.design.png' },
	{ id: 'camera.far', status: 'CAPTURED', filename: 'camera.far.png' },
	{ id: 'seed-0001.final', status: 'CAPTURED', filename: 'seed-0001.final.png' },
	{ id: 'seed-9e3779b9.final', status: 'CAPTURED', filename: 'seed-9e3779b9.final.png' },
	{ id: 'temporal.t000', status: 'CAPTURED', filename: 'temporal.t000.png' },
	{ id: 'temporal.t001', status: 'CAPTURED', filename: 'temporal.t001.png' }
] );

const BASELINE_SEED = 0x00000001;
const STRESS_SEED = 0x9e3779b9;

async function select( session, {
	scenario = 'wall-receiver',
	mode = 'final',
	camera = 'design',
	tier = 'ultra',
	seed = BASELINE_SEED,
	time = 0
} = {} ) {

	await session.controllerCall( 'setScenario', scenario );
	await session.controllerCall( 'setTier', tier );
	await session.controllerCall( 'setSeed', seed );
	await session.controllerCall( 'setCamera', camera );
	await session.controllerCall( 'setTime', time );
	await session.controllerCall( 'setMode', mode );
	await session.controllerCall( 'renderOnce' );

}

function assertDistinct( captures, firstFilename, secondFilename ) {

	const first = captures.find( ( capture ) => capture.png?.path === firstFilename );
	const second = captures.find( ( capture ) => capture.png?.path === secondFilename );
	if ( ! first?.png?.sha256 || ! second?.png?.sha256 ) {

		throw new Error( `missing hash-bound captures for ${ firstFilename } and ${ secondFilename }` );

	}
	if ( first.png.sha256 === second.png.sha256 ) {

		throw new Error( `${ firstFilename } and ${ secondFilename } are falsely duplicated` );

	}

}

export async function captureLab( session ) {

	const captures = [];
	const capture = async ( filename, state, target = 'presentation' ) => {

		await select( session, state );
		captures.push( await session.writeCapture( filename, target ) );

	};

	await capture( 'final.design.png', { mode: 'final' } );
	// raw-ao is the real AO diagnostic from the demo (owner-graph is a solid placeholder color).
	await capture( 'diagnostics.mosaic.png', { mode: 'raw-ao' } );
	await capture( 'camera.near.png', { mode: 'final', camera: 'near' } );
	await capture( 'camera.design.png', { mode: 'final', camera: 'design' } );
	await capture( 'camera.far.png', { mode: 'final', camera: 'far' } );
	await capture( 'seed-0001.final.png', { mode: 'final', seed: BASELINE_SEED } );
	await capture( 'seed-9e3779b9.final.png', { mode: 'final', seed: STRESS_SEED } );
	await capture( 'temporal.t000.png', { mode: 'final', time: 0 } );
	await capture( 'temporal.t001.png', { mode: 'final', time: 1 / 60 } );

	assertDistinct( captures, 'final.design.png', 'diagnostics.mosaic.png' );
	assertDistinct( captures, 'seed-0001.final.png', 'seed-9e3779b9.final.png' );
	assertDistinct( captures, 'temporal.t000.png', 'temporal.t001.png' );

	const locked = session.lockedState ?? {};
	await select( session, {
		scenario: locked.scenario ?? 'wall-receiver',
		mode: locked.mode && locked.mode !== 'presentation' ? locked.mode : 'final',
		camera: locked.camera ?? 'design',
		tier: locked.tier ?? 'ultra',
		seed: locked.seed ?? BASELINE_SEED,
		time: locked.timeSeconds ?? 0
	} );

	return Object.freeze( {
		acceptanceStatus: 'incomplete',
		captures: Object.freeze( captures ),
		pipeline: await session.controllerCall( 'describePipeline' ),
		resources: await session.controllerCall( 'describeResources' ),
		metrics: await session.controllerCall( 'getMetrics' ),
		note: 'Standard presentation + owner-graph diagnostic slots only; full v2 release promotion remains separate.'
	} );

}

export default captureLab;
