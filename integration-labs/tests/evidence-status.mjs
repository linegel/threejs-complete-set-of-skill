const operation = process.argv[ 2 ] ?? 'evidence';
console.error( JSON.stringify( {
	status: 'INSUFFICIENT_EVIDENCE',
	operation,
	reason: 'Integration flagships have missing host adapters and no permitted browser/WebGPU capture in this run.'
}, null, 2 ) );
process.exitCode = 2;
