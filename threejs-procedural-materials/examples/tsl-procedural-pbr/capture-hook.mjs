import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function captureLab(session) {
  const captures = [];
  async function capture(filename, target, scenario = null) {
    if (scenario) await session.controllerCall("setScenario", scenario);
    await session.controllerCall("renderOnce");
    const result = await session.writeCapture(filename, target);
    captures.push({ filename, scenario, ...result });
  }

  await capture("final.design.png", "final", "pbr-identity");
  await capture("no-post.design.png", "no-post", "pbr-identity");
  await capture("material-albedo.png", "material-albedo", "pbr-identity");
  await capture("material-normal.png", "material-normal", "specular-aa-and-filtering");
  await capture("material-footprint.png", "material-footprint", "specular-aa-and-filtering");
  await capture("material-normal-variance.png", "material-normal-variance", "specular-aa-and-filtering");
  await capture("atlas-array-triplanar.png", "no-post", "atlas-array-and-triplanar");
  await capture("dissolve-visible.png", "no-post", "instanced-dissolve");
  await capture("dissolve-shadow-parity.png", "final", "shadow-parity");
  await capture("wet-rock-direct-occlusion.png", "final", "wet-rock-and-occlusion");

  const incompleteBoundary = {
    schemaVersion: 2,
    labId: session.lab.id,
    status: "incomplete",
    publishable: false,
    evidenceContract: "v2",
    reason: "Capture session is not an accepted evidence bundle until current-adapter GPU timestamps, shadow-depth readback, supersampled specular error, and 50-cycle lifecycle evidence exist.",
    claims: {
      nativeWebGPUCorrectness: "INSUFFICIENT_EVIDENCE",
      currentAdapterTiming: "INSUFFICIENT_EVIDENCE",
      shadowDissolveParity: "INSUFFICIENT_EVIDENCE",
      supersampledSpecularError: "INSUFFICIENT_EVIDENCE",
      lifecycle: "INSUFFICIENT_EVIDENCE",
    },
    captures,
  };
  await writeFile(
    resolve(session.outputDir, "evidence-manifest.incomplete.json"),
    `${JSON.stringify(incompleteBoundary, null, 2)}\n`,
  );
  return { status: "incomplete", publishable: false, captures };
}

export default captureLab;
