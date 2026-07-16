---
kind: faq-answer
slug: /faq/why-does-my-webgpu-png-have-striped-rows/
title: Why Does My WebGPU PNG Have Striped Rows?
description: WebGPU readback rows can contain 256-byte alignment padding. Preserve the real stride, compact each row, and only then encode the PNG.
h1: Why does my WebGPU PNG have striped rows?
primary_query: why does my webgpu png have striped rows
query_aliases: ["webgpu png row stride stripes","webgpu bytesperrow png padding"]
summary: Usually, padded GPU rows are being encoded as tightly packed pixels. WebGPU texture-to-buffer copies use a bytesPerRow aligned to 256 bytes, while a PNG encoder expects width times bytesPerPixel bytes per row. Carry the actual integer stride through capture, then copy only the logical pixels from each row into a compact buffer before encoding. Do not infer stride from total buffer length divided by height.
related_skills: ["threejs-visual-validation"]
related_demos: ["webgpu-validation-harness"]
related_pages: ["/faq/how-do-i-verify-the-native-webgpu-backend/","/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/","/docs/use-in-an-existing-project/"]
published: 2026-07-16
last_reviewed: 2026-07-16
sources: ["https://www.w3.org/TR/webgpu/#gputexelcopybufferlayout","https://github.com/mrdoob/three.js/issues/31658","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/labs/runtime/aligned-readback.mjs","https://github.com/linegel/threejs-complete-set-of-skill/blob/main/scripts/capture-lab-browser-11-15.mjs"]
question_source_type: derived-upstream-issue
question_sources: ["https://github.com/mrdoob/three.js/issues/31658"]
first_observed: 2025-08-15
last_observed: 2026-07-16
canonical_route: /faq/why-does-my-webgpu-png-have-striped-rows/
evidence_status: verified
faq_group: troubleshooting
supported_revision: 0.185.1
---

## Why the stripes appear

A WebGPU texture-to-buffer copy describes the byte distance between row starts with `bytesPerRow`. For copies containing more than one texel-block row, that stride must satisfy WebGPU's 256-byte alignment rule. A PNG encoder normally expects tightly packed input with no GPU padding between rows.

For an uncompressed RGBA8 image:

```text
logicalBytesPerRow = width * 4
alignedBytesPerRow = ceil(logicalBytesPerRow / 256) * 256
minimumBufferBytes = (height - 1) * alignedBytesPerRow + logicalBytesPerRow
```

If an encoder advances by `logicalBytesPerRow` through a padded buffer, it begins later rows inside padding or previous-row data. The result can look striped, diagonally shifted, repeated, or corrupted.

## Compact the rows before encoding

Carry the exact source stride from the copy descriptor or capture result. Then remove padding row by row:

```js
const bytesPerPixel = 4;
const logicalBytesPerRow = width * bytesPerPixel;
const sourceBytesPerRow = readbackLayout.bytesPerRow;
const packed = new Uint8Array(logicalBytesPerRow * height);

for (let y = 0; y < height; y += 1) {
  const sourceOffset = y * sourceBytesPerRow;
  const destinationOffset = y * logicalBytesPerRow;

  packed.set(
    raw.subarray(sourceOffset, sourceOffset + logicalBytesPerRow),
    destinationOffset
  );
}
```

The repository helper [`aligned-readback.mjs`](https://github.com/linegel/threejs-complete-set-of-skill/blob/main/labs/runtime/aligned-readback.mjs) validates the stride, required byte length, and row unpacking. The capture path also records the compact and padded layouts independently so a later PNG step does not have to guess.

## Evidence

Upstream issue [#31658](https://github.com/mrdoob/three.js/issues/31658) documents a WebGPU render-target readback failure, the padded-row buffer footprint, and the need to unpack data before placing it in a tightly packed canvas image. The [WebGPU specification](https://www.w3.org/TR/webgpu/#gputexelcopybufferlayout) defines `bytesPerRow` and its alignment requirement. The [validation harness evidence](/evidence/webgpu-validation-harness/) proves the repository's current aligned-readback path under its declared capture contract.

## Conditions and limitations

- Do not unpack twice if the API or wrapper already returns compact pixels.
- Do not infer stride from `buffer.byteLength / height`; the last row need not carry trailing padding.
- Similar artifacts can come from a wrong texture format, channel order, crop width, origin, or stale buffer.
- RGBA8 widths divisible by 64 produce a logical row size divisible by 256. The bug can disappear at one width and return at another.
- The local proof is current for Three.js 0.185.1. The WebGPU alignment rule itself is not specific to Three.js.

First verify the [active backend](/faq/how-do-i-verify-the-native-webgpu-backend/). For a different final-image artifact, inspect the [double tone-mapping answer](/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/) or the [existing-project integration guide](/docs/use-in-an-existing-project/).

## Question provenance

This troubleshooting question is derived from upstream issue #31658. That issue reports blank or failed render-target readback and discusses padded rows; it does not report the exact striped-PNG symptom used in this page title. It is upstream engineering evidence, not customer evidence. Source first observed 2025-08-15; last checked and answer reviewed 2026-07-16.
