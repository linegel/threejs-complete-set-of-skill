export async function captureLab(session) {
  const captures = [];
  await session.controllerCall("setMechanism", "buoyancy-spray-and-masks");
  captures.push(await session.writeCapture("final.design.png", "final"));

  await session.controllerCall("setMechanism", "heightfield-simulation");
  captures.push(await session.writeCapture("heightfield.state.png", "height"));

  await session.controllerCall("setMechanism", "drops-and-object-ripples");
  await session.controllerCall("setTime", 0.25);
  captures.push(await session.writeCapture("drops-object-ripples.velocity.png", "velocity"));
  const impulseProbe = await session.controllerCall("runGpuMutationProbe", "async-impulse-loss");
  const stateDelta = impulseProbe.after.probes.reduce((maximum, value, index) => (
    Math.max(maximum, Math.abs(value - impulseProbe.before.probes[index]))
  ), 0);
  const impulseEvidence = {
    ...impulseProbe,
    stateDelta,
    readbackSource: "GPU storage buffer",
    verdict: impulseProbe.consumedSnapshot && stateDelta > 1e-7 ? "PASS" : "FAIL",
  };

  await session.controllerCall("setMechanism", "differential-caustics");
  await session.controllerCall("setTime", 0.25);
  captures.push(await session.writeCapture("receiver-caustics.png", "final"));
  const causticProbe = await session.controllerCall("runGpuMutationProbe", "receiver-energy-closure");
  const causticEvidence = {
    ...causticProbe,
    readbackSource: "GPU storage buffer",
    verdict: causticProbe.resolvedPowerUnits === causticProbe.depositedPowerUnits ? "PASS" : "FAIL",
  };

  await session.controllerCall("setMechanism", "refraction-and-absorption");
  captures.push(await session.writeCapture("refraction-absorption.png", "absorption"));

  await session.controllerCall("setMechanism", "fresnel-and-tir");
  captures.push(await session.writeCapture("fresnel-tir.png", "fresnel-and-tir"));

  return {
    captures,
    gpuReadbacks: {
      "async-impulse-loss": impulseEvidence,
      "receiver-energy-closure": causticEvidence,
    },
    acceptance: "INSUFFICIENT_EVIDENCE",
    missing: [
      "full schema-v2 artifact set",
      "GPU timestamp attribution",
      "50-cycle lifecycle evidence",
      "manual visual inspection",
    ],
  };
}
