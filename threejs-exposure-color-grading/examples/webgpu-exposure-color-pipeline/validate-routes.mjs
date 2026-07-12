import { readFile } from 'node:fs/promises';

import { EXPOSURE_QUALITY_TIERS, resolveExposureTier } from './constants.js';
import { EXPOSURE_MECHANISM_ROUTES, resolveExposureMechanismRoute } from './main.js';

function assert( value, message ) { if ( ! value ) throw new Error( message ); }
function rejectMessage( callback ) { try { callback(); } catch ( error ) { return error.message; } throw new Error( 'Expected route rejection.' ); }

const lutForTier = { 'full-histogram': 'creative', 'balanced-log-reduction': 'identity', 'minimum-fixed-shot': 'identity' };
const scenarioForMechanism = { adaptation: 'bright-window', 'metering-masks': 'masked-ui', 'tone-mapping': 'swatches', 'lut-grading': 'swatches' };
const toneForMechanism = { 'tone-mapping': 'AgX' };
const checked = [];

async function lockedRoute( kind, id ) {

	const path = new URL( `./${ kind }/${ id }/index.html`, import.meta.url );
	const html = await readFile( path, 'utf8' );
	const match = html.match( /data-lab-route='([^']+)'/ );
	assert( match, `${ kind}/${ id} lacks data-lab-route.` );
	assert( html.includes( 'src="../../route-wrapper.js"' ), `${ kind}/${ id } forks the canonical browser app.` );
	assert( html.includes( '../../../../../node_modules/three/build/three.webgpu.js' ), `${ kind}/${ id } lacks the local r185 import map.` );
	assert( ! /https?:\/\//.test( html ), `${ kind}/${ id } contains a CDN/network import.` );
	checked.push( `${ kind }/${ id }/` );
	return JSON.parse( match[ 1 ] );

}

for ( const [ id, route ] of Object.entries( EXPOSURE_MECHANISM_ROUTES ) ) {

	const locked = await lockedRoute( 'mechanism', id );
	assert( locked.mechanism === id, `Mechanism ${ id } wrapper locks the wrong id.` );
	assert( locked.tier === route.tier && locked.mode === route.mode, `Mechanism ${ id } wrapper drifted from the route table.` );
	assert( locked.scenario === ( scenarioForMechanism[ id ] ?? 'emitter' ), `Mechanism ${ id } scenario is not deterministic.` );
	assert( locked.toneMappingVariant === ( toneForMechanism[ id ] ?? 'Neutral' ), `Mechanism ${ id } tone map is not locked.` );
	assert( locked.lutVariant === lutForTier[ route.tier ], `Mechanism ${ id } LUT is inconsistent with its locked tier.` );

}

for ( const id of Object.keys( EXPOSURE_QUALITY_TIERS ) ) {

	const locked = await lockedRoute( 'tier', id );
	assert( locked.mechanism === null && locked.tier === id && locked.mode === 'final', `Tier ${ id } wrapper is not a fixed final route.` );
	assert( locked.lutVariant === lutForTier[ id ], `Tier ${ id } LUT is inconsistent.` );

}

const manifest = JSON.parse( await readFile( new URL( './lab.manifest.json', import.meta.url ), 'utf8' ) );
for ( const mechanism of manifest.mechanisms ) {

	assert( mechanism.route === `mechanism/${ mechanism.id }/`, `Manifest route drift for ${ mechanism.id }.` );
	const expected = resolveExposureMechanismRoute( mechanism.id );
	assert( mechanism.startup.tier === expected.tier && mechanism.startup.mode === expected.mode && mechanism.startup.scenario === expected.scenario, `Manifest startup drift for ${ mechanism.id }.` );

}
const browserSource = await readFile( new URL( './browser-app.js', import.meta.url ), 'utf8' );
assert( browserSource.includes( 'Locked exposure route rejects' ), 'Browser app does not reject locked-route overrides.' );
assert( browserSource.includes( 'Object.freeze( { ...locked } )' ), 'Locked exposure startup is mutable.' );
assert( browserSource.includes( 'window.labController = controller' ) && browserSource.includes( 'routeSelection:' ), 'Published routes cannot acknowledge their locked startup through getMetrics().' );
assert( browserSource.includes( "const LAB_ID = 'webgpu-exposure-color-pipeline'" ), 'Published exposure controller lacks a canonical lab identity.' );
assert( browserSource.includes( 'get labId() { return LAB_ID; }' ) && browserSource.includes( 'labId: LAB_ID' ), 'Exposure controller and metrics identity can drift.' );
const captureSource = await readFile( new URL( './capture.mjs', import.meta.url ), 'utf8' );
assert( captureSource.includes( "import { createServer } from 'vite'" ) && captureSource.includes( 'if ( ! url )' ), 'Root capture lacks a deterministic self-serving URL.' );
assert( captureSource.includes( "--profile" ) && captureSource.includes( "'correctness', 'performance'" ), 'Root capture does not enforce the standard profile contract.' );
const unknownMechanism = rejectMessage( () => resolveExposureMechanismRoute( '__unknown__' ) );
const unknownTier = rejectMessage( () => resolveExposureTier( '__unknown__' ) );
const packageJson = JSON.parse( await readFile( new URL( './package.json', import.meta.url ), 'utf8' ) );
assert( packageJson.scripts[ 'validate:full' ].includes( 'validate:artifacts' ), 'Exposure full validation does not require browser artifacts.' );
assert( ! packageJson.scripts[ 'validate:quick' ].includes( 'validate:artifacts' ), 'Exposure quick validation must remain browser-free.' );

console.log( JSON.stringify( { pass: true, checked, unknownMechanism, unknownTier, fullRequiresArtifacts: true, status: 'incomplete' }, null, 2 ) );
