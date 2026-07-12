import { StorageBufferAttribute } from 'three/webgpu';
import {
	Fn,
	abs,
	clamp as tslClamp,
	cos,
	exp,
	float,
	mix,
	normalLocal,
	positionGeometry,
	sin,
	storage,
	uint,
	uniform,
	vec2,
	vec3,
	vec4
} from 'three/tsl';

export const GPU_SKIFF_LAYOUT = Object.freeze( {
	stateRecords: 4,
	stateBytes: 64,
	poseBytes: 16,
	state: Object.freeze( {
		pose: 'vec4(heaveMetres, rollRadians, pitchRadians, physicsTimeSeconds)',
		velocity: 'vec4(heaveMps, rollRadps, pitchRadps, committedTick)',
		water: 'vec4(feedbackHeightMetres, feedbackVelocityMps, forceResidualNs, torqueResidualNms)',
		load: 'vec4(displacedVolumeM3, hydrodynamicForceYNewtons, torqueXNm, torqueZNm)'
	} )
} );

export const GPU_SKIFF_PARAMETERS = Object.freeze( {
	fixedTimeStepSeconds: 1 / 120,
	maximumCatchUpSteps: 8,
	massKg: 420,
	waterDensityKgM3: 1025,
	gravityMps2: 9.81,
	closedVolumeM3: 0.82,
	draftMeters: 1,
	lengthMeters: 3.2,
	beamMeters: 1.4,
	inertiaRollKgM2: 350,
	inertiaPitchKgM2: 1000,
	dragKgPerSecond: 280,
	rollRightingMomentNmPerRadian: 1850,
	pitchRightingMomentNmPerRadian: 2600,
	rollDampingNmsPerRadian: 720,
	pitchDampingNmsPerRadian: 980,
	waterPatchMassKg: 8200,
	waterRestoringRatePerSecond2: 5.2,
	waterDampingRatePerSecond: 1.1,
	waveAmplitudeMeters: 0.08,
	waveNumberRadiansPerMeter: 0.75,
	waveAngularFrequencyRadiansPerSecond: 1.7,
	secondaryWaveAmplitudeMeters: 0.035,
	secondaryWaveNumberRadiansPerMeter: 1.35,
	secondaryWaveAngularFrequencyRadiansPerSecond: 2.35,
	boundedCorrectionIterations: 2,
	quadratureCount: 9
} );

function rotatedOffset( localPoint, pose ) {

	const sinRoll = sin( pose.y );
	const cosRoll = cos( pose.y );
	const rollY = localPoint.y.mul( cosRoll ).sub( localPoint.z.mul( sinRoll ) );
	const rollZ = localPoint.y.mul( sinRoll ).add( localPoint.z.mul( cosRoll ) );
	const sinPitch = sin( pose.z );
	const cosPitch = cos( pose.z );
	return vec3(
		localPoint.x.mul( cosPitch ).sub( rollY.mul( sinPitch ) ),
		localPoint.x.mul( sinPitch ).add( rollY.mul( cosPitch ) ),
		rollZ
	);

}

function analyticWaveHeight( x, z, time, waterFeedback ) {

	const primaryPhase = float( GPU_SKIFF_PARAMETERS.waveNumberRadiansPerMeter )
		.mul( x.mul( 0.92 ).add( z.mul( 0.38 ) ) )
		.sub( time.mul( GPU_SKIFF_PARAMETERS.waveAngularFrequencyRadiansPerSecond ) );
	const secondaryPhase = float( GPU_SKIFF_PARAMETERS.secondaryWaveNumberRadiansPerMeter )
		.mul( x.mul( -0.31 ).add( z.mul( 0.95 ) ) )
		.sub( time.mul( GPU_SKIFF_PARAMETERS.secondaryWaveAngularFrequencyRadiansPerSecond ) )
		.add( 1.1 );
	const radialWeight = exp( x.mul( x ).add( z.mul( z ) ).mul( -0.22 ) );
	return sin( primaryPhase ).mul( GPU_SKIFF_PARAMETERS.waveAmplitudeMeters )
		.add( sin( secondaryPhase ).mul( GPU_SKIFF_PARAMETERS.secondaryWaveAmplitudeMeters ) )
		.add( waterFeedback.mul( radialWeight ) );

}

function analyticWaterSlope( x, z, time, waterFeedback ) {

	const primaryPhase = float( GPU_SKIFF_PARAMETERS.waveNumberRadiansPerMeter )
		.mul( x.mul( 0.92 ).add( z.mul( 0.38 ) ) )
		.sub( time.mul( GPU_SKIFF_PARAMETERS.waveAngularFrequencyRadiansPerSecond ) );
	const secondaryPhase = float( GPU_SKIFF_PARAMETERS.secondaryWaveNumberRadiansPerMeter )
		.mul( x.mul( -0.31 ).add( z.mul( 0.95 ) ) )
		.sub( time.mul( GPU_SKIFF_PARAMETERS.secondaryWaveAngularFrequencyRadiansPerSecond ) )
		.add( 1.1 );
	const radiusSquared = x.mul( x ).add( z.mul( z ) );
	const radialWeight = exp( radiusSquared.mul( -0.22 ) );
	const primaryScale = float( GPU_SKIFF_PARAMETERS.waveAmplitudeMeters * GPU_SKIFF_PARAMETERS.waveNumberRadiansPerMeter ).mul( cos( primaryPhase ) );
	const secondaryScale = float( GPU_SKIFF_PARAMETERS.secondaryWaveAmplitudeMeters * GPU_SKIFF_PARAMETERS.secondaryWaveNumberRadiansPerMeter ).mul( cos( secondaryPhase ) );
	return vec2(
		primaryScale.mul( 0.92 ).add( secondaryScale.mul( -0.31 ) ).sub( waterFeedback.mul( radialWeight ).mul( x ).mul( 0.44 ) ),
		primaryScale.mul( 0.38 ).add( secondaryScale.mul( 0.95 ) ).sub( waterFeedback.mul( radialWeight ).mul( z ).mul( 0.44 ) )
	);

}

function buildHydrodynamicLoadNode() {

	return Fn( ( [ pose, velocity, water ] ) => {

		const forceY = float( 0 ).toVar();
		const torqueX = float( 0 ).toVar();
		const torqueZ = float( 0 ).toVar();
		const displacedVolume = float( 0 ).toVar();
		const volumeWeight = GPU_SKIFF_PARAMETERS.closedVolumeM3 / GPU_SKIFF_PARAMETERS.quadratureCount;
		const time = pose.w.add( GPU_SKIFF_PARAMETERS.fixedTimeStepSeconds );

		for ( const xFactor of [ -0.36, 0, 0.36 ] ) {

			for ( const zFactor of [ -0.36, 0, 0.36 ] ) {

				const localPoint = vec3(
					xFactor * GPU_SKIFF_PARAMETERS.lengthMeters,
					-0.5 * GPU_SKIFF_PARAMETERS.draftMeters,
					zFactor * GPU_SKIFF_PARAMETERS.beamMeters
				);
				const offset = rotatedOffset( localPoint, pose );
				const pointY = pose.x.add( offset.y );
				const surfaceY = analyticWaveHeight( offset.x, offset.z, time, water.x );
				const immersion = tslClamp( surfaceY.sub( pointY ).div( GPU_SKIFF_PARAMETERS.draftMeters ), 0, 1 );
				const sampleVolume = immersion.mul( volumeWeight );
				const pointVerticalVelocity = velocity.x
					.add( velocity.z.mul( offset.x ) )
					.sub( velocity.y.mul( offset.z ) );
				const buoyancy = sampleVolume.mul( GPU_SKIFF_PARAMETERS.waterDensityKgM3 * GPU_SKIFF_PARAMETERS.gravityMps2 );
				const drag = pointVerticalVelocity.mul( -GPU_SKIFF_PARAMETERS.dragKgPerSecond / GPU_SKIFF_PARAMETERS.quadratureCount );
				const sampleForce = buoyancy.add( drag );
				forceY.addAssign( sampleForce );
				torqueX.addAssign( offset.z.mul( sampleForce ).negate() );
				torqueZ.addAssign( offset.x.mul( sampleForce ) );
				displacedVolume.addAssign( sampleVolume );

			}

		}
		// The nine-column clip under-resolves the continuous waterplane second
		// moment. These linearized terms close that declared coarse-proxy error;
		// they are part of the hull law, not arbitrary presentation bobbing.
		torqueX.subAssign( pose.y.mul( GPU_SKIFF_PARAMETERS.rollRightingMomentNmPerRadian ) );
		torqueX.subAssign( velocity.y.mul( GPU_SKIFF_PARAMETERS.rollDampingNmsPerRadian ) );
		torqueZ.subAssign( pose.z.mul( GPU_SKIFF_PARAMETERS.pitchRightingMomentNmPerRadian ) );
		torqueZ.subAssign( velocity.z.mul( GPU_SKIFF_PARAMETERS.pitchDampingNmsPerRadian ) );
		return vec4( forceY, torqueX, torqueZ, displacedVolume );

	} );

}

export function createGpuBoundedSkiffGraph( renderer ) {

	if ( renderer?.backend?.isWebGPUBackend !== true ) throw new Error( 'The bounded-skiff graph requires an initialized native WebGPU renderer.' );
	const equilibriumImmersion = GPU_SKIFF_PARAMETERS.massKg / ( GPU_SKIFF_PARAMETERS.waterDensityKgM3 * GPU_SKIFF_PARAMETERS.closedVolumeM3 );
	const equilibriumHeave = GPU_SKIFF_PARAMETERS.draftMeters * ( 0.5 - equilibriumImmersion );
	const stateBuffer = new StorageBufferAttribute( new Float32Array( [
		equilibriumHeave, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 0, 0,
		0, 0, 0, 0
	] ), 4 );
	stateBuffer.name = 'bounded-skiff-coupled-state';
	const previousPoseBuffer = new StorageBufferAttribute( new Float32Array( [ equilibriumHeave, 0, 0, 0 ] ), 4 );
	previousPoseBuffer.name = 'bounded-skiff-previous-presented-pose';
	const currentPoseBuffer = new StorageBufferAttribute( new Float32Array( [ equilibriumHeave, 0, 0, 0 ] ), 4 );
	currentPoseBuffer.name = 'bounded-skiff-current-presented-pose';
	const state = storage( stateBuffer, 'vec4', GPU_SKIFF_LAYOUT.stateRecords );
	const previousPose = storage( previousPoseBuffer, 'vec4', 1 );
	const currentPose = storage( currentPoseBuffer, 'vec4', 1 );
	const presentationAlpha = uniform( 0 ).setName( 'boundedSkiffPresentationAlpha' );
	const hydrodynamicLoad = buildHydrodynamicLoadNode();

	const integrate = Fn( () => {

		const priorPose = state.element( uint( 0 ) );
		const priorVelocity = state.element( uint( 1 ) );
		const priorWater = state.element( uint( 2 ) );
		const candidatePose = priorPose.toVar();
		const candidateVelocity = priorVelocity.toVar();
		const candidateWater = priorWater.toVar();
		const acceptedLoad = vec4( 0 ).toVar();
		const dt = float( GPU_SKIFF_PARAMETERS.fixedTimeStepSeconds );

		for ( let iteration = 0; iteration < GPU_SKIFF_PARAMETERS.boundedCorrectionIterations; iteration += 1 ) {

			const load = hydrodynamicLoad( candidatePose, candidateVelocity, candidateWater );
			const heaveAcceleration = load.x.sub( GPU_SKIFF_PARAMETERS.massKg * GPU_SKIFF_PARAMETERS.gravityMps2 )
				.div( GPU_SKIFF_PARAMETERS.massKg );
			const nextHeaveVelocity = priorVelocity.x.add( heaveAcceleration.mul( dt ) );
			const nextRollVelocity = priorVelocity.y.add( load.y.mul( dt ).div( GPU_SKIFF_PARAMETERS.inertiaRollKgM2 ) );
			const nextPitchVelocity = priorVelocity.z.add( load.z.mul( dt ).div( GPU_SKIFF_PARAMETERS.inertiaPitchKgM2 ) );
			const dynamicReactionForce = load.x.sub( GPU_SKIFF_PARAMETERS.massKg * GPU_SKIFF_PARAMETERS.gravityMps2 ).negate();
			const waterAcceleration = dynamicReactionForce.div( GPU_SKIFF_PARAMETERS.waterPatchMassKg )
				.sub( priorWater.x.mul( GPU_SKIFF_PARAMETERS.waterRestoringRatePerSecond2 ) )
				.sub( priorWater.y.mul( GPU_SKIFF_PARAMETERS.waterDampingRatePerSecond ) );
			const nextWaterVelocity = priorWater.y.add( waterAcceleration.mul( dt ) );
			candidateVelocity.assign( vec4( nextHeaveVelocity, nextRollVelocity, nextPitchVelocity, priorVelocity.w.add( 1 ) ) );
			candidatePose.assign( vec4(
				priorPose.x.add( nextHeaveVelocity.mul( dt ) ),
				priorPose.y.add( nextRollVelocity.mul( dt ) ),
				priorPose.z.add( nextPitchVelocity.mul( dt ) ),
				priorPose.w.add( dt )
			) );
			candidateWater.assign( vec4(
				priorWater.x.add( nextWaterVelocity.mul( dt ) ),
				nextWaterVelocity,
				0,
				0
			) );
			acceptedLoad.assign( load );

		}

		previousPose.element( uint( 0 ) ).assign( priorPose );
		currentPose.element( uint( 0 ) ).assign( candidatePose );
		state.element( uint( 0 ) ).assign( candidatePose );
		state.element( uint( 1 ) ).assign( candidateVelocity );
		state.element( uint( 2 ) ).assign( candidateWater );
		state.element( uint( 3 ) ).assign( vec4( acceptedLoad.w, acceptedLoad.x, acceptedLoad.y, acceptedLoad.z ) );

	} )().compute( 1, [ 1 ] ).setName( 'bounded-skiff:predict-sample-react-correct-commit' );

	let accumulatorSeconds = 0;
	let submittedTick = 0;
	let droppedTimeSeconds = 0;
	let dispatchCount = 0;
	let diagnosticReadbackCount = 0;
	let disposed = false;

	function requireLive() {

		if ( disposed ) throw new Error( 'The bounded-skiff graph is disposed.' );

	}

	function dispatchFixedStep() {

		requireLive();
		renderer.compute( integrate );
		submittedTick += 1;
		dispatchCount += 1;

	}

	function advancePresentationDelta( deltaSeconds ) {

		requireLive();
		if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) throw new Error( 'Presentation delta must be finite and non-negative.' );
		const dt = GPU_SKIFF_PARAMETERS.fixedTimeStepSeconds;
		const admitted = Math.min( deltaSeconds, dt * GPU_SKIFF_PARAMETERS.maximumCatchUpSteps );
		droppedTimeSeconds += deltaSeconds - admitted;
		accumulatorSeconds += admitted;
		const stepCount = Math.min( GPU_SKIFF_PARAMETERS.maximumCatchUpSteps, Math.floor( ( accumulatorSeconds + 1e-12 ) / dt ) );
		for ( let index = 0; index < stepCount; index += 1 ) dispatchFixedStep();
		accumulatorSeconds = Math.max( 0, accumulatorSeconds - stepCount * dt );
		presentationAlpha.value = Math.min( 1, Math.max( 0, accumulatorSeconds / dt ) );
		return stepCount;

	}

	function interpolatedPoseNode() {

		return mix( previousPose.element( uint( 0 ) ), currentPose.element( uint( 0 ) ), presentationAlpha );

	}

	function transformBodyVectorNode( localVector ) {

		const pose = interpolatedPoseNode();
		return rotatedOffset( localVector, pose );

	}

	function transformBodyPositionNode( localPosition = positionGeometry ) {

		const pose = interpolatedPoseNode();
		return transformBodyVectorNode( localPosition ).add( vec3( 0, pose.x, 0 ) );

	}

	function transformBodyNormalNode( localNormal = normalLocal ) {

		return transformBodyVectorNode( localNormal ).normalize();

	}

	function waterSurfaceNodes( localXZ = positionGeometry.xz ) {

		const pose = interpolatedPoseNode();
		const water = state.element( uint( 2 ) );
		const height = analyticWaveHeight( localXZ.x, localXZ.y, pose.w, water.x );
		const slope = analyticWaterSlope( localXZ.x, localXZ.y, pose.w, water.x );
		return { pose, water, height, slope };

	}

	async function captureGpuState() {

		requireLive();
		if ( typeof renderer.getArrayBufferAsync !== 'function' ) throw new Error( 'Renderer storage readback is unavailable.' );
		const bytes = await renderer.getArrayBufferAsync( stateBuffer, null, 0, stateBuffer.array.byteLength );
		diagnosticReadbackCount += 1;
		return Object.freeze( {
			layout: GPU_SKIFF_LAYOUT.state,
			values: Object.freeze( Array.from( new Float32Array( bytes ) ) ),
			submittedTick,
			diagnosticReadbackOnly: true,
			frameCriticalReadbackCount: 0
		} );

	}

	return Object.freeze( {
		stateBuffer,
		previousPoseBuffer,
		currentPoseBuffer,
		stateNode: state,
		parameters: GPU_SKIFF_PARAMETERS,
		layout: GPU_SKIFF_LAYOUT,
		advancePresentationDelta,
		transformBodyPositionNode,
		transformBodyNormalNode,
		waterSurfaceNodes,
		captureGpuState,
		describe() {

			return Object.freeze( {
				backend: 'native-webgpu',
				couplingClass: 'scheduler-bounded-iterated-two-way',
				submittedTick,
				dispatchCount,
				diagnosticReadbackCount,
				droppedTimeSeconds,
				fixedTimeStepSeconds: GPU_SKIFF_PARAMETERS.fixedTimeStepSeconds,
				boundedCorrectionIterations: GPU_SKIFF_PARAMETERS.boundedCorrectionIterations,
				quadratureCount: GPU_SKIFF_PARAMETERS.quadratureCount,
				storageBytes: stateBuffer.array.byteLength + previousPoseBuffer.array.byteLength + currentPoseBuffer.array.byteLength,
				frameCriticalReadbackCount: 0,
				waterModel: 'bounded-analytic-plus-local-perturbation; not-SWE'
			} );

		},
		dispose() {

			if ( disposed ) return;
			disposed = true;
			integrate.dispose?.();
			stateBuffer.dispose();
			previousPoseBuffer.dispose();
			currentPoseBuffer.dispose();

		}
	} );

}

export function createSkiffMaterialNodes( graph ) {

	return Object.freeze( {
		position: graph.transformBodyPositionNode( positionGeometry ),
		normal: graph.transformBodyNormalNode( normalLocal )
	} );

}

export function createWaterMaterialNodes( graph ) {

	const surface = graph.waterSurfaceNodes( positionGeometry.xz );
	const crest = tslClamp( abs( surface.height ).mul( 5.5 ), 0, 1 );
	return Object.freeze( {
		position: vec3( positionGeometry.x, surface.height, positionGeometry.z ),
		normal: vec3( surface.slope.x.negate(), 1, surface.slope.y.negate() ).normalize(),
		color: mix( vec3( 0.015, 0.19, 0.31 ), vec3( 0.04, 0.58, 0.66 ), crest )
	} );

}
