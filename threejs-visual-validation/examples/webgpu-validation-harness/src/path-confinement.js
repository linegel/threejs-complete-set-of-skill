import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function assertRelativePathText( relativePath, label ) {

	if ( typeof relativePath !== 'string' || relativePath.length === 0 ) {

		throw new Error( `${ label } must be a non-empty bundle-relative path.` );

	}

	if ( relativePath.includes( '\0' ) || isAbsolute( relativePath ) ) {

		throw new Error( `${ label } is an unconfined path; absolute and NUL-containing paths are forbidden.` );

	}

	const segments = relativePath.replaceAll( '\\', '/' ).split( '/' );
	if ( segments.some( ( segment ) => segment === '..' ) ) {

		throw new Error( `${ label } is an unconfined path; parent traversal is forbidden.` );

	}

}

function assertInside( root, candidate, label ) {

	const offset = relative( root, candidate );
	if ( offset === '..' || offset.startsWith( `..${ sep }` ) || isAbsolute( offset ) ) {

		throw new Error( `${ label } resolves outside the evidence bundle.` );

	}

}

export async function resolveConfinedPath( rootDir, relativePath, options = {} ) {

	const label = options.label ?? 'bundle path';
	assertRelativePathText( relativePath, label );

	const lexicalRoot = resolve( rootDir );
	const lexicalCandidate = resolve( lexicalRoot, relativePath );
	assertInside( lexicalRoot, lexicalCandidate, label );

	const physicalRoot = await realpath( lexicalRoot );

	if ( options.mustExist === false ) {

		const physicalParent = await realpath( dirname( lexicalCandidate ) );
		assertInside( physicalRoot, physicalParent, `${ label } parent` );
		return lexicalCandidate;

	}

	const physicalCandidate = await realpath( lexicalCandidate );
	assertInside( physicalRoot, physicalCandidate, label );
	return physicalCandidate;

}

export async function assertDistinctBundleFiles( rootDir, baselinePath, candidatePath, label = 'image comparison' ) {

	assertRelativePathText( baselinePath, `${ label}.baseline` );
	assertRelativePathText( candidatePath, `${ label}.candidate` );

	if ( baselinePath.replaceAll( '\\', '/' ) === candidatePath.replaceAll( '\\', '/' ) ) {

		throw new Error( `${ label} baseline-equals-candidate; self-comparison cannot prove visual correctness.` );

	}

	const baseline = await resolveConfinedPath( rootDir, baselinePath, { label: `${ label}.baseline` } );
	const candidate = await resolveConfinedPath( rootDir, candidatePath, { label: `${ label}.candidate` } );

	if ( baseline === candidate ) {

		throw new Error( `${ label} baseline and candidate resolve to the same file.` );

	}

	return { baseline, candidate };

}
