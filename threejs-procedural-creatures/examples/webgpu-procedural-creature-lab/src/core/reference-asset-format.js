export const REFERENCE_ASSET_SCHEMA = 'creature-reference-asset-v1';

const TYPE_INFO = Object.freeze({
	Float32Array: { bytes: 4, constructor: Float32Array },
	Uint32Array: { bytes: 4, constructor: Uint32Array },
	Uint16Array: { bytes: 2, constructor: Uint16Array },
	Uint8Array: { bytes: 1, constructor: Uint8Array },
});

function align16(value) {
	return Math.ceil(value / 16) * 16;
}

function arrayType(array) {
	const name = array?.constructor?.name;
	if (!TYPE_INFO[name]) throw new Error(`unsupported reference asset array type '${name}'`);
	return name;
}

function digestBytes(bytes) {
	let h1 = 0x811c9dc5;
	let h2 = 0x9e3779b9;
	let h3 = 0x85ebca6b;
	let h4 = 0xc2b2ae35;
	for (const byte of bytes) {
		h1 = Math.imul(h1 ^ byte, 0x01000193);
		h2 = Math.imul(h2 ^ byte, 0x27d4eb2d);
		h3 = Math.imul(h3 ^ byte, 0x165667b1);
		h4 = Math.imul(h4 ^ byte, 0x9e3779b1);
	}
	return [h1, h2, h3, h4].map((lane) => (lane >>> 0).toString(16).padStart(8, '0')).join('');
}

export function packReferenceAsset(surface, extraArrays = {}) {
	if (!surface?.identity || !(surface.positions instanceof Float32Array) || !(surface.indices instanceof Uint32Array)) {
		throw new Error('packReferenceAsset requires an extracted reference surface');
	}
	const arrays = {
		positions: surface.positions,
		normals: surface.normals,
		indices: surface.indices,
		...extraArrays,
	};
	const descriptors = {};
	let byteLength = 0;
	for (const [name, array] of Object.entries(arrays)) {
		const type = arrayType(array);
		byteLength = align16(byteLength);
		descriptors[name] = {
			type,
			byteOffset: byteLength,
			length: array.length,
			byteLength: array.byteLength,
		};
		byteLength += array.byteLength;
	}
	byteLength = align16(byteLength);
	const binary = new Uint8Array(byteLength);
	for (const [name, array] of Object.entries(arrays)) {
		binary.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), descriptors[name].byteOffset);
	}
	const manifest = {
		schemaVersion: REFERENCE_ASSET_SCHEMA,
		identity: surface.identity,
		tier: surface.tier,
		representation: surface.representation,
		extraction: surface.extraction,
		componentPolicy: surface.componentPolicy,
		certification: surface.certification,
		arrays: descriptors,
		binary: {
			byteLength,
			alignment: 16,
			contentDigest128: digestBytes(binary),
			sha256: null,
			sha256Status: 'pending-node-asset-writer',
		},
	};
	return { manifest, binary };
}

export function unpackReferenceAsset(manifest, binaryInput) {
	if (manifest?.schemaVersion !== REFERENCE_ASSET_SCHEMA) throw new Error('reference asset schema mismatch');
	const binary = binaryInput instanceof Uint8Array ? binaryInput : new Uint8Array(binaryInput);
	if (binary.byteLength !== manifest.binary?.byteLength) throw new Error('reference asset byte length mismatch');
	if (digestBytes(binary) !== manifest.binary?.contentDigest128) throw new Error('reference asset content digest mismatch');
	const arrays = {};
	for (const [name, descriptor] of Object.entries(manifest.arrays ?? {})) {
		const info = TYPE_INFO[descriptor.type];
		if (!info) throw new Error(`reference asset array '${name}' has unsupported type '${descriptor.type}'`);
		if (!Number.isInteger(descriptor.byteOffset) || descriptor.byteOffset % 16 !== 0) throw new Error(`reference asset array '${name}' is not 16-byte aligned`);
		if (!Number.isInteger(descriptor.length) || descriptor.length < 0) throw new Error(`reference asset array '${name}' length is invalid`);
		const requiredBytes = descriptor.length * info.bytes;
		if (requiredBytes !== descriptor.byteLength || descriptor.byteOffset + requiredBytes > binary.byteLength) {
			throw new Error(`reference asset array '${name}' range is invalid`);
		}
		const copied = binary.slice(descriptor.byteOffset, descriptor.byteOffset + requiredBytes);
		arrays[name] = new info.constructor(copied.buffer, copied.byteOffset, descriptor.length);
	}
	return arrays;
}
