import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function captureLab( session ) {
	const captures = [];
	const capture = async ( filename, target = 'final' ) => {
		await session.controllerCall( 'renderOnce' );
		const result = await session.writeCapture( filename, target );
		captures.push( { filename, ...result } );
	};

	if ( session.profile === 'performance' ) {
		await session.controllerCall( 'setMode', 'final' );
		await session.controllerCall( 'setCamera', 'design' );
		await session.controllerCall( 'setSeed', 1 );
		await session.controllerCall( 'setTime', 1 );
		await capture( 'final.performance.png', 'final' );
	} else {
		await session.controllerCall( 'setSeed', 1 );
		await session.controllerCall( 'setTime', 1 );
		await session.controllerCall( 'setCamera', 'design' );
		await capture( 'final.design.png', 'final' );
		await capture( 'no-post.design.png', 'no-post' );
		await capture( 'diagnostics.mosaic.png', 'diagnostics' );
		await capture( 'spectrum-and-fft.png', 'spectrum-fft' );
		await capture( 'dispersion-and-cascades.png', 'cascade-bands' );
		await capture( 'derivatives-and-jacobian.png', 'jacobian' );
		await capture( 'whitecaps-and-foam.png', 'foam' );
		await session.controllerCall( 'setCamera', 'underwater' );
		await capture( 'above-and-below-surface.png', 'underwater-optics' );
		await session.controllerCall( 'setCamera', 'design' );
		await session.controllerCall( 'setMode', 'cpu-query' );
		await capture( 'cpu-query-parity.png', 'cpu-query' );
		await session.controllerCall( 'setMode', 'final' );

		for ( const camera of [ 'near', 'design', 'far' ] ) {
			await session.controllerCall( 'setCamera', camera );
			await capture( `camera.${ camera }.png`, 'final' );
		}

		await session.controllerCall( 'setCamera', 'design' );
		await session.controllerCall( 'setSeed', 1 );
		await session.controllerCall( 'setTime', 1 );
		await capture( 'seed-0001.final.png', 'final' );
		await session.controllerCall( 'setSeed', 0x9e3779b9 );
		await session.controllerCall( 'setTime', 1 );
		await capture( 'seed-9e3779b9.final.png', 'final' );

		await session.controllerCall( 'setSeed', 1 );
		await session.controllerCall( 'setTime', 0 );
		await capture( 'temporal.t000.png', 'foam' );
		await session.controllerCall( 'setTime', 1 );
		await capture( 'temporal.t001.png', 'foam' );

		await session.controllerCall( 'setMode', 'final' );
		await session.controllerCall( 'setCamera', 'design' );
		await session.controllerCall( 'setSeed', 1 );
		await session.controllerCall( 'setTime', 0 );
	}

	const boundary = {
		schemaVersion: 2,
		labId: session.lab.id,
		status: 'incomplete',
		publishable: false,
		sourceHash: session.lab.sourceHash,
		evidenceContract: 'v2',
		reason: 'Capture session only; acceptance still requires the complete strict v2 bundle, GPU timestamps, lifecycle evidence, and visual review.',
		claimVerdicts: {
			visualCorrectness: 'INSUFFICIENT_EVIDENCE',
			mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
			performanceCompliance: 'INSUFFICIENT_EVIDENCE',
			gpuAttribution: 'INSUFFICIENT_EVIDENCE',
			lifecycleStability: 'INSUFFICIENT_EVIDENCE'
		},
		captures
	};
	await writeFile( resolve( session.outputDir, 'evidence-manifest.incomplete.json' ), `${ JSON.stringify( boundary, null, 2 ) }\n` );
	return { status: 'incomplete', publishable: false, captures };
}

export default captureLab;
