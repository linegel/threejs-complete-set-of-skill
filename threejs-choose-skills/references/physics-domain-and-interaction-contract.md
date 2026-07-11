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
  originCoordinateAccelerationMps2: Vec3 | TypedAbsence
  angularAccelerationRadPerS2: Vec3 | TypedAbsence
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
  originCoordinateAccelerationInParentMps2: Vec3 | TypedAbsence
  angularAccelerationInParentRadPerS2: Vec3 | TypedAbsence
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

Registries are versioned records, not untyped maps:

```yaml
PhysicsFrameRegistry:
  registryId: PhysicsFrameRegistryId
  owner: owner-id
  registryRevision: opaque-version
  rootFrameId: PhysicsFrameId
  framesById: { PhysicsFrameId: PhysicsFrameDescriptor }
  parentDagDigest: collision-resistant-digest

PhysicsChartRegistry:
  registryId: PhysicsChartRegistryId
  owner: owner-id
  registryRevision: opaque-version
  chartsById: { PhysicsChartId: PhysicsChartDescriptor }
  anchorFrameRegistryRevision: opaque-version

PhysicsClockRegistry:
  registryId: PhysicsClockRegistryId
  owner: owner-id
  registryRevision: opaque-version
  clocksById: { PhysicsClockId: PhysicsClockDescriptor }
  coordinationClockId: PhysicsClockId
  mappingDagDigest: collision-resistant-digest

PhysicsIdentityRegistry:
  registryId: PhysicsIdentityRegistryId
  owner: owner-id
  registryRevision: opaque-version
  namespacesByKind:
    entity: IdentityNamespaceDescriptor
    provider: IdentityNamespaceDescriptor
    signal: IdentityNamespaceDescriptor
    collider: IdentityNamespaceDescriptor
    shape: IdentityNamespaceDescriptor
    support: IdentityNamespaceDescriptor
    feature: IdentityNamespaceDescriptor
    contactManifold: IdentityNamespaceDescriptor
    physicsMaterial: IdentityNamespaceDescriptor
    interaction: IdentityNamespaceDescriptor
    conservationGroup: IdentityNamespaceDescriptor

IdentityNamespaceDescriptor:
  namespaceId: opaque-id
  owner: owner-id
  schemaId: opaque-schema-id
  generationPolicy: monotonically-increment-on-reuse
  allocationCursor: monotonic-integer-sequence
  retiredGenerationDigest: collision-resistant-digest
```

The frame parent graph is acyclic, has exactly one registered root, and every
parent reference resolves inside the same registry revision. Every chart anchor
resolves against `anchorFrameRegistryRevision`. Every clock-map edge resolves in
the same clock-registry revision and the mapping graph has no competing path
with a different result/error. Registry revision changes are atomic publications.
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
  instant: PhysicsInstant | TypedAbsence
  interval: PhysicsTimeInterval | TypedAbsence
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
  seconds: Quantity<second> | TypedAbsence
  clockSpan: PhysicsClockSpan | TypedAbsence
  secondsDerived: Quantity<second> | TypedAbsence # [D] for a clock-span
  mappingError: PhysicsErrorDescriptor | TypedAbsence

PhysicsClockSpan:
  clockId: PhysicsClockId
  start: PhysicsInstant
  endExclusive: PhysicsInstant
  mappingRevision: opaque-version

PhysicsDeadline:
  kind: absolute-time | duration-from-request
  absoluteTime: PhysicsInstant | TypedAbsence
  requestInstant: PhysicsInstant | TypedAbsence
  duration: PhysicsDuration | TypedAbsence
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
      { epochTick, epochRationalSubstep, epochSeconds, secondsPerTick } | TypedAbsence
    timestampTable:
      { tableVersion, coveredInstantRange, knotTable, interpolationRule,
        outOfRangePolicy, error } | TypedAbsence
    piecewiseVersioned:
      { segmentTableVersion, coveredInstantRange, segmentTable,
        outOfRangePolicy, error } | TypedAbsence
    external:
      { adapterId, adapterVersion, mappingHandle, coveredInstantRange,
        frozenEvaluationTable, onlineQueryProtocol, unloggedQueryPolicy,
        error } | TypedAbsence
  pauseSeekPolicy: typed-policy
  timeScalePolicy: typed-policy
  coordinationClockMap: versioned-map-and-error
```

`knotTable` and `segmentTable` are each a discriminated storage record: either
`{ storage: inline, inlineEntries, resourceRef: TypedAbsence }` or
`{ storage: immutable-resource, inlineEntries: TypedAbsence,
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
  coordinationAdvance: PhysicsCoordinationAdvanceRecord
  catchUpBatch: PhysicsCatchUpBatch | TypedAbsence
  stages: [PhysicsGraphStage]
  edges: [PhysicsGraphEdge]
  dependencies: [PhysicsDependency]
  loopMacros: [BoundedCouplingLoop]
  commitGroups: [PhysicsCommitGroup]
  commitTransactions: [PhysicsCommitTransaction]
  originRebaseTransactions: [PhysicsOriginRebaseTransaction]
  catchUpPolicy: PhysicsCatchUpPolicy
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
  reads: [PhysicsStageRead]
  writes: [PhysicsStageWrite]
  immutableSubstepParameters: { parameterRecordId, version }
  nativeStepRule: analytic | fixed | adaptive | event | streamed | external
  executionRule: PhysicsStageExecutionRule
  executionResidency: PhysicsResidencyDescriptor
  failurePolicy: typed-atomic-policy

PhysicsStageRead:
  readId: PhysicsStageReadId
  signalId: PhysicsSignalId
  requiredStateVersionRule: committed-predecessor | loop-seed-or-prior-iteration | exact-named-version
  requiredDisposition: committed | loop-provisional | transaction-prepared
  requestedTime: PhysicsTime
  samplePhase: interval-start | substep-stage | interval-end | analytic-at-request
  maximumStaleness: PhysicsDuration | not-applicable
  dependencyId: PhysicsDependencyId | TypedAbsence
  consumerTolerance: typed-gate

PhysicsStageWrite:
  writeId: PhysicsStageWriteId
  signalId: PhysicsSignalId
  producedStateVersionRule: execution-derived-unique-version
  disposition: loop-provisional | transaction-prepared
  producedTime: PhysicsTime
  commitGroupId: PhysicsCommitGroupId | TypedAbsence
  stateAdvanceClaimId: StateAdvanceClaimId | TypedAbsence
  publicationEligibility: loop-accepted-only | transaction-commit-only | never-publish

PhysicsStageExecutionRule:
  activation: per-advance | per-loop-iteration | per-event | per-analytic-request
  partition: single | exact-subcycle-tile | sparse-events | analytic-samples
  maximumActivationsPerAdvance: Quantity<activations>
  maximumExecutionsPerActivation: Quantity<executions>
  nativeSubcycleSelection: fixed-count | stability-bound | error-controller | event-times | not-applicable
  ordering: monotonic-interval-then-native-sequence

PhysicsStageExecution:
  executionId: PhysicsStageExecutionId
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  stageId: PhysicsGraphStageId
  executionSequence: integer
  executionInterval: PhysicsTimeInterval
  coordinationCoverageInterval: PhysicsTimeInterval
  coordinationClockMappingProof: clock-map-revision-error-and-rational-endpoints
  subcycleIndex: integer | TypedAbsence
  couplingLoopId: BoundedCouplingLoopId | TypedAbsence
  iterationIndex: integer | TypedAbsence
  readResolutions: [read-id-state-version-time-and-dependency]
  writeResolutions: [write-id-prepared-version-and-content-digest]
  dependencyCompletions: [PhysicsDependencyCompletionRef]
  stateAdvanceClaimIds: [StateAdvanceClaimId]
  interactionApplicationLedgerIds: [InteractionApplicationLedgerId]
  status: prepared | completed | rejected | failed
  completionReceiptDigest: collision-resistant-digest

StateAdvanceClaim:
  claimId: StateAdvanceClaimId
  contextId: PhysicsContextId
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  owner: state-equation-owner-id
  stateEquationId: named-state-equation
  kind: analytic-evaluation | state-hold | state-advance | event-application
  inputCommittedVersions: [typed-version-ref]
  outputPreparedVersion: typed-version-ref | TypedAbsence
  applicationInterval: PhysicsTimeInterval | TypedAbsence
  nativeExecutionIds: [PhysicsStageExecutionId]
  interactionApplicationLedgerIds: [InteractionApplicationLedgerId]
  exactOnceAdvanceKey: collision-free-key

PhysicsGraphEdge:
  edgeId: PhysicsGraphEdgeId
  producerStageId: PhysicsGraphStageId
  consumerStageId: PhysicsGraphStageId
  payload: typed-signal-ref | surface-exchange-ref | state-version-ref
  requiredVersionAndPhase: typed-version-phase
  interpolationExtrapolation: named-policy-and-error | not-used
  maximumStaleness: PhysicsDuration | not-applicable
  latency: PhysicsLatencyDescriptor
  barrier: PhysicsDependencyRef
  absencePolicy: block | declared-approximation | not-used

PhysicsDependencyRef:
  dependencyId: PhysicsDependencyId
  requiredCompletionVersion: opaque-version

PhysicsDependency:
  dependencyId: PhysicsDependencyId
  kind: cpu-data | gpu-pass-dispatch | same-queue-transition | cross-queue | copy-map | external-fence | none
  producerStageId: PhysicsGraphStageId
  consumerStageId: PhysicsGraphStageId
  payloadSchemaAndVersionRule: typed-signal-exchange-state-or-resource-rule
  producerResidencyRule: typed-residency-rule
  consumerResidencyRule: typed-residency-rule
  resourceSubresourceRule: typed-resource-range-rule | TypedAbsence
  accessTransitionRule: producer-access-to-consumer-access-rule
  generationCompatibilityRule: typed-generation-rule | TypedAbsence
  releaseAcquireProtocol: typed-protocol | TypedAbsence
  externalFenceOrHostVisibilityRule: typed-proof-rule | TypedAbsence
  completionSemantics: exact-template-condition

PhysicsDependencyCompletionRef:
  completionId: PhysicsDependencyCompletionId
  dependencyId: PhysicsDependencyId
  receiptDigest: collision-resistant-digest

PhysicsDependencyCompletion:
  completionId: PhysicsDependencyCompletionId
  dependencyId: PhysicsDependencyId
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  producerExecutionId: PhysicsStageExecutionId
  consumerExecutionId: PhysicsStageExecutionId
  payloadAndVersion: typed-signal-exchange-state-or-resource-ref
  producerResidency: PhysicsResidencyDescriptor
  consumerResidency: PhysicsResidencyDescriptor
  resourceIdentityAndSubresource: typed-resource-ref | TypedAbsence
  accessTransition: producer-access-to-consumer-access
  deviceBackendResourceGenerations: typed-generation-tuple | TypedAbsence
  producerRelease: submission-epoch-and-completion-token | TypedAbsence
  consumerAcquire: wait-token-and-first-use | TypedAbsence
  externalFenceOrHostVisibility: typed-proof | TypedAbsence
  status: completed | failed
  receiptDigest: collision-resistant-digest

PhysicsCatchUpPolicy:
  owner: graph-coordinator-id
  debtClockId: PhysicsClockId
  maximumDebt: PhysicsDuration
  maximumCoordinationAdvancesPerPresentationOpportunity: Quantity<advances>
  maximumNativeExecutionsPerOpportunity: Quantity<executions>
  debtDisposition: retain | drop-with-loss-ledger | block-presentation
  discontinuityOnDrop: required | forbidden
  externalDeadlinePolicy: wait | reject-advance | bounded-defer
  errorAndResourceGates: [typed-gate]

PhysicsCatchUpDebtIdentity:
  debtIdentityId: PhysicsCatchUpDebtIdentityId
  graphId: PhysicsGraphId
  debtClockId: PhysicsClockId
  sourceCursorBeforeAfter: typed-monotonic-cursor-pair
  presentationOpportunitySequence: integer
  observedAt: PhysicsInstant
  policyRevision: opaque-version

PhysicsCatchUpLossLedger:
  lossLedgerId: PhysicsCatchUpLossLedgerId
  debtIdentityId: PhysicsCatchUpDebtIdentityId
  droppedIntervals: [PhysicsTimeInterval]
  droppedStateEquationAdvances: [state-equation-id-and-interval]
  droppedInteractionAndEventRanges: [typed-closed-range]
  lostCommodities: typed-commodity-map
  approximationErrors: [PhysicsErrorDescriptor]
  discontinuityEpochBeforeAfter: typed-version-pair
  resetActions: [ScopedResetAction]
  contentDigest: collision-resistant-digest

PhysicsCatchUpBatch:
  catchUpBatchId: PhysicsCatchUpBatchId
  graphId: PhysicsGraphId
  contextId: PhysicsContextId
  owner: graph-coordinator-id
  debtIdentity: PhysicsCatchUpDebtIdentity
  debtBefore: PhysicsDuration
  elapsedDuringBatch: PhysicsDuration
  admittedAdvanceIntervals: [PhysicsTimeInterval]
  coordinationAdvanceIds: [PhysicsCoordinationAdvanceId]
  committedAdvanceDuration: PhysicsDuration
  explicitlyDroppedDuration: PhysicsDuration
  debtAfter: PhysicsDuration
  lossLedger: PhysicsCatchUpLossLedger | TypedAbsence
  policyRevision: opaque-version
  errorResourceAndExecutionGateResults: [typed-gate-and-result]
  status: completed | rejected | blocked
  receiptDigest: collision-resistant-digest

PhysicsCoordinationAdvanceRecord:
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  graphId: PhysicsGraphId
  contextId: PhysicsContextId
  coordinationSequence: integer
  catchUpBatchId: PhysicsCatchUpBatchId | TypedAbsence
  predecessorAdvanceId: PhysicsCoordinationAdvanceId | TypedAbsence
  predecessorReceiptDigest: collision-resistant-digest | TypedAbsence
  interval: PhysicsTimeInterval
  debtBefore: PhysicsDuration
  debtAfter: PhysicsDuration
  stageExecutionIds: [PhysicsStageExecutionId]
  stateAdvanceClaimIds: [StateAdvanceClaimId]
  commitTransactionIds: [PhysicsCommitTransactionId]
  status: prepared | committed | rejected | failed
  receiptDigest: collision-resistant-digest

BoundedCouplingLoop:
  loopId: BoundedCouplingLoopId
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  couplingInterval: PhysicsTimeInterval
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
  acceptedIterationIndex: integer | TypedAbsence
  acceptedWriteLineage: [CouplingAcceptedWriteLineage]
  outerEdgePolicy: ingress-committed-and-accepted-egress-only
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
  stageExecutionIds: [PhysicsStageExecutionId]
  interactionApplicationLedgerIds: [InteractionApplicationLedgerId]
  outputContentDigest: collision-resistant-digest
  dependencyCompletionRefs: [typed-completion-ref]

CouplingAcceptedWriteLineage:
  loopId: BoundedCouplingLoopId
  acceptedIterationIndex: integer
  provisionalVersion: typed-version-ref
  iterationOutputDigest: collision-resistant-digest
  preparedPublicationId: PhysicsPreparedPublicationId
  preparedVersion: typed-version-ref
  semanticEquivalenceProof: exact-copy | immutable-handle-promotion | named-conversion-with-error

PhysicsCommitGroup:
  commitGroupId: PhysicsCommitGroupId
  owner: transaction-owner-id
  interval: PhysicsTimeInterval
  provisionalVersions: [typed-version-ref]
  preparedPublications: [PhysicsPreparedPublication]
  committedPublications: [typed-version-ref]
  publicationLineage: [CommitPublicationLineage]
  stateEquationOwners: { named-state-equation: owner-id }
  conservationAndErrorGates: [typed-gate]
  atomicity: all-or-none
  failureDisposition: rollback | preserve-prior-commit | typed-degraded-commit
  commitTransactionId: PhysicsCommitTransactionId

PhysicsPreparedPublication:
  preparedPublicationId: PhysicsPreparedPublicationId
  commitGroupId: PhysicsCommitGroupId
  stateEquationOwner: owner-id
  signalOrStateEquationId: id
  provisionalVersion: typed-version-ref
  preparedVersion: typed-version-ref
  contentDigest: collision-resistant-digest
  ownerApproval: owner-id-and-revision
  prepareDependencyRefs: [PhysicsDependencyRef]
  visibility: transaction-private

PhysicsCommitTransaction:
  commitTransactionId: PhysicsCommitTransactionId
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  contextId: PhysicsContextId
  interval: PhysicsTimeInterval
  commitGroupIds: [PhysicsCommitGroupId]
  preparedPublicationIds: [PhysicsPreparedPublicationId]
  conservationErrorAndResourceGates: [typed-gate-and-result]
  priorCommittedVersions: [typed-version-ref]
  publicationSetDigest: collision-resistant-digest
  atomicPublicationProtocol: prepare-validate-single-registry-swap
  status: preparing | prepared | committed | rejected | rolled-back
  receipt: PhysicsCommitReceipt | TypedAbsence

PhysicsCommitReceipt:
  receiptId: PhysicsCommitReceiptId
  commitTransactionId: PhysicsCommitTransactionId
  publicationInstant: PhysicsInstant
  preparedToCommittedPublicationMap: [prepared-publication-id-version-digest-to-committed-version-digest]
  committedPublications: [typed-version-ref]
  priorToCommittedVersionMap: [typed-version-transition]
  publicationSetDigest: collision-resistant-digest
  registryRevisionBeforeAfter: typed-version-pair
  dependencyCompletionRefs: [PhysicsDependencyCompletionRef]
  conservationAndErrorGateResults: [typed-gate-and-result]
  status: committed
  receiptDigest: collision-resistant-digest

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
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  stageExecutions: [PhysicsStageExecution]
  dependencyCompletions: [PhysicsDependencyCompletion]
  stateAdvanceClaims: [StateAdvanceClaim]
  interactionApplicationLedgers: [InteractionApplicationLedger]
  loopResults: [loop-id-iterations-residuals-and-accepted-iterate]
  commitReceipts: [PhysicsCommitReceipt]
  catchUpDebtBeforeAfter: typed-duration-pair
  discontinuityEpoch: opaque-version
  physicsCostLedgerId: PhysicsCostLedgerId
```

One ledger covers one `PhysicsCoordinationAdvanceRecord` and one graph
coordination interval. Stage rows are ordered by
the graph partial order and execution sequence; a committed output must appear
in exactly one successful `commitReceipt`. The cost-ledger reference binds
the same target/workload quality state used to measure this execution policy;
it is not a timing value copied into every row.

A `PhysicsGraphStage` declares `stageId`, `stageKind`, owner, `clockId`, exact
input interval and sample phase, static read/write port version rules, immutable
substep-parameter record, native stepping rule, execution residency, and failure
policy. A stage write is either loop-local `provisional` state or a
transaction-private `prepared` state; it never becomes externally sampleable merely because a
dispatch completed. Every externally visible committed version appears in
exactly one `PhysicsCommitGroup`, and only the authoritative state-equation owner
may contribute its publication. A coordinator may commit an owner's already
prepared version atomically but does not become a second state-equation owner.

For a stage with `exact-subcycle-tile`, its successful
`PhysicsStageExecution` intervals
are ordered, nonoverlapping, gap-free, and their union equals the enclosing
coordination coverage interval. Native-clock endpoints map to exact structural
rational endpoints on the coordination clock under the cited mapping proof;
derived floating seconds are not tiling evidence. Static stage ports declare
version-selection rules, while each execution resolves exact input/output
versions and digests. Sparse event executions instead enumerate the closed event set;
analytic samples evaluate state without advancing it. `state-hold` records an
explicitly admitted interval with no state advance. For each state equation
and physical interval, at most one successful `StateAdvanceClaim` has kind
`state-advance`; subcycles are members of that claim, not independent graph
advances. An execution without its claim, or two claims that overlap the same
state equation and interval, is a hard double-step failure.

A `PhysicsGraphEdge` declares producer/consumer, exact signal/interaction and
version, sample phase, interpolation/extrapolation policy, maximum staleness,
latency, dependency, and absence policy. Each stage clock is registered. Each
execution interval is nonempty and either contained in or explicitly mapped to
the coordination interval. Every read is justified by exactly one matching edge
from a committed prior version or a permitted loop-local provisional writer;
every edge terminates at a matching read. A `PhysicsDependency` is an immutable
stage-level protocol template; each producer/consumer execution pair emits a
distinct `PhysicsDependencyCompletion` that binds payload, version, resource
identity/subresource, access, device/backend/resource generations, release,
acquire, and completion semantics. Submission order or a handle string alone is
not a completion proof. Every completion must satisfy
the producer/consumer residency pair before first consumer access.

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

Every iteration uses the identical `couplingInterval` and bracket. Iteration
zero inputs equal the declared seeds and committed ingress; iteration `k > 0`
inputs equal the exact versions and content digests selected by each carried
edge from iteration `k - 1`. The loop's accepted writes equal, with no extras or
omissions, the accepted row's outputs and
`CouplingAcceptedWriteLineage`; only those versions may cross an outer egress
edge. Correction and conservation gates that influence acceptance execute
inside the loop. Rejected iterations may not publish interactions, application
ledgers, resource leases, cache entries, events, or presentation state.

Every successful commit has a one-to-one `publicationLineage` row from each
provisional version to each committed publication, with a digest and either an
exact immutable promotion proof or a named conversion/error proof. A matching
name is not lineage; no unlisted byte range or state equation may enter the
commit.

Commit is prepare then atomic publication. Every group first produces
transaction-private `PhysicsPreparedPublication` records. A
`PhysicsCommitTransaction` validates the complete closed publication set and
per-owner approvals, then performs one logical registry-table swap; its receipt
is the sole transition to externally visible committed state. Failure before
that swap preserves the full prior committed set. A consumer can observe either
all receipt publications or none, including across CPU, GPU, and external
owners; per-resource completion without the transaction receipt is not commit.
The receipt's prepared-to-committed map is a bijection over the transaction's
prepared and committed sets, preserving each content digest unless a named
conversion with bounded error was admitted before the swap.

Each graph execution advances one explicit coordination interval. Each owner chooses its
native substeps subject to its stability/error gate. Rate interactions are
integrated over each overlapping subinterval; integrated impulses are applied
exactly once over their declared interval. The graph owns a common catch-up,
drop, and discontinuity decision so domains cannot independently skip different
physical intervals.

Committed coordination advances form a digest-linked monotonic sequence. Their
intervals are adjacent unless the catch-up policy emits a loss ledger and new
discontinuity epoch. Catch-up admission is graph-wide: it bounds both
coordination advances and all native executions for one presentation
opportunity, and it cannot be applied independently by a domain or render loop.
One `PhysicsCatchUpBatch` owns the exact debt cursor/opportunity identity,
ordered admitted intervals, and debt delta. Dropped debt requires its complete
loss ledger and discontinuity/reset transition; retained debt has typed absence
for that ledger. Its exact identity is `debtAfter = debtBefore +
elapsedDuringBatch - committedAdvanceDuration - explicitlyDroppedDuration`;
every term shares the registered debt clock and mapping revision. Per-domain
debt accounting is forbidden.

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
  chartId: PhysicsChartId | TypedAbsence
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
(`hard-bound`, `measured-residual`, `statistical-uncertainty`, or `unavailable`),
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

A `PhysicsSampleRequest` carries context/provider/signal/schema IDs, one
discriminated `PhysicsTime` arm, required and optional channel masks,
query points or oriented
footprints in physics-frame metres, requested filter/frequency response,
per-channel tolerances, maximum staleness, acceptable residency/latency, and
batch extent. A result returns a discriminated `actualBundleTime`, actual
per-channel `PhysicsTime`, support, filter/band, age,
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
  actualPhysicsTime: PhysicsTime
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
  airVelocityMps: SampledChannel<Vec3> | TypedAbsence
  airDensityKgPerM3: SampledChannel<scalar> | TypedAbsence
  airPressurePa: SampledChannel<scalar> | TypedAbsence
  temperatureK: SampledChannel<scalar> | TypedAbsence
  specificHumidityKgPerKg: SampledChannel<scalar> | TypedAbsence
  turbulenceStatistics: SampledChannel<typed-statistics> | TypedAbsence
  precipitationMassFluxKgPerM2S: SampledChannel<scalar> | TypedAbsence
  precipitationPhase: SampledChannel<phase-or-mass-fractions> | TypedAbsence
  precipitationVelocityMps: SampledChannel<Vec3> | TypedAbsence
  mediumMaterialVelocityMps: SampledChannel<Vec3> | TypedAbsence
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
  surfacePointVelocityMps: SampledChannel<Vec3> | TypedAbsence
  materialCurrentVelocityMps: SampledChannel<Vec3> | TypedAbsence
  waterColumnDepthMeters: SampledChannel<scalar> | TypedAbsence
  densityKgPerM3: SampledChannel<scalar> | TypedAbsence
  materialAccelerationMps2: SampledChannel<Vec3> | TypedAbsence
  pressurePa: SampledChannel<scalar> | TypedAbsence
  bathymetryPoint: SampledChannel<Vec3> | TypedAbsence
  wetDryState: SampledChannel<state> | TypedAbsence
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
  signedSeparationMeters: SampledChannel<scalar> | TypedAbsence
  pointVelocityMps: SampledChannel<Vec3> | TypedAbsence
  pointAccelerationMps2: SampledChannel<Vec3> | TypedAbsence
  physicsMaterialId: PhysicsMaterialId | TypedAbsence
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
  incidentRadiance: SampledChannel<spectral-radiance> | TypedAbsence
  surfaceIrradiance: SampledChannel<spectral-irradiance> | TypedAbsence
  directSolarIrradiance: SampledChannel<spectral-irradiance> | TypedAbsence
  skyIrradiance: SampledChannel<spectral-irradiance> | TypedAbsence
  transmittance: SampledChannel<dimensionless-spectrum> | TypedAbsence
  sourceDirection: SampledChannel<Vec3-or-distribution> | TypedAbsence
  attenuationFactorIds: [versioned-factor-id]
  skyIncludesDirectSolarDisc: true | false | TypedAbsence
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
  physicalImpactParents: [PhysicalImpactParentRecord]
  physicalImpactPartitions: [PhysicalImpactPartitionRecord]
  reactionGroups: [InteractionReactionGroup]
  conservationGroups: [ConservationGroup]
  couplingLoopId: BoundedCouplingLoopId | TypedAbsence
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
  sourceEntityId: EntityId-with-generation | TypedAbsence
  sourceStateVersions: [signal-or-material-state-version]
  targetOwner: state-equation-owner
  targetEntityId: EntityId-with-generation | TypedAbsence
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
  partitionMembership: InteractionPartitionMembership | TypedAbsence
  reactionGroupId: InteractionReactionGroupId | TypedAbsence
  reactionToInteractionIds: [InteractionId]
  conservationGroupIds: [ConservationGroupId]
  validity: typed-validity
  error: per-payload-and-footprint-error
  provenance: source-model-adapter-and-revision
```

Physical impacts that are spatially partitioned use these machine records:

```yaml
InteractionPartitionMembership:
  parentExchangeId: SurfaceExchangeId
  parentInteractionIds: [InteractionId]
  partitionGroupId: InteractionPartitionGroupId
  partitionId: InteractionPartitionId
  partitionMeasure: Quantity
  closureGroupId: ConservationGroupId

PhysicalImpactParentRecord:
  physicalImpactParentId: PhysicalImpactParentId
  contextId: PhysicsContextId
  parentExchangeId: SurfaceExchangeId
  parentInteractionIds: [InteractionId]
  applicationInterval: PhysicsTimeInterval
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  partitionGroupId: InteractionPartitionGroupId
  partitionIds: [InteractionPartitionId]
  totalFootprintMeasure: Quantity
  conservedPayloadInventory: typed-commodity-map
  closureGroupId: ConservationGroupId
  sourceContentDigest: collision-resistant-digest

PhysicalImpactPartitionRecord:
  physicalImpactPartitionId: PhysicalImpactPartitionRecordId
  physicalImpactParentId: PhysicalImpactParentId
  membership: InteractionPartitionMembership
  childInteractionIds: [InteractionId]
  partitionFootprint: InteractionFootprint
  partitionPayloadInventory: typed-commodity-map
  visualChildIds: [non-authoritative-visual-id]
  partitionContentDigest: collision-resistant-digest
```

The partition IDs are unique inside one `partitionGroupId`; their footprint
interiors do not overlap, their measures sum to the parent's measure within the
declared quadrature bound, and their payload inventories sum to the parent
inventory under `closureGroupId`. Visual children never own, duplicate, or
apply the physical payload.

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
  applicationLedgerIds: [InteractionApplicationLedgerId]

InteractionApplicationLedger:
  applicationLedgerId: InteractionApplicationLedgerId
  contextId: PhysicsContextId
  exchangeId: SurfaceExchangeId
  interactionId: InteractionId
  exactOnceKey: collision-free-delivery-key
  targetOwner: state-equation-owner-id
  targetEntityId: EntityId-with-generation | TypedAbsence
  targetStateEquation: named-equation-and-term
  targetStateVersionExpected: opaque-version
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  stageExecutionId: PhysicsStageExecutionId
  nativeSubcycleIndex: integer | TypedAbsence
  payloadTimeSemantics: rate | interval-integrated | state-over-interval | algebraic-over-interval
  declaredApplicationInterval: PhysicsTimeInterval
  executionOverlapInterval: PhysicsTimeInterval | TypedAbsence
  overlapMeasureSeconds: Quantity<second>
  appliedPayloadAmount: typed-dimensioned-payload-integral | TypedAbsence
  applicationFraction: Quantity<dimensionless>
  cursorBefore: integer
  cursorAfter: integer
  targetPreparedVersion: typed-version-ref | TypedAbsence
  commitTransactionId: PhysicsCommitTransactionId | TypedAbsence
  disposition: prepared | committed | duplicate-no-op | deferred | rejected
  replayEpoch: opaque-version
  replaySourceLedgerId: InteractionApplicationLedgerId | TypedAbsence
  applicationContentDigest: collision-resistant-digest
  receiptDigest: collision-resistant-digest | TypedAbsence
```

A rate payload is integrated exactly over the intersection of its declared
interval and the execution interval; disjoint executions record zero overlap
and no application. An interval-integrated payload has exactly one committed
ledger row with `applicationFraction = 1`; all repeats are `duplicate-no-op`.
Partition children are exact-once under their own IDs while the closure ledger
prevents a parent payload from also being applied. Replay restores the cursor
and application-ledger version before a closed replay range, applies only keys
without committed receipts, and atomically publishes the new cursor with the
resulting state.

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
  materialPairSelection: PhysicsMaterialPairSelection
  normalConvention: A-to-B
  manifoldPatch:
    referencePointMeters: Vec3
    tangentBasis: typed-orthonormal-basis
    patchAreaM2: Quantity<square-meter>
    points:
      - { persistentPointId, pointMeters, featurePair, areaWeightM2 }
  signedSeparationMeters: per-point-values-and-error
  separationConvention: positive-separated-zero-touching-negative-penetrating
  timeOfImpact: PhysicsInstant | TypedAbsence
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
    trajectoryAndVelocity: typed-trajectory | TypedAbsence
    transportTerms: typed-angular-momentum-transport | TypedAbsence
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
  materials: { PhysicsMaterialId: PhysicsMaterialRecord }
  materialStateDescriptors: [PhysicsSignalDescriptorRef<PhysicsMaterialState>]
  pairLawResolver: PhysicsMaterialPairResolver
  renderBindings: [PhysicsMaterialBinding] | TypedAbsence

PhysicsMaterialRecord:
  physicsMaterialId: PhysicsMaterialId
  recordVersion: opaque-version
  densityKgPerM3: Quantity | TypedAbsence
  contactLaw: versioned-law-and-parameters | TypedAbsence
  frictionLaw: versioned-law-and-parameters | TypedAbsence
  restitutionLaw: versioned-law-and-parameters | TypedAbsence
  complianceDampingLaw: versioned-law-and-parameters | TypedAbsence
  adhesionCohesionLaw: versioned-law-and-parameters | TypedAbsence
  permeabilityPorosityLaw: versioned-law-and-parameters | TypedAbsence
  wettingContactAngleLaw: versioned-law-and-parameters | TypedAbsence
  dragRoughnessLaw: versioned-law-and-parameters | TypedAbsence
  thermalConductivityWPerMK: Quantity | TypedAbsence
  specificHeatJPerKgK: Quantity | TypedAbsence
  emissivitySpectrum: typed-spectrum | TypedAbsence
  phaseChangeLaw: versioned-law-and-parameters | TypedAbsence
  uncertainty: per-property-error-map
  provenance: source-record

PhysicsMaterialBinding:
  bindingId: PhysicsMaterialBindingId
  renderMaterialOrPrimitiveSelector: stable-render-identity-and-slot
  physicsMaterialId: PhysicsMaterialId
  bindingVersion: opaque-version
  scope: exact-primitive | material-slot | semantic-asset-part
  overridePolicy: forbidden | named-explicit-override
  provenance: author-compiler-and-manifest-revision

PhysicsMaterialPairResolver:
  resolverId: PhysicsMaterialPairResolverId
  resolverVersion: opaque-version
  participantOrdering: ordered-A-B-with-contact-frame
  explicitPairOverrides: versioned-pair-map
  perLawCompositionRules: versioned-named-rules
  missingPairPolicy: block | named-approximation-with-error
  deterministicSelectionDigestRule: canonical-input-and-law-digest

PhysicsMaterialPairSelection:
  selectionId: PhysicsMaterialPairSelectionId
  interactionId: InteractionId
  applicationInterval: PhysicsTimeInterval
  orderedPhysicsMaterialIds: [PhysicsMaterialId, PhysicsMaterialId]
  orderedMaterialRecordVersions: [opaque-version, opaque-version]
  orderedMaterialStateIdsAndVersions: [typed-material-state-ref]
  materialStateSampleInstants: [PhysicsInstant]
  contactFrameId: PhysicsFrameId
  resolverId: PhysicsMaterialPairResolverId
  resolverVersion: opaque-version
  selectedLawRefsAndParameters: [versioned-law-and-parameters]
  approximationErrors: [PhysicsErrorDescriptor]
  selectionDigest: collision-resistant-digest
  latching: immutable-for-application-interval

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
  collisionGroups: CollisionFilterDescriptor
  approximationError: PhysicsErrorDescriptor
  residency: PhysicsResidencyDescriptor
```

```yaml
CollisionFilterDescriptor:
  filterId: CollisionFilterId
  filterVersion: opaque-version
  layerId: stable-layer-id
  belongsToMask: fixed-width-bitset
  collidesWithMask: fixed-width-bitset
  explicitPairExclusions: [ordered-collider-id-pair]
  explicitPairInclusions: [ordered-collider-id-pair]
  role: solid | sensor | query-only | boundary
  selfCollisionPolicy: disabled | enabled-by-shape-pair
  resolverOrdering: exclusions-then-inclusions-then-masks

DeformingSupportProxy:
  supportProxyId: DeformingSupportProxyId-with-generation
  contextId: PhysicsContextId
  owner: deformation-state-owner-id
  deformationSignalRef: PhysicsSignalDescriptorRef
  deformationStateVersion: opaque-version
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  validityInterval: PhysicsTimeInterval
  topologyRevision: opaque-version
  positionSampler: versioned-position-sampler
  velocitySampler: versioned-material-point-velocity-sampler
  normalAndJacobianSampler: versioned-differential-sampler
  conservativeSweptBounds: typed-bounds-and-interval
  topologyChangePolicy: forbidden-in-interval | versioned-remap-at-boundary
  supportFeatureRemap: stable-old-to-new-feature-map | TypedAbsence
  collisionFilter: CollisionFilterDescriptor
  physicsMaterialId: PhysicsMaterialId
  approximationError: PhysicsErrorDescriptor
  residency: PhysicsResidencyDescriptor

BoundaryConditionDescriptor:
  descriptorId: BoundaryConditionDescriptorId
  descriptorVersion: opaque-version
  normalCondition: no-penetration | prescribed-normal-velocity | prescribed-volume-flux | pressure | open-radiation
  tangentialCondition: free-slip | no-slip | navier-slip | prescribed-tangential-velocity
  thermalCondition: adiabatic | prescribed-temperature | prescribed-heat-flux | TypedAbsence
  speciesConditions: [species-id-and-value-flux-or-robin-law]
  roughnessAndPermeabilityLawRef: versioned-law-ref | TypedAbsence
  wetDryActivationRule: versioned-threshold-hysteresis-law | TypedAbsence
  twoWayReactionPolicy: required | forbidden | declared-one-way-with-error
  compatibilityAndStabilityGate: typed-gate

FluidBoundaryProxy:
  fluidBoundaryProxyId: FluidBoundaryProxyId-with-generation
  contextId: PhysicsContextId
  owner: boundary-state-owner-id
  physicsFrameId: PhysicsFrameId
  physicsOriginEpoch: PhysicsOriginEpoch
  transformRevision: opaque-version
  validityInterval: PhysicsTimeInterval
  supportGeometryRef: versioned-geometry-or-analytic-support
  geometryStateVersion: opaque-version
  positionSampler: versioned-position-sampler
  materialVelocitySampler: versioned-boundary-velocity-sampler
  normalAndMeasureSampler: versioned-differential-sampler
  conservativeSweptBounds: typed-bounds-and-interval
  boundaryCondition: BoundaryConditionDescriptor
  collisionFilter: CollisionFilterDescriptor
  physicsMaterialSelection: PhysicsMaterialId | PhysicsMaterialPairSelection
  reactionExchangeId: SurfaceExchangeId | TypedAbsence
  updateCadence: PhysicsCadenceDescriptor
  topologyRevisionAndRemap: typed-version-and-feature-remap
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
position and material-point velocity samplers, differential sampler,
conservative swept bounds, topology-change policy, and support-feature
remapping. `FluidBoundaryProxy` is the only boundary arm consumed by a fluid
solver; rendering geometry is not a boundary condition. Pair filtering is
deterministic and versioned. A `PhysicsMaterialPairSelection` is latched before
the first interaction application and cannot change inside its interval.

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
  acceleration: typed-spatial-acceleration | TypedAbsence
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
  dragModel: versioned-law | TypedAbsence
  addedMassModel: versioned-law | TypedAbsence
  waveExcitationModel: versioned-law | TypedAbsence
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
  replayLogCoverage: PhysicsTimeInterval | TypedAbsence
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
  interactionCapabilities: [ExternalInteractionCapability]
  stepReceipts: [ExternalSolverStepReceipt]
  residencySynchronization:
    authorityBySignalOrStateEquation: explicit-owner-map
    transport: shared-resource | device-copy | host-staging | network-message
    resourceProtocol:
      handleAndLayoutKinds: versioned-ABI
      producerAccessAndConsumerAccess: typed-access-map
      generationAndSubresourceFields: explicit-field-map
      acquireDependency: PhysicsDependencyRef
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
    solverSeedAndStreamIdentity: typed-cursor-map | TypedAbsence
    replayEquivalenceGate: bitwise | bounded-observable-error | unsupported
  errorModel: per-channel-and-coupling-errors
  checkpointRollback:
    support: none | checkpoint | checkpoint-and-replay
    checkpointFormatAndDigest: versioned-format | TypedAbsence
    cadenceAndMaximumRollback: typed-policy | TypedAbsence
    includedStateVersionsInventoriesAndCursors: explicit-set | TypedAbsence
    restoreOrderingAndValidationGates: typed-stage-plan | TypedAbsence
  failurePolicy:
    detectionAndTimeout: typed-gates
    freezeCommitGroups: [PhysicsCommitGroupId]
    priorCommittedStateDisposition: preserve | invalidate-with-discontinuity
    queuedInteractionEventDisposition: drain | retain-for-replay | reject-and-ledger
    recoveryOwnerAndPlan: owner-and-transaction-ref | TypedAbsence
    degradedPublication: forbidden | explicit-signals-errors-and-quality-epoch

ExternalInteractionCapability:
  capabilityId: ExternalInteractionCapabilityId
  direction: ingress | egress
  role: source | reaction
  payloadTag: InteractionPayload-tag
  targetEquationId: named-state-equation | TypedAbsence
  frameId: PhysicsFrameId
  unitSignature: exact-SI-dimensional-signature
  footprintKinds: [point | line | area | volume]
  cadence: PhysicsCadenceDescriptor
  batchBounds: typed-count-layout-and-byte-bound
  exactOnceSupport: required-ledger | unsupported
  reactionAtomicity: same-commit-transaction | independent-with-conservation-bound | not-applicable
  residency: PhysicsResidencyDescriptor
  dependencyRef: PhysicsDependencyRef
  errorDescriptorRef: PhysicsErrorId

ExternalSolverStepReceipt:
  receiptId: ExternalSolverStepReceiptId
  adapterId: PhysicsProviderId
  coordinationAdvanceId: PhysicsCoordinationAdvanceId
  externalStepSequence: integer
  requestedInterval: PhysicsTimeInterval
  actualNativeExecutionIntervals: [PhysicsTimeInterval]
  inputStateVersions: [typed-version-ref]
  inputApplicationLedgerIds: [InteractionApplicationLedgerId]
  outputPreparedVersions: [typed-version-ref]
  emittedInteractionSequenceRanges: [closed-sequence-range]
  dependencyCompletionRefs: [PhysicsDependencyCompletionRef]
  status: prepared | completed | rejected | failed
  contentDigest: collision-resistant-digest
```

Convert units, frames, handedness, and time at exactly one named adapter
boundary. Preserve stable IDs and source versions through serialization. Every
ownership field names exactly one side; split collision/contact ownership also
defines the typed handoff between them. No implicit engine default may own
stepping, constraints, collisions, manifold lifecycle, accumulation, or commit.
Expose interpolation, extrapolation, and delayed-state error instead of hiding
network/process latency.

Every external interaction matches exactly one directional
`ExternalInteractionCapability`. Ingress requires a target equation and
exact-once application support; egress records whether its reaction must share
the ingress commit transaction. Capability frame, units, footprint, cadence,
batch, residency, dependency, and error gates are checked before dispatch, not
inferred from the returned bytes. Unsupported required capability blocks the
route.

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
  -> PresentationTimeCohort
  -> view-independent PhysicsPresentationCandidate
  -> per-view CameraViewPublication
  -> per-view ViewPreparationPublication (visibility, shadows, caches, reset plans)
  -> sealed PhysicsPresentationSnapshot
  -> per-target PresentationRenderPlan
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
  timeCohortId: PresentationTimeCohortId
  requestedPresentationInstant: PhysicsInstant
  physicsOriginEpoch: PhysicsOriginEpoch
  commitProvenance: CandidateCommitProvenance
  candidateScope: committed-state-brackets-leases-and-events
  presentedStatePairs: [PresentedStatePair]
  resourceLeases: [PresentationResourceLease]
  eventSequenceRanges: [PresentationEventRange]

PresentationTimeCohort:
  timeCohortId: PresentationTimeCohortId
  presentationClockId: PhysicsClockId
  presentationOpportunitySequence: integer
  previousRequestedPresentationInstant: PhysicsInstant
  currentRequestedPresentationInstant: PhysicsInstant
  requestedPresentationInstant: PhysicsInstant
  requiredContextIds: [PhysicsContextId]
  requiredDiscontinuityEpochs: { PhysicsContextId: opaque-version }
  maximumInterContextSkew: PhysicsDuration
  maximumCandidateAge: PhysicsDuration
  admissionPolicy: exact-instant | bounded-mapped-skew
  cohortSpecificationDigest: collision-resistant-digest

CandidateCommitProvenance:
  provenanceId: CandidateCommitProvenanceId
  contextId: PhysicsContextId
  coordinationAdvanceIds: [PhysicsCoordinationAdvanceId]
  commitTransactionIds: [PhysicsCommitTransactionId]
  commitReceiptIdsAndDigests: [receipt-id-and-content-digest]
  committedStateVersions: [typed-version-ref]
  physicsOriginTransactionId: PhysicsOriginRebaseTransactionId | TypedAbsence
  qualityTransitionId: QualityTransitionId | TypedAbsence
  closedPublicationSetDigest: collision-resistant-digest

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
Every presented version resolves through `CandidateCommitProvenance` to one
committed receipt in the closed publication set; prepared or loop-provisional
versions are inadmissible. The candidate instant and context/discontinuity
epochs satisfy its immutable `PresentationTimeCohort` specification. A cohort
does not force equal solver clocks; it admits their mapped committed states
under the serialized skew and age gates.

`requestedPresentationInstant` equals the cohort's
`currentRequestedPresentationInstant`. Every selected pair arm and camera
publication maps the same previous/current cohort instants; views with a
different pair of requested instants require another cohort and Candidate.

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
  extrapolation: named-policy-age-and-error | TypedAbsence

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
  entityId: EntityId-with-generation | TypedAbsence
  providerId: PhysicsProviderId
  signalId: PhysicsSignalId
  previousPresented:
    provenance: PresentationSampleProvenance
    presentedInstant: PhysicsInstant
    stateHandle: PresentationStateHandle
    globalBinding: PresentationSpatialBinding
    originEpochBridge: PhysicsOriginEpochBridge | TypedAbsence
  currentPresented:
    provenance: PresentationSampleProvenance
    presentedInstant: PhysicsInstant
    stateHandle: PresentationStateHandle
    globalBinding: PresentationSpatialBinding
    originEpochBridge: PhysicsOriginEpochBridge | TypedAbsence
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
  previousJitterSampleAndConvention: typed-jitter-record
  currentJitterSampleAndConvention: typed-jitter-record
  jitterSequenceRevision: opaque-version
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
Previous/current jitter samples bind to the corresponding unjittered matrices
and one immutable `jitterSequenceRevision`; a singular current-only jitter key
cannot establish temporal motion or history compatibility.

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
  requiredPreparationEdges: [PresentationPreparationEdge]
  resourceLeases: [PresentationResourceLease] # full records created by this view preparation
  resourceLeaseRefs: [PresentationResourceLeaseRef]
  renderResourceLeases: [RenderResourceLease]

PresentationPreparationEdge:
  edgeId: PresentationPreparationEdgeId
  producerPublicationId: immutable-publication-id
  consumerPublicationId: immutable-publication-id
  requiredContentIdAndVersion: typed-content-ref
  resourceLeaseRef: PresentationResourceLeaseRef | TypedAbsence
  dependencyRef: PhysicsDependencyRef
  accessTransition: producer-access-to-consumer-access
  completionRequiredBefore: first-consumer-pass-or-seal
  status: satisfied | failed

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
  shadowFactorProvenance: ShadowFactorProvenance
  resourceLeaseRefs: [PresentationResourceLeaseRef]
  boundedDelay: PhysicsDuration | TypedAbsence

ShadowFactorProvenance:
  shadowFactorId: ShadowFactorId
  shadowViewId: shadow-view-id
  lightIdAndStateVersion: stable-light-id-and-version
  receiverViewId: view-id
  receiverStateVersions: [typed-version-ref]
  occluderPublicationRefs: [versioned-view-publication-ref]
  candidateId: PhysicsPresentationCandidateId
  cameraPublicationId: CameraViewPublicationId
  encodingAndFilterRevision: typed-shadow-encoding-filter-ref
  factorSemantics: direct-light-visibility
  applicationOwner: lighting-owner-id
  applicationMultiplicity: exactly-once
  contentDigest: collision-resistant-digest
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

The snapshot references the unique subset of Candidate pairs consumed by this
target/view; it does not copy independently mutable pairs or transforms or
force a sibling view's unused pair into its closure. Every referenced binding
ID resolves exactly once in the Candidate, and pair-state leases are derived
from that subset. IDs, target/view scope, device/resource generations,
events, reactive actions, and leases must resolve transitively through the exact
candidate, camera, and view-preparation publications. The
`closureManifest` is exact: its required lease IDs equal the union of referenced
pair-state handles and every preparation/shadow/cache/reactive/reset-plan dependency,
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
  kind: shadow-content | foam | emissive | optical | topology | deformation | disocclusion | event | camera-cut | projection | render-origin | physics-origin | quality | material-law | radiance-basis
  presentationTargetId: presentation-target-id
  viewId: view-id
  affectedRegion: AffectedRegionDescriptor
  resourceLeaseId: lease-id | TypedAbsence
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
  resourceLeaseId: lease-id | TypedAbsence
  inputHistoryLeaseRef: PresentationResourceLeaseRef | TypedAbsence
  expectedInputHistoryGeneration: opaque-version | TypedAbsence
  expectedOutputHistoryGeneration: opaque-version | TypedAbsence
  expectedPolicyResult: typed-policy-result
```

`AffectedRegionDescriptor` is the exact tagged union below. Exactly one arm
matching `kind` is present and all other arms are typed absence:

```yaml
AffectedRegionDescriptor:
  kind: full-frame | entity-set | physics-bounds | screen-mask
  fullFrame: { reason: scoped-reason } | TypedAbsence
  entitySet: { entityIds: [EntityId-with-generation] } | TypedAbsence
  physicsBounds:
    { physicsFrameId, physicsOriginEpoch, transformRevision,
      boundType, boundsMeters, error } | TypedAbsence
  screenMask: ReactiveMaskDescriptor | TypedAbsence
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
  entitySlotMapVersion: opaque-version | TypedAbsence
  residency: cpu | gpu | external | mirrored
  slotRangeStrideCount: typed-Quantity-records
  owner: owner-id
  leaseScope: candidate | view-preparation
  access: read
  submissionAvailability: typed-gpu-dependency
  leaseBegin: opaque-sequence
  reuseProhibitedUntil: ConsumerCompletionJoin

RenderResourceLease:
  renderResourceLeaseId: RenderResourceLeaseId
  baseLeaseRef: PresentationResourceLeaseRef
  presentationTargetId: presentation-target-id
  viewId: view-id
  semantic: color | depth | velocity | shadow-factor | history | reactive-mask | visibility | cache | named
  encodingFormat: semantic-encoding-and-physical-format
  physicalExtent: Quantity<physical-pixels>
  resolutionScale: Quantity<ratio>
  sampleCount: Quantity<samples>
  subresourceRange: typed-range
  producerPreparationEdgeId: PresentationPreparationEdgeId | TypedAbsence
  firstConsumerPhase: render-phase-id
  lastConsumerPhase: render-phase-id
  requiredConsumerKeys: [typed-consumer-key]
  aliasGroupAndCompatibility: typed-alias-proof | TypedAbsence
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
PresentationRenderPlan:
  renderPlanId: PresentationRenderPlanId
  timeCohortId: PresentationTimeCohortId
  candidateId: PhysicsPresentationCandidateId
  snapshotId: PhysicsPresentationSnapshotId
  presentationTargetId: presentation-target-id
  viewId: view-id
  phaseIds: [RenderPlanPhaseId]
  phaseRecords: [RenderPlanPhase]
  edges: [RenderPlanEdge]
  requiredPreparationEdgeIds: [PresentationPreparationEdgeId]
  renderResourceLeaseIds: [RenderResourceLeaseId]
  plannedResetActionIds: [scoped-action-id]
  resetActionPhaseById: { scoped-action-id: RenderPlanPhaseId }
  expectedResetHistoryGenerations:
    scoped-action-id: { inputHistoryGeneration, outputHistoryGeneration }
  shadowFactorIds: [ShadowFactorId]
  closureDigest: collision-resistant-digest
  immutablePlanDigest: collision-resistant-digest

RenderPlanPhase:
  phaseId: RenderPlanPhaseId
  renderPlanId: PresentationRenderPlanId
  presentationTargetId: presentation-target-id
  viewId: view-id
  owner: owner-id
  queueId: queue-id
  backendGeneration: opaque-version
  passOrDispatchKey: pass-or-dispatch-key
  inputResourceGenerationIds: [typed-resource-generation-id]
  outputResourceGenerationIds: [typed-resource-generation-id]
  outputOwnerByGeneration: { typed-resource-generation-id: owner-id }
  outputEncodingByGeneration: { typed-resource-generation-id: semantic-encoding-and-physical-format }
  outputPhysicalExtentByGeneration: { typed-resource-generation-id: Quantity<physical-pixels> }
  historyReadGenerationIds: [typed-history-generation-id]
  historyWriteGenerationIds: [typed-history-generation-id]

RenderPlanEdge:
  edgeId: RenderPlanEdgeId
  renderPlanId: PresentationRenderPlanId
  producerPhaseId: RenderPlanPhaseId
  consumerPhaseId: RenderPlanPhaseId
  dependencyRef: PhysicsDependencyRef
  resourceGenerationId: typed-resource-generation-id
  subresourceRange: typed-range
  producerAccess: typed-resource-access
  consumerAccess: typed-resource-access
  completionRef: PhysicsDependencyCompletionRef
  externalFence: typed-fence-and-generation-proof | TypedAbsence

ScopedResetActionResult:
  resultId: ScopedResetActionResultId
  actionId: scoped-action-id
  renderPlanId: PresentationRenderPlanId
  executionPhaseId: RenderPlanPhaseId
  presentationTargetId: presentation-target-id
  viewId: view-id
  historyKey: view-signal-encoding-resolution-jitter-key
  causeEpochs: [scoped-epoch]
  appliedRegion: AffectedRegionDescriptor
  policyApplied: preserve-with-proof | reset | reject-region | reproject-with-proof | reseed | rebuild | bypass | hold-prior | convert-with-proof
  inputHistoryLeaseRef: PresentationResourceLeaseRef | TypedAbsence
  outputHistoryLeaseRef: PresentationResourceLeaseRef | TypedAbsence
  inputHistoryGeneration: opaque-version | TypedAbsence
  outputHistoryGeneration: opaque-version | TypedAbsence
  dependencyCompletionRefs: [PhysicsDependencyCompletionRef]
  queueSubmissionEpoch: opaque-sequence | TypedAbsence
  status: completed | failed | bypassed-with-proof
  residualAndError: typed-residual-and-error
  failure: typed-failure-record | TypedAbsence
  resultDigest: collision-resistant-digest

FrameCohortAdmission:
  cohortAdmissionId: FrameCohortAdmissionId
  timeCohortId: PresentationTimeCohortId
  targetFrameSequence: monotonic-integer-sequence
  requiredTargetViewKeys: [target-view-key]
  candidateIds: [PhysicsPresentationCandidateId]
  snapshotIds: [PhysicsPresentationSnapshotId]
  renderPlanIds: [PresentationRenderPlanId]
  mappedPresentationInstants: { context-id: PhysicsInstant }
  observedMaximumSkew: PhysicsDuration
  configuredMaximumFramesInFlightByTarget: { target-view-key: positive-integer }
  observedFramesInFlightByTarget: { target-view-key: nonnegative-integer }
  saturationPolicyByTarget: { target-view-key: stall | drop-unsubmitted | reject-admission }
  ageSkewDiscontinuityAndClosureGateResults: [typed-gate-and-result]
  status: admitted | rejected
  admissionDigest: collision-resistant-digest

FrameSlotAdmission:
  slotAdmissionId: FrameSlotAdmissionId
  cohortAdmissionId: FrameCohortAdmissionId
  targetFrameSequence: monotonic-integer-sequence
  presentationTargetId: presentation-target-id
  viewId: view-id
  configuredMaximumFramesInFlight: positive-integer
  observedFramesInFlightAtAdmission: nonnegative-integer
  saturationPolicy: stall | drop-unsubmitted | reject-admission
  frameSlotIndex: integer
  frameSlotGeneration: opaque-version
  backendGeneration: opaque-version
  deviceLossGeneration: opaque-version
  priorOccupantExecutionId: FrameExecutionRecordId | TypedAbsence
  priorSlotCompletionJoin: ConsumerCompletionJoin | TypedAbsence
  acquisitionToken: typed-target-acquisition-token
  presentCompletionReservation: typed-target-present-reservation
  requiredRenderResourceLeaseIds: [RenderResourceLeaseId]
  capacityAndAliasingGateResults: [typed-gate-and-result]
  status: admitted | rejected
  admissionDigest: collision-resistant-digest

FrameExecutionRecord:
  executionId: FrameExecutionRecordId
  timeCohortId: PresentationTimeCohortId
  candidateIds: [PhysicsPresentationCandidateId]
  cohortAdmission: FrameCohortAdmission
  renderPlans: [PresentationRenderPlan]
  slotAdmissions: [FrameSlotAdmission]
  requiredTargetViewKeys: [target-view-key]
  snapshotIds: [PhysicsPresentationSnapshotId]
  overallStatus: submitted | completed | partial-failure | aborted | device-lost
  backendGeneration: opaque-version
  deviceLossGeneration: opaque-version
  targetExecutions:
    target-view-key:
      snapshotId: PhysicsPresentationSnapshotId | TypedAbsence
      renderPlanId: PresentationRenderPlanId | TypedAbsence
      slotAdmissionId: FrameSlotAdmissionId | TypedAbsence
      presentationTargetId: presentation-target-id
      viewId: view-id
      status: submitted | completed | failed | aborted | device-lost
      submittedPasses: [pass-or-dispatch-key]
      queueSubmissionEpochs: [opaque-sequence]
      actionResults: [typed-action-result]
      resetActionResults: [ScopedResetActionResult]
      completionTokens: [CompletionTokenRef]
      presentedTimestamp: PhysicsInstant | TypedAbsence
      loss: { deviceId, backendGeneration, deviceLossGeneration,
              lossTransactionId } | TypedAbsence
      failure: typed-failure-record-or-TypedAbsence
  leaseDispositionById:
    lease-id:
      disposition: retained-until-join | retired-after-abort | invalidated-by-device-loss
      consumingSnapshotIds: [PhysicsPresentationSnapshotId]
      completionJoin: ConsumerCompletionJoin
      retirementEvidence: typed-completion-or-loss-record
```

No target submits until its `FrameCohortAdmission`, `PresentationRenderPlan`,
and `FrameSlotAdmission` are all admitted and digest-consistent. Cohort
candidate/snapshot/plan sets equal the required target/view set exactly. A slot
is admitted only after its prior completion join or loss invalidation and after
every required render lease passes capacity, generation, and aliasing gates.
Observed in-flight occupancy cannot exceed the configured target maximum. At
saturation, only the serialized policy may stall, drop an unsubmitted cohort,
or reject admission; it never overwrites a live slot. Acquisition and present
reservations resolve to the exact target, frame sequence, slot generation, and
eventual completion token or typed failure.
The plan's `phaseIds` equal its phase-record IDs; phase edges form a DAG and
bind every inter-phase resource/subresource generation to a concrete completion
or fence. Each phase output-generation set equals the key set of its owner,
encoding, and extent maps. The render plan contains every required preparation
edge, planned reset action/expected generation, shadow factor, and render-
resource lifetime; later phases cannot add a mutable hidden dependency.
`resetActionPhaseById` has exactly the same key set as
`plannedResetActionIds`. Its phase exists in this plan, writes the expected
output history generation, and precedes every phase that reads that generation
under the plan DAG. Each actual `ScopedResetActionResult` exists only in the
matching `TargetExecution`, names that exact plan and phase, matches one planned
action and its expected input/output generations, resolves its dependency
completions to that phase's edges, and uses a queue submission epoch recorded by
that target execution. This makes reset work and traffic visible through the
same phase/work-attribution evidence as its first consumer; neither preparation
nor the Snapshot claims that execution occurred.
Each `ShadowFactorId` is applied exactly once by its lighting owner
to the named direct-light term and never again by a material or final-image
phase.

For a completed target, reset results close the planned action set exactly and
every result is `completed` or `bypassed-with-proof`; those statuses require a
typed-absent failure arm. A submitted target may contain only a duplicate-free
terminal-success subset whose phases have completed. A failed result requires a
present failure arm and cannot satisfy a completed target. A pre-seal failed,
aborted, or lost target has no reset result, submission epoch, or completion
token.

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
this execution is invalidated by the same loss transaction. Every target has a
typed `loss` arm: it is present exactly for `device-lost` and binds the device,
backend generation, device-loss generation, and loss transaction; all other
target statuses carry typed absence. Mixed target loss therefore uses
`partial-failure`, and lease invalidation is selected from each lease's exact
device/backend/resource generation against the matching target loss record—not
from `overallStatus`. Only matching lost-generation leases take
`invalidated-by-device-loss`; other leases retain their exact joins.

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
  latencyOrDeadlineGate: PhysicsDuration | PhysicsDeadline | TypedAbsence
  requestedAllocation: QualityAllocationRequest
  admissionRequirements: [QualityAdmissionRequirement]

QualityAllocationRequest:
  allocationRequestId: QualityAllocationRequestId
  affectedTargetsViews: [target-view-id]
  requestedHotBytesByResidency: labelled-byte-map
  requestedTransientPeakBytesByResidency: labelled-byte-map
  migrationOverlapBytesByResidency: labelled-byte-map
  requestedBindingsTexturesBuffersAndAttachments: labelled-limit-demand-map
  requestedTrafficBytesPerCoordinationIntervalAndSecond: labelled-rate-map
  requestedCpuGpuAndExternalWork: labelled-cadence-work-map
  maximumFramesInFlightAndMultiviewMultiplier: labelled-counts
  thermalPowerEnvelope: labelled-gate
  lifetimeAndRetirementPlanDigest: collision-resistant-digest

QualityAdmissionRequirement:
  requirementId: QualityAdmissionRequirementId
  kind: physical-error | visual-error | conservation | stability | latency | memory | traffic | binding-limit | thermal | safe-boundary
  bound: canonical-labelled-quantity-or-typed-predicate
  evidenceRef: content-addressed-measurement-or-proof
  failureDisposition: reject | hold-current | narrower-candidate

QualityRequestAdmission:
  admissionId: QualityRequestAdmissionId
  requestId: QualityChangeRequestId
  coordinatorId: route-physics-coordinator
  currentQualityStateId: PhysicsQualityStateId
  currentQualityEpoch: PhysicsQualityEpoch
  selectedCandidateQualityStateId: PhysicsQualityStateId | TypedAbsence
  hysteresisAndMinimumResidenceResults: [typed-gate-and-result]
  admissionRequirementResults: [requirement-id-and-result]
  safeCommitBoundary: PhysicsTime | TypedAbsence
  allocationRequestDigest: collision-resistant-digest
  status: admitted | rejected | deferred
  reason: typed-reason

QualityAllocationAdmission:
  allocationAdmissionId: QualityAllocationAdmissionId
  allocationRequestId: QualityAllocationRequestId
  transitionId: QualityTransitionId
  allocatorOwner: owner-id
  targetDeviceBackendGenerations: [typed-generation-tuple]
  grantedBytesByResidencyAndLifetime: labelled-byte-map
  grantedBindingsTexturesBuffersAndAttachments: labelled-limit-map
  grantedTrafficAndWorkEnvelope: labelled-cadence-work-map
  allocationLeaseIds: [lease-id]
  simultaneousOldNewPeakProof: PhysicsMemoryLedger
  limitHeadroomAndThermalGateResults: [typed-gate-and-result]
  retirementJoinRefs: [ConsumerCompletionJoin]
  status: admitted | rejected
  receiptDigest: collision-resistant-digest
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
  requestId: QualityChangeRequestId
  requestSequence: monotonic-integer-sequence
  affectedTargetsViews: [target-view-id]
  affectedControls: [quality-control-id]
  sourceEvidenceDigest: collision-resistant-digest
  fromState: PhysicsQualityStateId
  toState: PhysicsQualityStateId
  fromQualityEpoch: PhysicsQualityEpoch
  toQualityEpoch: PhysicsQualityEpoch
  triggerEvidence: labelled-pressure-and-error-records
  requestAdmission: QualityRequestAdmission
  protectedInvariants: [named-invariant]
  prepare:
    allocationAdmission: QualityAllocationAdmission
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

No transition allocates or compiles before an admitted
`QualityRequestAdmission`, and no population or commit uses capacity absent
from the admitted `QualityAllocationAdmission`. Granted lifetimes and bytes
cover simultaneous old/new state plus frames in flight; rejection leaves the
current quality state and its authority unchanged. Transition `requestId`,
sequence, target/view scope, controls, and evidence digest equal the admitted
request exactly; they cannot be widened, reordered, or silently replaced.

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
  cadenceTraceTotals: CadenceTraceTotals
  status: active | provisional
  harness: PhysicsCostHarness
  composedGateSet: PhysicsComposedCostGateSet
  opportunityTable: PhysicsCostOpportunityTable
  composedTrace: PhysicsComposedCostTrace
  qualityState: PhysicsQualityStateId
  graphStageCosts: [router-cost-record]
  coordinationIntervalsPerSecond: labelled-distribution
  stageExecutionsPerCoordinationInterval: labelled-count-by-stage
  stageExecutionsPerSecond: labelled-count-by-stage
  coordinationIntervalsPerPresentedFrame: labelled-distribution
  subcyclesAndCouplingIterationsPerPresentedFrame: labelled-distribution-by-owner
  executionsPerPresentedFrame: labelled-count-by-stage
  worstPermittedCatchUpCost: PhysicsWorstPermittedCatchUpCost
  hotBytesReadWrittenPerExecution: labelled-by-stage-and-resource
  solverDispatches: [extent-workgroup-cadence-and-timing]
  sparseActiveDomainCosts: [PhysicsSparseActiveDomainCost]
  contactCosts: [PhysicsContactCost]
  externalAdapterCosts: [PhysicsExternalAdapterCost]
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
  workAttribution: [PhysicsCostAttribution]
  sharedWorkKeys: [PhysicsWorkKey]
  perViewWorkKeys: { target-view-key: [PhysicsWorkKey] }
  hotState: PhysicsMemoryLedger
  peakTransient: PhysicsMemoryLedger
  migrationOverlap: PhysicsMemoryLedger
  qualityCostEvidence: [PhysicsQualityCostEvidenceRef]
  qualityCostEvidenceResourcesByDigest: { content-digest: PhysicsQualityCostEvidenceResource }
  qualityMigrationCostEvidence: [PhysicsQualityMigrationCostEvidence]
  thermalPowerState: measured-or-unavailable

PhysicsCostHarness:
  harnessId: PhysicsCostHarnessId
  target:
    deviceId: stable-device-id
    osAndBrowserBuild: exact-builds
    gpuAdapterAndDriver: exact-identity-or-typed-unavailable
    backendAndDeviceGeneration: exact-WebGPU-generations
    displayModeAndMeasuredRefresh: typed-record
    powerSourceAndGovernor: typed-record
    thermalStartAndStabilizationPolicy: typed-record
  viewport:
    cssExtent: labelled-extent
    dpr: labelled-scalar
    physicalExtent: labelled-derived-extent
  workload:
    routeAndSceneRevision: content-addressed-identity
    contextGraphAndRegistryRevisions: typed-revision-tuple
    resourceAndPipelineGraphDigest: collision-resistant-digest
    presentationTargetsAndViews: [target-view-key]
    seedCameraInputAndEventTrace: content-addressed-record
    qualityStateAndEpoch: typed-quality-identity
  protocol:
    warmupAndCompilationState: typed-record
    coldTransitionAndSustainedSegments: typed-record
    sampleAndQuantilePolicy: typed-record
    cpuClockAndGpuQueryCoverage: typed-record
    counterAvailabilityAndUncertainty: typed-record
    visibilityPowerAndAutomationControls: typed-record
  harnessDigest: collision-resistant-digest

PhysicsComposedCostGateSet:
  gateSetId: PhysicsComposedCostGateSetId
  harnessId: PhysicsCostHarnessId
  qualityStateAndEpoch: typed-quality-identity
  frozenBeforeTraceDigest: collision-resistant-digest
  cpuCriticalPathP95: Quantity<second> # [G]
  gpuCriticalPathP95: Quantity<second> | TypedAbsence # [G], absence forbids GPU-performance acceptance
  externalTailP95: Quantity<second> | TypedAbsence # [G]
  presentedIntervalP95: Quantity<second> # [G]
  deadlineMissRatio: Quantity<dimensionless> # [G]
  updateLatencyByStateEquation: { state-equation-id: Quantity<second> } # [G]
  hotStateBytes: Quantity<byte> # [G]
  peakTransientBytes: Quantity<byte> # [G]
  migrationOverlapBytes: Quantity<byte> # [G]
  logicalTrafficPerOpportunity: Quantity<byte> # [G]
  uploadCopyMapBytesPerOpportunity: Quantity<byte> # [G]
  allocationAndCompilationChurn: typed-gates
  sustainedDriftAndQualityResidence: typed-gates
  numericalAndVisualErrorGateRefs: [gate-id]

PhysicsCostOpportunityTable:
  opportunityTableId: PhysicsCostOpportunityTableId
  harnessId: PhysicsCostHarnessId
  measurementInterval: PhysicsTimeInterval
  storage: inline | immutable-resource
  inlineRows: [PhysicsCostOpportunityRow] | TypedAbsence
  resource:
    { contentDigest, canonicalByteLayout, rowCount: Quantity<count>,
      orderedRowDigestRoot }
    | TypedAbsence
  exactRowCount: Quantity<count>
  tableDigest: collision-resistant-digest

PhysicsCostOpportunityRow:
  opportunityKey: { presentationClockId, presentationOpportunitySequence }
  opportunityInterval: PhysicsTimeInterval
  catchUpBatchId: PhysicsCatchUpBatchId | TypedAbsence
  coordinationAdvanceIds: [PhysicsCoordinationAdvanceId]
  stageExecutionCounts: { PhysicsGraphStageId: Quantity<count> }
  nativeSubcycleCounts: { owner-id: Quantity<count> }
  couplingIterationCounts: { BoundedCouplingLoopId: Quantity<count> }
  interactionApplicationCounts: { payload-tag: Quantity<count> }
  presentedFrameCounts: { target-view-key: Quantity<count> }
  workOccurrenceCounts: { PhysicsWorkKey: Quantity<count> }
  trafficOccurrenceAndLogicalByteTotals: { TrafficRecordId: typed-count-byte-pair }
  queueDispatchPassAndBarrierCounts: typed-count-record
  cpuCriticalPath: labelled-duration-and-node-path
  gpuCriticalPath: labelled-duration-query-coverage-and-node-path | TypedAbsence
  externalTail: labelled-duration-and-dependency-path | TypedAbsence
  presentedIntervalAndDeadlineMiss: typed-measured-record
  hotStatePeakTransientAndMigrationBytes: typed-measured-or-derived-record
  numericalAndVisualGateResults: [gate-result]
  qualityStateAndEpoch: typed-quality-identity
  rowDigest: collision-resistant-digest

PhysicsComposedCostTrace:
  composedTraceId: PhysicsComposedCostTraceId
  harnessId: PhysicsCostHarnessId
  gateSetId: PhysicsComposedCostGateSetId
  opportunityTableId: PhysicsCostOpportunityTableId
  cadenceTraceTotalsId: CadenceTraceTotalsId
  cpuCriticalPathDistribution: labelled-distribution
  gpuCriticalPathDistribution: labelled-distribution | TypedAbsence
  externalTailDistribution: labelled-distribution | TypedAbsence
  presentedIntervalAndDeadlineMissDistribution: typed-distribution
  memoryTrafficAllocationAndThermalDistributions: typed-distributions
  gateResults: { gate-id: pass | fail | insufficient-evidence }
  status: measured-valid | measured-invalid | insufficient-evidence

PhysicsWorstPermittedCatchUpCost:
  catchUpCostId: PhysicsWorstPermittedCatchUpCostId
  harnessId: PhysicsCostHarnessId
  gateSetId: PhysicsComposedCostGateSetId
  catchUpPolicyIdentity:
    { graphId, graphRevision, policyDigest, debtClockId,
      maximumDebt, maximumCoordinationAdvancesPerPresentationOpportunity,
      maximumNativeExecutionsPerOpportunity, debtDisposition }
  admissibleScheduleModel:
    integerVariables: stage-native-loop-interaction-and-work-counts
    constraintsDigest: graph-policy-activation-partition-loop-and-resource-closure
    objectiveDimensions:
      [cpu-critical-path, gpu-critical-path, external-tail, presented-interval,
       hot-traffic, peak-live-bytes, migration-overlap-bytes, numerical-error,
       visual-error]
  frontierWitnesses: [PhysicsCatchUpCostWitness]
  frontierCoverage:
    method: exhaustive-enumeration | verified-integer-optimization | conservative-dominating-bound
    proofRef: content-addressed-proof
    coveredObjectiveDimensions: [objective-dimension]
    uncoveredObjectiveDimensions: [objective-dimension]
    componentwiseDominationDigest: collision-resistant-digest
  gateResults: { gate-id: pass | fail | insufficient-evidence }
  requiredDisposition: admit | reduce-policy | block-presentation | drop-with-loss-and-discontinuity

PhysicsCatchUpCostWitness:
  witnessId: opaque-id
  maximizedObjectiveDimensions: [objective-dimension]
  opportunityRow: PhysicsCostOpportunityRow
  repetitionAndSustainedProtocol: typed-record
  composedMeasuredDistributions: typed-CPU-GPU-external-presentation-memory-traffic-error-distributions
  derivedUpperBoundsAndAssumptions: typed-record
  witnessDigest: collision-resistant-digest

PhysicsQualityCostEvidenceResource:
  resourceType: PhysicsQualityCostEvidenceResource
  qualityStateAndEpoch: typed-quality-identity
  graphAndResourceRevisionDigest: collision-resistant-digest
  harness: PhysicsCostHarness
  gateSet: PhysicsComposedCostGateSet
  opportunityTable: PhysicsCostOpportunityTable
  opportunityRowsResource: typed-canonical-opportunity-row-resource
  cadenceTraceTotals: CadenceTraceTotals
  composedTrace: PhysicsComposedCostTrace
  worstPermittedCatchUpCost: PhysicsWorstPermittedCatchUpCost
  steadyCostLedger: typed-steady-cost-ledger

PhysicsQualityCostEvidenceRef:
  qualityStateAndEpoch: typed-quality-identity
  graphAndResourceRevisionDigest: collision-resistant-digest
  evidenceResourceDigest: collision-resistant-digest
  harnessId: PhysicsCostHarnessId
  gateSetId: PhysicsComposedCostGateSetId
  steadyCostLedgerId: PhysicsCostLedgerId
  composedTraceId: PhysicsComposedCostTraceId
  worstPermittedCatchUpCostId: PhysicsWorstPermittedCatchUpCostId
  incomingMigrationCostEvidenceIds: [PhysicsQualityMigrationCostEvidenceId]
  outgoingMigrationCostEvidenceIds: [PhysicsQualityMigrationCostEvidenceId]
  status: accepted | rejected | insufficient-evidence

PhysicsQualityMigrationCostEvidence:
  migrationCostEvidenceId: PhysicsQualityMigrationCostEvidenceId
  transitionId: QualityTransitionId
  sourceAndDestinationQualityEpochs: typed-quality-pair
  requestAndAllocationAdmissionIds: typed-admission-pair
  harnessId: PhysicsCostHarnessId
  gateSetId: PhysicsComposedCostGateSetId
  phaseOpportunityRows:
    prepare: [PhysicsCostOpportunityRow]
    populate: [PhysicsCostOpportunityRow]
    commit: [PhysicsCostOpportunityRow]
    retire: [PhysicsCostOpportunityRow]
  overlapMemoryLedgerId: PhysicsMemoryLedgerId
  migrationTrafficRecordIds: [TrafficRecordId]
  allocationCompilationAndPipelineCreation: typed-cost-records
  sourceRetirementTail: labelled-duration-and-completion-join
  conservationConstraintAndVisualErrorResults: [gate-result]
  composedGateResultsDuringTransition: { gate-id: pass | fail | insufficient-evidence }
  status: accepted | rejected | insufficient-evidence

PhysicsSparseActiveDomainCost:
  sparseCostId: opaque-id
  ownerAndStateEquationIds: typed-owner-equation-set
  algorithmAndRevision: exact-active-set-compaction-solver-revision
  measurementIntervalAndOpportunityTableId: typed-trace-ref
  representedDomain:
    totalEligibleElements: Quantity<count>
    probeCandidates: labelled-distribution
    activeCoreElements: labelled-distribution
    haloGhostAndBoundaryElements: labelled-distribution
    allocatedCapacityAndHighWater: labelled-counts
    activeConnectedComponentsAndExtent: labelled-distributions
  activationPipeline:
    detectionClassification: labelled-work-traffic-and-time
    prefixScanSortOrCompaction: labelled-work-traffic-and-time
    allocationGrowthAndIndirectArguments: labelled-work-traffic-and-time
    haloBoundaryAndNeighborRebuild: labelled-work-traffic-and-time
    solverWorkOverActiveAndHaloSets: labelled-work-traffic-and-time
  lifecycle:
    activationAndDeactivationCounts: labelled-distributions
    expansionVelocityAndResidence: labelled-distributions
    deactivationHysteresis: typed-policy
    inactiveRegionModelAndErrorGate: typed-model-gate
    overflowDisposition: grow | backpressure | conservative-merge | fail-visible
  catchUpAndMigrationWitnessRefs: [witness-or-migration-cost-id]
  gateResults: { gate-id: pass | fail | insufficient-evidence }

PhysicsContactCost:
  contactCostId: opaque-id
  contactOwnerSolverAndRevision: typed-owner-solver-revision
  measurementIntervalAndOpportunityTableId: typed-trace-ref
  bodyShapeAndProxyPopulation: labelled-counts-by-class
  broadphase:
    algorithmAndRevision: exact-algorithm
    updatedBoundsAndMovedProxies: labelled-distributions
    candidatePairsAndPairBytes: labelled-distributions
    rebuildRefitSortAndTraversalWork: labelled-time-traffic-counts
  narrowphase:
    testedPairsByShapePair: labelled-distributions
    generatedContactsAndRejectedPairs: labelled-distributions
    manifoldCountPointCountAndFeatureRemaps: labelled-distributions
  solve:
    islandCountAndLargestIsland: labelled-distributions
    scalarConstraintRowsByLaw: labelled-distributions
    iterationsSubstepsAndResiduals: labelled-distributions
    warmStartHitsMissesInvalidationsAndCacheBytes: labelled-record
    deterministicSortReductionAndAtomicContention: labelled-record
  lifecycleEventsAndReactionApplications: labelled-counts-and-exact-once-refs
  stressFixtureRefs: [pileup-high-speed-topology-change-and-migration-trace]
  gateResults: { gate-id: pass | fail | insufficient-evidence }

PhysicsExternalAdapterCost:
  externalCostId: opaque-id
  adapterIdVersionProcessAndDevice: typed-external-identity
  measurementIntervalAndOpportunityTableId: typed-trace-ref
  requestResponseAndBatchCounts: labelled-distributions
  ingressEgressLogicalAndPhysicalBytes: labelled-records
  serializationDeserializationAndConversion: labelled-time-traffic-records
  transport:
    kind: shared-resource | same-process | IPC | device-copy | network | named
    enqueueQueueWaitTransportAndRemoteWait: dependency-aligned-distributions
    ownershipTransitionsFencesMapsAndCacheEffects: labelled-records
  remoteSolveAndCommit:
    remoteComputeDistribution: labelled-distribution | TypedAbsence
    externalCompletionAndHostVisibility: typed-dependency-records
    commitPublicationTail: labelled-distribution
  retriesTimeoutsDuplicatesDropsAndExactOnceResults: labelled-record
  inFlightStagingSharedAndRecoveryBytes: labelled-memory-record
  clockMappingSamplingAndStalenessCost: labelled-record
  catchUpMigrationProcessFailureAndDeviceLossWitnessRefs: [witness-id]
  gateResults: { gate-id: pass | fail | insufficient-evidence }

CadenceTraceTotals:
  traceTotalsId: CadenceTraceTotalsId
  traceRef: content-addressed-protocol-and-trace
  measurementInterval: PhysicsTimeInterval
  exactDuration: PhysicsDuration
  coordinationAdvanceCount: Quantity<count>
  catchUpBatchCount: Quantity<count>
  stageExecutionCounts: { PhysicsGraphStageId: Quantity<count> }
  nativeSubcycleCounts: { owner-id: Quantity<count> }
  couplingIterationCounts: { BoundedCouplingLoopId: Quantity<count> }
  interactionApplicationCounts: { payload-tag: Quantity<count> }
  presentedFrameCounts: { target-view-key: Quantity<count> }
  workOccurrenceCounts: { PhysicsWorkKey: Quantity<count> }
  trafficOccurrenceAndLogicalByteTotals: { TrafficRecordId: typed-count-byte-pair }
  droppedCoordinationIntervals: [PhysicsTimeInterval]
  exactTotalsDigest: collision-resistant-digest

`CadenceTraceTotals.traceRef` identifies raw evidence but is not itself count
closure. The ordered opportunity table makes co-occurrence reviewable. For
every stage, loop, owner, payload tag, work key, traffic record, and target/view,
the corresponding row counts sum exactly to the matching cadence total:

```text
sum_o n_stage(o,s)       = CadenceTraceTotals.stageExecutionCounts[s]       [D]
sum_o n_subcycle(o,a)    = CadenceTraceTotals.nativeSubcycleCounts[a]       [D]
sum_o n_loop(o,l)        = CadenceTraceTotals.couplingIterationCounts[l]    [D]
sum_o n_work(o,k)        = CadenceTraceTotals.workOccurrenceCounts[k]       [D]
sum_o n_traffic(o,r)     = trace traffic occurrence count[r]                [D]
sum_o bytes_traffic(o,r) = trace logical byte total[r]                      [D]
```

The same closure applies to interactions and target/view frame counts. Every
row lists exact execution identities, not percentile-derived counts. Its
critical paths resolve through the graph dependency DAG and concrete completion
records. CPU, GPU, external, and presentation spans remain separate because
they may overlap. A sum of stage `p95` values, a product of cadence percentiles,
or a `traceRef` without loadable digest-checked rows fails composed evidence.

For one presentation opportunity `o`, let `x_o` be the integer vector of
coordination advances, stage executions, native subcycles, loop iterations,
interaction applications, queue operations, and work occurrences. The exact
graph activation/partition rules and `PhysicsCatchUpPolicy` define the feasible
set `A`:

```text
x_o in A                                                                  [G]
n_advance(o) <= maximumCoordinationAdvancesPerPresentationOpportunity     [G]
n_native(o)  <= maximumNativeExecutionsPerOpportunity                     [G]
```

For cost/error dimension `j`, the permitted envelope is

```text
B_j = max over x in A of R_j(x)                                           [D]
accept = AND_j( measuredComposedResult_j <= frozenGate_j )                 [G,M]
```

`R_j` is evaluated from the actual dependency/resource schedule, not a linear
sum of subsystem percentiles. The maximum-CPU, maximum-GPU, maximum-traffic,
maximum-live-memory, maximum-migration-overlap, maximum-numerical-error, and
maximum-visual-error schedules may differ. Consequently
`PhysicsWorstPermittedCatchUpCost` carries a componentwise
dominating frontier, not one arbitrarily named worst frame. Its coverage proof
must show that every feasible schedule is dominated in every claimed objective
dimension by a measured witness or a conservative bound. An uncovered
dimension is `insufficient-evidence`; a derived bound alone cannot become a
measured target-performance verdict.

Each frontier witness is an executable feasible schedule with exact row
closure. Repeat it under the same sustained harness to measure the composed
CPU/GPU/external/presentation distributions and resource peaks. If the frontier
cannot pass, reduce the graph-wide policy, block presentation while debt is
retained, or drop only through the declared loss ledger and discontinuity. A
domain may not privately clip its executions to make the measured burst pass.

Steady-state quality evidence does not cover a transition. Every admitted
`QualityTransition` has one `PhysicsQualityMigrationCostEvidence` spanning
prepare, population, atomic commit, and retirement. It includes simultaneous
source/destination resources, frames in flight, copy/upload traffic,
allocation/compilation or pipeline creation, reset/handoff cost, conservation
and visual error, composed deadline behavior, and the completion-join tail
until the source generation can retire. Every eligible quality state binds its
own harness, frozen gate set, steady composed trace, catch-up frontier, and all
incoming/outgoing transition evidence. Reusing a result after a graph,
resource-layout, quality-epoch, target, browser, or harness digest change is
invalid.

Sparse work is not `activeElements * solverKernel` alone. The trace must expose
the complete activation pipeline:

```text
T_sparse = criticalPath(detect/classify, scan-or-sort, compact,
                        allocate-or-grow, build-neighbors-and-halo,
                        solve, publish-indirect-arguments)                 [M]
B_sparse >= compulsory bytes of every listed phase                        [D]
```

Record eligible/probed, active-core, halo/ghost/boundary, allocated, and
high-water counts separately. A dense probe followed by a sparse solve remains
dense in its probe phase. A sparse indirect dispatch still pays active-list,
prefix-scan/sort, neighbor, counter-clear, and argument-buffer traffic. Freeze
stress forcing that maximizes component fragmentation, active-front expansion,
capacity growth, and halo-to-core ratio. Deactivation requires hysteresis plus
a valid inactive-region model/error gate; silently dropping dry, sleeping, or
out-of-view elements is not sparsity evidence. Active-list/capacity overflow is
visible and participates in the catch-up frontier.

Contact cost is state-distribution dependent. Do not infer it from body count
or quote an asymptotic broadphase label. For each opportunity report moved
proxies, candidate pairs, tested shape pairs, accepted contacts, manifolds,
manifold points, scalar constraint rows, islands, largest island, solver
iterations, warm-start outcomes, feature remaps, cache bytes, and exact-once
contact/reaction events. Broadphase rebuild/refit/sort/traversal, narrowphase,
manifold maintenance, island construction, constraint assembly/solve, and
deterministic reduction are distinct work/traffic phases. Freeze pileup,
high-speed crossing, sleeping/waking, topology/proxy change, cache-cold, and
quality-migration fixtures before inspection. Average empty-space frames cannot
authorize a contact-performance claim.

For an external adapter, derive the end-to-end tail from its concrete dependency
path:

```text
L_external = criticalPath(enqueue, serialization/conversion, queue wait,
                          transport/ownership transfer, remote wait/solve,
                          fence/completion, deserialization, atomic commit) [M]
```

Only serialized edges add; overlapped segments remain separate. “Zero copy”
removes neither ownership transitions, cache effects, fences, queueing, nor
in-flight residency. Record request/response/batch counts, logical and physical
bytes, IPC/device/network transport, staging/shared allocations, process/device
identity, remote-compute visibility, clock-map/staleness work, timeouts,
retries, duplicate suppression, drops, recovery, and exact-once outcomes. If
remote timing is unavailable, expose the measured adapter tail and mark remote
attribution unavailable; do not assign the residual to the local solver. Test
worst permitted catch-up, quality migration, process failure, and device loss
with the same commit and loss semantics as native owners.

PhysicsMemoryLedger:
  memoryLedgerId: PhysicsMemoryLedgerId
  contextId: PhysicsContextId
  measurementInterval: PhysicsTimeInterval
  qualityEpoch: PhysicsQualityEpoch
  category: hot-state | peak-transient | migration-overlap | frame-cohort
  allocations: [PhysicsMemoryAllocationRecord]
  logicalBytesByResidency: labelled-byte-map
  physicalAllocatedBytesByResidency: labelled-byte-map-or-unavailable
  maximumSimultaneouslyLiveBytes: labelled-byte-map
  sharedBytesByWorkKey: { PhysicsWorkKey: Quantity<byte> }
  perViewBytesByTargetView: { target-view-key: Quantity<byte> }
  lifetimeDagDigest: collision-resistant-digest
  allocationTraceRef: content-addressed-trace
  status: measured | derived-with-measured-allocation | unavailable

PhysicsMemoryAllocationRecord:
  allocationId: PhysicsMemoryAllocationId
  resourceId: resource-id
  owner: owner-id
  semantic: solver-state | interaction-queue | descriptor-table | checkpoint | presentation | render | validation | named
  residency: PhysicsResidencyDescriptor
  deviceBackendResourceGenerations: typed-generation-tuple | TypedAbsence
  encodingFormatAndExtent: typed-layout-extent-record
  elementCountStrideAndLogicalBytes: typed-count-stride-byte-record
  physicalAllocatedBytes: Quantity<byte> | TypedAbsence
  liveInterval: typed-allocation-sequence-interval
  framesInFlightMultiplier: Quantity<count>
  sharingScope: route-shared | context-shared | target-shared | per-view
  targetViewKeys: [target-view-key]
  workKey: PhysicsWorkKey
  aliasGroupAndNonoverlapProof: typed-alias-proof | TypedAbsence
  leaseIdsAndCompletionJoins: [lease-id-and-join-ref]
  evidenceRef: content-addressed-measurement-or-derivation

TrafficRecord:
  trafficRecordId: TrafficRecordId
  contextId: PhysicsContextId
  producer: owner-stage-pass-or-external-id
  consumers: [owner-stage-pass-or-external-id]
  direction: cpu-to-gpu | gpu-to-cpu | gpu-to-gpu | external-ingress | external-egress | same-residency
  resourceIdAndVersion: typed-resource-version-ref
  sourceAndDestinationResidency: typed-residency-pair
  deviceBackendResourceGenerations: typed-generation-tuple | TypedAbsence
  logicalBytesPerOccurrence: Quantity<byte>
  physicalBytesPerOccurrence: Quantity<byte> | TypedAbsence
  occurrenceCount: Quantity<count>
  cadenceBasis: per-stage-execution | per-coordination-advance | per-presented-frame | per-second | event-driven
  dirtyFraction: Quantity<dimensionless>
  measurementInterval: PhysicsTimeInterval
  accessAndResourceTransition: typed-before-after-access-record
  passDispatchOrExternalBoundary: typed-boundary-ref
  dependencyRefs: [PhysicsDependencyRef]
  readbackMapBehavior: none | asynchronous-diagnostic | host-critical-failure
  workKey: PhysicsWorkKey
  sharingScope: shared | per-view
  targetViewKeys: [target-view-key]
  measuredCountersRef: content-addressed-counters | TypedAbsence

PhysicsCostAttribution:
  workKey: PhysicsWorkKey
  owner: owner-id
  scope: shared | per-view
  targetViewKeys: [target-view-key]
  coordinationAdvanceIds: [PhysicsCoordinationAdvanceId]
  stageExecutionPassOrDispatchIds: [typed-execution-id]
  occurrenceCount: Quantity<count>
  cpuTime: labelled-duration-distribution | TypedAbsence
  gpuTime: labelled-duration-distribution | TypedAbsence
  externalLatency: labelled-duration-distribution | TypedAbsence
  trafficRecordIds: [TrafficRecordId]
  memoryAllocationIds: [PhysicsMemoryAllocationId]
  attributionRule: count-shared-once | count-once-per-listed-view
  attributionDigest: collision-resistant-digest
```

`PhysicsMemoryLedger` includes every live solver ping-pong/version slot,
multilevel grid, contact/warm-start cache, interaction/event queue, descriptor
table, stable-ID map, CPU mirror, previous/current presentation state,
frames-in-flight resources, validation/readback allocation, and simultaneous
old/new transition state. Derive logical bytes from extents/formats/lifetimes
`[D]`; treat physical allocation/residency as `[M]` when observable.

Every live allocation appears exactly once in a memory-ledger lifetime DAG,
and every transfer/copy/map appears in one `TrafficRecord`; logical and physical
bytes are never conflated. A shared `PhysicsWorkKey` appears once in
`sharedWorkKeys` and names all consumers. A per-view key appears only under the
target/view that actually executes it. Aggregate cost is the sum over unique
keys: shared work is not multiplied by view count, and per-view work is not
misreported as free sharing.

Every `TrafficRecord` declares producer, consumers, direction, logical bytes,
frequency, dirty fraction, resource transition, pass/dispatch boundary,
readback/map behavior, and measured counters when exposed. On bandwidth-limited
or tile-based targets, minimize stored intermediates, pass breaks, redundant
state mirrors, and full-domain updates; prove the chosen fusion/packing with
target evidence rather than assuming compute is cheaper.

Per-presented-frame numbers never replace per-coordination-interval and
per-second evidence: rendering may throttle, pause, or run at a cadence unrelated
to simulation. Bind every distribution to the exact opportunity rows, measure
the `PhysicsWorstPermittedCatchUpCost` frontier rather than only the steady
zero-debt case, and report dependency critical paths instead of adding
overlapping CPU/GPU stage percentiles. On tile GPUs, count attachment
store/load/resolve traffic, compute/render pass breaks, and spills; on all
targets, gate binding/storage-buffer/texture limits and frames-in-flight or
multiview resource multiplication.

All cadence distributions are observations over the same serialized
`measurementInterval`, clock mapping, quality epoch, target/view set, and
protocol trace. A percentile of `A`, a percentile of `B`, and a percentile of
their ratio are three separate statistics; multiplying percentile summaries is
not an exact cadence identity. `CadenceTraceTotals` is the exact count/duration/
byte authority for the cited trace. Every reported distribution derives from
paired samples whose integer totals and interval equal that record; no
percentile multiplication may reconstruct cadence. The opportunity-table row
sums must reproduce those totals and its row/digest closure must reproduce the
`PhysicsComposedCostTrace`; otherwise co-occurrence and critical-path claims are
unproven.

Keep frequently sampled state in its consuming residency. Batch queries and
interactions, compact active regions, update dirty ranges, and use analytic or
precomputed inactive regions where the error gate permits. Do not evict hot
state only to upload/reconstruct it at a higher cadence. Adaptive quality uses
the router's single hysteretic controller; physics domains do not independently
oscillate tiers. A controller may enter a state only when its
`PhysicsQualityCostEvidenceRef` is accepted for the active harness and both the
steady and worst-permitted catch-up gates pass. A transition is separately
admissible only when its migration-cost evidence passes. Every quality-cost
reference resolves through `qualityCostEvidenceResourcesByDigest`; that mapping
has exactly the referenced digest key set, each value validates as a
`PhysicsQualityCostEvidenceResource`, and the key equals the digest of the full
resource including its canonical opportunity rows. Test-process globals or an
out-of-band resolver cannot satisfy this closure.

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
| registry authority | Frame/chart/clock/identity lookups resolve one atomic registry revision; parent and clock-mapping DAGs are acyclic; retired generations never alias live identities |
| clocks and graph | Canonical rationals and versioned fixed, timestamp-table, piecewise, external, adaptive, analytic, event, GPU, and presentation mappings cover identical coordination intervals without double step, hidden lag, or domain-specific drop |
| coordination and catch-up | Digest-linked `PhysicsCoordinationAdvanceRecord` intervals tile exactly; activation and partition multiplicities respect both maxima; one state equation has at most one advance claim per interval; `state-hold` and analytic evaluations do not advance; `PhysicsCatchUpBatch` debt arithmetic, drops, loss, and discontinuity close exactly |
| dependency completion | Recurrent producer/consumer executions emit distinct `PhysicsDependencyCompletion` receipts; deliberately wrong payload/version/subresource/access/generation/release/acquire/fence proofs reject before first consumer access |
| graph publication | Provisional versions cannot escape; every edge matches a read/write/version/residency dependency; an all-or-none commit group publishes only accepted owner versions |
| commit transaction | Prepare all owner-approved publications, fail one gate, and prove the prior registry remains wholly visible; then pass all gates and prove one `PhysicsCommitReceipt` atomically exposes the exact closed publication set |
| bounded feedback | Coupling loop converges under its residual gate and atomically rejects a divergent provisional iterate; graph remains acyclic outside the loop macro |
| loop lineage | Every iteration input digest equals its seeds or exact prior-iteration output; only the accepted row equals `CouplingAcceptedWriteLineage`; rejected interaction/application/cache/lease/event versions cannot cross an outer edge |
| provider envelope | Required-channel masks, per-channel unit/filter/time/error, actual band/support, age/staleness, state/resource versions, and explicit absence survive CPU/GPU/external adapters |
| absent channel mutation | Replace a required channel with absent, stale, wrong-unit, wrong-frame, wrong-epoch, or implicit-zero data; the consumer blocks or selects a declared approximation |
| water semantics | `geometricNormalVelocityMps` satisfies the analytic interface projection identity; full parameterization velocity may be typed absence; surface-point and material-current velocity differ in a known wave/current case; each consumer selects the equation-correct channel and filter |
| rigid-body boundary | `RigidBodyState` pose/twist/reference point/frame/epoch/version matches analytic motion and remains immutable through native, GPU, and external adapters |
| support/contact | Moving and deforming support point velocity and separation sign match analytic motion; support queries do not create duplicate impulses; the named contact owner/solver revision preserves point IDs and lifecycle or explicitly resets |
| material/proxy identity | Deterministic pair-law resolution latches both material versions; collider shape/pose bindings and support/feature IDs survive batching, compaction, rebase, and visual LOD within proxy-error gates; render PBR state cannot alter them |
| deforming/fluid proxy | Analytic moving/deforming support and fluid boundaries match position, material velocity, normals/Jacobians, swept bounds, feature remap, collision filter, wet/dry activation, and declared boundary-condition reactions over their validity intervals |
| precipitation | Airborne inventory, emitted/deposited/advected/phase-changed mass, destination footprint, and residual close across graph intervals; same-tick mutation is impossible |
| wind coupling | Air-density-dependent force, filtered reference-height wind, stability/fetch/duration, and ocean source-term calibration are explicit; raw wind-to-spectrum mutation fails |
| lighting transport | Position/direction-or-normal/footprint/solid-angle/time queries preserve per-channel radiometric units/bases; duplicated attenuation-factor ID and ambiguous solar-disc inclusion fail |
| dimensional interactions | Every payload tag passes unit/measure/rate-integral/footprint checks; point versus wrench impulse is unambiguous; integrated transfers apply exactly once across different receiver subcycle counts |
| impact partition and application | Partition measures and commodity inventories close to each `PhysicalImpactParentRecord`; visual children have no authority; overlap-integrated rates and once-only integrals produce exact `InteractionApplicationLedger` rows; replay from restored cursors commits only previously unapplied keys |
| reaction grouping | One-to-many and many-to-one reaction groups transform into one balance frame/reference point, accept atomically, and close impulse/torque/commodity residuals |
| delivery/overflow | Duplicate, late, reordered, skipped-frame, overflow, retry, and cancellation cases preserve per-consumer cursors and report lost conserved quantities |
| discrete exchange | Gather/scatter moment, force, torque, work, and energy residuals meet gates under translation/rotation and resolution change |
| conservation | Closed/open-system mass, linear/angular momentum, energy, species, modeled dissipation, boundary flux, and numerical residual ledgers reconcile |
| fluid/body coupling | One-way invariance; explicit two-way added-mass stability; iterated coupling convergence; hydrostatic equilibrium; displaced volume, force, torque, work, and wave/current filtering |
| GPU publication | Same-queue dependency succeeds; deliberately missing pass boundary fails; submission is not reported as completion; host visibility occurs only after the declared map/fence |
| authoritative GPU recovery | Device loss freezes commits, invalidates the lost generation, restores one coherent checkpoint, replays exact-once ranges, revalidates conservation/error, and atomically publishes—or records an explicit discontinuous restart |
| no-readback critical path | Runtime trace contains no frame-critical GPU-to-CPU map/readback; diagnostic readback is delayed and excluded from steady-state claims |
| presentation pair | Independent previous/current per-binding brackets reconstruct their requested instants with clock-map error; motion uses their immutable state handles and the per-view source-frame-qualified render transforms |
| presentation admission | Candidate versions resolve to committed receipts and one `PresentationTimeCohort`; cohort candidate/snapshot/plan keys close exactly; rejected cohort or occupied `FrameSlotAdmission` submits nothing; accepted slots retain every `RenderResourceLease` through the exact completion join |
| motion identity | Spawn, death, teleport, reparent, LOD change, compaction, and slot reuse preserve stable IDs and invalidate motion with the exact reason |
| shadow/reactive lifecycle | The candidate -> camera view -> explicit shadow/visibility/cache publication -> seal DAG is acyclic; reactive publications and scoped reset plans have no same-phase mutation/cycle |
| render-plan closure | Every `PresentationRenderPlan` phase/edge DAG declares exact input/output/history generations, owners, encodings, extents, dependencies, fences, planned reset generations, leases, and shadow factors; each actual `ScopedResetActionResult` matches the plan; missing or extra closure members reject; each `ShadowFactorId` applies once to direct light under its exact provenance |
| candidate abort/device loss | Multi-target pre-seal failure and device loss append keyed target/lease dispositions, cancel dependent actions, retire or invalidate every lease, and never fabricate a snapshot/completion token |
| event presentation | Repeated rendering does not respawn an event; skipped rendering consumes the complete monotonic sequence range exactly once |
| quality transition | Prepare/commit/retire order, conservative map, positivity/constraints, ID/RNG/cursor preservation, queue/manifold policy, peak overlap, rollback, per-equation authoritative emitters, and multi-consumer completion join all pass |
| quality admission | Rejected request admission performs no allocation; rejected allocation admission performs no population/commit; admitted capacity covers hot, transient, old/new migration overlap, frames in flight, binding limits, traffic, and thermal gates |
| external adapter | Native-versus-adapted frame/time/unit/channel/state results meet errors; stepping/constraints/collision/contact/accumulation/commit ownership is complete; process/device failure cannot half-commit an exchange |
| external directional capability | Every ingress/egress payload matches exactly one `ExternalInteractionCapability` frame/unit/footprint/cadence/batch/residency/dependency/error record; ingress exact-once and reaction atomicity survive retry and process failure |
| memory/traffic attribution | Allocation lifetime totals match `PhysicsMemoryLedger`; every copy/map/transition matches one `TrafficRecord`; unique work keys count shared work once and per-view work only for actual views; logical/physical bytes remain distinct |
| cadence trace totals | Exact duration/count/byte totals in `CadenceTraceTotals` reconcile all per-advance, per-second, per-frame, catch-up, work, and traffic distributions without percentile multiplication |
| composed opportunity closure | Every digest-checked `PhysicsCostOpportunityRow` resolves concrete advances/executions/dependencies and its stage/subcycle/loop/interaction/work/traffic/frame counts sum exactly to `CadenceTraceTotals`; composed CPU/GPU/external/presentation distributions derive from aligned rows rather than subsystem percentile sums |
| worst permitted catch-up | The exact graph/policy feasible set has a componentwise dominating CPU/GPU/external/presentation/traffic/memory/migration/error frontier; each claimed dimension has an executable sustained witness or conservative bound, and every measured composed result passes its frozen gate |
| quality cost coverage | Every eligible quality state binds a matching harness/gate/steady trace/catch-up frontier; every incoming/outgoing transition separately covers prepare/populate/commit/retire costs, simultaneous old/new resources, traffic, allocation/compilation, error, deadlines, and the retirement tail |
| sparse active-domain cost | Eligible/probed/active/halo/allocated/high-water counts, activation/scan/compaction/allocation/neighbor/solver phases, overflow, hysteresis, inactive-model error, and fragmented expansion stress reconcile to opportunity work/traffic and the catch-up frontier |
| contact cost | Broadphase moved proxies/candidate pairs, narrowphase tests/contacts, manifold points, islands, constraint rows, iterations, warm-start/cache behavior, deterministic reduction, reactions, and frozen pileup/high-speed/topology/migration stresses pass their composed gates |
| external adapter cost | Batch/message/byte counts and dependency-aligned enqueue/serialization/queue/transport/remote/fence/deserialization/commit tails, in-flight memory, retries/exact-once, clock mapping, catch-up, migration, process failure, and device loss pass or narrow attribution explicitly |
| mobile sustained run | Per-interval/per-second/presented-frame costs, worst-permitted catch-up frontier, dependency tails, tile traffic/spills, device limits, allocations, multiview/in-flight multiplication, memory, thermal/clock drift, quality trace, errors, and teardown stay within named physical-target gates |

### Hard failure gates

Reject the affected route or narrow its claim when any of the following occurs:

- two owners advance the same state equation, or a required producer/consumer/
  reaction owner is missing;
- two owners integrate wetness/snow/receiver state for the same region/equation,
  or appearance state is treated as conserved receiver inventory;
- a quantity lacks SI unit/frame/time/support, uses the reciprocal scale
  convention, or crosses an unversioned transform/chart;
- a frame/chart/clock/identity lookup mixes registry revisions, resolves two
  authority paths, aliases a retired generation, or uses a cyclic parent/map DAG;
- a required channel is absent, zero-filled, stale beyond its gate, synthesized
  without error, or filtered incompatibly with its consumer;
- an instant rational is noncanonical, a clock mapping/revision cannot derive its
  seconds, execution/coordination intervals have gaps/overlaps, activation or
  partition maxima are exceeded, a state equation double-steps, a state-hold or
  analytic evaluation advances state, or catch-up debt/drop/loss differs by
  domain or lacks one graph-wide batch;
- a dependency template is treated as a reusable completion, or a concrete
  completion omits/mismatches execution, payload, version, subresource, access,
  generation, release/acquire, fence, or host-visibility proof;
- provisional/prepared state escapes, a commit skips prepare, a commit receipt
  is partial, an iterative cycle is unbounded, an iteration reads the wrong
  lineage/bracket, or any rejected/nonaccepted loop output crosses an outer edge;
- a rate is applied as an integral, an integral is applied per substep,
  intensive-flux quadrature does not sum to represented physical area, an
  extensive-distributed inverse-area kernel does not integrate to one, or a
  payload uses the wrong state term;
- a payload/footprint pair is invalid, point impulse contains an undeclared free
  couple, source/reaction-group acceptance is non-atomic, an exact-once key
  repeats, overflow hides lost commodities, or nondeterministic reduction is
  claimed deterministic;
- impact partitions overlap or fail measure/commodity closure, a visual child
  applies parent authority, a rate is integrated outside interval overlap, or
  replay applies a key with an existing committed application receipt;
- conservation residual, coupling stability, positivity, constraint, chart,
  transform, or approximation error exceeds its `[G]` bound;
- contact ownership/solver revision, collider pose, separation sign, material
  pair law, or rigid-body twist reference is ambiguous; a physical property is
  inferred from visual PBR state; or an unavailable property silently becomes
  zero;
- a deforming/fluid proxy lacks material-point velocity, differential/swept-
  bound validity, filter, boundary condition, feature remap, or latched material
  selection; or an external interaction lacks exactly one directional
  capability and dependency/error/exact-once/reaction-atomicity policy;
- GPU submission is called completion, authoritative GPU state lacks a bounded
  recovery/restart transaction, a resource is reused before its keyed
  multi-consumer lease join retires, a workgroup barrier is used as a global
  fence, or frame-critical readback appears;
- rendering reads mutable simulation state, shares one interpolation alpha
  across bindings/views, derives motion from adjacent solver states, omits
  previous/current provenance, creates a candidate-camera-cache cycle, or
  mutates a candidate/publication/snapshot in a later phase;
- a candidate lacks commit provenance/time-cohort admission, a target submits
  without an admitted render plan and frame slot, preparation/reset/lease
  closure is incomplete, a reset lacks a matching `ScopedResetActionResult`, a render
  resource is reused before its join, or one shadow factor is applied zero or
  multiple times;
- previous/current cohort or jitter provenance disagree, in-flight occupancy
  exceeds the admitted target maximum, a live frame slot is overwritten, or an
  acquisition/present reservation resolves to another target, sequence, slot,
  or generation;
- a quality switch changes equations without explicit handoff/error, loses
  inventories/IDs/events silently, has two emitters for one state-equation/source
  channel during crossfade, retires before all consumer classes complete, or
  exceeds peak memory;
- quality work starts before request/allocation admission, an allocation is
  absent from the memory lifetime ledger, a transfer is absent from traffic,
  shared/per-view work is double-counted, logical/physical bytes are conflated,
  cadence distributions do not reconcile to exact opportunity rows and trace
  totals, a catch-up objective lacks frontier coverage, a cost result is reused
  across a harness/graph/resource/quality digest change, or a transition relies
  on steady-state cost evidence instead of migration evidence;
- a sparse claim omits activation/scan/compaction/halo work, hides capacity
  overflow or inactive-region error, or measures only settled low occupancy; a
  contact claim omits pair/manifold/constraint/cache tails or avoids its frozen
  pileup/topology stresses; or an external adapter hides serialization,
  transport, queue/fence, retry, in-flight-memory, or unavailable remote timing;
- target acceptance uses isolated demo timings, desktop extrapolation, a cold
  burst, unlabelled budgets, or a final image without native-domain diagnostics.

The common contract ends at these boundaries. Keep collision algorithms,
constitutive models, fluid/solid/atmosphere solvers, procedural motion,
radiative transport, and render techniques in their expert owners. Standardize
only what must cross an owner boundary, and measure the composed result.
