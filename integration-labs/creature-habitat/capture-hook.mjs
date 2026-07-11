export async function captureLab(session) {
  const captures = [];
  const original = await session.controllerCall("getMetrics");
  try {
    await session.controllerCall("setTime", 1.5);
    for (const [filename, target] of [
      ["final.design.png", "final"],
      ["no-post.design.png", "no-post"],
      ["contact-events.design.png", "contact-events"],
      ["outline.actual-emissive-mrt.png", "outline"],
      ["shadow.actual-atlas.png", "shadow-atlas"],
    ]) {
      captures.push({ filename, ...(await session.writeCapture(filename, target)) });
    }
  } finally {
    await session.controllerCall("setMode", original.mode);
  }
  return {
    status: "incomplete",
    publishable: false,
    captures,
    readbackProvenance: {
      outline: "RGBA8 diagnostic is derived from the real creature-only emissive MRT attachment; raw target: outline-mask",
      shadow: "RGBA8 diagnostic samples the real allocated host directional-shadow atlas; capture target: shadow-atlas",
    },
    missing: [
      "complete schema-v2 evidence bundle",
      "accepted current-adapter performance trace",
      "50-cycle lifecycle evidence",
      "manual visual inspection",
    ],
  };
}

export default captureLab;
