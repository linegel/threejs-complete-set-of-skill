import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute } from 'three/tsl';

import { buildReferenceDeformationNodes } from './reference-deformation.js';

export function createReferenceCreatureMaterial(options = {}) {
	const deformation = buildReferenceDeformationNodes(options);
	const material = new MeshStandardNodeMaterial({ color: 0xffffff, roughness: options.roughness ?? 0.72, metalness: 0 });
	material.name = `CreatureReferenceMaterial:${options.tier ?? 'hero'}`;
	material.positionNode = deformation.worldPosition;
	material.castShadowPositionNode = deformation.worldPosition;
	// The deformation map varies across the surface with the static skin
	// weights, so blending per-slot inverse-transpose normals is not the true
	// derivative of the final position. Flat geometric normals are derived from
	// that final displaced position and cannot disagree with the rendered face.
	material.flatShading = true;
	material.colorNode = attribute(options.colorAttribute ?? 'color', 'vec3');
	material.userData.referenceDeformation = deformation;
	material.userData.representation = 'canonical-reference-surface-candidate';
	material.userData.skinningMethod = deformation.skinningMethod;
	material.userData.correctionLayout = deformation.correctionLayout;
	material.userData.fieldEvaluation = deformation.correctionLayout === 'none'
		? 'none in canonical reference shading'
		: 'two bounded vertex-stage field trials on static feathered correction weights; none in fragment shading';
	material.userData.normalSource = 'fragment derivative of final deformed position';
	material.userData.shadowCasterParity = {
		sharedPositionNode: deformation.worldPosition,
		positionNode: material.positionNode,
		castShadowPositionNode: material.castShadowPositionNode,
		receivedShadowPositionNode: null,
		receivedShadowDerivedFromPositionWorld: true,
	};
	return material;
}
