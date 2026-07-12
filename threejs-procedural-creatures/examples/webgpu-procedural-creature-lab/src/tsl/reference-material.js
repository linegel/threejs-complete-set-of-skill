import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute } from 'three/tsl';

import { buildReferenceDeformationNodes } from './reference-deformation.js';

export function createReferenceCreatureMaterial(options = {}) {
	const deformation = buildReferenceDeformationNodes(options);
	const material = new MeshStandardNodeMaterial({ color: 0xffffff, roughness: options.roughness ?? 0.72, metalness: 0 });
	material.name = `CreatureReferenceMaterial:${options.tier ?? 'hero'}`;
	material.positionNode = deformation.worldPosition;
	material.castShadowPositionNode = deformation.worldPosition;
	material.normalNode = deformation.worldNormal;
	material.colorNode = attribute(options.colorAttribute ?? 'color', 'vec3');
	material.userData.referenceDeformation = deformation;
	material.userData.representation = 'canonical-reference-surface-candidate';
	material.userData.fieldEvaluation = 'none in canonical fragment shading';
	material.userData.shadowCasterParity = {
		sharedPositionNode: deformation.worldPosition,
		positionNode: material.positionNode,
		castShadowPositionNode: material.castShadowPositionNode,
		receivedShadowPositionNode: null,
		receivedShadowDerivedFromPositionWorld: true,
	};
	return material;
}
