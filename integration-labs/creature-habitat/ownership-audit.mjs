export const REQUIRED_EXCLUSIVE_SEMANTICS = Object.freeze([
  "renderer",
  "final-render-pipeline",
  "tone-map",
  "output-transform",
  "camera-state",
  "world-units-and-wind",
  "creature-state",
  "contact-event-registry",
  "vegetation-storage",
  "bounded-water-state",
  "shadow-maps",
]);

/** Rejects missing and duplicate exclusive ownership before graph construction. */
export function assertExclusiveOwnership(entries, required = REQUIRED_EXCLUSIVE_SEMANTICS) {
  if (!Array.isArray(entries)) throw new TypeError("ownership entries must be an array");
  const bySemantic = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.semantic !== "string" || typeof entry.owner !== "string") {
      throw new TypeError("ownership entries require semantic and owner strings");
    }
    const owners = bySemantic.get(entry.semantic) ?? [];
    owners.push(entry.owner);
    bySemantic.set(entry.semantic, owners);
  }
  for (const semantic of required) {
    const owners = bySemantic.get(semantic) ?? [];
    if (owners.length === 0) throw new Error(`missing exclusive owner: ${semantic}`);
    if (owners.length !== 1) throw new Error(`duplicate exclusive owner: ${semantic} -> ${owners.join(", ")}`);
  }
  return Object.freeze(Object.fromEntries([...bySemantic].map(([semantic, owners]) => [semantic, owners[0]])));
}

