# Procedural PBR Mechanics

Read the section selected by the parent skill. **Derived** values follow from
the equations or API layout; **Gated** values must pass a named target; visual
parameters are **Authored**; timings are **Measured** with their workload.

## Contents

- [NodeMaterial slot and energy contract](#nodematerial-slot-and-energy-contract)
- [Mapping, atlas, and projection](#mapping-atlas-and-projection)
- [Derivative normals and specular AA](#derivative-normals-and-specular-aa)
- [Substrate and water ownership](#substrate-and-water-ownership)
- [Dynamic maps and instances](#dynamic-maps-and-instances)
- [Output, diagnostics, and failure signatures](#output-diagnostics-and-failure-signatures)

## NodeMaterial slot and energy contract

Use `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` so Three.js retains
its lighting, shadows, environment, GGX, multiscattering, and physical lobes.
Assign PBR causes through node slots; reserve `fragmentNode`/`outputNode` for a
deliberate whole-material replacement.

Relevant r185 slots include:

```text
colorNode, roughnessNode, metalnessNode, normalNode, aoNode
opacityNode, alphaTestNode, maskNode
emissiveNode
positionNode, castShadowPositionNode, receivedShadowPositionNode
castShadowNode, maskShadowNode, mrtNode
```

`bumpMap(texture(heightMap))` resamples the texture and builds a Mikkelsen
surface gradient; an already evaluated scalar is not its input. The visible and
caster position nodes share the same local-space displacement. Receiver
position is a separate world-space override and usually remains unset.

Dielectric normal-incidence Fresnel is **Derived**

```text
F0 = ((n2-n1)/(n2+n1))^2
```

Against air, `ior=1.5` gives `F0=0.04`; water at `ior≈1.333` gives
`F0≈0.0204`. Drive physical-material IOR/specular slots and keep the engine's
Fresnel path. Metalness is an identity endpoint: homogeneous dielectric `0`,
exposed homogeneous metal `1`. Dirt, oxide, coating, and substrate are separate
identities or layers; fractional metalness is only a declared subpixel mixture.

Normalize identity weights. For hard eligibility `H_i` and continuous response
`R_i`:

```text
q_i = H_i * max(R_i, 0)
s = sum_i(q_i)
w_i = q_i/s                    when s > epsilon
w = oneHot(fallbackIdentity)   otherwise
```

Keep `H_i` for semantic IDs and picking. Filter `w_i` for shading. A single GGX
approximation blends `alpha=roughness^2`, then recovers `sqrt(alpha)`; distinct
visible lobes remain discrete or use explicit layers.

Installed r185 clearcoat fixes its Fresnel at `F0=0.04`. A clearcoat water-film
look is therefore an authored optical approximation, not exact water IOR.

## Mapping, atlas, and projection

Select mapping from the defect:

| Defect/contract | Candidate |
| --- | --- |
| stable parameterization and density | UV sampling |
| same dimensions/format/mips/sampler across variants | texture array |
| differing source dimensions with controlled assembly | mip-safe atlas |
| one dominant surface direction | one-/two-axis projection |
| no parameterization preserves scale | triplanar projection |
| valid UVs but visible repetition | stochastic tiling |

Count hot-path sample operations as **Derived**

```text
S = sum(projectionCount * boundTextureLookups * manualTaps)
```

Bindings and samples are different budgets. A packed texture shares one lookup
only when lanes share coordinate, color/data semantics, precision, filtering,
and cadence.

Installed r185 `triplanarTexture()` performs three projected samples per bound
texture and blends with absolute local-normal weights. It does not filter the
weights, reorient tangent-space normal maps, or implement stochastic tiling.
A projected color plus packed data texture therefore adds six filtered samples;
a separate projected normal texture adds three more. Prefer projected height or
gradient with validated per-axis bases for triplanar normal detail.

Atlas mip safety:

- build each tile's mip chain with duplicated filter support at every level, or
  use an equivalent border-preserving process;
- for level `l`, gutter width satisfies **Derived**
  `g_l >= ceil(r_l)` where `r_l` includes the selected filter/manual support;
- transform gradients by tile scale so LOD tracks tile texel density;
- keep color atlases `SRGBColorSpace` and data atlases `NoColorSpace`;
- a base-level coordinate clamp cannot repair mips already contaminated across
  tile boundaries.

For stochastic tiling, candidate transforms derive from stable integer cell
IDs, weights remain nonnegative and sum to one, gradients transform with each
candidate, and every PBR channel uses the same candidate identities/weights.
Directionally meaningful grain restricts rotations to its authored symmetry.
Validate temporal switching, anisotropy, seams, spectrum, and distribution;
tiling solves repetition, not UV seams.

Static compressed maps record the actual device transcode, mip bytes, and
max/RMS error for each semantic channel. Color-oriented compression is not
automatically valid for normal, roughness, height, or threshold data.

## Derivative normals and specular AA

For view-space position `P`, base unit normal `N`, and scalar height `h`, the
parameterization-free surface-gradient construction is **Derived**:

```text
sigmaX = dFdx(P)
sigmaY = dFdy(P)
R1 = cross(sigmaY, N)
R2 = cross(N, sigmaX)
det = dot(sigmaX, R1)
surfaceGradient = sign(det) * (dFdx(h)*R1 + dFdy(h)*R2)
Nperturbed = normalize(abs(det)*N - heightScale*surfaceGradient)
```

Evaluate it in derivative-uniform fragment control flow. Vertex/compute users
need analytic or stored gradients. Filter `h` before perturbation. When `N` is
r185 `normalView` on a double-sided material, multiply `det` by
`faceDirection`, matching `BumpMapNode`; otherwise restrict the branch to front
faces.

Normal/height mip contracts retain unresolved detail:

- height mips store mean height plus removed slope variance or an equivalent
  statistic;
- normal mips retain the unnormalized vector mean and its length/second moment;
- for unit source normals with mean `m`, unresolved vector variance is
  **Derived** `v_mip=max(1-dot(m,m),0)`;
- normalize after sampling; normalizing during mip generation requires a
  separate variance/cone lane.

Three.js r185 `getRoughness()` already adds geometric-normal variation from
`normalViewGeometry`. Custom AA adds material-detail variation only. For a
locally linear detail-normal field over a one-pixel box:

```text
v_box = (|dFdx(Ndetail)|^2 + |dFdy(Ndetail)|^2) / 12
v_detail = v_mip + v_box
alpha = roughness^2
alphaFiltered = clamp(alpha + kVariance*v_detail, alpha, 1)
roughnessFiltered = sqrt(alphaFiltered)
```

`kVariance` is authored, then fitted against a supersampled no-post reference;
GGX has no universal mapping from this proxy to alpha. Anisotropic materials
project covariance into tangent/bitangent and broaden their two alphas
separately. Clearcoat owns its own detail variance.

For a filtered random-phase sinusoidal height band with half-amplitude `A_j`,
frequency `f_j`, and retained amplitude weight `w_j`, removed slope variance is
**Derived**

```text
v_removed,j = (2*pi*A_j*f_j)^2/2 * (1-w_j^2)
```

Sum independent bands. Do not add both band-removal variance and mip/box
variance for the same energy. Expose retained band weights, normal mean,
variance source, roughness before/after AA, and supersampled error.

## Substrate and water ownership

Terrain/coast/seabed materials consume one versioned field source with compatible
units, frame, datum, filter, and revision. Common inputs include signed coast
distance, terrain/bed height, slope/cavity, substrate identity, exposure, and a
receiver-owned wetness state.

Ownership is explicit:

| Owner | Signals |
| --- | --- |
| fields/terrain | support, coast distance/frame, bed position/normal, static substrate IDs |
| receiver state | retained wetness, liquid/snow storage, wetting age, drainage/drying state |
| seabed material | ordinary scene-linear reflected radiance |
| water | dynamic free surface/normal, optical path, transmittance, in-scatter, caustic irradiance, foam |

Still-water depth is **Derived**
`max(waterRestElevation-terrainElevation,0)` only when datum, units, frame, and
position agree. Signed-distance mips must preserve a monotone transition; when
ordinary averaging can merge coast components, re-distance the downsampled zero
set, carry conservative min/max bounds, or select a level whose support cannot
merge them.

Filter visible coast transitions by footprint while retaining hard land/water
and substrate semantics. Persistent wetness needs a state/history provider:
wetting events, drainage/evaporation, and substrate retention. A static run-up
envelope is valid when history is not observable. Wetness changes absorption/
color, roughness, micro-normal visibility, and optional film response together.

Substrate base color remains non-emissive. Caustics modulate incident lighting;
foam belongs to water composition; dynamic free-surface color is not painted
into shore albedo. Material detail must preserve geometry-owned cliff facets and
silhouettes.

## Dynamic maps and instances

Use one graph for a batch. Static variants use instance attributes;
GPU-updated variants use `StorageInstancedBufferAttribute`/`storage()` only when
measured update and sampling cost wins. Variant, lifetime, wetness, burn, and
dissolve remain data fields with stable instance identity.

Dissolve drives visible and shadow paths from one cause:

```text
instance seed + lifetime + stable object/world field
  -> threshold
  -> opacity/alphaTest/mask
  -> castShadow/maskShadow
```

Cause maps use the procedural-field amortization decision. Pack only matching
coordinates, precision, filter, cadence, and locality. Static maps build once;
edited maps update dirty support plus filter halos and rebuild required mips.

Dynamic causes publish immutable previous/current generations until all
consuming renders complete. Identity/coordinate/encoding/extent changes create
a new generation and invalidate dependent bindings, histories, and diagnostics.
Device loss disposes invalid generations and rebuilds from authoritative CPU or
source data.

## Output, diagnostics, and failure signatures

Author-facing color textures use `SRGBColorSpace`; normal, roughness,
metalness, masks, height, LUT, weather, and generated cause maps use
`NoColorSpace`. HDR material results stay scene-linear until one tone-map and
output conversion in the final node pipeline. `emissiveNode` adds actual
radiance; bloom is downstream.

Expose:

```text
coordinate and physical/art scale
hard eligibility, identity weights, and fallback bit
structural causes and causal modifiers
mapping weights, selected mip, gutter state, bindings, samples
normal mean, variance sources, roughness before/after AA
metal/dielectric identity and dielectric F0
visible/caster displacement and alpha parity
raw emission, no-post beauty, and final post result
dynamic generation, reset reason, and disposal state
```

Validate close/mid/far and motion against a supersampled no-post reference;
atlas gutters at the selected filter/anisotropy; compiled per-stage bindings
against actual device limits; hot-path samples; color-space flags; conductor/
dielectric endpoints; shadow parity; no extra scene render; target bytes,
whole-frame timings, and sustained behavior for performance claims.

Reject the material system when channels use unrelated identities/coordinates,
roughness is detached from material identity, unresolved normal energy is
discarded or counted twice, an atlas bleeds across mips, triplanar/stochastic
sampling is paid without solving its stated defect, material displacement and
caster geometry diverge, emission or substrate color impersonates water/post,
per-instance state clones materials, dynamic state has multiple owners, or
display conversion occurs in both material and post.
