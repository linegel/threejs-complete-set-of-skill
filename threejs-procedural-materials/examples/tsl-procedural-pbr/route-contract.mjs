export const ROUTE_KINDS = Object.freeze(["mechanism", "tier"]);

export function resolveLockedRoute(manifest, kind, id) {
  if (!ROUTE_KINDS.includes(kind)) throw new Error(`Unknown route kind "${kind}"`);
  if (typeof id !== "string" || id.length === 0) throw new Error("route id must be nonempty");
  const entries = kind === "mechanism" ? manifest.mechanisms : manifest.tiers;
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown ${kind} route "${id}"`);
  return Object.freeze({ kind, id, labId: manifest.id, status: entry.acceptanceStatus });
}

export function assertLockedRouteMutation(lock, selectionKind, nextId) {
  if (lock === null || lock === undefined) return nextId;
  if (!ROUTE_KINDS.includes(lock.kind)) throw new Error(`Unknown route kind "${lock.kind}"`);
  if (selectionKind !== "mechanism" && selectionKind !== "tier") {
    throw new Error(`Unknown route selection kind "${selectionKind}"`);
  }
  if (lock.kind === selectionKind && lock.id !== nextId) {
    throw new Error(`Locked ${selectionKind} route "${lock.id}" rejects "${nextId}"`);
  }
  return nextId;
}
