import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const allowedDowngradeAxes = new Set( [
	'webgpu-budget',
	'precomputed-static',
	'cpu-offline-bake',
	'feature-removal',
	'legacy-branch',
	'labelled-proxy'
] );

async function readJson( path ) {

	return JSON.parse( await readFile( path, 'utf8' ) );

}

export function buildTierPlan( capabilities, ownerContract ) {

	if ( capabilities.request?.explicitFallbackWhenWebGPUUnavailable !== true ) {

		throw new Error( 'Tier planner requires an explicit request to apply fallback when WebGPU is unavailable.' );

	}

	if ( capabilities.request.canonicalOwner !== ownerContract.owner ) {

		throw new Error( 'Capability manifest canonical owner does not match owner contract.' );

	}

	return {
		canonicalOwner: ownerContract.owner,
		target: capabilities.request.target,
		webgpuAvailable: capabilities.backend.webgpuAvailable,
		missing: capabilities.backend.missing,
		rows: ownerContract.features.map( ( feature ) => ( {
			tier: feature.id,
			target: capabilities.request.target,
			axis: feature.downgradeAxis,
			kept: feature.kept,
			lost: feature.lost,
			implementation: feature.implementation,
			validation: feature.validation,
			frameBudgetMs: feature.frameBudgetMs,
			passCount: feature.passCount,
			memoryCapMB: feature.memoryCapMB,
			resolution: feature.resolution,
			updateCadence: feature.updateCadence,
			screenshots: feature.screenshots,
			metricThresholds: feature.metricThresholds
		} ) )
	};

}

function formatList( value ) {

	return Array.isArray( value ) ? value.join( ', ' ) : String( value );

}

export function formatMarkdownTable( plan ) {

	const lines = [
		'| Tier | Target | Axis | Kept | Lost | Implementation | Validation |',
		'| --- | --- | --- | --- | --- | --- | --- |'
	];

	for ( const row of plan.rows ) {

		lines.push( `| ${ row.tier } | ${ row.target } | ${ row.axis } | ${ row.kept } | ${ row.lost } | ${ row.implementation } | ${ row.validation } |` );

	}

	return `${ lines.join( '\n' ) }\n`;

}

export function validateTierPlan( plan ) {

	if ( plan.webgpuAvailable === true ) {

		throw new Error( 'Fallback tier plan is invalid while WebGPU is available.' );

	}

	if ( plan.rows.length === 0 ) {

		throw new Error( 'Tier plan must contain at least one downgraded feature.' );

	}

	for ( const row of plan.rows ) {

		if ( allowedDowngradeAxes.has( row.axis ) === false ) {

			throw new Error( `${ row.tier } has unknown downgrade axis ${ row.axis }.` );

		}

		for ( const key of [ 'kept', 'lost', 'implementation', 'validation', 'resolution', 'updateCadence' ] ) {

			if ( typeof row[ key ] !== 'string' || row[ key ].length === 0 ) {

				throw new Error( `${ row.tier } missing ${ key } text.` );

			}

		}

		if ( Number.isFinite( row.frameBudgetMs ) === false || row.frameBudgetMs <= 0 ) {

			throw new Error( `${ row.tier } needs a positive frame budget.` );

		}

		if ( Number.isInteger( row.passCount ) === false || row.passCount < 0 ) {

			throw new Error( `${ row.tier } needs a non-negative pass count.` );

		}

		if ( Number.isFinite( row.memoryCapMB ) === false || row.memoryCapMB <= 0 ) {

			throw new Error( `${ row.tier } needs a positive memory cap.` );

		}

		if ( Array.isArray( row.screenshots ) === false || row.screenshots.length === 0 ) {

			throw new Error( `${ row.tier } needs screenshot names.` );

		}

		if ( Array.isArray( row.metricThresholds ) === false || row.metricThresholds.length === 0 ) {

			throw new Error( `${ row.tier } needs metric thresholds.` );

		}

	}

	return true;

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const here = dirname( fileURLToPath( import.meta.url ) );
	const capabilitiesPath = resolve( process.argv[ 2 ] ?? `${ here }/sample-capabilities.json` );
	const contractPath = resolve( process.argv[ 3 ] ?? `${ here }/sample-owner-contract.json` );
	const plan = buildTierPlan( await readJson( capabilitiesPath ), await readJson( contractPath ) );
	validateTierPlan( plan );
	console.log( formatMarkdownTable( plan ) );
	console.log( JSON.stringify( {
		canonicalOwner: plan.canonicalOwner,
		missing: plan.missing,
		rowCount: plan.rows.length,
		axes: plan.rows.map( ( row ) => row.axis ),
		screenshots: plan.rows.map( ( row ) => formatList( row.screenshots ) )
	}, null, 2 ) );

}
