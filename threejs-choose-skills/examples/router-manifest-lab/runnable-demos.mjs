export const RUNNABLE_DEMOS_BY_SKILL = Object.freeze( {
	'threejs-ambient-contact-shading': { id: 'webgpu-node-gtao', title: 'GTAO lab', href: '/demos/webgpu-node-gtao/' },
	'threejs-black-holes-and-space-effects': { id: 'tsl-curved-ray', title: 'Curved-ray black hole', href: '/demos/tsl-curved-ray/' },
	'threejs-bloom': { id: 'node-selective-bloom', title: 'Selective bloom lab', href: '/demos/node-selective-bloom/' },
	'threejs-camera-controls-and-rigs': { id: 'webgpu-camera-rig', title: 'Camera rig lab', href: '/demos/webgpu-camera-rig/' },
	'threejs-choose-skills': { id: 'router-manifest-lab', title: 'Skill router lab', href: '/demos/router-manifest-lab/' },
	'threejs-compatibility-fallbacks': { id: 'browser-fallback-harness', title: 'Browser fallback harness', href: '/demos/browser-fallback-harness/' },
	'threejs-debugging': { id: 'debugging-contract-lab', title: 'Debugging contract lab', href: '/demos/debugging-contract-lab/' },
	'threejs-dynamic-surface-effects': { id: 'webgpu-touch-history-frost', title: 'Touch-history frost lab', href: '/demos/webgpu-touch-history-frost/' },
	'threejs-exposure-color-grading': { id: 'webgpu-exposure-color-pipeline', title: 'Exposure and grading lab', href: '/demos/webgpu-exposure-color-pipeline/' },
	'threejs-image-pipeline': { id: 'webgpu-image-pipeline', title: 'Image pipeline lab', href: '/demos/webgpu-image-pipeline/' },
	'threejs-object-sculptor': { id: 'webgpu-tower-ship-sculptor', title: 'Tower and ship sculptor', href: '/demos/webgpu-tower-ship-sculptor/' },
	'threejs-particles-trails-and-effects': { id: 'webgpu-pooled-effects', title: 'Pooled effects lab', href: '/demos/webgpu-pooled-effects/' },
	'threejs-procedural-buildings-and-cities': { id: 'webgpu-material-slot-compiler', title: 'Material-slot city compiler', href: '/demos/webgpu-material-slot-compiler/' },
	'threejs-procedural-creatures': { id: 'webgpu-procedural-creature-lab', title: 'Procedural creature lab', href: '/demos/webgpu-procedural-creature-lab/' },
	'threejs-procedural-fields': { id: 'webgpu-field-bake', title: 'Procedural field bake', href: '/demos/webgpu-field-bake/' },
	'threejs-procedural-geometry': { id: 'semantic-mesh-writer', title: 'Semantic mesh writer', href: '/demos/semantic-mesh-writer/' },
	'threejs-procedural-materials': { id: 'tsl-procedural-pbr', title: 'Procedural PBR lab', href: '/demos/tsl-procedural-pbr/' },
	'threejs-procedural-motion-systems': { id: 'webgpu-procedural-timelines', title: 'Procedural timelines lab', href: '/demos/webgpu-procedural-timelines/' },
	'threejs-procedural-planets': { id: 'webgpu-quadtree-planet', title: 'Quadtree planet lab', href: '/demos/webgpu-quadtree-planet/' },
	'threejs-procedural-vegetation': { id: 'webgpu-dense-grass', title: 'Dense grass lab', href: '/demos/webgpu-dense-grass/' },
	'threejs-rain-snow-and-wet-surfaces': { id: 'webgpu-rain-snow-and-wet-surfaces', title: 'Rain, snow, and wet surfaces', href: '/demos/webgpu-rain-snow-and-wet-surfaces/' },
	'threejs-scalable-real-time-shadows': { id: 'webgpu-cached-clipmap-shadow', title: 'Cached clipmap shadow lab', href: '/demos/webgpu-cached-clipmap-shadow/' },
	'threejs-sky-atmosphere-and-haze': { id: 'webgpu-lut-atmosphere', title: 'LUT atmosphere lab', href: '/demos/webgpu-lut-atmosphere/' },
	'threejs-spectral-ocean': { id: 'webgpu-fft-ocean', title: 'FFT ocean lab', href: '/demos/webgpu-fft-ocean/' },
	'threejs-visual-validation': { id: 'webgpu-validation-harness', title: 'Visual validation harness', href: '/demos/webgpu-validation-harness/' },
	'threejs-volumetric-clouds': { id: 'webgpu-weather-volume-clouds', title: 'Volumetric cloud lab', href: '/demos/webgpu-weather-volume-clouds/' },
	'threejs-water-optics': { id: 'webgpu-bounded-water', title: 'Bounded water lab', href: '/demos/webgpu-bounded-water/' }
} );

export function runnableDemosForFixture( fixture ) {

	const skillIds = [ fixture.route.primaryOwner, ...fixture.route.selectedSkills ];
	const missingSkills = [ ...new Set( skillIds ) ].filter( ( skillId ) => ! RUNNABLE_DEMOS_BY_SKILL[ skillId ] );
	if ( missingSkills.length > 0 ) throw new RangeError( `No runnable demo is registered for: ${ missingSkills.join( ', ' ) }` );

	const demos = [];
	const seen = new Set();
	for ( const skillId of skillIds ) {

		const demo = RUNNABLE_DEMOS_BY_SKILL[ skillId ];
		if ( demo.id === 'router-manifest-lab' || seen.has( demo.id ) ) continue;
		seen.add( demo.id );
		demos.push( { ...demo, skillId } );

	}

	if ( demos.length === 0 ) throw new RangeError( `Scenario ${ fixture.id } has no external runnable demo.` );
	return { primary: demos[ 0 ], supporting: demos.slice( 1 ) };

}
