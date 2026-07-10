# Router Preflight Template

Delete unused optional records. Never leave an allocated signal without a
consumer. Every reported quantity uses `{ value, unit, label, source }` with
exactly one of `Authored`, `Derived`, `Measured`, or `Gated`.

## input brief

Paste the user brief. Preserve authoritative data/assets, user question, target
views, devices, interaction, accuracy/error requirements, references, and
performance claims.

## preflight

```yaml
backendManifest:
  requiredReleaseBand: { value: "<fill>", unit: revision, label: Gated, source: repository-contract }
  installedPackageVersion: { value: "<fill>", unit: semver, label: Measured, source: installed-package }
  runtimeRevision: { value: "<fill>", unit: revision, label: Measured, source: runtime-import }
  requiredBackend: { value: WebGPU, unit: backend, label: Gated, source: flagship-route-contract }
  actualBackend: { value: "<fill>", unit: backend, label: Measured, source: initialized-renderer }
  deviceBrowserGpu: { value: "<fill>", unit: identity, label: Measured, source: target-run }
  cssViewport: { value: "<fill>", unit: css-pixels, label: Measured, source: target-run }
  rendererDpr: { value: "<fill>", unit: ratio, label: Measured, source: initialized-renderer }
  physicalRenderExtent: { value: "<fill>", unit: physical-pixels, label: Derived, source: cssViewport-and-rendererDpr }
  compatibilityMode: { value: "<fill>", unit: boolean, label: Measured, source: initialized-backend }
  requestedSamples: { value: "<fill>", unit: samples-per-pixel, label: Authored, source: render-contract }
  actualRendererSamples: { value: "<fill>", unit: samples-per-pixel, label: Measured, source: initialized-renderer }
  maxColorAttachments: { value: "<fill>", unit: attachments, label: Measured, source: initialized-device-limits }
  maxColorAttachmentBytesPerSample: { value: "<fill>", unit: bytes-per-sample, label: Measured, source: initialized-device-limits }
  outputBufferType: "<fill>"
  featureGates: []
  capabilityBlocker: ""
  apiProof:
    WebGPURenderer: "<installed-source/export proof>"
    RenderPipeline: "<installed-source/export proof>"
    TSL: "<installed-source/export proof>"

workloadProfile:
  domain: scientific-visualization | product-configurator | architecture-aec | cinematic-art | digital-twin | data-scene | other
  intent: explain | inspect | configure | coordinate | present | monitor
  truthContract: metric | identity | physically-plausible | perceptual-style
  representation: imported-hierarchy | procedural-mesh | points-glyphs | lines-graph | surface-field | volume-field | hybrid
  interaction: fixed-view | orbit | free-navigation | direct-manipulation | multi-view
  temporal: static | deterministic-animation | simulation | sparse-events | streamed-deltas | live-irregular-updates
  scale: object | room | building | city-terrain | planetary | multiscale
  topology: imported-unique | procedural-unique | repeated | streamed-changing
  viewPattern: bounded | unconstrained | sectioned | overview-to-detail
  residency: host-authoritative | gpu-resident | hybrid
  uploadAndReadbackNeeds: []
  deployment: []
  authoredResolutionAndDpr: []
  errorBounds: []
  updateLatencyBound: { value: "<fill>", unit: ms, label: Gated, source: product-contract }

causeLedger:
  sourceOfTruth: "<authoritative data, asset, model, or authored mechanism>"
  userQuestion: "<what must the image let the user know or do>"
  primaryObservable: "<observable acceptance target>"
  truthOrStyleInvariant: "<property adaptation may not violate>"
  unitsAndCoordinateFrame: "<units, handedness, origin, georeference>"
  missingDataAndUncertainty: "<missing/out-of-range/uncertainty policy>"
  physicalOrDataCause: "<mechanism that creates the observable>"
  earliestMissingLayer: topology | geometry | field | material | illumination | transport-volume | motion | camera-projection | image-transform
  missingSignal: "<signal not yet authored>"
  candidateAlgorithms: []
  selectedAlgorithm: "<selected algorithm>"
  rejectedAlgorithms: []
  rejectionEvidence: []
  noPostBaseline: "<what remains readable without image effects>"
  postProcessingRejectedBecause: "<why post cannot replace the missing cause>"
  primaryVisualContract: "<single acceptance sentence>"
  errorMetric: "<metric domain and mask>"
  truthDebugView: "<diagnostic proving the cause>"
```

## routeManifest

```yaml
selectedSkills: []
omittedSkills: []
primaryOwner: "<earliest non-post causal owner or explicit outside-pack owner>"
deferredSkills: []

owners:
  sourceOfTruth: "<fill>"
  representation: "<fill>"
  spatialFrame: "<fill>"
  timebase: "<fill>"
  semanticIds: "<fill or not used>"
  selectionPicking: "<fill or not used>"
  clipSection: "<fill or not used>"
  presentation: "<fill>"
  validation: $threejs-visual-validation

requiredSignals:
  sceneColorRegistry:
    primary-view:
      producer: "<shared scene producer>"
      consumers: [primary-presentation]
      encoding: "<fill>"
      resolution: { value: "<fill>", unit: physical-pixels, label: Derived, source: canvas-dpr-pass-scale }
  depthRegistry: not used
  normalRegistry: not used
  velocityRegistry: not used
  objectIdRegistry: not used
  historyRegistry: not used

domainSignals: {}

# A nonphysical route keeps these exact empty values. Replace the active records
# with the versioned shared ABI for a coupled route; keep the deprecated singular
# snapshot explicitly unused.
physicsContext: not used
physicsGraph: not used
physicsCoordinationAdvanceRecords: []
physicsCostLedger: not used
physicsSignals: {}
physicsErrorPropagationLedgers: {}
physicsInteractions: []
physicsInteractionApplicationLedgers: {}
physicsCommitTransactions: {}
physicsQualityTransitions: []
physicsPresentationTimeCohortsById: {}
physicsPresentationCandidate: not used
physicsCameraViewPublicationsByTarget: {}
physicsViewPreparationPublicationsByTarget: {}
physicsPresentationSnapshotsByTarget: {}
physicsPresentationRenderPlansByTarget: {}
frameExecutionRecord: not used
physicsPresentationSnapshot: not used # deprecated compatibility projection; never allocate

outputOwnersByPresentationTarget:
  primary-presentation:
    toneMap: "<fill>"
    outputTransform: "<fill>"
    adaptiveQuality: "<fill>"

# Compatibility projection only. It never authorizes allocation.
sharedResourceOwners:
  gbuffer: not used
  depth: not used
  normal: not used
  velocity: not used
  history: not used
  weatherEnvelope: not used
  toneMap: "<same owner as outputOwnersByPresentationTarget>"
  outputTransform: "<same owner as outputOwnersByPresentationTarget>"
  adaptiveResolution: "<same owner as outputOwnersByPresentationTarget>"

spaceAndOwnerHandoff:
  source-space: "<coordinates and units>"
  world-space: "<Y-up units, georeference, floating origin>"
  view-space: "<camera convention and encoding>"
  clip-space: "<projection, jitter, and depth owner>"
  NDC: "<range and screen origin>"
  UV: "<origin and wrap policy>"
  texel: "<texel center, DPR, pass scale>"
  time: "<clock, timestamp, interpolation, reset>"
  identity: "<stable ID and remap owner>"
  depth-convention: "<standard, reversed, logarithmic, orthographic, resolve>"
  color-data-domain: "<source encoding through display conversion>"
  owner-boundary: "<producer, consumers, lifetime, invalidation>"
```

## active physical route scaffold

Keep the nonphysical defaults above unchanged. For an active physical route,
replace every placeholder below with a schema-valid, closed ABI record and make
the normal `npm run test:skills` gate pass. Every reference must resolve to the
exact version, digest, generation, receipt, lease, or completion it names.
Inactive union arms use the complete `TypedAbsence` record shown here; never
serialize a bare `absent`, `typed-absence`, `not used`, `null`, empty handle, or
implicit zero.

```yaml
activePhysicalRouteScaffold:
  abiSchemaId: threejs-physics-domain-and-interaction-abi/v1
  typedAbsenceExample:
    kind: absent
    reason: not-requested
    authority: "<authoritative owner-id>"
    schemaId: typed-absence-v1
    effectiveTime: timeless
    provenance: "<source-and-revision>"

  contextAndProviders:
    physicsContext: "<PhysicsContext>"
    requiredContextMembers:
      quantitySystem: "<PhysicsQuantitySystem>"
      worldToPhysicsTransform: "<WorldPhysicsTransform>"
      physicsFrameRegistry: "<PhysicsFrameRegistry with closed frame DAG>"
      chartRegistry: "<PhysicsChartRegistry with resolved anchors>"
      physicsClockRegistry: "<PhysicsClockRegistry with closed mapping DAG>"
      gravityProvider: "<PhysicsSignalDescriptorRef resolving in physicsSignals>"
      idNamespaces: "<PhysicsIdentityRegistry>"
      physicsMaterialRegistry: "<PhysicsMaterialRegistry with deterministic pair-law resolution>"
    physicsSignals: { "<signal-key>": "<PhysicsSignalDescriptor>" }
    physicsErrorPropagationLedgers: { "<ledger-id>": "<ErrorPropagationLedger>" }

  schedulingAndCommit:
    physicsGraph: "<PhysicsGraph>"
    graphInventories:
      stages: ["<PhysicsGraphStage>"]
      edges: ["<PhysicsGraphEdge>"]
      dependencies: ["<PhysicsDependency>"]
      dependencyCompletions: ["<PhysicsDependencyCompletion in PhysicsExecutionLedger>"]
      catchUpPolicy: "<PhysicsCatchUpPolicy>"
      catchUpBatch: "<PhysicsCatchUpBatch or complete TypedAbsence>"
      coordinationAdvances: ["<PhysicsCoordinationAdvanceRecord; same records as physicsCoordinationAdvanceRecords>"]
      stageExecutions: ["<PhysicsStageExecution in PhysicsExecutionLedger>"]
      stateAdvanceClaims: ["<StateAdvanceClaim in PhysicsExecutionLedger>"]
      executionLedger: "<PhysicsExecutionLedger>"
      interactionApplicationLedgers: ["<InteractionApplicationLedger; same records as physicsInteractionApplicationLedgers>"]
      commitTransactions: ["<PhysicsCommitTransaction; same records as physicsCommitTransactions>"]
      commitReceipts: ["<PhysicsCommitReceipt embedded in each committed transaction and execution ledger>"]
    physicsCoordinationAdvanceRecords: ["<PhysicsCoordinationAdvanceRecord>"]
    physicsInteractionApplicationLedgers: { "<ledger-id>": "<InteractionApplicationLedger>" }
    physicsCommitTransactions: { "<transaction-id>": "<PhysicsCommitTransaction with matching PhysicsCommitReceipt>" }

  interactions:
    physicsInteractions: ["<SurfaceExchange with closed batch, records, reactions, conservation, and application lineage>"]

  physicsQualityRequests: { "<request-id>": "<QualityChangeRequest>" }
  physicsQualityStates: { "<quality-state-id>": "<PhysicsQualityStateDescriptor for every active/source/destination state>" }
  physicsQualityRequestAdmissions: { "<admission-id>": "<QualityRequestAdmission>" }
  physicsQualityAllocationAdmissions: { "<allocation-admission-id>": "<QualityAllocationAdmission>" }
  physicsQualityTransitions:
    - "<QualityTransition resolving its requestId/fromState/toState inventories and embedding the exact requestAdmission and prepare.allocationAdmission>"

  presentation:
    physicsPresentationTimeCohortsById: { "<cohort-id>": "<PresentationTimeCohort>" }
    physicsPresentationCandidate: "<PhysicsPresentationCandidate with committed receipt provenance>"
    physicsCameraViewPublicationsByTarget: { "<target-view-key>": "<CameraViewPublication>" }
    physicsViewPreparationPublicationsByTarget: { "<target-view-key>": "<ViewPreparationPublication>" }
    physicsPresentationSnapshotsByTarget:
      "<target-view-key>": "<PhysicsPresentationSnapshot with exact PresentationClosureManifest>"
    physicsPresentationRenderPlansByTarget: { "<target-view-key>": "<PresentationRenderPlan>" }
    frameCohortAdmission: "<FrameCohortAdmission embedded in frameExecutionRecord>"
    frameSlotAdmissions: ["<FrameSlotAdmission embedded in frameExecutionRecord>"]
    frameExecutionRecord: "<FrameExecutionRecord closing every required target/view and lease join>"

  exactPerformanceEvidence:
    physicsCostLedger: "<PhysicsCostLedger>"
    cadenceTraceTotals: "<CadenceTraceTotals whose counts and bytes reconcile to one trace interval>"
    memoryLedgers:
      hotState: "<PhysicsMemoryLedger>"
      peakTransient: "<PhysicsMemoryLedger>"
      migrationOverlap: "<PhysicsMemoryLedger>"
      frameCohort: "<PhysicsMemoryLedger covering admitted slots and frames in flight>"
    trafficRecords: { "<traffic-record-id>": "<TrafficRecord counted exactly in CadenceTraceTotals>" }
    closureChecks:
      - every-stage-execution-count-reconciles
      - every-interaction-application-count-reconciles
      - every-work-occurrence-count-reconciles
      - every-traffic-occurrence-and-logical-byte-total-reconciles
      - every-live-allocation-has-one-lifetime-and-retirement-proof
      - shared-work-counts-once-and-per-view-work-counts-only-for-executed-views
```

## performance contract

```yaml
performanceContract:
  requestedRefresh: { value: "<fill>", unit: Hz, label: Authored, source: product-brief }
  actualDisplayRefresh: { value: "<fill>", unit: Hz, label: Measured, source: target-run }
  frozenTargetRefresh: { value: "<fill>", unit: Hz, label: Gated, source: accepted-target-envelope }
  frameInterval: { value: "<fill>", unit: ms, label: Derived, source: frozenTargetRefresh }
  cpuP95Budget: { value: "<fill>", unit: ms, label: Gated, source: derived-cpu-envelope }
  gpuP95Budget: { value: "<fill>", unit: ms, label: Gated, source: derived-gpu-envelope }
  presentedP95Budget: { value: "<fill>", unit: ms, label: Gated, source: presentation-contract }
  peakLiveMemoryBudget: { value: "<fill>", unit: bytes, label: Gated, source: target-memory-contract }
  cpuEnvelopeInputs: []
  gpuEnvelopeInputs: []
  interactionReserve: { value: "<fill>", unit: ms, label: Authored, source: planning-only-not-acceptance }
  errorBounds: []

  aggregationPolicy:
    basis: composed-full-frame-plus-paired-sample-marginals
    acceptance: measured-composed-frame
    forbidden: [standalone-total-addition, subsystem-percentile-addition, fixed-time-overhead]

  drawAccounting:
    source: renderer-info-plus-backend-trace
    batchedMeshModel: backend-multidraw-entries-measured
    forbiddenAssumption: single-gpu-draw-per-batchedmesh-material-family

  mrtDecision:
    status: not-used | candidate | accepted
    attachments: []
    consumerProof: []
    targetABEvidence: []
    tileGpuEvidence: []

  passKeys: [primary-view.scene, primary-presentation.present]

  costRecords:
    - id: composed-full-frame
      scope: full-frame
      deviceBrowserGpu: { value: "<fill>", unit: identity, label: Measured, source: benchmark-profile }
      cssViewport: { value: "<fill>", unit: css-pixels, label: Measured, source: benchmark-profile }
      rendererDpr: { value: "<fill>", unit: ratio, label: Measured, source: benchmark-profile }
      renderExtent: { value: "<fill>", unit: physical-pixels, label: Derived, source: cssViewport-and-rendererDpr }
      qualityState: "<fill>"
      sceneStateAndSeed: "<fill>"
      includes: []
      excludes: []
      passKeys: [primary-view.scene, primary-presentation.present]
      cpuP50: { value: "<fill>", unit: ms, label: Measured, source: benchmark-trace }
      cpuP95: { value: "<fill>", unit: ms, label: Measured, source: benchmark-trace }
      gpuP50: { value: "<fill>", unit: ms, label: Measured, source: gpu-timestamp-trace }
      gpuP95: { value: "<fill>", unit: ms, label: Measured, source: gpu-timestamp-trace }
      presentedP50: { value: "<fill>", unit: ms, label: Measured, source: presentation-trace }
      presentedP95: { value: "<fill>", unit: ms, label: Measured, source: presentation-trace }
      bytes: { value: "<fill>", unit: bytes, label: Derived, source: logical-allocation-ledger }
      method: "<sampling and quantile method>"

  passLedger:
    - key: primary-view.scene
      runtimeRole: shared
      accountingOwner: "<fill>"
      viewScope:
        scene: "<fill>"
        camera: "<fill>"
        view: primary-view
        layers: "<fill>"
        jitter: "<fill>"
        timeSample: { value: "<fill>", unit: seconds, label: Authored, source: reproducible-input-path }
      producer: "<fill>"
      consumers: [primary-presentation.present]
      kind: render
      clockId: not used
      cadence: not used
      substepMultiplicity: not used
      executionsPerPresentedFrame: { value: 1, unit: execution-per-frame, label: Authored, source: route-structure }
      inputs: []
      outputs: [primary-view.scene-color]
      resolution: { value: "<fill>", unit: physical-pixels, label: Derived, source: canvas-dpr-pass-scale }
      formats: []
      sampleCount: { value: "<fill>", unit: samples-per-pixel, label: Measured, source: configured-pass }
      loadStoreResolve: []
      lifetime: "<fill>"
      hotBytesPerExecution: { value: "<fill>", unit: bytes-per-execution, label: Derived, source: pass-resource-ledger }
      sourceReactionOrConservationGroups: []
      timing:
        p50: { value: "<fill>", unit: ms, label: Measured, source: gpu-timestamp-trace }
        p95: { value: "<fill>", unit: ms, label: Measured, source: gpu-timestamp-trace }
    - key: primary-presentation.present
      runtimeRole: exclusive
      accountingOwner: "<fill>"
      viewScope:
        scene: "<fill>"
        camera: "<fill>"
        view: primary-view
        layers: "<fill>"
        jitter: "<fill>"
        timeSample: { value: "<fill>", unit: seconds, label: Authored, source: reproducible-input-path }
      producer: "<fill>"
      consumers: [display]
      kind: present
      clockId: not used
      cadence: per-presented-frame
      substepMultiplicity: not used
      executionsPerPresentedFrame: { value: 1, unit: execution-per-frame, label: Authored, source: route-structure }
      inputs: [primary-view.scene-color]
      outputs: [display]
      resolution: { value: "<fill>", unit: physical-pixels, label: Derived, source: canvas-dpr-pass-scale }
      formats: []
      sampleCount: { value: "<fill>", unit: samples-per-pixel, label: Measured, source: configured-pass }
      loadStoreResolve: []
      lifetime: "<fill>"
      hotBytesPerExecution: { value: "<fill>", unit: bytes-per-execution, label: Derived, source: pass-resource-ledger }
      sourceReactionOrConservationGroups: []
      timing:
        p50: { value: "<fill>", unit: ms, label: Measured, source: gpu-timestamp-trace }
        p95: { value: "<fill>", unit: ms, label: Measured, source: gpu-timestamp-trace }

  qualityLadder: []
  skillTierCrosswalk: {}
  qualityController:
    observedSignals: [cpuP50, cpuP95, gpuP50, gpuP95, presentedP50, presentedP95, droppedFrames, memoryPressure, thermalState]
    samplingWindow: { value: "<fill>", unit: frames-or-time, label: Authored, source: controller-policy }
    downgradePredicate: { value: persistent-p95-budget-violation, unit: predicate, label: Gated, source: performance-contract }
    upgradePredicate: { value: persistent-p50-p95-recovery-headroom, unit: predicate, label: Gated, source: performance-contract }
    headroom: { value: "<fill>", unit: budget-fraction-or-ms, label: Authored, source: controller-policy }
    downgradePersistence: { value: "<fill>", unit: windows, label: Authored, source: controller-policy }
    upgradePersistence: { value: "<fill>", unit: windows, label: Authored, source: controller-policy }
    cooldown: { value: "<fill>", unit: windows, label: Authored, source: controller-policy }
    bottleneckClassifier: "<fill>"
    qualityLadder: []
    protectedInvariants: []

  routeStatus: provisional | measured-valid | invalid | unmeasurable

coverageStatus: complete | partial | blocked
```

## route blockers

```yaml
capabilityBlocker: ""
rejectionReason: ""
missingOwners: []
routeAway:
  asset-and-domain-data-pipeline: ""
  scientific-data-and-numerics: ""
  BIM-AEC: ""
  live-data-and-picking: ""
  lighting-IBL-reflections: ""
  generic-volume-point-cloud-graph: ""
  WebXR: ""
  UI-accessibility: ""
  deployment-editor-tooling: ""
  physics: ""
  generic-app-architecture: ""
  fallbackTeaching: "explicit request only; otherwise WebGPU absence is a blocker"
```

## acceptance evidence

```yaml
acceptanceEvidence:
  requiredDebugViews: []
  requiredMetrics: []
  requiredCommands: []
  requiredArtifacts: []
  assertions: []

validationEvidence:
  noPostCapture: ""
  truthDiagnostics: []
  rendererInfoWithLimitations: ""
  composedTimingDistributions: ""
  pairedMarginalDistributions: ""
  passLedgerArtifact: ""
  signalInventory: ""
  logicalMemoryLedger: ""
  sustainedTrace: ""
  qualityControllerTrace: ""
  unavailableHardwareEvidence: []
```
