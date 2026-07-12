import { COASTAL_CRAB_SPEC, validateCoastalCrabSpec } from './crab-spec.js';

const SIDES = Object.freeze( [ 'L', 'R' ] );
const LEG_ORDINALS = Object.freeze( [ 1, 2, 3, 4 ] );
const LEG_SEGMENTS = Object.freeze( [ 'coxa', 'merus', 'dactyl' ] );
const CLAW_SEGMENTS = Object.freeze( [ 'coxa', 'arm', 'wrist', 'palm', 'fixed-finger', 'hinged-finger' ] );

function slot( slotIndex, id, family, zone, parentId, metadata = {} ) {

	return Object.freeze( { slotIndex, id, family, zone, parentId, ...metadata } );

}

export function createCoastalCrabRig( profileId = 'ochre-rock', spec = COASTAL_CRAB_SPEC ) {

	validateCoastalCrabSpec( spec );
	const profile = spec.profiles.find( ( candidate ) => candidate.id === profileId );
	if ( ! profile ) throw new Error( `unknown crab morphology profile '${ profileId }'` );
	const slots = [];
	slots.push( slot( slots.length, 'body.carapace', 'body', 'shell', null, { geometry: 'closed-superellipsoid-four-lobe' } ) );
	slots.push( slot( slots.length, 'body.membrane', 'body', 'membrane', 'body.carapace', { geometry: 'closed-underside-membrane' } ) );
	for ( const side of SIDES ) slots.push( slot( slots.length, `eye.${ side }.stalk`, 'eye', 'eye', 'body.carapace', { geometry: 'closed-stalk-plus-eye-sphere' } ) );
	for ( const side of SIDES ) {

		for ( const ordinal of LEG_ORDINALS ) {

			let parentId = 'body.carapace';
			for ( const segment of LEG_SEGMENTS ) {

				const id = `leg.${ side }${ ordinal }.${ segment }`;
				slots.push( slot( slots.length, id, 'walking-leg', segment === 'dactyl' ? 'dactyl' : 'shell', parentId, { legId: `${ side }${ ordinal }`, segment, geometry: 'closed-capped-tapered-segment' } ) );
				parentId = id;

			}

		}

	}
	for ( const side of SIDES ) {

		let parentId = 'body.carapace';
		for ( const segment of CLAW_SEGMENTS ) {

			const id = `claw.${ side}.${ segment }`;
			const segmentParentId = segment.includes( 'finger' ) ? `claw.${ side }.palm` : parentId;
			slots.push( slot( slots.length, id, 'claw', segment.includes( 'finger' ) ? 'dactyl' : 'shell', segmentParentId, {
				segment,
				geometry: segment.includes( 'finger' ) ? 'closed-swept-finger' : segment === 'palm' ? 'closed-claw-palm' : 'closed-capped-tapered-segment',
				...( segment === 'hinged-finger' ? { hingeAxis: [ ...spec.claws.hingeAxis ], restAngleDegrees: spec.claws.restAngleDegrees, threatAngleDegrees: spec.claws.threatAngleDegrees } : {} )
			} ) );
			if ( ! segment.includes( 'finger' ) ) parentId = id;

		}

	}
	if ( slots.length !== spec.capacity.usedSlots ) throw new Error( `crab rig compiled ${ slots.length } slots instead of ${ spec.capacity.usedSlots }` );
	if ( new Set( slots.map( ( entry ) => entry.id ) ).size !== slots.length ) throw new Error( 'crab rig contains duplicate slot IDs' );
	if ( slots.some( ( entry, index ) => entry.slotIndex !== index ) ) throw new Error( 'crab rig slot indices are not dense and stable' );
	return Object.freeze( {
		schemaVersion: 'coastal-crab-rig-v1',
		profile: Object.freeze( { ...profile } ),
		slots: Object.freeze( slots ),
		usedSlots: slots.length,
		capacity: spec.capacity.singleCrabSlots,
		packedCapacity: spec.capacity.packedProfileSlots,
		materialZones: Object.freeze( [ 'shell', 'membrane', 'dactyl', 'eye' ] )
	} );

}

export function crabRigIdentity( rig ) {

	return rig.slots.map( ( entry ) => `${ entry.slotIndex }:${ entry.id }:${ entry.parentId ?? '-' }:${ entry.zone }` ).join( '|' );

}
