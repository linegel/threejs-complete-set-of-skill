import { IntegrationLabController } from './browser-controller.mjs';

const contractPath = document.querySelector( 'meta[name="integration-contract"]' )?.content;
const lockedTier = document.querySelector( 'meta[name="locked-tier"]' )?.content ?? null;
if ( ! contractPath ) throw new Error( 'Integration page is missing its contract path.' );

const contractUrl = new URL( contractPath, document.baseURI );
const response = await fetch( contractUrl );
if ( ! response.ok ) throw new Error( `Failed to load integration contract: ${ response.status }` );
const contract = await response.json();
const controller = new IntegrationLabController( contract, { lockedTier } );
window.labController = controller;
await controller.ready();
