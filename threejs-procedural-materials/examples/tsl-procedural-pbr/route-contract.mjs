export const ROUTE_KINDS = Object.freeze(["mechanism", "tier"]);

export function resolveLockedRoute(manifest, kind, id) {
  if (!ROUTE_KINDS.includes(kind)) throw new Error(`Unknown route kind "${kind}"`);
  if (typeof id !== "string" || id.length === 0) throw new Error("route id must be nonempty");
  const entries = kind === "mechanism" ? manifest.mechanisms : manifest.tiers;
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown ${kind} route "${id}"`);
  return Object.freeze({ kind, id, labId: manifest.id, status: entry.acceptanceStatus });
}
