import { fileURLToPath } from 'node:url';

import { startImmutablePhysicalServer } from './immutable-physical-server.js';

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const result = await startImmutablePhysicalServer();
	process.stdout.write( `${ JSON.stringify( {
		automationSurface: 'codex-in-app-browser',
		url: `http://${ result.host }:${ result.port }/src/in-app-evidence.html`,
		buildDirectory: result.immutableBuild.directory,
		servedByteLedger: result.ledgerPath,
		publishable: false,
		note: 'Open the URL only in Codex in-app Browser; the server never launches a browser.'
	}, null, 2 ) }\n` );

}
