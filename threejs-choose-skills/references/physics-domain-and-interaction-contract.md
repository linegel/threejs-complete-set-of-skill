# Physics Domain And Interaction Contract

Use this contract when two or more skills exchange physical state, forcing,
contacts, sources, reactions, or presentation state. It standardizes boundaries,
ownership, ordering, and evidence; it does not prescribe a universal solver,
timestep, state buffer, physics engine, or CPU/GPU representation.

## Contents

- Evidence and invariants
- PhysicsContext, frames, charts, clocks, and identity
- PhysicsGraph and multi-rate scheduling
- PhysicsSignalDescriptor and provider protocol
- Canonical forcing, water, support, precipitation, and lighting records
- SurfaceExchange, interactions, reactions, and conservation
- Physics materials and physical proxies
- CPU/GPU synchronization and external solvers
- Physics presentation and reactive state
- Quality transitions and mobile performance
- Validation scenarios and failure gates

Serialized record keys and enums are mirrored in the machine-readable
[physics ABI vocabulary](physics-domain-and-interaction-contract.schema.json).
That file is normative for spelling, required-key sets, enum membership, typed
absence, and router drift tests; this document remains normative for physical
meaning, equations, ownership, ordering, and acceptance evidence.

## Evidence And Invariants

Use the router evidence labels everywhere a produced artifact contains a
quantitative value:

- `[D]` is derived algebra with named, unit-bearing inputs and the formula.
- `[G]` is a capability, invariant, or acceptance bound; it is not a timing
  estimate.
- `[M]` is measured on a named target, workload, quality state, and protocol.
- `[A]` is an authored policy or starting value and cannot prove acceptance.

Use `[D/G/M/A]` as compact prose aliases only. Serialize every quantitative
value in the router's exact canonical form:
`{ value, unit, label: Derived|Gated|Measured|Authored, source }`. Schema versions, opaque IDs,
enumerants, and integer sequence identities are not quantitative claims. An
unlabelled threshold, cadence, tolerance, byte count, duration, or scale is
invalid.

The following are `[G]` invariants:

- Keep domain solvers in their optimal native representations. Exchange typed
  views, not a universal state array.
- Assign exactly one owner to each state equation and committed state version.
  Consumers may cache immutable versions but may not advance them.
- Represent every physical provider quantity in SI units in a stable,
  right-handed Cartesian physics frame. Camera-relative coordinates are a
  presentation concern.
- Treat every optional channel as either present with metadata or a typed
  absence. A sentinel string, null, NaN, zero, empty resource handle, or stale
  generation is not typed absence.
  Never encode unavailable velocity, force, density, temperature, radiance, or
  another physical quantity as an implicit zero.
- Separate semantic frame revision, transform revision, physics-origin epoch,
  render-origin epoch, provider state version, quality epoch, and presentation
  epoch. Equality of any one does not imply equality of the others.
- Declare rate versus time-integrated quantity, source-to-receiver sign,
  represented support, application interval, physics frame, transform revision,
  and origin epoch at every interaction boundary.
- Publish simulation state to rendering through immutable, leased versions.
  Rendering never reads a mutable solver work buffer.

Typed absence is a record, never the text `typed-absence`:

```yaml
TypedAbsence:
  kind: absent
  reason: unsupported | unavailable | not-requested | not-applicable | gated-off
  authority: owner-id
  schemaId: typed-absence-v1
  effectiveTime: PhysicsTime | timeless
  provenance: source-and-revision
```

Every union arm that is inactive contains this record. Its `authority` is the
owner entitled to say that the value does not exist; `reason` distinguishes a
capability limit from a request choice. A bare string is only expository
shorthand in prose and is rejected in a serialized ABI record.

## `PhysicsContext`, Frames, Charts, Clocks, And Identity

### Canonical context

```yaml
PhysicsContext:
  contextId: PhysicsContextId
  schemaId: PhysicsContextSchemaId
  contextVersion: opaque-version
  metersPerWorldUnit: Quantity<meter/world-unit> # positive [G]; only scale convention
  quantitySystem: PhysicsQuantitySystem
  worldFrameId: WorldFrameId
  physicsRootFrameId: PhysicsFrameId
  worldToPhysicsTransform: WorldPhysicsTransform
  worldTransformRevision: opaque-version # must equal the referenced transform revision
  physicsFrameRegistry: PhysicsFrameRegistry
  chartRegistry: PhysicsChartRegistry
  physicsClockRegistry: PhysicsClockRegistry
  gravityProvider: PhysicsSignalDescriptorRef<acceleration>
  physicsOriginEpoch: PhysicsOriginEpoch
  idNamespaces: PhysicsIdentityRegistry
  physicsMaterialRegistry: PhysicsMaterialRegistry

PhysicsQuantitySystem:
  systemId: canonical-SI-physics-v1
  registryRevision: opaque-version
  length: metre
  mass: kilogram
  time: second
  thermodynamicTemperature: kelvin
  angle: radian
  amountOfSubstance: mole
  electricCurrent: ampere
  luminousIntensity: candela
  derivedQuantityRegistry: versioned-dimension-and-unit-map
```

Serialize only `metersPerWorldUnit`; derive its reciprocal `[D]`. Do not allow
both reciprocal conventions in one manifest. `gravityProvider` is sampled by
position and `PhysicsInstant`; the ref resolves to a registered descriptor with
SI acceleration channels, frame/epoch/revision, validity, and error. Gravity is
never implicit negative world Y.

`quantitySystem` is invariant across one Context version. All provider and
interaction units resolve through its dimension registry; temperature is
absolute kelvin at the ABI, mass is kilogram, and angle is radian even when an
authoring UI displays Celsius, tonnes, degrees, or engine units. Convert once
at a named adapter and carry its revision/error. A change to a base unit or
dimension registry creates a new Context version; it is not a quality tier.

`WorldPhysicsTransform` uses the one positive uniform scale
`metersPerWorldUnit`, a proper basis rotation, and translation at a named
`PhysicsInstant`; it serializes no second scale factor:

```yaml
WorldPhysicsTransform:
  transformRevision: opaque-version
  referenceInstant: PhysicsInstant
  physicsOriginEpoch: PhysicsOriginEpoch
  scaleSource: metersPerWorldUnit
  properBasisRotation: Mat3
  translationMeters: Vec3
  originCoordinateRateMps: Vec3
  angularRateOfWorldRelativeToPhysicsRadPerS: Vec3
  originCoordinateAccelerationMps2: Vec3 | typed-absence
  angularAccelerationRadPerS2: Vec3 | typed-absence
  validityInterval: PhysicsTimeInterval
  error: PhysicsErrorDescriptor
```

`worldTransformRevision` is the context binding to this exact
`transformRevision`; mismatch is invalid. Define the world-coordinate derivative
explicitly:

```text
x_physics = R_worldToPhysics (metersPerWorldUnit * x_world) + t_physics
coordinateRate_physics = R_worldToPhysics (metersPerWorldUnit * coordinateRate_world)
                         + originCoordinateRate_physics
                         + omega_worldRelativeToPhysics x
                           R_worldToPhysics (metersPerWorldUnit * x_world)
coordinateAcceleration_physics =
    R_worldToPhysics (metersPerWorldUnit * coordinateAcceleration_world)
  + originCoordinateAcceleration_physics
  + angularAcceleration_worldRelativeToPhysics x r
  + 2 omega_worldRelativeToPhysics x
      R_worldToPhysics (metersPerWorldUnit * coordinateRate_world)
  + omega_worldRelativeToPhysics x
      (omega_worldRelativeToPhysics x r)
where r = R_worldToPhysics (metersPerWorldUnit * x_world)
```

The last two terms are zero only for a stationary world/physics adapter. This is
a coordinate-rate conversion, not a basis change of a physical velocity vector.
A physical polar velocity already expressed as a geometric vector transforms as
`V_physics = R_worldToPhysics V_world`; do not add origin or angular terms twice.
Angular velocity is axial and rotated but not length-scaled. Transform normals
by the inverse transpose and tensors according to their declared variance. This
world/physics adapter is distinct from the camera-relative render transform.

Every rigid frame uses this exact boundary record:

```yaml
PhysicsFrameDescriptor:
  frameId: PhysicsFrameId
  parentFrameId: PhysicsFrameId | root
  owner: owner-id
  transformRevision: opaque-version
  referenceInstant: PhysicsInstant
  parentFromFrameRotation: Mat3 # proper orthogonal
  parentFromFrameTranslationMeters: Vec3
  originCoordinateRateInParentMps: Vec3
  angularRateOfFrameRelativeToParentInParentRadPerS: Vec3
  originCoordinateAccelerationInParentMps2: Vec3 | typed-absence
  angularAccelerationInParentRadPerS2: Vec3 | typed-absence
  validityInterval: PhysicsTimeInterval
  uncertainty: PhysicsErrorDescriptor
```

Require `transpose(R) R = I` and `det(R) = +1` within labelled gates; merely
checking that the determinant is positive does not reject shear or scale.
Reflections and negative scale are forbidden in the live physics-frame graph
`[G]`. Convert handedness once at ingestion, including winding and axial-vector
semantics.

For transform `B <- A`, define the coordinate-rate conversion

```text
p_B = R_BA p_A + t_BA
coordinateRate_B = R_BA coordinateRate_A + dot(t_BA)
                   + omega_BA x (R_BA p_A)
coordinateAcceleration_B = R_BA coordinateAcceleration_A + ddot(t_BA)
                         + alpha_BA x r
                         + 2 omega_BA x (R_BA coordinateRate_A)
                         + omega_BA x (omega_BA x r)
where r = R_BA p_A and alpha_BA = dot(omega_BA)
T_B = R_BA T_A transpose(R_BA)
```

Here `t_BA` is the position in B of A's origin, `dot(t_BA)` is that origin's
coordinate rate expressed in B, and `omega_BA` is A's angular velocity relative
to B expressed in B; `R_BA` maps A components to B. A physical polar vector
uses `V_B = R_BA V_A`, and an axial vector uses the corresponding proper-rotation
rule; neither receives frame-transport terms. `R_BA` is a proper orthogonal
matrix `[G]`. The acceleration equation is valid for the same derivative
parameter and the stated `B <- A` convention; its five terms are respectively
relative acceleration, origin acceleration, Euler, Coriolis, and centripetal
acceleration. Reject an acceleration conversion when `ddot(t_BA)` or
`alpha_BA` is absent; never drop a term merely because a render frame appears
stationary in one capture. Normals use the
inverse-transpose rule. Polar vectors, axial vectors, points, normals, scalars,
coordinate rates, and tensors are distinct schema kinds.

Geodetic, spherical, coastline, curvilinear, and texture coordinates are
`PhysicsChartDescriptor` records, not rigid frames. A chart declares its rigid
anchor frame, forward/inverse maps, Jacobian, metric tensor, validity domain,
singularities, orientation, curvature error, chart revision, and error bound.

```yaml
PhysicsChartDescriptor:
  chartId: PhysicsChartId
  owner: owner-id
  anchorPhysicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  chartRevision: opaque-version
  coordinateUnitsAndRanges: typed-map
  forwardMap: versioned-map
  inverseMap: versioned-map
  jacobian: versioned-function
  metricTensor: versioned-function
  orientation: right-handed-or-explicit
  validityDomain: typed-domain
  singularitiesAndSeams: typed-set
  curvatureAndLinearizationError: PhysicsErrorDescriptor
```

`PhysicsIdentityRegistry` assigns distinct generation-bearing IDs for entity,
provider, signal, collider, shape, support, feature, contact manifold,
`PhysicsMaterialId`, interaction, and conservation group. IDs are never GPU
slots, draw indices, frame IDs, render-material IDs, or recycled without a new
generation. Compaction publishes an explicit old-to-new slot map while stable
IDs remain unchanged.

### Canonical time

Ticks, rational numerators/denominators, mapping revisions, and sequence IDs are
structural identities, not evidence-wrapped physical quantities. Use distinct
instant and interval records; never attach a duration-shaped interval to an
instant or serialize independent authoritative tick and seconds fields:

```yaml
PhysicsInstant:
  clockId: PhysicsClockId
  tick: monotonic-integer-sequence
  rationalSubstep: { numerator: integer, denominator: positive-integer }
  clockMappingRevision: opaque-version
  discontinuityEpoch: opaque-version
  timeSecondsDerived: Quantity<second> # [D] through the versioned clock mapping

PhysicsTimeInterval:
  clockId: PhysicsClockId
  start: PhysicsInstant
  endExclusive: PhysicsInstant
  intervalMappingRevision: opaque-version

PhysicsTime:
  kind: instant | interval
  instant: PhysicsInstant | typed-absence
  interval: PhysicsTimeInterval | typed-absence
```

Canonicalize the rational with `0 <= numerator < denominator` and
`gcd(numerator, denominator) = 1`. `start` and `endExclusive` use the same clock,
mapping revision, and discontinuity epoch; require `start < endExclusive`.
Represent an instant only as `PhysicsInstant`, never as a zero-length interval.
`PhysicsTime` is the pack-wide discriminated union used when a generic boundary
truly accepts either form: exactly one arm is present. Exact records below use
the narrower `PhysicsInstant` or `PhysicsTimeInterval`; the union is never an
ambiguous tick/seconds/interval bag.

Use discriminated durations/deadlines, never a unit string that means either
seconds or ticks:

```yaml
PhysicsDuration:
  kind: seconds | clock-span
  seconds: Quantity<second> | typed-absence
  clockSpan: PhysicsClockSpan | typed-absence
  secondsDerived: Quantity<second> | typed-absence # [D] for a clock-span
  mappingError: PhysicsErrorDescriptor | typed-absence

PhysicsClockSpan:
  clockId: PhysicsClockId
  start: PhysicsInstant
  endExclusive: PhysicsInstant
  mappingRevision: opaque-version

PhysicsDeadline:
  kind: absolute-time | duration-from-request
  absoluteTime: PhysicsInstant | typed-absence
  requestInstant: PhysicsInstant | typed-absence
  duration: PhysicsDuration | typed-absence
```

Exactly one duration/deadline arm is present. A seconds duration has no clock
span; a clock span derives seconds only through its versioned mapping. An
`absolute-time` deadline has `absoluteTime` active and both other arms absent.
A `duration-from-request` deadline has both `requestInstant` and `duration`
active, derives its absolute boundary through their registered clock mapping,
and has `absoluteTime` absent. A duration without its request instant is
undefined and rejected.

`PhysicsClockDescriptor` uses a discriminated mapping:

```yaml
PhysicsClockDescriptor:
  clockId: PhysicsClockId
  owner: owner-id
  mappingRevision: opaque-version
  discontinuityEpoch: opaque-version
  mappingKind: fixed-rational | timestamp-table | piecewise-versioned | external
  mapping:
    fixedRational:
      { epochTick, epochRationalSubstep, epochSeconds, secondsPerTick } | typed-absence
    timestampTable:
      { tableVersion, coveredInstantRange, knotTable, interpolationRule,
        outOfRangePolicy, error } | typed-absence
    piecewiseVersioned:
      { segmentTableVersion, coveredInstantRange, segmentTable,
        outOfRangePolicy, error } | typed-absence
    external:
      { adapterId, adapterVersion, mappingHandle, coveredInstantRange,
        frozenEvaluationTable, onlineQueryProtocol, unloggedQueryPolicy,
        error } | typed-absence
  pauseSeekPolicy: typed-policy
  timeScalePolicy: typed-policy
  coordinationClockMap: versioned-map-and-error
```

`knotTable` and `segmentTable` are each a discriminated storage record: either
`{ storage: inline, inlineEntries, resourceRef: typed-absence }` or
`{ storage: immutable-resource, inlineEntries: typed-absence,
resourceRef: { contentDigest, byteLayout, elementCount } }`. Resolving the
resource by digest must reproduce the exact canonical entry bytes. A timestamp
knot is `{ instantKey: { tick, rationalSubstep }, timeSeconds }`. An affine
segment is `{ startInclusive, endExclusive, secondsAtStart,
secondsPerTick }`. Knots and segment boundaries are strictly increasing in the
lexicographic rational coordinate
`u(I) = I.tick + I.rationalSubstep.numerator /
I.rationalSubstep.denominator`; segments are non-overlapping, gap-free over the
covered range, and right-open. `secondsPerTick` is positive and serialized as
an exact reduced rational quantity; `timeSeconds` and `secondsAtStart` use the
canonical labelled quantity form.

Evaluation is normative:

```text
fixed-rational: t(I) = epochSeconds + (u(I) - u(epoch)) * secondsPerTick
timestamp-table: t(I) = t_k + (u(I)-u_k)/(u_(k+1)-u_k) * (t_(k+1)-t_k)
piecewise-versioned: t(I) = secondsAtStart_k
                              + (u(I)-u(start_k)) * secondsPerTick_k
```

The timestamp rule is exactly `piecewise-linear-seconds`; no implementation-
selected spline is allowed. Every adjacent knot and segment boundary must be
continuous and strictly monotone within its declared error unless the change
increments `discontinuityEpoch`. The out-of-range policy is `reject`; clamping
or extrapolation requires a separately versioned mapping and an explicit error
model. The external arm freezes every accepted evaluation into its content-
addressed `frozenEvaluationTable`; `onlineQueryProtocol` identifies request,
response, adapter revision, and response digest, and `unloggedQueryPolicy` is
`reject`. A replay therefore never depends on a live process returning the same
answer.

Exactly one arm matching `mappingKind` is present and the other three carry
typed absence. `PhysicsInstant.timeSecondsDerived` must equal the evaluation
above under its `clockMappingRevision`; it is never a second authority. A tick
span on a nonuniform clock derives seconds from its named start/end instants and
mapping revision; `tickCount` alone is insufficient. Analytic, fixed-step,
adaptive, event-driven, streamed, and presentation clocks may coexist. No
clock is silently promoted to a universal timestep.

## `PhysicsGraph` And Multi-Rate Scheduling

```yaml
PhysicsGraph:
  graphId: PhysicsGraphId
  contextId: PhysicsContextId
  coordinationInterval: PhysicsTimeInterval
  stages: [PhysicsGraphStage]
  edges: [PhysicsGraphEdge]
  loopMacros: [BoundedCouplingLoop]
  commitGroups: [PhysicsCommitGroup]
  originRebaseTransactions: [PhysicsOriginRebaseTransaction]
  catchUpPolicy: graph-wide-policy
  discontinuityPolicy: graph-wide-policy
  executionLedger: PhysicsExecutionLedger
```

Use these exact stage kinds and preserve their order:

```text
ingest -> sample-forcing -> predict -> emit-interactions -> solve-subcycles
       -> reduce-reactions -> correct -> commit -> publish-presentation
```

These are dependency buckets, not mandatory dispatches. A route may have zero,
one, or several stages of a kind; an empty kind allocates no resource and
executes no no-op pass. Every edge must still respect the partial order, and a
bounded loop is represented only by its scheduler-owned loop macro.

```yaml
PhysicsGraphStage:
  stageId: PhysicsGraphStageId
  stageKind: ingest | sample-forcing | predict | emit-interactions | solve-subcycles | reduce-reactions | correct | commit | publish-presentation
  owner: owner-id
  clockId: PhysicsClockId
  executionInterval: PhysicsTimeInterval
  samplePhase: interval-start | substep-stage | interval-end | analytic-at-request
  reads:
    - { signalId, requiredStateVersion, requiredDisposition, samplePhase }
  writes:
    - { signalId, producedStateVersion, disposition, commitGroupId }
  immutableSubstepParameters: { parameterRecordId, version }
  nativeStepRule: analytic | fixed | adaptive | event | streamed | external
  executionResidency: PhysicsResidencyDescriptor
  failurePolicy: typed-atomic-policy

PhysicsGraphEdge:
  edgeId: PhysicsGraphEdgeId
  producerStageId: PhysicsGraphStageId
  consumerStageId: PhysicsGraphStageId
  payload: typed-signal-ref | surface-exchange-ref | state-version-ref
  requiredVersionAndPhase: typed-version-phase
  interpolationExtrapolation: named-policy-and-error | not-used
  maximumStaleness: PhysicsDuration | not-applicable
  latency: PhysicsLatencyDescriptor
  barrier: cpu-data | gpu-pass-dispatch | same-queue-transition | cross-queue | copy-map | external-fence | none
  absencePolicy: block | declared-approximation | not-used

BoundedCouplingLoop:
  loopId: BoundedCouplingLoopId
  orderedStageIds: [PhysicsGraphStageId]
  iterationBound: Quantity<iterations> # [G]
  residuals: [typed-residual-norm]
  convergenceBounds: [Quantity] # [G]
  conservationGroupIds: [ConservationGroupId]
  provisionalVersionNamespace: loop-scoped-namespace
  seedCommittedVersions: [committed-version-ref]
  externalReads: [committed-version-ref]
  iterationCarriedEdges: [CouplingIterationEdge]
  iterationVersionRule: exact-iteration-index-and-bracket-rule
  acceptedWrites: [provisional-version-ref]
  perIterationLedger: [CouplingIterationLedger]
  acceptedIteratePublication: atomic
  divergenceFallback: reject | rollback | declared-one-way-degrade

CouplingIterationEdge:
  edgeId: PhysicsGraphEdgeId
  producerStageId: PhysicsGraphStageId
  consumerStageId: PhysicsGraphStageId
  signalOrExchangeId: id
  producedIterationOffset: integer
  consumedIterationOffset: integer
  requiredBracket: exact-coupling-time-bracket
  requiredProvisionalVersionPattern: version-pattern-with-iteration-index
  barrier: typed-graph-barrier

CouplingIterationLedger:
  loopId: BoundedCouplingLoopId
  iterationIndex: integer
  bracket: exact-coupling-time-bracket
  inputVersions: [typed-version-ref]
  outputVersions: [typed-version-ref]
  interactionSequenceRanges: [closed-sequence-range]
  residualValues: [labelled-quantity]
  conservationResults: [ConservationGroupId-and-status]
  accepted: boolean
  dependencyCompletionRefs: [typed-completion-ref]

PhysicsCommitGroup:
  commitGroupId: PhysicsCommitGroupId
  owner: transaction-owner-id
  interval: PhysicsTimeInterval
  provisionalVersions: [typed-version-ref]
  committedPublications: [typed-version-ref]
  publicationLineage: [CommitPublicationLineage]
  stateEquationOwners: { named-state-equation: owner-id }
  conservationAndErrorGates: [typed-gate]
  atomicity: all-or-none
  failureDisposition: rollback | preserve-prior-commit | typed-degraded-commit

CommitPublicationLineage:
  provisionalVersion: typed-version-ref
  committedVersion: typed-version-ref
  contentDigest: collision-resistant-digest
  semanticEquivalenceProof: exact-copy | immutable-handle-promotion | named-conversion-with-error
  ownerApproval: state-equation-owner-and-revision
  publicationInstant: PhysicsInstant

PhysicsExecutionLedger:
  ledgerId: PhysicsExecutionLedgerId
  graphId: PhysicsGraphId
  graphRevision: opaque-version
  coordinationInterval: PhysicsTimeInterval
  stageExecutions:
    - { stageId, executionInterval, executionSequence, inputVersions,
        provisionalOutputVersions, committedOutputVersions, status,
        dependencyCompletionRefs }
  loopResults: [loop-id-iterations-residuals-and-accepted-iterate]
  commitResults: [commit-group-id-status-and-published-versions]
  catchUpDebtBeforeAfter: typed-duration-pair
  discontinuityEpoch: opaque-version
  physicsCostLedgerId: PhysicsCostLedgerId
```

One ledger covers one graph coordination interval. Stage rows are ordered by
the graph partial order and execution sequence; a committed output must appear
in exactly one successful `commitResults` row. The cost-ledger reference binds
the same target/workload quality state used to measure this execution policy;
it is not a timing value copied into every row.

A `PhysicsGraphStage` declares `stageId`, `stageKind`, owner, `clockId`, exact
input interval and sample phase, read versions, write versions, immutable
substep-parameter record, native stepping rule, execution residency, and failure
policy. A write is either loop/transaction-local `provisional` state or a
`committed-publication`; it never becomes externally sampleable merely because a
dispatch completed. Every externally visible committed version appears in
exactly one `PhysicsCommitGroup`, and only the authoritative state-equation owner
may contribute its publication. A coordinator may commit an owner's already
prepared version atomically but does not become a second state-equation owner.

A `PhysicsGraphEdge` declares producer/consumer, exact signal/interaction and
version, sample phase, interpolation/extrapolation policy, maximum staleness,
latency, barrier kind, and absence policy. Each stage clock is registered. Each
execution interval is nonempty and either contained in or explicitly mapped to
the coordination interval. Every read is justified by exactly one matching edge
from a committed prior version or a permitted loop-local provisional writer;
every edge terminates at a matching read. Barrier semantics must satisfy the
producer/consumer residency pair.

The outer graph is a DAG `[G]`. A physical feedback cycle is one
`BoundedCouplingLoop` supernode with iteration ordering, maximum-iteration gate,
residual norm, convergence bound, divergence fallback, and conservation ledger.
Iteration zero reads only `seedCommittedVersions`. Each later iteration reads
the exact prior-iteration version named by `iterationCarriedEdges`; the bracket
cannot change inside the loop. `perIterationLedger` records every input/output
version and interaction range, so a solver cannot freeze one participant while
advancing the other or accidentally reapply an outer weather event. Internal
reads/writes remain in a loop-scoped provisional namespace. Only
the accepted iterate enters its commit group; rejected/divergent iterates cannot
leak through descriptors, events, caches, or presentation. Do not hide a cycle
with a stale sample or a one-frame lag.

Every successful commit has a one-to-one `publicationLineage` row from each
provisional version to each committed publication, with a digest and either an
exact immutable promotion proof or a named conversion/error proof. A matching
name is not lineage; no unlisted byte range or state equation may enter the
commit.

Each graph execution advances one explicit coordination interval. Each owner chooses its
native substeps subject to its stability/error gate. Rate interactions are
integrated over each overlapping subinterval; integrated impulses are applied
exactly once over their declared interval. The graph owns a common catch-up,
drop, and discontinuity decision so domains cannot independently skip different
physical intervals.

Use a collision-free total delivery key over physical time, stage order,
producer ID, producer-local monotonic sequence, and interaction ID. Declare
late, duplicate, overflow, cancellation, and retry policies. Deterministic
replay requires a fixed reduction tree/order and declared floating-point mode;
unordered floating-point atomics are not deterministic evidence.

## `PhysicsSignalDescriptor` And Provider Protocol

```yaml
PhysicsSignalDescriptor:
  signalId: PhysicsSignalId
  providerId: PhysicsProviderId
  schemaId: PhysicsSignalSchemaId
  contextId: PhysicsContextId
  owner: owner-id
  consumers: [consumer-id]
  channels: { channelId: PhysicsChannelDescriptor }
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  chartId: PhysicsChartId | absent
  clockId: PhysicsClockId
  samplePhase: graph-stage-and-boundary
  representedFootprint: spatial-support
  filter: PhysicsFilterDescriptor
  validity: spatial-temporal-version-domain
  perChannelError: { channel-id: PhysicsErrorDescriptor }
  residency: PhysicsResidencyDescriptor
  cadence: PhysicsCadenceDescriptor
  latency: PhysicsLatencyDescriptor
  stateVersion: opaque-version
  resourceGeneration: OptionalResourceGeneration
  missingChannelPolicy: report-absent | reject-request | named-reconstruction-with-error

OptionalResourceGeneration:
  kind: present | absent
  generation: opaque-version | TypedAbsence
```

`present` carries an opaque generation; `absent` carries the exact
`TypedAbsence` record in `generation`. This deliberately avoids an empty
handle, zero generation, or sentinel token.

The records referenced by `PhysicsSignalDescriptor` are exact:

```yaml
PhysicsChannelDescriptor:
  channelId: PhysicsChannelId
  valueType: scalar-vector-tensor-structured-type
  tensorRankAndShape: typed-rank-and-shape
  unit: canonical-SI-unit
  basisBehavior: scalar | polar-vector | axial-vector | covector | tensor | structured
  quantityClass: intensive | extensive | geometric | categorical
  samplingMeasure: point | line | area | volume | solid-angle | path | none
  declaredSupport: PhysicsSupportDescriptor
  declaredFilter: PhysicsFilterDescriptor
  timeSemantics: instant | interval-average | interval-integral | state-over-interval
  validity: PhysicsValidityDescriptor
  errorRef: PhysicsErrorId

PhysicsValidityDescriptor:
  status: valid | stale-within-gate | out-of-domain | unavailable | failed
  domain: spatial-temporal-version-domain
  validTime: PhysicsTime | timeless
  staleAfter: PhysicsDuration | TypedAbsence
  reason: typed-reason-or-TypedAbsence
  acceptanceGate: typed-gate

PhysicsSupportDescriptor:
  supportId: PhysicsSupportId
  kind: point | line | area | volume | solid-angle | path | global
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  chartId: PhysicsChartId | TypedAbsence
  geometry: versioned-geometry-or-domain
  orientation: typed-orientation-or-TypedAbsence
  measureUnit: canonical-SI-measure-unit
  representedMeasure: Quantity
  error: PhysicsErrorDescriptor

PhysicsFilterDescriptor:
  filterId: PhysicsFilterId
  supportMeasure: point | line | area | volume | solid-angle | path | global
  kernelOrTransferFunction: normalized-kernel-or-frequency-response
  spatialBandwidth: typed-band-or-TypedAbsence
  temporalBandwidth: typed-band-or-TypedAbsence
  phaseSemantics: phase-resolved | phase-averaged | envelope | not-applicable
  normalization: exact-integral-and-measure
  causality: causal | acausal-offline | instantaneous
  error: PhysicsErrorDescriptor

PhysicsErrorDescriptor:
  errorId: PhysicsErrorId
  quantityOrChannelId: id
  classification: hard-bound | measured-residual | statistical-uncertainty | unavailable
  norm: typed-norm
  basisFrameId: PhysicsFrameId | TypedAbsence
  support: PhysicsSupportDescriptor | TypedAbsence
  boundOrStatistic: labelled-quantity-distribution-or-TypedAbsence
  confidenceOrCoverage: labelled-probability-or-TypedAbsence
  correlationModel: independent | fully-correlated | covariance-ref | bounded-adversarial | named-model
  combinationRule: triangle | root-sum-square | covariance-propagation | operator-bound | interval-arithmetic | named-rule
  source: derivation-measurement-model-and-revision
  validity: PhysicsValidityDescriptor

ErrorPropagationLedger:
  ledgerId: ErrorPropagationLedgerId
  contextId: PhysicsContextId
  outputSignalOrInteractionId: id
  outputStateVersion: opaque-version
  evaluationInterval: PhysicsTimeInterval
  inputErrors: [PhysicsErrorDescriptorRef]
  transformsFiltersInterpolations: [versioned-operation-and-local-error]
  correlationAssumptions: [input-pair-or-group-model]
  operatorOrGainBounds: [dimensioned-operator-bound]
  modeledApproximationTerms: [PhysicsErrorDescriptorRef]
  numericalTerms: [PhysicsErrorDescriptorRef]
  combinationRule: exact-versioned-rule
  outputError: PhysicsErrorDescriptor
  acceptanceGate: per-consumer-tolerance-result
  provenance: implementation-build-and-evidence

PhysicsMirrorDescriptor:
  kind: available | absent
  sourceStateVersion: opaque-version | TypedAbsence
  mirrorStateVersion: opaque-version | TypedAbsence
  availableAt: PhysicsInstant | TypedAbsence
  age: PhysicsDuration | TypedAbsence
  error: PhysicsErrorDescriptor | TypedAbsence
  synchronization: graph-edge-or-TypedAbsence

PhysicsResidencyDescriptor:
  kind: cpu | gpu | external | mirrored
  deviceId: device-id | TypedAbsence
  queueId: queue-id | TypedAbsence
  bindingIdentity: typed-handle-layout-subresource | TypedAbsence
  sameQueueAvailability: typed-dependency | TypedAbsence
  hostVisibility: host-visible | not-host-visible | delayed
  mirror: PhysicsMirrorDescriptor
  readbackPolicy: forbidden | diagnostic-delayed-only | scheduled-noncritical

PhysicsCadenceDescriptor:
  kind: analytic-on-demand | fixed | adaptive | event-driven | streamed
  clockId: PhysicsClockId
  intervalOrTrigger: PhysicsDuration | typed-trigger
  samplePhase: interval-start | substep-stage | interval-end | analytic-at-request
  jitterBound: PhysicsDuration
  maximumBurst: labelled-execution-count
  evidence: derivation-measurement-or-gate

PhysicsLatencyDescriptor:
  productionDelay: PhysicsDuration
  consumerAvailability: graph-dependency-or-external-fence
  maximumStaleness: PhysicsDuration
  hostVisibleDelay: PhysicsDuration | TypedAbsence
  clockMappingRevision: opaque-version
  error: PhysicsErrorDescriptor

PhysicsChannelTolerance:
  channelId: PhysicsChannelId
  norm: typed-norm
  maximumError: labelled-quantity-or-statistic
  maximumAge: PhysicsDuration
  requiredValidity: [validity-status]

PhysicsSampleRequest:
  requestId: PhysicsSampleRequestId
  contextId: PhysicsContextId
  providerId: PhysicsProviderId
  signalId: PhysicsSignalId
  schemaId: PhysicsSignalSchemaId
  requestedPhysicsTime: PhysicsTime
  requiredChannels: [PhysicsChannelId]
  optionalChannels: [PhysicsChannelId]
  queryFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  chartId: PhysicsChartId | TypedAbsence
  querySupport: PhysicsSupportDescriptor
  requestedFilter: PhysicsFilterDescriptor
  tolerancesByChannel: [PhysicsChannelTolerance]
  maximumStaleness: PhysicsDuration
  acceptableResidency: [residency-kind]
  acceptableLatency: PhysicsLatencyDescriptor
  batchExtent: typed-count-layout-and-byte-bound
  responseMode: values | ordered-resource-bindings
  exactOnceKey: request-sequence-key

PhysicsSampleResponseEnvelope:
  requestId: PhysicsSampleRequestId
  descriptorRef: PhysicsSignalDescriptorRef
  requestedPhysicsTime: PhysicsTime
  actualBundleTime: PhysicsTime
  resultStateVersion: opaque-version
  resourceGeneration: OptionalResourceGeneration
  channels: { channel-id: SampledChannel }
  absentChannels: { channel-id: TypedAbsence }
  representedSupport: PhysicsSupportDescriptor
  actualFilter: PhysicsFilterDescriptor
  latency: PhysicsLatencyDescriptor
  residency: PhysicsResidencyDescriptor
  validity: PhysicsValidityDescriptor
  error: PhysicsErrorDescriptor
  errorPropagationLedgerRef: ErrorPropagationLedgerId
  provenance: provider-adapter-build-and-revision
```

Every `PhysicsChannelDescriptor` declares value type, scalar/vector/tensor kind,
SI unit, basis/frame behavior, intensive/extensive classification, sampling
measure, actual sample interval, age, validity, and `errorRef`. The descriptor's
`perChannelError` map is the sole error authority and has exactly the same key
set as `channels`; each `errorRef` resolves to its corresponding entry. Do not
duplicate independently mutable error values in both places.
`PhysicsErrorDescriptor` declares norm/basis, bound or statistic, classification
(`hard-bound`, `measured-residual`, `statistical-uncertainty`, or `unknown`),
correlation/combination rule, and source. One aggregate error scalar cannot
replace per-channel errors.

`PhysicsResidencyDescriptor` declares kind, device/queue, binding identity,
same-queue availability, host visibility, mirror age/error, and readback policy;
the signal-level `OptionalResourceGeneration` is the sole resource-generation
authority. `PhysicsCadenceDescriptor` is one of analytic-on-demand,
fixed, adaptive, event-driven, or streamed and carries its labelled timing
parameters. `PhysicsLatencyDescriptor` separates production delay, consumer
availability, maximum staleness, and host-visible delay. The packed GPU form
uses stable descriptor-table handles plus SoA channel arrays; it does not
deep-copy descriptors into each hot sample or interaction.

A `PhysicsSampleRequest` carries context/provider/signal/schema IDs, a
`PhysicsInstant` or `PhysicsTimeInterval`, required and optional channel masks,
query points or oriented
footprints in physics-frame metres, requested filter/frequency response,
per-channel tolerances, maximum staleness, acceptable residency/latency, and
batch extent. A result returns the actual support, filter/band, interval, age,
versions, resource generation, and explicit `absentChannels`. Adapters may add
a channel only under a named approximation with error and provenance; they may
not synthesize an exact-looking zero.

Providers expose descriptor discovery plus batched sampling. GPU providers
return ordered resource bindings/handles; they do not trigger per-query host
readback. A CPU consumer that cannot tolerate the declared delayed mirror must
select a CPU/analytic adapter or block the coupling.

The descriptor clock, cadence clock, sample time, and latency/staleness mapping
must agree through registered clock mappings. Its frame transform revision must
resolve in the frame registry at the stated origin epoch. `validity.staleAfter`
and latency `maximumStaleness` are either the same typed duration or one is an
explicitly stricter consumer gate. A `present` resource generation must match
the residency binding; `absent` is valid for CPU/analytic state and cannot be
serialized as an empty string or null.

Use this channel envelope in every canonical sample:

```yaml
SampledChannel<T>:
  channelId: channel-id
  value: T
  unit: SI-unit
  actualPhysicsTime: PhysicsInstant | PhysicsTimeInterval
  actualSupport: spatial-or-directional-support
  actualFilter: PhysicsFilterDescriptor
  validity: valid | stale-within-gate | out-of-domain | unavailable | failed
  error: PhysicsErrorDescriptor
  stateVersion: opaque-version
```

The sample-level `validity` and `error` fields below summarize whether the
requested bundle can be used atomically; they never replace channel metadata.

## Canonical Provider Records

### `EnvironmentForcingSnapshot`

This immutable snapshot is the common forcing input for clouds, rain/snow,
water, vegetation, particles, creatures, structures, and thermal/radiometric
consumers. It is not mutable shared weather state and not a wave spectrum.

```yaml
EnvironmentForcingSnapshot:
  descriptor: PhysicsSignalDescriptor
  sampleInstant: PhysicsInstant
  airVelocityMps: SampledChannel<Vec3> | absent
  airDensityKgPerM3: SampledChannel<scalar> | absent
  airPressurePa: SampledChannel<scalar> | absent
  temperatureK: SampledChannel<scalar> | absent
  specificHumidityKgPerKg: SampledChannel<scalar> | absent
  turbulenceStatistics: SampledChannel<typed-statistics> | absent
  precipitationMassFluxKgPerM2S: SampledChannel<scalar> | absent
  precipitationPhase: SampledChannel<phase-or-mass-fractions> | absent
  precipitationVelocityMps: SampledChannel<Vec3> | absent
  mediumMaterialVelocityMps: SampledChannel<Vec3> | absent
  validity: atomic-bundle-validity
  error: per-channel-error-map-and-correlation
  absentChannels: [channel-id]
```

Temperature is kelvin `[G]`; a Celsius source converts in a named adapter.
`precipitationMassFluxKgPerM2S` is mass crossing the descriptor's oriented area
per time, positive from source to receiver. Derive water-equivalent depth only
from a declared phase density `[D]`. Do not reinterpret an area flux as a
volumetric source. If mixed phases are present, phase mass fractions sum to
unity within a declared `[G]` residual.

Aerodynamic consumers require air density or a declared equation-of-state
adapter; wind velocity alone does not determine force. Ocean-spectrum
initialization derives and validates a named reference-height wind such as
`U10`, stability correction, fetch, duration, averaging/filter band, and source
term. Raw instantaneous wind never parameterizes a spectrum directly.

### `PrecipitationEmissionSnapshot`

Cloud microphysics or another precipitation owner publishes a separate
immutable output:

```yaml
PrecipitationEmissionSnapshot:
  descriptor: PhysicsSignalDescriptor
  emissionInterval: PhysicsTimeInterval
  emittedMassFluxKgPerM2S: SampledChannel<scalar>
  phase: SampledChannel<phase-or-mass-fractions>
  emissionVelocityMps: SampledChannel<Vec3>
  airborneInventory: SampledChannel<MassInventory>
  transportDelay: PhysicsDuration
  destinationFootprint: spatial-support
  conservationGroupId: ConservationGroupId
```

It never mutates an `EnvironmentForcingSnapshot` already consumed in the same
graph interval. Schedule emission from interval `n` into forcing/rain interval
`n+1` with declared transport delay, or create a direct acyclic transport edge
whose producer precedes its consumer. Appearance-only clouds publish no
emission channel. Precipitation closure includes airborne inventory at both
interval endpoints, inflow/outflow, deposition, evaporation/sublimation, and
the numerical residual.

`MassInventory` is a tagged union: `total-mass` carries kg directly;
`density-field` carries kg m^-3 plus integration support, measure, quadrature,
filter, and error. Closure never integrates an untyped scalar/field.

### `WaterSurfaceSample`

`WaterSurfaceProvider` accepts batched `PhysicsSampleRequest` positions in
physics-frame metres and returns:

```yaml
WaterSurfaceSample:
  descriptor: PhysicsSignalDescriptor
  sampleInstant: PhysicsInstant
  surfaceParameterization: WaterSurfaceParameterization
  freeSurfacePoint: SampledChannel<Vec3>
  freeSurfaceNormal: SampledChannel<Vec3>
  geometricNormalVelocityMps: SampledChannel<scalar>
  surfacePointVelocityMps: SampledChannel<Vec3> | absent
  materialCurrentVelocityMps: SampledChannel<Vec3> | absent
  waterColumnDepthMeters: SampledChannel<scalar> | absent
  densityKgPerM3: SampledChannel<scalar> | absent
  materialAccelerationMps2: SampledChannel<Vec3> | absent
  pressurePa: SampledChannel<scalar> | absent
  bathymetryPoint: SampledChannel<Vec3> | absent
  wetDryState: SampledChannel<state> | absent
  representedFootprint: spatial-support
  filter: PhysicsFilterDescriptor
  validity: atomic-bundle-validity
  error: per-channel-error-map-and-correlation
  absentChannels: [channel-id]

WaterSurfaceParameterization:
  parameterizationId: opaque-id
  chartId: PhysicsChartId
  parameterizationRevision: opaque-version
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  coordinateMap: versioned-r-of-u-v-t
  gaugeConvention: fixed-chart-coordinates | material-labels | named-remap
  validityDomainAndSeams: typed-domain
  error: PhysicsErrorDescriptor
```

For a parameterized surface `r(u,v,t)`, `surfacePointVelocityMps` is the time
derivative at fixed coordinates of the exact serialized parameterization. Its
tangential component is gauge-dependent and must not be treated as geometric
interface motion. The gauge-invariant interface channel is
`geometricNormalVelocityMps = dot(surfacePointVelocityMps,
freeSurfaceNormal)` with its own propagated error; an implicit/level-set owner
may publish it directly and mark the full coordinate velocity absent.
`materialCurrentVelocityMps` is the material fluid velocity evaluated at the
query location. These are not interchangeable: free-surface kinematics,
buoyancy, drag, advection, spray, and camera tracking consume the one their
equations require. A spectral truncation query, phase-averaged
coastal query, heightfield sample, or delayed CPU mirror declares its actual
filter, omitted band, phase semantics, staleness, and error.

`freeSurfaceNormal` points from liquid into the exterior medium. Wet
`waterColumnDepthMeters` is nonnegative along the declared gravity/up direction;
dry queries report typed absence plus `wetDryState`, not negative depth.
`pressurePa` declares `absolute` or `gauge` and, for gauge pressure, its datum.
Each velocity/acceleration channel declares its evaluation point and is a
physical vector in `physicsFrameId`, not a moving-frame coordinate rate.

Local ripple, impact, wake, or displacement adapters must dimensionalize input
amplitude, wavelength/footprint, time, mass/momentum/volume semantics, and
attenuation. A normalized screen-space disturbance is not a physical source.

### `SupportSurfaceSample`

`SupportSurfaceProvider` covers static, rigid, kinematic, articulated, and
deforming supports without conflating a nearest-surface query with a contact
solver:

```yaml
SupportSurfaceSample:
  descriptor: PhysicsSignalDescriptor
  sampleInstant: PhysicsInstant
  supportId: SupportId
  featureId: FeatureId
  closestPointMeters: SampledChannel<Vec3>
  outwardNormal: SampledChannel<Vec3>
  signedSeparationMeters: SampledChannel<scalar> | absent
  pointVelocityMps: SampledChannel<Vec3> | absent
  pointAccelerationMps2: SampledChannel<Vec3> | absent
  physicsMaterialId: PhysicsMaterialId | absent
  oneSidedness: front | back | two-sided
  representedFootprint: spatial-support
  validity: atomic-bundle-validity
  error: per-channel-error-map-and-correlation
  absentChannels: [channel-id]
```

For deforming support, `pointVelocityMps` includes rigid-frame translation,
angular velocity cross lever arm, and local deformation velocity. A support
sample supplies geometry/kinematics; persistent contact manifolds, impulses,
friction state, warm starts, and separation events belong to the interaction
owner.

`outwardNormal` defines positive separation: `signedSeparationMeters > 0` is
separated along the outward normal, zero is touching within error, and negative
is penetration. One-sided rejection is evaluated before returning this sign.

### `LightingTransportSnapshot`

Use this record for typed radiometric transport consumed by water reflection,
caustics, atmosphere, vegetation energy balance, thermal models, and materials.
It is a `PhysicsSignalDescriptor` provider output, never an
`InteractionRecord`.

```yaml
LightingTransportSnapshot:
  descriptor: PhysicsSignalDescriptor
  sampleInstant: PhysicsInstant
  incidentRadiance: SampledChannel<spectral-radiance> | absent
  surfaceIrradiance: SampledChannel<spectral-irradiance> | absent
  directSolarIrradiance: SampledChannel<spectral-irradiance> | absent
  skyIrradiance: SampledChannel<spectral-irradiance> | absent
  transmittance: SampledChannel<dimensionless-spectrum> | absent
  sourceDirection: SampledChannel<Vec3-or-distribution> | absent
  attenuationFactorIds: [versioned-factor-id]
  skyIncludesDirectSolarDisc: true | false | absent
  validity: atomic-bundle-validity
  error: per-channel-error-map-and-correlation
  absentChannels: [channel-id]
```

Requests specify position, direction or receiver normal, spatial footprint,
solid-angle support, spectral basis, and `PhysicsInstant`. Each returned channel
declares its own radiometric quantity, SI unit, spectral/angular basis, filter,
and error; no bundle-wide basis overrides channel metadata. Track
every applied atmosphere, cloud-shadow, visibility, or medium attenuation by
versioned factor ID; reject duplicate or ambiguous attenuation. A boolean
"attenuated" flag is insufficient.

### Receiver accumulation ownership

Deposition, inundation/wash, melt, drainage, infiltration, evaporation,
runoff, compaction, and phase-change exchanges feed exactly one route-selected
receiver-state owner for each surface region and state equation. Rain, water,
snow, vegetation, and materials may publish or consume exchanges, but they may
not independently integrate competing wetness/snow stores. The owner publishes
versioned `PhysicsSignalDescriptor` channels such as liquid mass per area,
snow/ice mass per area, temperature, or coverage. Derive water-equivalent
depth, geometric snow height, and visual coverage through declared density,
compaction, and coverage maps; do not use a dimensionless mask as a conserved
inventory.

## `SurfaceExchange`, Interactions, Reactions, And Conservation

### Exchange envelope

Use `SurfaceExchange` for contact, wind loading, precipitation deposition,
fluid/body coupling, wakes, trampling, snow loading, heat transfer, erosion,
moving boundaries, and similar cross-domain exchanges:

```yaml
SurfaceExchange:
  exchangeId: SurfaceExchangeId
  contextId: PhysicsContextId
  applicationInterval: PhysicsTimeInterval
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  mode: one-way | two-way-explicit | two-way-iterated
  participants: [owner-id]
  sourceDescriptors: [PhysicsSignalDescriptorRef]
  interactions: [InteractionRecord]
  reactions: [InteractionRecord]
  reactionGroups: [InteractionReactionGroup]
  conservationGroups: [ConservationGroup]
  couplingLoopId: BoundedCouplingLoopId | absent
  stabilityGate: stability-model-and-bound
  convergence: residuals-and-status | not-applicable
  batchLedger: InteractionBatchLedger
```

One-way mode identifies the authoritative source and records a `[G]` upper
bound on omitted feedback or narrows the claim. Two-way explicit mode is valid
only under a declared partitioned-stability/added-mass gate. Otherwise use a
bounded predictor/exchange/solve/reaction/correct loop and measure convergence.
Equal-and-opposite linear impulse alone does not prove angular momentum,
energy, volume constraint, or coupling stability.

Every descriptor, record, reaction group, and conservation group resolves to
the exchange context, interval, registered frame, transform revision, and
origin epoch. A narrower interaction interval must be contained in the exchange
interval. Any cross-frame record is transformed by a named adapter before batch
publication; the receiver never guesses a frame conversion.

### Tagged dimensional interaction union

```yaml
InteractionRecord:
  interactionId: InteractionId
  exactOnceKey: collision-free-delivery-key
  role: source | reaction
  sourceOwner: owner-id
  sourceEntityId: EntityId-with-generation | absent
  sourceStateVersions: [signal-or-material-state-version]
  targetOwner: state-equation-owner
  targetEntityId: EntityId-with-generation | absent
  targetStateVersionExpected: opaque-version
  targetStateEquation: named-equation-and-term
  applicationInterval: PhysicsTimeInterval
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  footprint: InteractionFootprint
  payload: InteractionPayload # tagged union below
  signConvention: positive-source-to-receiver
  applicationLedgerKey: exact-once-ledger-key
  reactionGroupId: InteractionReactionGroupId | typed-absence
  reactionToInteractionIds: [InteractionId]
  conservationGroupIds: [ConservationGroupId]
  validity: typed-validity
  error: per-payload-and-footprint-error
  provenance: source-model-adapter-and-revision
```

`InteractionPayload` is a closed tagged dimensional union. Never put force,
impulse, traction, mass flux, volume flux, momentum flux, or heat flux into a
generic `value` or `vector` field.

| Payload tag | Time/support semantics | Required quantities |
| --- | --- | --- |
| `pointImpulse` | integrated over `applicationInterval` at one point | linear impulse in N s and application point in m; angular impulse about another origin is derived |
| `wrenchImpulse` | integrated over `applicationInterval` | linear impulse in N s plus independent angular impulse in N m s about a named point |
| `wrenchRate` | rate over interval | force in N; torque in N m about a named point |
| `surfaceTraction` | intensive area density | traction in Pa at oriented area quadrature points whose physical weights sum to represented area |
| `massRate` | extensive rate | species/phase mass rate in kg s^-1 |
| `massFlux` | intensive area rate | species/phase mass flux in kg m^-2 s^-1 at physical-area quadrature points |
| `massTransfer` | interval-integrated extensive transfer | species/phase mass in kg |
| `volumeRate` | extensive rate | volume rate in m^3 s^-1 with material/phase |
| `volumeFlux` | intensive area rate | normal volume flux in m s^-1 at physical-area quadrature points |
| `volumeTransfer` | interval-integrated transfer under a named material/constraint | volume in m^3 |
| `momentumFlux` | intensive oriented area rate | momentum-flux tensor in Pa at physical-area quadrature points |
| `momentumTransfer` | interval-integrated distributed transfer | linear momentum in N s and angular momentum in N m s about a named point |
| `heatRate` | extensive rate | power in W |
| `heatFlux` | intensive area rate | heat flux in W m^-2 at physical-area quadrature points |
| `heatTransfer` | interval-integrated thermal transfer | heat in J |
| `energyTransfer` | interval-integrated named energy commodity | energy in J with mechanical/chemical/radiative classification |
| `movingBoundary` | kinematic boundary over interval | boundary position/velocity and no-penetration/slip law |
| `constraintTarget` | algebraic/penalty target | constrained DOFs, target, compliance law, and work accounting |

The serialized footprint and every payload arm use these exact keys:

```yaml
InteractionFootprint:
  footprintId: InteractionFootprintId
  kind: point | line | area | volume
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  chartId: PhysicsChartId | TypedAbsence
  supportGeometry: versioned-support-geometry
  orientation: typed-orientation-or-TypedAbsence
  measureUnit: one | meter | square-meter | cubic-meter
  representedMeasure: Quantity
  distributionKind: point | intensive-field | extensive-distributed
  kernel: versioned-kernel-or-TypedAbsence
  kernelUnit: one | inverse-meter | inverse-square-meter | inverse-cubic-meter
  normalizationTarget: none | represented-measure | unity
  normalizationIntegral: labelled-quantity
  quadrature: points-physical-weights-Jacobians-and-error
  referencePointMeters: Vec3
  approximationError: PhysicsErrorDescriptor

PointImpulsePayload:
  tag: pointImpulse
  timeSemantics: interval-integrated
  linearImpulseNs: Vec3
  applicationPointMeters: Vec3

WrenchImpulsePayload:
  tag: wrenchImpulse
  timeSemantics: interval-integrated
  linearImpulseNs: Vec3
  angularImpulseNms: Vec3
  referencePointMeters: Vec3

WrenchRatePayload:
  tag: wrenchRate
  timeSemantics: rate
  forceN: Vec3
  torqueNm: Vec3
  referencePointMeters: Vec3

SurfaceTractionPayload:
  tag: surfaceTraction
  timeSemantics: rate
  tractionPaByQuadraturePoint: [Vec3]

MassRatePayload:
  tag: massRate
  timeSemantics: rate
  speciesPhaseMassRateKgPerS: typed-nonnegative-map

MassFluxPayload:
  tag: massFlux
  timeSemantics: rate
  speciesPhaseMassFluxKgPerM2SByQuadraturePoint: typed-nonnegative-map-array

MassTransferPayload:
  tag: massTransfer
  timeSemantics: interval-integrated
  speciesPhaseMassKg: typed-nonnegative-map

VolumeRatePayload:
  tag: volumeRate
  timeSemantics: rate
  volumeRateM3PerS: scalar
  materialPhaseId: id

VolumeFluxPayload:
  tag: volumeFlux
  timeSemantics: rate
  normalVolumeFluxMpsByQuadraturePoint: [scalar]
  materialPhaseId: id

VolumeTransferPayload:
  tag: volumeTransfer
  timeSemantics: interval-integrated
  volumeM3: scalar
  materialPhaseId: id
  constraintLawRef: id

MomentumFluxPayload:
  tag: momentumFlux
  timeSemantics: rate
  momentumFluxTensorPaByQuadraturePoint: [Mat3]

MomentumTransferPayload:
  tag: momentumTransfer
  timeSemantics: interval-integrated
  linearMomentumNs: Vec3
  angularMomentumNms: Vec3
  referencePointMeters: Vec3

HeatRatePayload:
  tag: heatRate
  timeSemantics: rate
  powerW: scalar

HeatFluxPayload:
  tag: heatFlux
  timeSemantics: rate
  heatFluxWPerM2ByQuadraturePoint: [scalar]

HeatTransferPayload:
  tag: heatTransfer
  timeSemantics: interval-integrated
  heatJ: scalar

EnergyTransferPayload:
  tag: energyTransfer
  timeSemantics: interval-integrated
  energyJ: scalar
  energyClassification: mechanical | chemical | radiative | phase-change | other-named

MovingBoundaryPayload:
  tag: movingBoundary
  timeSemantics: state-over-interval
  boundaryPositionMetersByQuadraturePoint: [Vec3]
  boundaryVelocityMpsByQuadraturePoint: [Vec3]
  noPenetrationAndSlipLawRef: versioned-law-ref

ConstraintTargetPayload:
  tag: constraintTarget
  timeSemantics: algebraic-over-interval
  constrainedDofs: typed-dof-set
  targetValues: typed-dimensioned-map
  complianceLawRef: versioned-law-ref
  workAccountingRef: ConservationGroupId
```

An `InteractionFootprint` declares point/line/area/volume measure, orientation,
support geometry, kernel, normalization integral, quadrature, reference point,
and approximation error. For `intensive-field`, payload values are physical
densities at quadrature points and quadrature weights have physical measure;
their sum equals `representedMeasure` within the gate. No normalized kernel is
multiplied into the density. For `extensive-distributed`, the payload is one
extensive rate or transfer and the footprint kernel has inverse-measure units
and integrates to unity. Confusing these two paths is a dimensional failure,
not a harmless normalization choice. The receiver applies a rate only over interval overlap; it
applies an integrated payload once, never once per substep. `targetStateEquation`
prevents a mass flux from being accidentally applied as a momentum or height
source.

Payload and footprint kinds are coupled. `pointImpulse` requires a point
footprint; an area/volume-distributed impulse uses `momentumTransfer`;
`surfaceTraction`, `massFlux`, `volumeFlux`, `momentumFlux`, and `heatFlux`
require an oriented area measure. `pointImpulse` carries no independent free
couple. Use `wrenchImpulse` when a linear impulse and an independent angular
impulse are both required.
For mass, species, and volume transfers, positive means a nonnegative amount
leaves the ordered source and enters the ordered receiver. Linear/angular
momentum and heat/energy payloads are signed components in the declared physics
frame/basis delivered to the receiver; reversing endpoints creates a distinct
record with transformed payload, never a second legal encoding of the same
record.

### Spatial-vector frame transport

Rigid-body twists and wrenches use explicit SE(3) adjoint/coadjoint transport,
not component-wise rotation. For `B <- A` with `p_B = R_BA p_A + t_BA`, define
`[x]_x y = x cross y`. With twists ordered `[omega; v_at_origin]` and
wrenches ordered `[tau_about_origin; force]`, the exact matrices are:

```text
Ad(T_BA) = [ R_BA            0   ]
            [ [t_BA]_x R_BA  R_BA ]

Ad(T_BA)^(-T) = [ R_BA  [t_BA]_x R_BA ]
                 [   0          R_BA    ]

V_B = Ad(T_BA) V_A
F_B = Ad(T_BA)^(-T) F_A
omega_B = R_BA omega_A
v_at_B_origin_B = R_BA v_at_A_origin_A + t_BA x (R_BA omega_A)
force_B = R_BA force_A
tau_about_B_origin_B = R_BA tau_about_A_origin_A
                       + t_BA x (R_BA force_A)
tau_about_q = tau_about_p + (p - q) x force
angularImpulse_about_q = angularImpulse_about_p + (p - q) x linearImpulse
```

Here `t_BA` is the position of A's origin measured from B's origin and expressed
in B. The displayed coadjoint follows from the displayed adjoint; changing the
ordering or the direction of `t_BA` changes the blocks and is a schema change.
Every wrench/impulse payload serializes its reference point; transport records
the source/destination frames, transform revision, origin epoch, and induced
torque shift. Validate both `F_B^T V_B = F_A^T V_A` and round-trip transport
within the error gate. A coordinate-rate frame transport from the earlier
section is not a rigid-body twist transform and cannot substitute for it.

### Reaction grouping

Do not require a one-to-one source/reaction topology. Distributed coupling may
split one source across several reactions or reduce several sources into one
reaction. Serialize the atomic relation:

```yaml
InteractionReactionGroup:
  reactionGroupId: InteractionReactionGroupId
  contextId: PhysicsContextId
  exchangeId: SurfaceExchangeId
  applicationInterval: PhysicsTimeInterval
  sourceInteractionIds: [InteractionId]
  reactionInteractionIds: [InteractionId]
  acceptance: all-or-none
  orderedReduction: deterministic-tree-and-floating-point-mode
  balanceFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  balanceTransformRevision: opaque-version
  balanceReferencePoint: point-in-balance-frame
  conservationGroupIds: [ConservationGroupId]
  residualsAndBounds: typed-commodity-residuals
```

Each interaction belongs to at most one reaction group for a given conserved
commodity. Source/reaction payloads are transported to the group's balance
frame/reference point before testing signs, impulse, torque, heat, mass, or
energy. Exact-once keys use the canonical interval identity, stage order,
producer ID/sequence, and interaction ID; a redundant tick field that can
disagree with the interval is forbidden.

A `PhysicsSignalDescriptorRef` is a stable descriptor-table ID and version, not
an embedded deep copy. Pack hot `InteractionRecord` batches as
descriptor-indexed SoA data while preserving the canonical semantic record.

`InteractionBatchLedger` records published sequence range, accepted/rejected/
late/duplicate counts, per-consumer cursor, overflow policy, and the lost or
deferred amount of every conserved commodity. Repeated render frames do not
replay an event; skipped render frames do not discard it. Source and required
reaction records in one `InteractionReactionGroup` are accepted atomically or
the entire group is rejected.

```yaml
InteractionBatchLedger:
  batchId: InteractionBatchId
  exchangeId: SurfaceExchangeId
  producerId: owner-id
  publishedSequenceRange: closed-monotonic-range
  perConsumerCursor: { consumer-id: next-sequence }
  acceptedRejectedLateDuplicate: typed-labelled-counts
  overflowPolicy: block | reject-batch | bounded-defer | lossy-with-failed-conservation
  overflowSequenceRanges: [closed-monotonic-range]
  lostCommodities: typed-commodity-map
  deferredCommodities: typed-commodity-map
  exactOnceApplicationLedgerVersion: opaque-version
```

### Contact manifolds and discrete exchange

Keep `ContactManifoldRecord` separate from `SupportSurfaceSample`:

```yaml
ContactManifoldRecord:
  descriptor: PhysicsSignalDescriptor
  manifoldId: ContactManifoldId-with-generation
  contextId: PhysicsContextId
  owner: contact-solver-owner-id
  solverIdAndRevision: deterministic-solver-build-and-law-revision
  lifecycle: begin | persist | end
  validityInterval: PhysicsTimeInterval
  sampleInstant: PhysicsInstant
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  bodyA: { entityId, colliderId, shapeId, featureIds, stateVersion }
  bodyB: { entityId, colliderId, shapeId, featureIds, stateVersion }
  materialA: { physicsMaterialId, materialStateId, materialStateVersion, sampleInstant }
  materialB: { physicsMaterialId, materialStateId, materialStateVersion, sampleInstant }
  normalConvention: A-to-B
  manifoldPatch:
    referencePointMeters: Vec3
    tangentBasis: typed-orthonormal-basis
    patchAreaM2: Quantity<square-meter>
    points:
      - { persistentPointId, pointMeters, featurePair, areaWeightM2 }
  signedSeparationMeters: per-point-values-and-error
  separationConvention: positive-separated-zero-touching-negative-penetrating
  timeOfImpact: PhysicsInstant | typed-absence
  relativePointVelocityMps: per-point-A-relative-to-B
  constitutivePairLaw: deterministic-versioned-law
  frictionAdhesionState: solver-owned-state | TypedAbsence
  warmStartImpulses: solver-owned-state | TypedAbsence
  emittedInteractionIds: [InteractionId]
  validity: typed-validity
  error: per-contact-channel-error
  resetMigrationPolicy: typed-policy
```

The declared contact-solver `owner` exclusively advances manifold lifecycle,
internal friction/adhesion state, warm starts, and emitted impulses. The
manifold owns collider/shape/feature pairs, persistent point IDs,
separation state, friction/adhesion internal state, warm-start impulses, solver
revision, validity interval, and reset/migration policy. Its relative velocity
includes both frames' translation, angular `omega x r`, and local deformation.
The deterministic material-pair key latches both material-state versions in one
physics interval. Rebuild or invalidate the manifold when topology, shape
generation, material law, time discontinuity, or quality transition violates
its gate. The collision solver owns impulses; support/geometry providers do
not.

Grid/particle/mesh gather and scatter pairs declare whether they form a
discrete-adjoint pair under a named inner product. Validate zeroth and first
kernel moments, net force/torque, virtual work, and energy dissipation/injection.
Using the same-looking kernel in both directions is not adjointness evidence.

### Conservation groups

```yaml
ConservationGroup:
  conservationGroupId: ConservationGroupId
  contextId: PhysicsContextId
  interval: PhysicsTimeInterval
  participants: [owner-id]
  referencePhysicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  angularMomentumReference:
    kind: fixed-inertial-point | moving-point-with-transport
    pointAtStartMeters: Vec3
    trajectoryAndVelocity: typed-trajectory | typed-absence
    transportTerms: typed-angular-momentum-transport | typed-absence
  commodities: [mass, linear-momentum, angular-momentum, energy, species]
  explicitConstraints: [incompressible-volume] | []
  initialInventory: typed-commodity-map
  finalInventory: typed-commodity-map
  externalSources: typed-commodity-map
  boundaryFluxes: typed-commodity-map
  modeledInternalTransfers: participant-pair-commodity-map
  modeledConversions: input-output-stoichiometric-commodity-map
  modeledDissipation: nonnegative-physical-sink-map
  numericalResidual: typed-commodity-map
  residualNorms: typed-norm-map
  acceptanceBounds: typed-Quantity-map
```

For each declared commodity `Q`, evaluate

```text
[D] residual_Q = final_Q - initial_Q - externalSource_Q + boundaryOutflow_Q
                 - modeledConversion_Q + modeledDissipation_Q
```

with signs and integration measures serialized. Use an inertial physics frame
and fixed inertial reference point, or include non-inertial and moving-origin
transport terms. A body center of mass is not a fixed reference merely because
it is convenient. Volume is not generally conserved under
phase change or compressibility; include it only as an explicit material/model
constraint. `modeledInternalTransfers` must cancel over the closed participant
set and detects one-sided or duplicated applications; it is not subtracted from
the group total. Cross-commodity conversions use a dimensionally valid named
stoichiometric/constitutive map. Conservation does not imply energy preservation
for a dissipative law: record physically modeled dissipation separately from
conversion, boundary loss, and numerical residual.

## Physics Materials And Physical Proxies

### `PhysicsMaterialRegistry`

`PhysicsMaterialId` is independent of Three.js/PBR material identity. A render
material may bind to a physics material explicitly; color, roughness, or
metalness never infer contact or transport properties.

```yaml
PhysicsMaterialRegistry:
  registryId: PhysicsMaterialRegistryId
  owner: material-registry-owner-id
  registryVersion: opaque-version
  materials:
    PhysicsMaterialId:
      densityKgPerM3: Quantity | absent
      contactLaw: versioned-law-and-parameters | absent
      frictionLaw: versioned-law-and-parameters | absent
      restitutionLaw: versioned-law-and-parameters | absent
      complianceDampingLaw: versioned-law-and-parameters | absent
      adhesionCohesionLaw: versioned-law-and-parameters | absent
      permeabilityPorosityLaw: versioned-law-and-parameters | absent
      wettingContactAngleLaw: versioned-law-and-parameters | absent
      dragRoughnessLaw: versioned-law-and-parameters | absent
      thermalConductivityWPerMK: Quantity | absent
      specificHeatJPerKgK: Quantity | absent
      emissivitySpectrum: typed-spectrum | absent
      phaseChangeLaw: versioned-law-and-parameters | absent
      uncertainty: per-property-error-map
      provenance: source-record
  materialStateDescriptors: [PhysicsSignalDescriptorRef<PhysicsMaterialState>]
  pairLawResolver:
    resolverIdAndVersion: deterministic-resolver-revision
    participantOrdering: ordered-A-B-with-contact-frame
    explicitPairOverrides: versioned-pair-map
    perLawCompositionRules: versioned-named-rules
    missingPairPolicy: block | named-approximation-with-error
  renderBindings: optional-explicit-map

PhysicsMaterialState:
  descriptor: PhysicsSignalDescriptor
  materialStateId: PhysicsMaterialStateId-with-generation
  physicsMaterialId: PhysicsMaterialId
  owner: material-state-equation-owner
  stateVersion: opaque-version
  sampleInstant: PhysicsInstant
  validityInterval: PhysicsTimeInterval
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  temperatureK: SampledChannel<scalar> | TypedAbsence
  liquidSaturation: SampledChannel<scalar> | TypedAbsence
  iceMassFraction: SampledChannel<scalar> | TypedAbsence
  phaseMassFractions: SampledChannel<typed-map> | TypedAbsence
  damageOrCompactionState: SampledChannel<typed-state> | TypedAbsence
  constitutiveInputs: versioned-dimensioned-map
  validity: PhysicsValidityDescriptor
  error: per-channel-error-map
```

Friction and restitution are laws over the variables their model requires, not
universal scalars. Missing properties remain absent. A solver either blocks the
affected interaction or selects a named `[A]` approximation with a `[G]` error/
claim gate; it never receives an implicit zero or global default.
Dynamic wetness, ice, temperature, phase, damage, or compaction lives in
`PhysicsMaterialState`; it does not mutate the registry or hide inside a render
material. The pair resolver, participant ordering, contact frame, both
material-state IDs/versions/sample instants, and every selected law revision are latched for the entire interaction
interval. Do not assume arithmetic/geometric averaging or commutativity.

### `ColliderProxy`

```yaml
ColliderProxy:
  colliderId: ColliderId-with-generation
  entityId: EntityId-with-generation
  shapeId: ShapeId-with-generation
  contextId: PhysicsContextId
  shapeFrameId: PhysicsFrameId
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  shapeRepresentation: analytic | convex | mesh | sdf | compound | external
  shapeDefinitionRef: versioned-parameters-or-resource
  topologyRevision: opaque-version
  poseSignalRef: PhysicsSignalDescriptorRef
  poseStateVersion: opaque-version
  validityInterval: PhysicsTimeInterval
  updateCadence: PhysicsCadenceDescriptor
  sweptBounds: typed-bounds-and-interval
  oneSidedness: front | back | two-sided
  closedness: open | closed | watertight-with-gate
  collisionMode: discrete | continuous-with-named-sweep
  featureIdPolicy: stable-versioned-remap-policy
  conservativeInflationMeters: Quantity<meter>
  physicsMaterialId: PhysicsMaterialId
  collisionGroups: explicit-filter
  approximationError: PhysicsErrorDescriptor
  residency: PhysicsResidencyDescriptor
```

The visible mesh is not automatically a collider. Declare one-sidedness,
closedness/watertightness where required, feature-ID stability, conservative
inflation, continuous/discrete collision mode, and update cadence. The
shape-to-physics pose resolves through `shapeFrameId`, `poseSignalRef`, exact
pose version, transform revision, and origin epoch; an ID plus an opaque pose
version is not enough to place a collider. A
`DeformingSupportProxy` additionally declares deformation source/version,
position and velocity sampler, conservative swept bounds, topology-change
policy, and support-feature remapping.

### `RigidBodyProperties`

```yaml
RigidBodyProperties:
  entityId: EntityId-with-generation
  owner: rigid-state-owner
  massKg: Quantity
  centerOfMassBodyMeters: Quantity<Vec3>
  inertiaTensorBodyKgM2: Quantity<Mat3>
  bodyFrameId: PhysicsFrameId
  colliderIds: [ColliderId-with-generation]
  physicsMaterialIds: [PhysicsMaterialId]
  stateEquation: named-integrator-and-constraints
  forceTorqueApplicationOwner: owner-id
  error: per-property-error-map
```

Require a positive mass and physically valid symmetric inertia tensor under the
selected body model `[G]`. Pose, twist, and committed state versions live with
the state owner, not in this immutable property record.

### `RigidBodyState`

Use this dynamic boundary record for procedural motion, contact, fluid/body
coupling, external rigid-body engines, and presentation. It describes state; it
does not select an integrator or collision algorithm.

```yaml
SpatialReferencePoint:
  kind: center-of-mass | explicit-point
  pointMeters: Vec3
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  sampleInstant: PhysicsInstant

RigidBodyState:
  descriptor: PhysicsSignalDescriptor
  entityId: EntityId-with-generation
  owner: rigid-state-owner
  stateVersion: opaque-version
  sampleInstant: PhysicsInstant
  validityInterval: PhysicsTimeInterval
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  bodyFrameId: PhysicsFrameId
  centerOfMassPositionMeters: SampledChannel<Vec3>
  bodyToPhysicsRotation: SampledChannel<Quaternion-or-Mat3>
  twist:
    ordering: angular-then-linear-at-reference-point
    angularVelocityRadPerS: SampledChannel<Vec3>
    linearVelocityMps: SampledChannel<Vec3>
    referencePoint: SpatialReferencePoint
  acceleration: typed-spatial-acceleration | typed-absence
  motionMode: dynamic | kinematic | static | sleeping
  committedDisposition: committed-publication
  error: per-state-channel-error-map
```

The rotation is proper and normalized within a gate. The twist is a physical
spatial velocity, not a coordinate-rate tuple; transport it with the declared
SE(3) adjoint. Shifting the same-frame linear velocity from point `p` to `q`
uses `v(q) = v(p) + omega cross (q - p)` with both points expressed in the
serialized frame at the same instant; then any cross-frame adjoint is applied.
The point is never implied by the word `explicit`. A kinematic/static state
still names its owner and version.
The record owner/version/frame/epoch/revision and every channel time/version
must agree with its descriptor; duplicated fields are integrity checks, not
independent authorities.
Forces and impulses target the state owner's named momentum equation through
`InteractionRecord`; no consumer mutates this immutable publication directly.

### `HydrostaticHullProperties`

```yaml
HydrostaticHullProperties:
  entityId: EntityId-with-generation
  hullFrameId: PhysicsFrameId
  geometry: closed-volume | signed-distance | clipped-panels | quadrature-set
  geometryRevision: opaque-version
  displacedVolumeQuery: versioned-query
  waterlineClipping: named-algorithm
  buoyancyModel: hydrostatic | Froude-Krylov | named-extension
  dragModel: versioned-law | absent
  addedMassModel: versioned-law | absent
  waveExcitationModel: versioned-law | absent
  samplingFootprint: spatial-support
  approximationError: per-output-error-map
  validity: regime-and-domain
```

Hydrostatic buoyancy integrates pressure or displaced volume from the same
filtered water state used by the coupling schedule. Drag consumes material
fluid velocity relative to the body, not surface-point velocity. Added-mass or
wave-excitation terms require a stability/convergence gate and may not duplicate
forces already present in the water solver. A visual hull is eligible only
after watertightness/orientation/volume and approximation errors pass.

## Coupling Schedules, CPU/GPU Ordering, And External Solvers

### One-way and two-way schedules

Use this one-way sequence:

```text
source commit -> sample immutable source version -> receiver predict
-> emit rate/integral records -> receiver solve-subcycles -> receiver commit
```

Record the omitted reaction and its validity bound. A later visual response
must not feed back through an undocumented path.

Use this two-way sequence:

```text
both owners predict -> sample the same coupling-time bracket
-> emit source records -> solve native subcycles -> reduce reaction records
-> correct both owners -> conservation/stability check -> atomic commit
```

When a partitioned pass is not stable under the added-mass/stiffness gate, put
the exchange in a `BoundedCouplingLoop`, recompute consistent source/reaction
records each iteration, test the declared residuals, and commit only the
accepted iterate. Do not publish one participant while the other fails.

### GPU state and barriers

Do not collapse these distinct facts:

```yaml
GpuStatePublication:
  logicalStateVersion: opaque-version
  resourceGeneration: opaque-version
  producingStageId: stage-id
  queueSubmissionEpoch: opaque-sequence | not-submitted
  sameQueueAvailableAfter: typed-gpu-dependency
  deviceCompletionToken: opaque-token | unavailable
  hostVisibleCompletionEpoch: opaque-sequence | not-host-visible
  leasedResources: [resource-slot-and-generation]
```

- `logicalStateVersion` is the state a later correctly ordered GPU consumer may
  read.
- `queueSubmissionEpoch` proves command submission, not device completion.
- `deviceCompletionToken` proves completion only under its backend semantics.
- `hostVisibleCompletionEpoch` exists only after the required fence/map/copy has
  completed. Promise resolution from dispatch submission is not such proof.

Every graph edge names one typed dependency: CPU data dependency, GPU pass or
dispatch boundary, same-queue resource transition, cross-queue synchronization,
explicit copy/map, external fence, or no barrier required. Workgroup barriers
do not order different workgroups; atomics do not replace a global phase
boundary. Ping-pong or version resources when a dispatch has a global
read-after-write dependency.

No frame-critical path may require GPU-to-CPU readback `[G]`. Use a GPU consumer,
an analytic/CPU mirror with declared error and latency, or a delayed diagnostic
path. Record uploads, copies, maps, synchronization stalls, and resource-state
transitions in the graph/cost ledgers.

Pin every state resource referenced by a presentation candidate or snapshot
through all render consumers and queue submission. Retire it only after the
declared multi-consumer completion join. Logical immutability without resource lifetime
ownership is insufficient.

An authoritative GPU-only solver also publishes recovery semantics:

```yaml
AuthoritativeGpuStateRecovery:
  recoveryId: opaque-id
  contextId: PhysicsContextId
  owner: state-equation-owner
  authoritativeSignalIds: [PhysicsSignalId]
  recoveryMode: restore-and-replay | discontinuous-restart
  authoritativeResidency:
    deviceId: device-id
    backendGeneration: opaque-version
    deviceLossGeneration: opaque-version
    bindings:
      - { signalId, logicalStateVersion, resourceGeneration, layoutRevision,
          subresource, access, aliasingPolicy }
  checkpointPolicy:
    cadence: PhysicsCadenceDescriptor
    checkpointResidency: gpu-redundant | cpu | external
    maximumRollback: PhysicsDuration
    maximumRecoveryError: PhysicsErrorDescriptor
  latestCheckpoint: GpuCheckpointState | TypedAbsence
  replayLogCoverage: PhysicsTimeInterval | typed-absence
  restoreTransaction: GpuDeviceLossRestoreTransaction | TypedAbsence
  restartTransaction: GpuDiscontinuousRestartTransaction | TypedAbsence
  unrecoverablePolicy: block-route | execute-declared-restart

GpuCheckpointState:
  checkpointId: opaque-id
  contentDigest: collision-resistant-digest
  contextVersion: opaque-version
  graphAndMaterialRegistryVersions: [typed-version-ref]
  frameClockAndMappingRevisions: [typed-version-ref]
  committedVersions: [typed-version-ref]
  checkpointInstant: PhysicsInstant
  physicsOriginEpoch: PhysicsOriginEpoch
  resourceGenerations: [opaque-version]
  conservedInventories: typed-commodity-map
  stableIdRngEventAndLedgerCursors: typed-cursor-map

GpuDeviceLossRestoreTransaction:
  freezeCommitGroupIds: [PhysicsCommitGroupId]
  invalidateDeviceAndResourceGenerations: [typed-generation-ref]
  retireLostPresentationLeasesBy: device-loss-generation
  restoreCheckpointId: opaque-id
  restoreTargetResidency: typed-device-resource-layout-bindings
  replayInterval: PhysicsTimeInterval | TypedAbsence
  replayInteractionEventRanges: [producer-consumer-sequence-range]
  restoreLedgerCursorsBeforeReplay: typed-cursor-map
  validationGates: [finite-conservation-constraint-and-error-gate]
  atomicPublicationCommitGroupId: PhysicsCommitGroupId
  publishedDeviceLossGeneration: opaque-version

GpuDiscontinuousRestartTransaction:
  freezeCommitGroupIds: [PhysicsCommitGroupId]
  invalidateDeviceAndResourceGenerations: [typed-generation-ref]
  affectedStateEquationsAndSignals: [id]
  lostInventoriesInteractionsAndEvents: typed-loss-ledger
  restartInitialStateAndProvenance: typed-state-set
  newDiscontinuityEpoch: opaque-version
  resetActions: [ScopedResetAction-ref]
  validationGates: [finite-domain-and-loss-accounting-gate]
  atomicPublicationCommitGroupId: PhysicsCommitGroupId
  publishedDeviceLossGeneration: opaque-version
```

Checkpoint copies/maps are asynchronous graph work and appear in traffic,
memory, and latency ledgers; they never become hidden frame-critical readback.
On device loss, `restore-and-replay` requires active checkpoint policy/state and
restore transaction while `restartTransaction` is typed absence. It freezes
affected commit groups, invalidates the lost device/resource generation,
restores one internally consistent checkpoint, replays the exact-once
interaction/event range once, re-runs conservation/error gates, and atomically
publishes a new generation. `discontinuous-restart` makes the checkpoint and
restore arms typed absence and requires the restart transaction with complete
loss accounting, a new discontinuity epoch, and reset plan. If neither proof is
available, block; never continue from partially reconstructed visual state.

The checkpoint digest covers canonical bytes for every listed state version,
inventory, stable-ID/RNG/event/application-ledger cursor, and referenced
context/graph/material/frame/clock revision. Restore rejects a partial digest,
unknown layout, missing cursor, or resource generation from the lost device.
`restoreLedgerCursorsBeforeReplay` and the replay sequence ranges form one
exact-once boundary: restore the pre-range cursor, replay the closed range, then
publish its post-range cursor in the atomic commit. A redundant GPU checkpoint
counts only if it resides in a separately failure-isolated allocation/device
named by the policy.

### `ExternalSolverAdapter`

```yaml
ExternalSolverAdapter:
  adapterId: PhysicsProviderId
  externalSolverIdVersion: solver-and-build-identity
  contextId: PhysicsContextId
  boundaryRevision: opaque-version
  ownedStateEquations: [named-equation]
  ownership:
    stepping: external-solver | route-owner-id
    constraintAssemblyAndSolve: external-solver | route-owner-id
    collisionDetection: external-solver | route-owner-id
    contactManifoldLifecycle: external-solver | route-owner-id
    forceImpulseAccumulation: external-solver | route-owner-id
    committedStatePublication: external-solver | route-owner-id
  supportedFramesCharts: [id]
  unitConversion:
    sourceUnitSystemId: versioned-id
    destinationUnitSystemId: canonical-SI
    perQuantityAffineOrLinearMaps: typed-dimension-checked-map
    handednessAndAxialConvention: exact-ingress-egress-map
    conversionError: per-quantity-error-map
  clockMapping:
    externalClockId: PhysicsClockId
    contextClockId: PhysicsClockId
    mappingRevision: opaque-version
    mappingDescriptorRef: PhysicsClockDescriptorRef
    maximumAgeAndMappingError: typed-gates
  stepSemantics: analytic | fixed | adaptive | event | remote-stream
  signalDescriptors: [PhysicsSignalDescriptor]
  acceptedInteractions: [InteractionPayload-tag]
  emittedReactions: [InteractionPayload-tag]
  residencySynchronization:
    authorityBySignalOrStateEquation: explicit-owner-map
    transport: shared-resource | device-copy | host-staging | network-message
    resourceProtocol:
      handleAndLayoutKinds: versioned-ABI
      producerAccessAndConsumerAccess: typed-access-map
      generationAndSubresourceFields: explicit-field-map
      acquireDependency: PhysicsGraphEdge-barrier
      releaseOrCompletionToken: typed-token
      lifecycleAndRetirementOwner: owner-id
    transferProtocol:
      serializationLayoutAndDigest: versioned-layout-and-content-digest
      endianPrecisionAndQuantization: explicit-representation
      sequenceAndExactOnceKeys: typed-sequence-schema
      maximumBytesCadenceLatencyAndStaleness: typed-gates
    hostVisibilityProof: device-completion-plus-copy-map | external-fence-and-validated-transfer | not-host-visible
  precisionDeterminism:
    scalarFormatsAndAccumulationMode: explicit-map
    reductionOrdering: deterministic-tree | declared-nondeterministic-with-error
    solverSeedAndStreamIdentity: typed-cursor-map | typed-absence
    replayEquivalenceGate: bitwise | bounded-observable-error | unsupported
  errorModel: per-channel-and-coupling-errors
  checkpointRollback:
    support: none | checkpoint | checkpoint-and-replay
    checkpointFormatAndDigest: versioned-format | typed-absence
    cadenceAndMaximumRollback: typed-policy | typed-absence
    includedStateVersionsInventoriesAndCursors: explicit-set | typed-absence
    restoreOrderingAndValidationGates: typed-stage-plan | typed-absence
  failurePolicy:
    detectionAndTimeout: typed-gates
    freezeCommitGroups: [PhysicsCommitGroupId]
    priorCommittedStateDisposition: preserve | invalidate-with-discontinuity
    queuedInteractionEventDisposition: drain | retain-for-replay | reject-and-ledger
    recoveryOwnerAndPlan: owner-and-transaction-ref | typed-absence
    degradedPublication: forbidden | explicit-signals-errors-and-quality-epoch
```

Convert units, frames, handedness, and time at exactly one named adapter
boundary. Preserve stable IDs and source versions through serialization. Every
ownership field names exactly one side; split collision/contact ownership also
defines the typed handoff between them. No implicit engine default may own
stepping, constraints, collisions, manifold lifecycle, accumulation, or commit.
Expose interpolation, extrapolation, and delayed-state error instead of hiding
network/process latency.

A shared-resource transport must match device, backend generation, resource
generation, layout, access, subresource, and acquire/release dependency; a
handle string alone is invalid. Copy, staging, and network transports carry a
content digest plus exact sequence/application keys, and are charged to the
traffic/latency ledger. `hostVisibilityProof` cannot claim host visibility from
submission alone. If checkpoint support is `none`, all other checkpoint fields
are typed absence and the failure policy must block or publish an explicit
discontinuity; an opaque “best effort” recovery mode is forbidden.

An external engine does not bypass `PhysicsGraph`, interaction typing,
conservation, quality migration, presentation snapshots, or evidence gates. If
it cannot expose a required channel or synchronization fact, mark it absent and
block or narrow the coupled claim.

## Physics Presentation And Reactive State

Presentation is an explicit acyclic publication chain:

```text
committed physics/origin transaction
  -> view-independent PhysicsPresentationCandidate
  -> per-view CameraViewPublication
  -> per-view ViewPreparationPublication (visibility, shadows, caches, resets)
  -> sealed PhysicsPresentationSnapshot
  -> FrameExecutionRecord
```

No record is mutated by a later phase. A phase consumes only immutable prior
records and emits a new version. This permits a physics-follow camera to consume
the candidate before selecting a render origin, without forcing the candidate
to contain a stale or circular camera transform.

### View-independent candidate

After all physical owners and any physics-origin transaction commit, publish:

```yaml
PhysicsPresentationCandidate:
  candidateId: PhysicsPresentationCandidateId
  contextId: PhysicsContextId
  presentationEpoch: PhysicsPresentationEpoch
  requestedPresentationInstant: PhysicsInstant
  physicsOriginEpoch: PhysicsOriginEpoch
  candidateScope: committed-state-brackets-leases-and-events
  presentedStatePairs: [PresentedStatePair]
  resourceLeases: [PresentationResourceLease]
  eventSequenceRanges: [PresentationEventRange]

PresentationEventRange:
  rangeId: PresentationEventRangeId
  producerId: owner-id
  consumerId: target-view-or-shared-consumer-id
  streamId: event-stream-id
  firstSequence: integer
  lastSequenceInclusive: integer
  sourceStateVersion: opaque-version
  interval: PhysicsTimeInterval
  cursorBefore: integer
  cursorAfter: integer
  payloadDigest: collision-resistant-digest
```

The candidate contains no camera, render origin, view matrix, shadow/cache
epoch, or global-to-render mapping. Candidates may be shared by views whose
requested physical state pairs and event ranges are identical even when their
cameras, projections, render origins, resolutions, or shadow policies differ.

Each previous/current presented state has independent provenance:

```yaml
PresentationSampleProvenance:
  sourceClockId: PhysicsClockId
  requestedPresentationInstant: PhysicsInstant
  mappedSourceInstant: PhysicsInstant
  clockMapRevision: opaque-version
  clockMapError: PhysicsErrorDescriptor
  lowerBracket:
    { stateVersion, sampleInstant, physicsFrameId, physicsOriginEpoch,
      transformRevision, resourceGeneration }
  upperBracket:
    { stateVersion, sampleInstant, physicsFrameId, physicsOriginEpoch,
      transformRevision, resourceGeneration }
  interpolation: named-policy-alpha-and-error
  extrapolation: named-policy-age-and-error | typed-absence

PresentationStateHandle:
  leaseId: lease-id
  resourceGeneration: opaque-version
  deviceLossGeneration: opaque-version
  layoutRevision: opaque-version
  subresourceOrCpuSlice: typed-range

PresentationSpatialBinding:
  kind: rigid | skinned | procedural-deformation | particles | field
  sourcePhysicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  bindingPayload: typed-rigid-pose-skeleton-deformer-particle-or-field-binding

PresentedStatePair:
  bindingId: stable-binding-id
  entityId: EntityId-with-generation | typed-absence
  providerId: PhysicsProviderId
  signalId: PhysicsSignalId
  previousPresented:
    provenance: PresentationSampleProvenance
    presentedInstant: PhysicsInstant
    stateHandle: PresentationStateHandle
    globalBinding: PresentationSpatialBinding
    originEpochBridge: PhysicsOriginEpochBridge | typed-absence
  currentPresented:
    provenance: PresentationSampleProvenance
    presentedInstant: PhysicsInstant
    stateHandle: PresentationStateHandle
    globalBinding: PresentationSpatialBinding
    originEpochBridge: PhysicsOriginEpochBridge | typed-absence
  motionBinding:
    kind: rigid | skinned | procedural-deformation | particles | field
    storageRepresentation: cpu-struct | gpu-structured-buffer | texture-field | external-handle | named-packed-layout
    previousStateHandle: PresentationStateHandle
    currentStateHandle: PresentationStateHandle
    identitySlotMap: versioned-map
    motionVectorValidity: valid | spawn | despawn | teleport | reparent | lod-change | slot-reuse | discontinuity | unavailable
```

There is no graph-wide interpolation alpha or simulation version. Each
binding/provider maps both the previous and current presentation instants to its
own clock and brackets, with a named map revision and error. Bracket order,
derived alpha, frame/origin/transform compatibility, and resource generations
are validated independently for both states. A physics-origin discontinuity
either supplies a proven state transform across epochs or invalidates motion;
adjacent solver states are not a substitute for previous/current presented
state.

`PhysicsOriginEpochBridge` is
`{ transactionId, fromPhysicsOriginEpoch, toPhysicsOriginEpoch,
fromToTransformRevision, transformedStateVersion, roundTripAndErrorGates }` and
must resolve to an accepted `PhysicsOriginRebaseTransaction`. It is typed
absence when the arm already uses the Candidate epoch. If present, its `from`
epoch equals the arm binding/bracket epoch, its `to` epoch equals the Candidate
epoch, and it proves the exact transformed state version. Both brackets of one
arm use the binding epoch. All previous arms consumed by one
`CameraViewPublication.globalToRenderPrevious` share its source frame/revision/
epoch; all current arms analogously share `globalToRenderCurrent`. The two
camera transforms bind their `referenceInstant` exactly to the camera's
previous/current render-sample instants.

`motionBinding.kind` is semantic; `storageRepresentation` is orthogonal. A
particle binding may be CPU, GPU-buffer, texture-field, or external, and a field
may use several packed layouts without changing its physical identity. Changing
storage alone does not silently change the binding kind or motion-validity rule.

Particle/instance compaction moves stable identity, current state, and previous
presented state atomically. Birth, death, generation change, slot reuse,
reparenting, teleport, and representation change invalidate motion under the
enumerated reason.

### Camera/view publication

The camera owner consumes the candidate and publishes one immutable record per
target/view:

```yaml
RenderSimilarityTransform:
  sourcePhysicsFrameId: PhysicsFrameId
  sourceTransformRevision: opaque-version
  sourcePhysicsOriginEpoch: PhysicsOriginEpoch
  destinationRenderFrameId: RenderFrameId
  renderOriginEpoch: RenderOriginEpoch
  referenceInstant: PhysicsInstant
  properBasisRotation: Mat3
  presentationScale: Quantity<dimensionless> # default 1
  renderUnitsPerMeter: Quantity<render-unit/meter>
  translationRenderUnits: Vec3
  transformRevision: opaque-version
  error: PhysicsErrorDescriptor

CameraViewPublication:
  cameraPublicationId: CameraViewPublicationId
  candidateId: PhysicsPresentationCandidateId
  owner: camera-owner-id
  presentationTargetId: presentation-target-id
  viewId: view-id
  cameraId: camera-id
  viewScope: scene-layers-visibility-and-subview
  cameraStateVersion: opaque-version
  cameraProjectionRevision: opaque-version
  previousRenderSampleInstant: PhysicsInstant
  currentRenderSampleInstant: PhysicsInstant
  globalToRenderPrevious: RenderSimilarityTransform
  globalToRenderCurrent: RenderSimilarityTransform
  previousUnjitteredViewMatrix: typed-matrix
  currentUnjitteredViewMatrix: typed-matrix
  previousUnjitteredProjectionMatrix: typed-matrix
  currentUnjitteredProjectionMatrix: typed-matrix
  jitterSampleAndConvention: typed-jitter-record
  viewport: typed-physical-and-css-viewport
  rendererDpr: Quantity<ratio>
  renderExtent: Quantity<physical-pixels>
  depthConvention: typed-depth-record
  projectionValidityAndError: typed-validity-and-error
```

Define the mapping exactly as

```text
x_render = renderUnitsPerMeter * R_physicsToRender * x_physicsMeters
           + translationRenderUnits
```

so translation is in output render units. `renderUnitsPerMeter` is exactly
`presentationScale / metersPerWorldUnit` `[D]`; `presentationScale` defaults to
one and is an explicitly authored, dimensionless presentation-only scale. The
current and previous transforms each serialize their own presentation scale,
source frame/revision, origin epoch, and transform revision. A pure
camera-relative rebase changes translation and `renderOriginEpoch`, not physical
state. Rotation/scale changes require a new semantic transform revision. Every
mapping names its source physics frame, transform revision, and origin epoch.

### Shadow/cache preparation and sealed snapshot

Visibility, culling, acceleration structures, shadows, and caches consume both
the candidate and its `CameraViewPublication`, then publish:

```yaml
ViewPreparationPublication:
  viewPreparationId: ViewPreparationPublicationId
  candidateId: PhysicsPresentationCandidateId
  cameraPublicationId: CameraViewPublicationId
  presentationTargetId: presentation-target-id
  viewId: view-id
  visibilityPublicationRefs: [versioned-view-publication-ref]
  accelerationPublicationRefs: [versioned-view-publication-ref]
  shadowViewPublicationRefs: [ShadowViewPublicationRef]
  cachePublicationRefs: [versioned-view-publication-ref]
  reactiveEpochs: [scoped-epoch]
  reactivePublications: [ReactivePublication]
  resetDependencies: [ScopedResetAction]
  resourceLeases: [PresentationResourceLease] # full records created by this view preparation
  resourceLeaseRefs: [PresentationResourceLeaseRef]
```

Shadow views are explicit publications, not inferred global epochs. A shadow,
cache, or visibility publication cannot be both input and output of the same
phase. Deferred data names the prior publication and bounded delay. After every
required shadow result exists, publish this ref:

```yaml
ShadowViewPublicationRef:
  shadowOwner: owner-id
  shadowViewId: shadow-view-id
  presentationTargetId: presentation-target-id
  receiverViewId: view-id
  cameraPublicationId: CameraViewPublicationId
  cameraProjectionRevision: opaque-version
  shadowContentEpoch: scoped-epoch
  resourceLeaseRefs: [PresentationResourceLeaseRef]
  boundedDelay: PhysicsDuration | typed-absence
```

Every shadow ref is target/view keyed, names the camera publication that
prepared it, and resolves only Candidate or same-preparation leases. A delayed
ref names its exact prior content epoch/generation through those lease refs;
`boundedDelay` is typed absence for a same-publication result.

After every required preparation record exists, seal:

```yaml
PhysicsPresentationSnapshot:
  snapshotId: PhysicsPresentationSnapshotId
  candidateId: PhysicsPresentationCandidateId
  cameraPublicationId: CameraViewPublicationId
  viewPreparationId: ViewPreparationPublicationId
  presentationTargetId: presentation-target-id
  viewId: view-id
  presentedStatePairRefs: [candidate-binding-id]
  resourceLeaseRefs: [PresentationResourceLeaseRef]
  eventSequenceRanges: [PresentationEventRange]
  closureManifest: PresentationClosureManifest
  sealVersion: opaque-version

PresentationClosureManifest:
  snapshotId: PhysicsPresentationSnapshotId
  pairStateHandleLeaseIds: [lease-id]
  preparationDependencyLeaseIds: [lease-id]
  reactiveAndResetLeaseIds: [lease-id]
  shadowCacheVisibilityLeaseIds: [lease-id]
  exactRequiredLeaseIds: [lease-id]
  exactEventRangeIds: [PresentationEventRangeId]
  dependencyDagDigest: collision-resistant-digest
  closureDigest: collision-resistant-digest
```

The snapshot references candidate pairs; it does not copy independently mutable
pairs or transforms. IDs, target/view scope, device/resource generations,
events, reactive actions, and leases must resolve transitively through the exact
candidate, camera, and view-preparation publications. The
`closureManifest` is exact: its required lease IDs equal the union of referenced
pair-state handles and every preparation/shadow/cache/reactive/reset dependency,
not a subset or superset; its event IDs equal every Candidate range addressed
to that target/view or a declared shared consumer. Digests cover canonical
sorted IDs and dependency edges. `resetDependencies` is an
acyclic immutable plan keyed by history/resource owner, target, view, signal,
encoding, resolution, and reason—not one global reset boolean.

Candidate leases own view-independent solver/presentation state. A
`ViewPreparationPublication` owns full leases for camera-dependent resources it
creates after the camera publication—visibility lists, shadow maps, masks,
view-conditioned acceleration data, or caches—and lists refs to both those
leases and any Candidate leases it consumes. A snapshot may reference only the
union of its Candidate leases and its own preparation's full leases. No sibling
view may resolve or retire another view's preparation lease. This two-level
ownership preserves the acyclic publication chain without pretending a
camera-dependent generation existed before the camera. For every lease,
`FrameExecutionRecord.leaseDispositionById[leaseId].consumingSnapshotIds` is
exactly the set of sealed snapshots whose refs resolve to that lease; omission
of one consumer permits unsafe reuse and invention of one prevents retirement.

```yaml
ReactivePublication:
  sourceId: owner-or-signal-id
  sourceVersion: opaque-version
  reactiveEpoch: scoped-epoch
  kind: shadow-content | foam | emissive | optical | topology | deformation | disocclusion | event
  presentationTargetId: presentation-target-id
  viewId: view-id
  affectedRegion: AffectedRegionDescriptor
  resourceLeaseId: lease-id | typed-absence
  validity: typed-validity
  error: PhysicsErrorDescriptor
  plannedConsumerActions: [ScopedResetAction-reference]

ScopedResetAction:
  actionId: scoped-action-id
  owner: history-or-cache-owner
  historyKey: view-signal-encoding-resolution-jitter-key
  presentationTargetId: presentation-target-id
  viewId: view-id
  causeEpochs: [scoped-epoch]
  affectedRegion: AffectedRegionDescriptor
  policy: preserve-with-proof | reset | reject-region | reproject-with-proof | reseed | rebuild | bypass | hold-prior | convert-with-proof
  capabilityGate: named-consumer-capability
  dependencies: [scoped-action-id]
  executionStrategy: named-pass-dispatch-or-state-operation
  resourceLeaseId: lease-id | typed-absence
```

`AffectedRegionDescriptor` is the exact tagged union below. Exactly one arm
matching `kind` is present and all other arms are typed absence:

```yaml
AffectedRegionDescriptor:
  kind: full-frame | entity-set | physics-bounds | screen-mask
  fullFrame: { reason: scoped-reason } | typed-absence
  entitySet: { entityIds: [EntityId-with-generation] } | typed-absence
  physicsBounds:
    { physicsFrameId, physicsOriginEpoch, transformRevision,
      boundType, boundsMeters, error } | typed-absence
  screenMask: ReactiveMaskDescriptor | typed-absence
```

`physics-bounds` uses physics-frame metres and carries origin/revision/error;
`screen-mask` uses the exact descriptor below:

```yaml
ReactiveMaskDescriptor:
  presentationTargetId: presentation-target-id
  viewId: view-id
  cameraId: camera-id
  cameraProjectionRevision: opaque-version
  jitterKey: typed-jitter-key
  physicalExtent: Quantity<physical-pixels>
  resolutionScale: Quantity<ratio>
  encodingFormat: semantic-encoding-and-physical-format
  conservativeCoverage: inside | outside | signed | probabilistic
  dilationAndError: typed-Quantity-and-error-record
  resourceLeaseId: lease-id
```

When a consumer cannot use a mask, promote the publication/action to
`full-frame` before sealing. A validation-only mask is not allocated on the
runtime path.

```yaml
PresentationResourceLease:
  leaseId: lease-id
  resourceId: resource-id
  deviceId: device-id
  deviceLossGeneration: opaque-version
  resourceGeneration: opaque-version
  layoutRevision: opaque-version
  entitySlotMapVersion: opaque-version | typed-absence
  residency: cpu | gpu | external | mirrored
  slotRangeStrideCount: typed-Quantity-records
  owner: owner-id
  leaseScope: candidate | view-preparation
  access: read
  submissionAvailability: typed-gpu-dependency
  leaseBegin: opaque-sequence
  reuseProhibitedUntil: ConsumerCompletionJoin

PresentationResourceLeaseRef:
  leaseId: lease-id
  deviceId: device-id
  deviceLossGeneration: opaque-version
  resourceGeneration: opaque-version
  layoutRevision: opaque-version
  subresourceOrCpuSlice: typed-range

ConsumerCompletionJoin:
  joinId: ConsumerCompletionJoinId
  leaseId: lease-id
  requiredConsumerKeys: [typed-consumer-key]
  simulationConsumers: [CompletionTokenRef]
  couplingConsumers: [CompletionTokenRef]
  externalConsumers: [CompletionTokenRef]
  presentationConsumers: [CompletionTokenRef]
  joinPredicate: all-required-consumers-complete-or-loss-invalidated
  joinDigest: collision-resistant-digest
  deviceLossRetirementPath: typed-retirement-rule

CompletionTokenRef:
  tokenId: opaque-token
  consumerKey: typed-consumer-key
  consumerKind: simulation | coupling | external | presentation
  executionId: FrameExecutionRecordId | TypedAbsence
  presentationTargetId: presentation-target-id | TypedAbsence
  viewId: view-id | TypedAbsence
  snapshotId: PhysicsPresentationSnapshotId | TypedAbsence
  queueSubmissionEpoch: opaque-sequence | TypedAbsence
  backendGeneration: opaque-version
  deviceLossGeneration: opaque-version
  completionSemantics: typed-backend-or-external-semantics
```

The owner writes a new resource generation; it never mutates a generation under
a presentation read lease. `PresentationResourceLeaseRef` is the Candidate- or
ViewPreparation-owned `leaseId` plus device/resource/layout generation and typed
subresource range.

Each completion ref binds a token to the exact consumer, execution, target/view,
snapshot, submission epoch, and device generation that can release the lease.
The canonical sorted refs and required consumer keys hash to `joinDigest`; the
lease's `reuseProhibitedUntil` and its execution disposition must carry the same
join ID/digest. An unrelated completion token cannot satisfy the join.

Execution/completion is a separate multi-target record:

```yaml
FrameExecutionRecord:
  executionId: FrameExecutionRecordId
  candidateId: PhysicsPresentationCandidateId
  requiredTargetViewKeys: [target-view-key]
  snapshotIds: [PhysicsPresentationSnapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: opaque-version
  deviceLossGeneration: opaque-version
  targetExecutions:
    target-view-key:
      snapshotId: PhysicsPresentationSnapshotId | typed-absence
      presentationTargetId: presentation-target-id
      viewId: view-id
      status: submitted | completed | failed | aborted | device-lost
      submittedPasses: [pass-or-dispatch-key]
      queueSubmissionEpochs: [opaque-sequence]
      actionResults: [typed-action-result]
      completionTokens: [CompletionTokenRef]
      presentedTimestamp: PhysicsInstant | TypedAbsence
      failure: typed-failure-record-or-TypedAbsence
  leaseDispositionById:
    lease-id:
      disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss
      consumingSnapshotIds: [PhysicsPresentationSnapshotId]
      completionJoin: ConsumerCompletionJoin
      retirementEvidence: typed-completion-or-loss-record
```

Never mutate a candidate or snapshot to record completion. A pre-seal failure
uses an empty snapshot list for that target, cancels dependent actions, and
retires only preparation leases exclusive to that failed target through their
keyed abort conditions. Candidate leases stay
live until the completion join of every surviving consumer; a failure never
retires a lease still referenced by another sealed snapshot. It never
fabricates a snapshot. Device loss invalidates the lost generation immediately and uses the
declared loss retirement/recovery transaction rather than waiting for an
impossible normal completion token.

`requiredTargetViewKeys` and `targetExecutions` have identical key sets. An
all-target pre-seal abort is valid with empty `snapshotIds`; every target then
has typed-absent `snapshotId`, status `aborted` or `failed`, no submitted pass/
token, and an explicit failure. Status algebra is exact: `submitted` means at
least one target is submitted and none has terminal failure; `completed` means
all required targets completed; `partial-failure` means at least one target
completed or remains valid and at least one is failed, aborted, or device-lost;
`aborted` means no target submitted and all targets aborted/failed before useful
submission; `device-lost` means every required target/resource generation in
this execution is invalidated by the same loss transaction. Mixed target loss
therefore uses `partial-failure`, and only leases on the lost device/generation
take `invalidated-by-device-loss`. Other leases retain their exact joins.

For every lease, the disposition's `consumingSnapshotIds` is the exact closure
consumer set, its `completionJoin` equals the lease's
`reuseProhibitedUntil` by join ID/digest, and each presentation completion ref
resolves to a matching `TargetExecution` token. A normal completion cannot
invalidate a loss generation, and an abort cannot retire a Candidate or shared
preparation lease still required by any surviving consumer.

### Reactive epochs

Track independent scoped epochs for physical discontinuity, topology,
deformation, source data, physics origin, render origin, quality, material law,
shadow/cache content, optical/emissive state, and presentation. An epoch change
declares affected signals/entities/regions and downstream actions. Do not reset
an unrelated history merely because another domain advanced.

Origin rebase has two cases:

- A render-origin change updates current/previous global-to-render transforms
  and relevant temporal consumers; it does not alter physics state.
- A physics-origin change is the atomic transaction below; no owner may rebase
  independently.

```yaml
PhysicsOriginRebaseTransaction:
  transactionId: PhysicsOriginRebaseTransactionId
  contextId: PhysicsContextId
  commitInstant: PhysicsInstant
  fromContextVersion: opaque-version
  toContextVersion: opaque-version
  fromPhysicsOriginEpoch: PhysicsOriginEpoch
  toPhysicsOriginEpoch: PhysicsOriginEpoch
  fromWorldTransformRevision: opaque-version
  toWorldTransformRevision: opaque-version
  fromFrameRegistryRevision: opaque-version
  toFrameRegistryRevision: opaque-version
  fromChartRegistryRevision: opaque-version
  toChartRegistryRevision: opaque-version
  fromToTransform:
    transformRevision: opaque-version
    properBasisRotation: Mat3
    translationMeters: Vec3
    error: PhysicsErrorDescriptor
  affectedOwnersAndCommittedVersions: { owner-id: [typed-version-ref] }
  transformedStateKinds: [point, coordinate-rate, physical-vector, axial-vector, tensor, collider, contact, cache]
  interactionAndEventQueueAction: transform | drain-before-boundary | reject
  provisionalStateRequirement: none-live
  conservationRoundTripAndErrorGates: [typed-gate]
  presentationResetPlan: [ScopedResetAction]
  atomicPublication: all-or-none
  rollback: preserve-from-epoch
```

The transaction runs at a graph step/commit boundary after provisional work is
resolved. It transforms every committed owner, collider, contact/warm-start
state, queued interaction retained across the boundary, and authoritative
checkpoint consistently; advances the epoch once; and publishes only after
round-trip, conservation, and finite-state gates pass. Render-origin rebase does
none of this. The from/to Context and registry revisions make the lineage
injective: a bridge cannot attach to a transform from another frame/chart
registry that happens to use the same epoch label.

When a temporal implementation cannot reproject across different render
origins or projections—for example, a stock reconstruction whose previous-depth
path assumes one render frame—its `ScopedResetAction` requires a conservative
history reset. Do not claim origin-rebase preservation without mechanism proof.

## `QualityTransition` And Mobile Performance

### Quality-state contract

The shared render/quality governor may request, but never perform, a physics
change:

```yaml
QualityChangeRequest:
  requestId: QualityChangeRequestId
  requesterId: quality-governor-id
  requestSequence: monotonic-integer-sequence
  observedInterval: PhysicsTimeInterval
  affectedTargetsViews: [target-view-id]
  pressureClass: cpu | gpu | presentation | upload | memory | thermal | physical-error | visual-error
  requestedDirection: reduce-cost | increase-fidelity | hold
  rankedCandidateControls: [quality-control-id]
  evidenceRecords: [canonical-labelled-quantity]
  protectedInvariants: [named-invariant]
  latencyOrDeadlineGate: PhysicsDuration | PhysicsDeadline | absent
```

The physics coordinator consumes this through a `PhysicsSignalDescriptor`,
checks current graph state, hysteresis, conservation/error gates, resource peak,
and safe step boundary, then admits a `QualityTransition` or records a rejection
reason. A request has no state-mutation authority.

Every `PhysicsQualityStateDescriptor` declares:

- equations/model and constitutive-law versions;
- spatial discretization, represented band/footprint, boundary treatment, and
  active domain;
- native stepping/coupling cadence and stability/error controls;
- state variables, conserved inventories, stochastic stream/cursor, stable-ID
  policy, contact/warm-start state, and presentation representation;
- per-observable `[G]` physical and visual error bounds;
- hot-state, transient, traffic, and synchronization costs.

```yaml
PhysicsQualityStateDescriptor:
  qualityStateId: PhysicsQualityStateId
  contextId: PhysicsContextId
  owner: route-physics-coordinator
  qualityEpoch: PhysicsQualityEpoch
  equationsAndConstitutiveLawVersions: [typed-version-ref]
  discretizationAndActiveDomain: typed-spatial-temporal-record
  representedBandsFootprintsAndFilters: [typed-record]
  boundaryTreatment: versioned-policy
  nativeStepAndCouplingControls: typed-stability-error-record
  stateVariablesAndInventories: [typed-state-or-commodity-ref]
  stochasticStreamsAndCursors: typed-cursor-map
  stableIdPolicy: versioned-policy
  contactAndWarmStartState: typed-state-ref-or-TypedAbsence
  presentationRepresentation: versioned-representation-map
  physicalAndVisualErrorBounds: [PhysicsErrorDescriptor]
  hotTransientTrafficAndSynchronizationCosts: PhysicsCostLedger-ref
  validity: PhysicsValidityDescriptor

ConservativeStateMap:
  mapId: ConservativeStateMapId
  contextId: PhysicsContextId
  sourceQualityStateId: PhysicsQualityStateId
  destinationQualityStateId: PhysicsQualityStateId
  sourceStateVersions: [typed-version-ref]
  destinationProvisionalVersions: [typed-version-ref]
  restrictionOrProlongationOperator: versioned-linear-or-nonlinear-map
  sourceMeasure: PhysicsSupportDescriptor
  destinationMeasure: PhysicsSupportDescriptor
  conservedCommodities: [commodity-id]
  positivityAndConstraintPreservation: [typed-proof-and-gate]
  boundaryAndActiveDomainTreatment: versioned-policy
  introducedFilter: PhysicsFilterDescriptor
  stableIdRngEventAndLedgerMap: typed-map
  contactWarmStartMap: versioned-map-or-TypedAbsence
  residuals: typed-commodity-and-state-map
  errorPropagationLedgerRef: ErrorPropagationLedgerId
  acceptanceGate: typed-result
```

A solver/model change is not ordinary visual LOD. It is acceptable only when
the destination model preserves the signed-off observable and declares the new
equations, closure, handoff error, and conservation semantics.

### Three-phase transition

```yaml
QualityTransition:
  transitionId: QualityTransitionId
  contextId: PhysicsContextId
  fromState: PhysicsQualityStateId
  toState: PhysicsQualityStateId
  fromQualityEpoch: PhysicsQualityEpoch
  toQualityEpoch: PhysicsQualityEpoch
  triggerEvidence: labelled-pressure-and-error-records
  protectedInvariants: [named-invariant]
  prepare:
    allocateCompilePopulate: [operation]
    sourceStateVersion: opaque-version
    eventQueuePartition: declared-policy
    predictedPeakResources: PhysicsMemoryLedger
    failurePolicy: keep-old-state
  commitAtStepBoundary:
    commitInstant: PhysicsInstant
    conservativeMap: [ConservativeStateMap]
    idRngEventCursorMap: explicit-map
    contactWarmStartAction: migrate | invalidate-with-reason
    authoritativeEmitterByStateEquationOrSourceChannel:
      named-equation-or-channel: exactly-one-owner-and-representation
    residualAndErrorGate: typed-gates
    atomicPublication: required
  retireAfterCompletion:
    oldResourceLeases: [lease-id]
    completionJoin: ConsumerCompletionJoin
    oldEventQueueDrain: declared-policy
    retirementEvidence: typed-simulation-coupling-external-and-frame-record-refs
  resetPlan: [ScopedResetAction]
  rollback: named-atomic-policy
```

`prepare` cannot publish the destination as authoritative. `commitAtStepBoundary`
maps one coherent committed state, accepts conservation/error residuals, and
atomically increments the quality epoch. `retireAfterCompletion` keeps old
resources alive until simulation, coupling, presentation, and render consumers
release them.

Each `ConservativeStateMap` declares restriction/prolongation operator,
source/destination measures, conserved commodities, positivity/constraint
preservation, boundary/active-domain treatment, introduced filter, residual,
and error. Preserve stable IDs, stochastic sequence identity, event cursors,
and exact-once ledgers. Drain or partition interaction queues at the transition
boundary; migrate compatible contact manifolds/warm starts or invalidate them
explicitly.

If no valid map exists, perform an explicit model handoff/reset, record lost or
reinitialized inventories, increment the relevant discontinuity/reactive
epochs, and reject interpolation across it. During any visual crossfade, only
one representation per named state-equation term or conserved source channel
emits forces/sources `[G]`; independent equations may retain different
authoritative owners. Otherwise the system double-couples.

### Cost, traffic, and hot state

Do not assign budgets by device-class folklore. Freeze `[G]` CPU, GPU,
presentation, update-latency, memory, thermal, and error gates for each named
target; accept only sustained `[M]` composed evidence.

```yaml
PhysicsCostLedger:
  ledgerId: PhysicsCostLedgerId
  contextId: PhysicsContextId
  graphId: PhysicsGraphId
  graphRevision: opaque-version
  measurementInterval: PhysicsTimeInterval
  measurementClockId: PhysicsClockId
  qualityEpoch: opaque-version
  presentationTargetsAndViews: [target-view-key]
  measurementProtocolRefs: [content-addressed-protocol-and-trace]
  status: active | provisional
  targetAndHarness: named-device-browser-view-workload
  qualityState: PhysicsQualityStateId
  graphStageCosts: [router-cost-record]
  coordinationIntervalsPerSecond: labelled-distribution
  stageExecutionsPerCoordinationInterval: labelled-count-by-stage
  stageExecutionsPerSecond: labelled-count-by-stage
  coordinationIntervalsPerPresentedFrame: labelled-distribution
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled-distribution-by-owner
  executionsPerPresentedFrame: labelled-count-by-stage
  worstPermittedCatchUpBurst:
    triggerAndIntervalDebt: typed-record
    executionsDispatchesAndTraffic: labelled-records
    latencyMemoryAndErrorGate: typed-gates
  hotBytesReadWrittenPerExecution: labelled-by-stage-and-resource
  solverDispatches: [extent-workgroup-cadence-and-timing]
  queueSubmissionsAndPassBreaks: labelled-counts
  dependencyCriticalPaths: [cpu-gpu-external-overlap-and-tail-record]
  tileGpuTraffic:
    attachmentStoreLoadResolveBytes: labelled-records
    tileSpillEvidence: measured-or-unavailable
    renderComputePassBreaks: labelled-counts
  bindingAndDeviceLimits: [limit-demand-headroom-and-gate]
  cpuWork: [task-cadence-and-timing]
  allocationGcAndCompilation: [cadence-latency-and-byte-record]
  uploadsCopiesMaps: [TrafficRecord]
  hostCompletionsReadbacksPerPresentedFrame: labelled-counts # steady runtime expects zero
  synchronization: [wait-or-stall-record]
  multiviewAndFramesInFlightMultipliers: labelled-resource-and-work-records
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  thermalPowerState: measured-or-unavailable
```

`PhysicsMemoryLedger` includes every live solver ping-pong/version slot,
multilevel grid, contact/warm-start cache, interaction/event queue, descriptor
table, stable-ID map, CPU mirror, previous/current presentation state,
frames-in-flight resources, validation/readback allocation, and simultaneous
old/new transition state. Derive logical bytes from extents/formats/lifetimes
`[D]`; treat physical allocation/residency as `[M]` when observable.

Every `TrafficRecord` declares producer, consumers, direction, logical bytes,
frequency, dirty fraction, resource transition, pass/dispatch boundary,
readback/map behavior, and measured counters when exposed. On bandwidth-limited
or tile-based targets, minimize stored intermediates, pass breaks, redundant
state mirrors, and full-domain updates; prove the chosen fusion/packing with
target evidence rather than assuming compute is cheaper.

Per-presented-frame numbers never replace per-coordination-interval and
per-second evidence: rendering may throttle, pause, or run at a cadence unrelated
to simulation. Measure the worst catch-up policy that the route permits, not
only the steady zero-debt case. Report dependency critical paths instead of
adding overlapping CPU/GPU stage percentiles. On tile GPUs, count attachment
store/load/resolve traffic, compute/render pass breaks, and spills; on all
targets, gate binding/storage-buffer/texture limits and frames-in-flight or
multiview resource multiplication.

All cadence distributions are observations over the same serialized
`measurementInterval`, clock mapping, quality epoch, target/view set, and
protocol trace. A percentile of `A`, a percentile of `B`, and a percentile of
their ratio are three separate statistics; multiplying percentile summaries is
not an exact cadence identity. Cross-check exact integer totals per trace, then
report paired distributions from those same samples.

Keep frequently sampled state in its consuming residency. Batch queries and
interactions, compact active regions, update dirty ranges, and use analytic or
precomputed inactive regions where the error gate permits. Do not evict hot
state only to upload/reconstruct it at a higher cadence. Adaptive quality uses
the router's single hysteretic controller; physics domains do not independently
oscillate tiers.

## Validation Scenarios And Failure Gates

Validation binds native-domain correctness, cross-interface behavior, visual
causality, and sustained target performance. A plausible final image cannot
replace state/equation evidence; a numerically correct state cannot replace
proof that presentation filtering, motion, lighting, and histories expose it
correctly.

### Required fixtures

| Fixture | Required proof |
| --- | --- |
| context and units | Positive `metersPerWorldUnit`; reciprocal derived only; SI round trip for points/polar/axial vectors/normals/tensors; gravity sampled at point/time; no render scale in physics providers |
| moving frames | Physical-vector basis change and coordinate-rate/acceleration transport are tested separately against an analytic rotating/translating frame, including angular, Coriolis, and centripetal terms; proper orthogonality, transform revision, and validity enforced |
| spatial vectors | SE(3) twist adjoint and wrench/impulse coadjoint preserve power/virtual work and apply the correct reference-point torque shift |
| charts | Geodetic/coast chart forward/inverse/Jacobian/metric residuals over valid domain; singularity and curvature-error gates trigger |
| origin epochs | Camera render rebase preserves physical state; a `PhysicsOriginRebaseTransaction` transforms all owners/proxies/contacts/queues/checkpoints atomically or rolls back; stale epoch samples reject |
| clocks and graph | Canonical rationals and versioned fixed, timestamp-table, piecewise, external, adaptive, analytic, event, GPU, and presentation mappings cover identical coordination intervals without double step, hidden lag, or domain-specific drop |
| graph publication | Provisional versions cannot escape; every edge matches a read/write/version/residency dependency; an all-or-none commit group publishes only accepted owner versions |
| bounded feedback | Coupling loop converges under its residual gate and atomically rejects a divergent provisional iterate; graph remains acyclic outside the loop macro |
| provider envelope | Required-channel masks, per-channel unit/filter/time/error, actual band/support, age/staleness, state/resource versions, and explicit absence survive CPU/GPU/external adapters |
| absent channel mutation | Replace a required channel with absent, stale, wrong-unit, wrong-frame, wrong-epoch, or implicit-zero data; the consumer blocks or selects a declared approximation |
| water semantics | Surface-point velocity and material-current velocity differ in a known analytic wave/current case; each consumer selects the equation-correct channel and filter |
| rigid-body boundary | `RigidBodyState` pose/twist/reference point/frame/epoch/version matches analytic motion and remains immutable through native, GPU, and external adapters |
| support/contact | Moving and deforming support point velocity and separation sign match analytic motion; support queries do not create duplicate impulses; the named contact owner/solver revision preserves point IDs and lifecycle or explicitly resets |
| material/proxy identity | Deterministic pair-law resolution latches both material versions; collider shape/pose bindings and support/feature IDs survive batching, compaction, rebase, and visual LOD within proxy-error gates; render PBR state cannot alter them |
| precipitation | Airborne inventory, emitted/deposited/advected/phase-changed mass, destination footprint, and residual close across graph intervals; same-tick mutation is impossible |
| wind coupling | Air-density-dependent force, filtered reference-height wind, stability/fetch/duration, and ocean source-term calibration are explicit; raw wind-to-spectrum mutation fails |
| lighting transport | Position/direction-or-normal/footprint/solid-angle/time queries preserve per-channel radiometric units/bases; duplicated attenuation-factor ID and ambiguous solar-disc inclusion fail |
| dimensional interactions | Every payload tag passes unit/measure/rate-integral/footprint checks; point versus wrench impulse is unambiguous; integrated transfers apply exactly once across different receiver subcycle counts |
| reaction grouping | One-to-many and many-to-one reaction groups transform into one balance frame/reference point, accept atomically, and close impulse/torque/commodity residuals |
| delivery/overflow | Duplicate, late, reordered, skipped-frame, overflow, retry, and cancellation cases preserve per-consumer cursors and report lost conserved quantities |
| discrete exchange | Gather/scatter moment, force, torque, work, and energy residuals meet gates under translation/rotation and resolution change |
| conservation | Closed/open-system mass, linear/angular momentum, energy, species, modeled dissipation, boundary flux, and numerical residual ledgers reconcile |
| fluid/body coupling | One-way invariance; explicit two-way added-mass stability; iterated coupling convergence; hydrostatic equilibrium; displaced volume, force, torque, work, and wave/current filtering |
| GPU publication | Same-queue dependency succeeds; deliberately missing pass boundary fails; submission is not reported as completion; host visibility occurs only after the declared map/fence |
| authoritative GPU recovery | Device loss freezes commits, invalidates the lost generation, restores one coherent checkpoint, replays exact-once ranges, revalidates conservation/error, and atomically publishes—or records an explicit discontinuous restart |
| no-readback critical path | Runtime trace contains no frame-critical GPU-to-CPU map/readback; diagnostic readback is delayed and excluded from steady-state claims |
| presentation pair | Independent previous/current per-binding brackets reconstruct their requested instants with clock-map error; motion uses their immutable state handles and the per-view source-frame-qualified render transforms |
| motion identity | Spawn, death, teleport, reparent, LOD change, compaction, and slot reuse preserve stable IDs and invalidate motion with the exact reason |
| shadow/reactive lifecycle | The candidate -> camera view -> explicit shadow/visibility/cache publication -> seal DAG is acyclic; reactive publications and scoped reset plans have no same-phase mutation/cycle |
| candidate abort/device loss | Multi-target pre-seal failure and device loss append keyed target/lease dispositions, cancel dependent actions, retire or invalidate every lease, and never fabricate a snapshot/completion token |
| event presentation | Repeated rendering does not respawn an event; skipped rendering consumes the complete monotonic sequence range exactly once |
| quality transition | Prepare/commit/retire order, conservative map, positivity/constraints, ID/RNG/cursor preservation, queue/manifold policy, peak overlap, rollback, per-equation authoritative emitters, and multi-consumer completion join all pass |
| external adapter | Native-versus-adapted frame/time/unit/channel/state results meet errors; stepping/constraints/collision/contact/accumulation/commit ownership is complete; process/device failure cannot half-commit an exchange |
| mobile sustained run | Per-interval/per-second/presented-frame costs, worst catch-up burst, dependency tails, tile traffic/spills, device limits, allocations, multiview/in-flight multiplication, memory, thermal/clock drift, quality trace, errors, and teardown stay within named target gates |

### Hard failure gates

Reject the affected route or narrow its claim when any of the following occurs:

- two owners advance the same state equation, or a required producer/consumer/
  reaction owner is missing;
- two owners integrate wetness/snow/receiver state for the same region/equation,
  or appearance state is treated as conserved receiver inventory;
- a quantity lacks SI unit/frame/time/support, uses the reciprocal scale
  convention, or crosses an unversioned transform/chart;
- a required channel is absent, zero-filled, stale beyond its gate, synthesized
  without error, or filtered incompatibly with its consumer;
- an instant rational is noncanonical, a clock mapping/revision cannot derive its
  seconds, graph intervals have gaps/overlaps, provisional state escapes, a
  commit group is partial, an iterative cycle is unbounded, or catch-up differs
  by domain;
- a rate is applied as an integral, an integral is applied per substep, a
  footprint kernel is not normalized, or a payload uses the wrong state term;
- a payload/footprint pair is invalid, point impulse contains an undeclared free
  couple, source/reaction-group acceptance is non-atomic, an exact-once key
  repeats, overflow hides lost commodities, or nondeterministic reduction is
  claimed deterministic;
- conservation residual, coupling stability, positivity, constraint, chart,
  transform, or approximation error exceeds its `[G]` bound;
- contact ownership/solver revision, collider pose, separation sign, material
  pair law, or rigid-body twist reference is ambiguous; a physical property is
  inferred from visual PBR state; or an unavailable property silently becomes
  zero;
- GPU submission is called completion, authoritative GPU state lacks a bounded
  recovery/restart transaction, a resource is reused before its keyed
  multi-consumer lease join retires, a workgroup barrier is used as a global
  fence, or frame-critical readback appears;
- rendering reads mutable simulation state, shares one interpolation alpha
  across bindings/views, derives motion from adjacent solver states, omits
  previous/current provenance, creates a candidate-camera-cache cycle, or
  mutates a candidate/publication/snapshot in a later phase;
- a quality switch changes equations without explicit handoff/error, loses
  inventories/IDs/events silently, has two emitters for one state-equation/source
  channel during crossfade, retires before all consumer classes complete, or
  exceeds peak memory;
- target acceptance uses isolated demo timings, desktop extrapolation, a cold
  burst, unlabelled budgets, or a final image without native-domain diagnostics.

The common contract ends at these boundaries. Keep collision algorithms,
constitutive models, fluid/solid/atmosphere solvers, procedural motion,
radiative transport, and render techniques in their expert owners. Standardize
only what must cross an owner boundary, and measure the composed result.
