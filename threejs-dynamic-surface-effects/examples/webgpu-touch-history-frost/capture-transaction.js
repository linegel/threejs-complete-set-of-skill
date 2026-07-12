function requireFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
  return value;
}

export function canonicalFrostEvidenceJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError("Frost evidence numbers must be finite JSON values");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalFrostEvidenceJson).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Frost evidence must contain only plain JSON values");
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalFrostEvidenceJson(value[key])}`
  )).join(",")}}`;
}

export async function sha256FrostEvidence(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Frost evidence hashing requires Web Crypto");
  const bytes = new TextEncoder().encode(canonicalFrostEvidenceJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function runFrostCaptureTransaction({
  recipeId,
  snapshot,
  execute,
  cleanup,
  verify,
  poison,
} = {}) {
  if (typeof recipeId !== "string" || recipeId.length === 0) throw new TypeError("Frost capture recipeId is required");
  requireFunction(snapshot, "Frost capture snapshot");
  requireFunction(execute, "Frost capture execute");
  requireFunction(cleanup, "Frost capture cleanup");
  requireFunction(verify, "Frost capture verify");
  requireFunction(poison, "Frost capture poison");

  const entry = await snapshot();
  let result;
  const failures = [];
  try {
    result = await execute(entry);
  } catch (error) {
    failures.push(error);
  }
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }

  let restored = null;
  try {
    restored = await verify(entry);
  } catch (verificationError) {
    failures.push(verificationError);
    try {
      await poison(verificationError);
    } catch (poisonError) {
      failures.push(poisonError);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, `Frost capture recipe ${recipeId} failed transactionally`);
  }
  return Object.freeze({ entry, restored, result });
}
