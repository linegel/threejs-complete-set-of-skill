import {
	createCapabilityTier,
	createDefaultImagePipelineConfig,
	evaluateLightingAwareAoComposite
} from './pipelineConfig.js';

function fail( message ) {

	throw new Error( message );

}

export function validateImagePipelineConfig( config = createDefaultImagePipelineConfig() ) {

	if ( config.sceneRenderCount !== 1 ) {

		fail( 'Image pipeline must use exactly one scene render by default.' );

	}

	if ( ! config.toneMapOwner || ! config.outputTransformOwner ) {

		fail( 'Both toneMapOwner and outputTransformOwner are required.' );

	}

	if ( config.outputTransformOwner === 'renderOutput' && config.outputColorTransform !== false ) {

		fail( 'renderOutput() output ownership requires RenderPipeline.outputColorTransform = false.' );

	}

	if ( config.outputTransformOwner === 'RenderPipeline.outputColorTransform' && config.outputColorTransform !== true ) {

		fail( 'RenderPipeline output ownership requires outputColorTransform = true.' );

	}

	if ( config.toneMapOwner !== config.outputTransformOwner && config.outputColorTransform !== false ) {

		fail( 'Split output ownership requires RenderPipeline.outputColorTransform = false.' );

	}

	if ( config.toneMapOwner === 'RenderPipeline' && config.outputTransformOwner === 'renderOutput' ) {

		fail( 'Tone mapping and output conversion cannot be split across RenderPipeline and renderOutput().' );

	}

	for ( const consumerName of Object.keys( config.consumers ) ) {

		if ( ! config.producers[ consumerName ] ) {

			fail( `Consumer list "${ consumerName }" has no matching producer.` );

		}

		if ( ! config.colorDomains[ consumerName ] ) {

			fail( `Consumer list "${ consumerName }" has no matching color/domain declaration.` );

		}

	}

	for ( const mrtName of config.requiredMRT ) {

		if ( ! config.producers[ mrtName ] ) {

			fail( `MRT "${ mrtName }" is missing a producer.` );

		}

		if ( ! Array.isArray( config.consumers[ mrtName ] ) || config.consumers[ mrtName ].length === 0 ) {

			fail( `MRT "${ mrtName }" is missing declared consumers.` );

		}

		if ( ! config.colorDomains[ mrtName ] ) {

			fail( `MRT "${ mrtName }" is missing a color/domain declaration.` );

		}

	}

	if ( config.temporal.enabled === true ) {

		if ( ! config.temporal.velocityConvention ) {

			fail( 'Temporal mode requires a velocity convention.' );

		}

		if ( ! config.temporal.jitterOwner ) {

			fail( 'Temporal mode requires a jitter owner.' );

		}

	}

	const estimatedBytes = config.requiredMRT.length * config.memory.hdrAttachmentBytes;

	if ( estimatedBytes > config.memory.memoryBudget ) {

		fail( `Estimated MRT memory ${ estimatedBytes } exceeds budget ${ config.memory.memoryBudget }.` );

	}

	if ( config.resize.updatesRenderer !== true || config.resize.updatesScenePass !== true ) {

		fail( 'Resize path must update renderer and scene pass.' );

	}

	if ( config.disposal.disposesRenderPipeline !== true || config.disposal.disposesTargets !== true ) {

		fail( 'Disposal path must own RenderPipeline and target teardown.' );

	}

	validateAoCompositeContract();

	return {
		pass: true,
		sceneRenderCount: config.sceneRenderCount,
		toneMapOwner: config.toneMapOwner,
		outputTransformOwner: config.outputTransformOwner,
		requiredMRT: config.requiredMRT,
		estimatedBytes
	};

}

function assertRgbEqual( actual, expected, label ) {

	for ( let index = 0; index < 3; index += 1 ) {

		if ( Math.abs( actual[ index ] - expected[ index ] ) > 1e-9 ) {

			fail( `${ label } changed at channel ${ index }: expected ${ expected[ index ] }, got ${ actual[ index ] }.` );

		}

	}

}

export function validateAoCompositeContract() {

	const pixelTerms = {
		direct: [ 1.2, 0.7, 0.35 ],
		indirect: [ 0.4, 0.25, 0.12 ],
		emissive: [ 3.5, 2.1, 0.8 ],
		atmosphere: [ 0.18, 0.22, 0.31 ],
		ui: [ 0.9, 0.9, 0.9 ]
	};
	const aoForcedZero = evaluateLightingAwareAoComposite( pixelTerms, 0 );
	const aoForcedOne = evaluateLightingAwareAoComposite( pixelTerms, 1 );

	assertRgbEqual( aoForcedZero.direct, pixelTerms.direct, 'Direct light' );
	assertRgbEqual( aoForcedZero.emissive, pixelTerms.emissive, 'Emissive light' );
	assertRgbEqual( aoForcedZero.atmosphere, pixelTerms.atmosphere, 'Atmosphere' );
	assertRgbEqual( aoForcedZero.ui, pixelTerms.ui, 'UI overlay' );
	assertRgbEqual( aoForcedZero.indirect, [ 0, 0, 0 ], 'Indirect light under zero AO' );

	const removedByAo = aoForcedOne.color.map( ( component, index ) => component - aoForcedZero.color[ index ] );
	assertRgbEqual( removedByAo, pixelTerms.indirect, 'AO visibility must remove only indirect light' );

	return {
		pass: true,
		aoForcedZeroPreserves: [ 'direct', 'emissive', 'atmosphere', 'ui' ],
		aoForcedZeroRemoves: [ 'indirect' ]
	};

}

const fixtureFactories = {
	valid: () => createDefaultImagePipelineConfig(),
	'duplicate-scene-render': () => createDefaultImagePipelineConfig( { sceneRenderCount: 2 } ),
	'duplicate-output-owner': () => createDefaultImagePipelineConfig( {
		toneMapOwner: 'RenderPipeline',
		outputTransformOwner: 'renderOutput',
		outputColorTransform: true
	} ),
	'double-output-transform': () => createDefaultImagePipelineConfig( {
		outputColorTransform: true
	} ),
	'missing-velocity-convention': () => createDefaultImagePipelineConfig( {
		requiredMRT: [ 'output', 'normal', 'emissive', 'velocity' ],
		producers: {
			output: 'scene-pass',
			normal: 'scene-pass',
			emissive: 'scene-pass',
			depth: 'scene-pass',
			velocity: 'scene-pass'
		},
		consumers: {
			output: [ 'lighting-composite' ],
			normal: [ 'GTAONode' ],
			emissive: [ 'BloomNode' ],
			depth: [ 'GTAONode' ],
			velocity: [ 'TRAANode' ]
		},
		colorDomains: {
			output: 'scene-linear HDR',
			normal: 'data/no-color',
			emissive: 'scene-linear HDR',
			depth: 'data/no-color',
			velocity: 'data/no-color',
			final: 'display-referred sRGB'
		},
		temporal: {
			enabled: true,
			velocityConvention: null,
			jitterOwner: null,
			resetEvents: [ 'resize' ]
		}
	} ),
	'undeclared-mrt-consumer': () => createDefaultImagePipelineConfig( {
		consumers: {
			output: [ 'lighting-composite' ],
			normal: [],
			emissive: [ 'BloomNode' ],
			depth: [ 'GTAONode' ]
		}
	} )
};

export function runValidationFixture( fixtureName ) {

	const factory = fixtureFactories[ fixtureName ];

	if ( ! factory ) {

		fail( `Unknown fixture "${ fixtureName }".` );

	}

	return validateImagePipelineConfig( factory() );

}

export function runSelfTest() {

	const valid = runValidationFixture( 'valid' );
	const aoComposite = validateAoCompositeContract();
	const invalidFixtures = [
		'duplicate-scene-render',
		'duplicate-output-owner',
		'double-output-transform',
		'missing-velocity-convention',
		'undeclared-mrt-consumer'
	];

	for ( const fixture of invalidFixtures ) {

		try {

			runValidationFixture( fixture );
			fail( `Fixture "${ fixture }" unexpectedly passed.` );

		} catch ( error ) {

			if ( error.message.includes( 'unexpectedly passed' ) ) throw error;

		}

	}

	const fakeRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: true },
		hasFeature: ( name ) => name === 'timestamp-query',
		getOutputBufferType: () => 'HalfFloatType',
		computeAsync: async () => {}
	};

	const tier = createCapabilityTier( fakeRenderer, { requiredMRT: 3, requiredStorage: true } );

	if ( tier.tier !== 'full' || tier.timestampQuery !== true || tier.budgetReason.length !== 0 ) {

		fail( 'Capability tier validation failed for full fake renderer.' );

	}

	return { valid, invalidFixtures, tier, aoComposite };

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const fixtureIndex = process.argv.indexOf( '--fixture' );
	const expectInvalidIndex = process.argv.indexOf( '--expect-invalid' );

	try {

		const result = expectInvalidIndex !== -1
			? process.argv.slice( expectInvalidIndex + 1 ).map( ( fixture ) => {

				try {

					runValidationFixture( fixture );
					fail( `Fixture "${ fixture }" unexpectedly passed.` );

				} catch ( error ) {

					if ( error.message.includes( 'unexpectedly passed' ) ) throw error;
					return { fixture, rejected: true, message: error.message };

				}

			} )
			: fixtureIndex === -1
				? runSelfTest()
				: runValidationFixture( process.argv[ fixtureIndex + 1 ] );

		console.log( JSON.stringify( result, null, 2 ) );

	} catch ( error ) {

		console.error( error.message );
		process.exitCode = 1;

	}

}
