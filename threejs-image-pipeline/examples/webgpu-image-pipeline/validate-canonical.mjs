import { readFile } from 'node:fs/promises';

import {
	IMAGE_PIPELINE_MECHANISM_ROUTES,
	IMAGE_PIPELINE_TIERS,
	createCanonicalImagePipeline,
	resolveImagePipelineRoute
} from './canonical-main.js';
import { createExposureColorStage } from '../../../threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline/stage.js';
import { createImagePipelineStage } from './stage.js';

function assert( value, message ) { if ( ! value ) throw new Error( message ); }
function rejects( callback, token ) {

	try { callback(); } catch ( error ) { assert( error.message.includes( token ), `Unexpected rejection: ${ error.message }` ); return error.message; }
	throw new Error( `Expected rejection containing "${ token }".` );

}

const source = await readFile( new URL( './canonical-main.js', import.meta.url ), 'utf8' );
const browser = await readFile( new URL( './canonical-browser-app.js', import.meta.url ), 'utf8' );
const stageSource = await readFile( new URL( './stage.js', import.meta.url ), 'utf8' );
const manifest = JSON.parse( await readFile( new URL( './lab.manifest.json', import.meta.url ), 'utf8' ) );
assert( typeof createCanonicalImagePipeline === 'function', 'Canonical owner factory is missing.' );
assert( typeof createExposureColorStage === 'function', 'Host-safe exposure stage factory is missing.' );
assert( typeof createImagePipelineStage === 'function', 'Host-safe image-pipeline stage factory is missing.' );
assert( Object.keys( IMAGE_PIPELINE_TIERS ).join( ',' ) === 'full,reduced,debug', 'Locked image-pipeline tiers drifted.' );
assert( Object.keys( IMAGE_PIPELINE_MECHANISM_ROUTES ).length === 6, 'Mechanism route count drifted.' );
for ( const id of Object.keys( IMAGE_PIPELINE_MECHANISM_ROUTES ) ) assert( resolveImagePipelineRoute( id ).tier, `Route ${ id } lacks a tier.` );
const unknownRoute = rejects( () => resolveImagePipelineRoute( 'unknown' ), 'Unknown image-pipeline mechanism route' );
for ( const token of [
	'await renderer.init()',
	'isWebGPUBackend !== true',
	'scenePass.setMRT',
	'getTextureNode( \'depth\' )',
	'getViewZNode( \'depth\' )',
	'getLinearDepthNode( \'depth\' )',
	'normalView',
	'emissive',
	'velocity',
	'traa(',
	'createExposureColorStage',
	'outputColorTransform = false',
	'renderPipeline.needsUpdate = true',
	'buildDynamicGraph( cause )',
	'function setSeed( seed )',
	'physicalResidencyVerdict: \'INSUFFICIENT_EVIDENCE\''
] ) assert( source.includes( token ), `Canonical source is missing ${ token }.` );
assert( ! source.includes( 'process.' ), 'Canonical browser implementation dereferences Node-only process.' );
assert( ! source.includes( 'hdr.rgb.mul( 0.78 )' ) && ! source.includes( 'hdr.rgb.mul( 0.22 )' ), 'Canonical final still darkens direct/emissive with an invented AO split.' );
assert( source.includes( "application: 'diagnostic-only'" ) && source.includes( 'finalReachable: false' ), 'AO diagnostic boundary is not explicit.' );
assert( source.indexOf( 'const stableInput = rtt( hdr' ) < source.indexOf( 'const bloomNode =' ), 'Stable pre-bloom materialization must preserve unmodified scene HDR.' );
assert( source.indexOf( 'temporalNode = traa' ) < source.indexOf( 'const hdrComposite =' ), 'Temporal resolve must precede bloom composition.' );
assert( source.includes( 'temporalNode._historyRenderTarget.texture' ), 'Temporal history diagnostic does not reach the actual TRAANode history target.' );
assert( source.includes( 'bypass( compress( temporalHistoryTexture ), temporalTexture )' ), 'Temporal history route does not execute TRAANode before sampling history.' );
assert( source.includes( 'exposure: bypass(' ) && source.includes( '), preBloom )' ), 'Exposure diagnostic does not execute its meter-source graph.' );
assert( source.includes( "'temporal-current'" ) && source.includes( "'temporal-history'" ) && source.includes( "'temporal-resolved'" ), 'Temporal current/history/resolved diagnostics are incomplete.' );
assert( source.includes( "resetStrategy: 'dispose and rebuild TRAANode; first render seeds fresh history'" ), 'Temporal reset ownership is not executable.' );
assert( source.includes( "'view-z':" ) && source.includes( 'viewZDiagnosticEncoding' ), 'View-Z reconstruction diagnostic is missing.' );
assert( browser.includes( 'bytesPerRow' ) && browser.includes( 'Math.ceil( compact / 256 ) * 256' ), 'Browser capture lacks aligned WebGPU row-stride handling.' );
assert( browser.includes( 'readRenderTargetPixelsAsync' ), 'Canonical capture must use render-target readback.' );
assert( ! stageSource.includes( 'new WebGPURenderer' ) && ! stageSource.includes( 'new RenderPipeline' ), 'Host adapter creates a private renderer or RenderPipeline owner.' );
assert( stageSource.includes( 'meterSourceTextureNode: preGradeTexture' ) && stageSource.includes( 'bloomTextureNode.rgb' ), 'Host adapter does not meter composed pre-grade HDR.' );
assert( stageSource.includes( 'temporalNode._historyRenderTarget.texture' ) && stageSource.includes( 'temporalConfidence' ), 'Host adapter lacks temporal history/confidence diagnostics.' );
assert( manifest.status === 'incomplete', 'Manifest cannot be accepted before native-WebGPU evidence.' );
assert(
	manifest.runtimeProof.every( ( proof ) => proof.evidence === 'INSUFFICIENT_EVIDENCE' && proof.status === 'incomplete' ),
	'Unexecuted runtime proof was promoted.'
);

console.log( JSON.stringify( {
	pass: true,
	tiers: Object.keys( IMAGE_PIPELINE_TIERS ),
	mechanisms: Object.keys( IMAGE_PIPELINE_MECHANISM_ROUTES ),
	mutations: { unknownRoute },
	runtimeVerdict: 'INSUFFICIENT_EVIDENCE'
}, null, 2 ) );
