import { readFile } from 'node:fs/promises';

import { IMAGE_PIPELINE_MECHANISM_ROUTES, IMAGE_PIPELINE_TIERS, resolveImagePipelineRoute, resolveImagePipelineTier } from './canonical-main.js';

function assert( value, message ) { if ( ! value ) throw new Error( message ); }
function rejectMessage( callback ) { try { callback(); } catch ( error ) { return error.message; } throw new Error( 'Expected route rejection.' ); }

const checked = [];
async function lockedRoute( kind, id ) {

	const html = await readFile( new URL( `./${ kind }/${ id }/index.html`, import.meta.url ), 'utf8' );
	const match = html.match( /data-lab-route='([^']+)'/ );
	assert( match, `${ kind}/${ id } lacks data-lab-route.` );
	assert( html.includes( 'src="../../route-wrapper.js"' ), `${ kind}/${ id } forks the canonical browser app.` );
	assert( html.includes( '../../../../../node_modules/three/build/three.webgpu.js' ), `${ kind}/${ id } lacks the local r185 import map.` );
	assert( ! /https?:\/\//.test( html ), `${ kind}/${ id } contains a CDN/network import.` );
	checked.push( `${ kind }/${ id }/` );
	return JSON.parse( match[ 1 ] );

}

for ( const [ id, route ] of Object.entries( IMAGE_PIPELINE_MECHANISM_ROUTES ) ) {

	const locked = await lockedRoute( 'mechanism', id );
	assert( locked.mechanism === id && locked.tierId === route.tier && locked.mode === route.mode, `Mechanism ${ id } wrapper drifted from the route table.` );

}
for ( const id of Object.keys( IMAGE_PIPELINE_TIERS ) ) {

	const locked = await lockedRoute( 'tier', id );
	assert( locked.mechanism === null && locked.tierId === id && locked.mode === 'final', `Tier ${ id } wrapper is not a fixed final route.` );

}

const manifest = JSON.parse( await readFile( new URL( './lab.manifest.json', import.meta.url ), 'utf8' ) );
for ( const mechanism of manifest.mechanisms ) {

	assert( mechanism.route === `mechanism/${ mechanism.id }/`, `Manifest route drift for ${ mechanism.id }.` );
	const expected = resolveImagePipelineRoute( mechanism.id );
	assert( mechanism.startup.tier === expected.tier && mechanism.startup.mode === expected.mode, `Manifest startup drift for ${ mechanism.id }.` );

}
const browserSource = await readFile( new URL( './canonical-browser-app.js', import.meta.url ), 'utf8' );
assert( browserSource.includes( 'Locked image-pipeline route rejects' ), 'Browser app does not reject locked-route overrides.' );
assert( browserSource.includes( 'Object.freeze( { ...locked } )' ), 'Locked image-pipeline startup is mutable.' );
assert( browserSource.includes( 'window.labController = controller' ) && browserSource.includes( 'routeSelection:' ), 'Published routes cannot acknowledge their locked startup through getMetrics().' );
const captureSource = await readFile( new URL( './canonical-capture.mjs', import.meta.url ), 'utf8' );
assert( captureSource.includes( "import { createServer } from 'vite'" ) && captureSource.includes( 'if ( ! url )' ), 'Root capture lacks a deterministic self-serving URL.' );
assert( captureSource.includes( "--profile" ) && captureSource.includes( "'correctness', 'performance'" ), 'Root capture does not enforce the standard profile contract.' );
const unknownMechanism = rejectMessage( () => resolveImagePipelineRoute( '__unknown__' ) );
const unknownTier = rejectMessage( () => resolveImagePipelineTier( '__unknown__' ) );
const packageJson = JSON.parse( await readFile( new URL( './package.json', import.meta.url ), 'utf8' ) );
const temporalPackageJson = JSON.parse( await readFile( new URL( '../webgpu-temporal-history/package.json', import.meta.url ), 'utf8' ) );
for ( const [ label, value ] of [ [ 'image pipeline', packageJson ], [ 'temporal history', temporalPackageJson ] ] ) {

	assert( value.scripts[ 'validate:full' ].includes( 'validate:artifacts' ), `${ label } full validation does not require browser artifacts.` );
	assert( ! value.scripts[ 'validate:quick' ].includes( 'validate:artifacts' ), `${ label } quick validation must remain browser-free.` );

}

console.log( JSON.stringify( { pass: true, checked, unknownMechanism, unknownTier, fullRequiresArtifacts: true, status: 'incomplete' }, null, 2 ) );
