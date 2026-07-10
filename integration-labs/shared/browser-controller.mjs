import {
	describeRuntimeGraph,
	getLockedTier,
	loadAvailableAdapterFactories,
	validateIntegrationContract
} from './integration-contract-core.mjs';

function escapeHtml( value ) {

	return String( value ).replace( /[&<>"']/g, ( character ) => ( {
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
	} )[ character ] );

}

function evidenceText( record ) {

	return `${ record.value } ${ record.unit } [${ record.label }]`;

}

export class IntegrationLabController {

	#contract;
	#lockedTier;
	#tier;
	#mode;
	#camera;
	#seed;
	#time = 0;
	#size = { width: 1200, height: 800, dpr: 1 };
	#validation;
	#factoryRegistry = null;
	#disposed = false;
	#historyReset = 'initialization';

	constructor( contract, { lockedTier = null } = {} ) {

		this.#contract = contract;
		this.#validation = validateIntegrationContract( contract );
		if ( this.#validation.verdict !== 'PASS' ) throw new Error( `${ this.#validation.code }: ${ this.#validation.message }` );
		this.#lockedTier = lockedTier;
		this.#tier = lockedTier ?? 'balanced';
		getLockedTier( contract, this.#tier );
		this.#mode = contract.modes[ 0 ];
		this.#camera = contract.cameras[ 0 ];
		this.#seed = contract.seeds[ 0 ];

	}

	async ready() {

		this.#assertLive();
		this.#factoryRegistry = await loadAvailableAdapterFactories( this.#contract );
		await this.renderOnce();

	}

	async setScenario( id ) {

		if ( id !== this.#contract.id ) throw new RangeError( `Unknown scenario: ${ id }` );

	}

	async setMode( id ) {

		if ( ! this.#contract.modes.includes( id ) ) throw new RangeError( `Unknown mode: ${ id }` );
		this.#mode = id;
		await this.renderOnce();

	}

	async setTier( id ) {

		getLockedTier( this.#contract, id );
		if ( this.#lockedTier && id !== this.#lockedTier ) throw new Error( `Tier route is locked to ${ this.#lockedTier }; requested ${ id }.` );
		this.#tier = id;
		this.#historyReset = `tier:${ id }`;
		await this.renderOnce();

	}

	async setSeed( seed ) {

		if ( ! this.#contract.seeds.includes( seed ) ) throw new RangeError( `Unknown seed: ${ seed }` );
		this.#seed = seed;
		this.#historyReset = `seed:${ seed }`;
		await this.renderOnce();

	}

	async setCamera( id ) {

		if ( ! this.#contract.cameras.includes( id ) ) throw new RangeError( `Unknown camera: ${ id }` );
		this.#camera = id;
		this.#historyReset = `camera:${ id }`;
		await this.renderOnce();

	}

	async setTime( seconds ) {

		if ( ! Number.isFinite( seconds ) || seconds < 0 ) throw new RangeError( 'Time must be finite and nonnegative.' );
		this.#time = seconds;
		await this.renderOnce();

	}

	async step( deltaSeconds ) {

		if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) throw new RangeError( 'Step must be finite and nonnegative.' );
		this.#time += deltaSeconds;
		await this.renderOnce();

	}

	async resetHistory( cause ) {

		if ( typeof cause !== 'string' || cause === '' ) throw new TypeError( 'History reset cause is required.' );
		this.#historyReset = cause;

	}

	async resize( width, height, dpr ) {

		if ( ! [ width, height, dpr ].every( Number.isFinite ) || width <= 0 || height <= 0 || dpr <= 0 ) throw new RangeError( 'Resize dimensions and DPR must be positive.' );
		this.#size = { width, height, dpr };
		await this.renderOnce();

	}

	async renderOnce() {

		this.#assertLive();
		renderContractUi( this );

	}

	async capturePixels() {

		throw new Error( 'INCOMPLETE_INTEGRATION: no renderer is constructed until every required host adapter exists.' );

	}

	describePipeline() { this.#assertLive(); return describeRuntimeGraph( this.#contract, this.#tier ); }
	describeResources() { this.#assertLive(); return { resources: this.#contract.resources, source: 'authored integration contract; runtime inventory absent' }; }

	getMetrics() {

		this.#assertLive();
		return {
			integrationId: this.#contract.id,
			status: this.#contract.status,
			validation: this.#validation,
			loadedAdapters: this.#factoryRegistry ? [ ...this.#factoryRegistry.loaded.keys() ] : [],
			missingAdapters: this.#factoryRegistry?.missing ?? this.#validation.details.missingAdapters,
			adapterImportErrors: this.#factoryRegistry?.errors ?? [],
			tier: this.#tier,
			mode: this.#mode,
			camera: this.#camera,
			seed: this.#seed,
			time: this.#time,
			size: this.#size,
			historyReset: this.#historyReset,
			performance: 'INSUFFICIENT_EVIDENCE'
		};

	}

	getFactory( adapterId ) {

		this.#assertLive();
		const entry = this.#factoryRegistry?.loaded.get( adapterId );
		if ( ! entry ) throw new RangeError( `Adapter factory is unavailable: ${ adapterId }` );
		return entry.factory;

	}

	async dispose() {

		this.#factoryRegistry?.loaded.clear();
		this.#disposed = true;

	}

	get contract() { return this.#contract; }
	get validation() { return this.#validation; }
	get factoryRegistry() { return this.#factoryRegistry; }
	get lockedTier() { return this.#lockedTier; }
	get tier() { return this.#tier; }
	get mode() { return this.#mode; }
	get camera() { return this.#camera; }
	get seed() { return this.#seed; }

	#assertLive() { if ( this.#disposed ) throw new Error( 'IntegrationLabController is disposed.' ); }

}

function renderContractUi( controller ) {

	const root = document.querySelector( '#app' );
	if ( ! root ) return;
	const contract = controller.contract;
	const tier = getLockedTier( contract, controller.tier );
	const summary = controller.validation.details.tiers.find( ( candidate ) => candidate.id === controller.tier );
	const loaded = controller.factoryRegistry ? [ ...controller.factoryRegistry.loaded.keys() ] : [];
	const missing = controller.factoryRegistry?.missing ?? controller.validation.details.missingAdapters.map( ( id ) => ( { id } ) );
	const errors = controller.factoryRegistry?.errors ?? [];
	const tierOptions = contract.tiers.map( ( candidate ) => `<option value="${ candidate.id }" ${ candidate.id === controller.tier ? 'selected' : '' }>${ candidate.id }</option>` ).join( '' );
	const modeOptions = contract.modes.map( ( mode ) => `<option value="${ escapeHtml( mode ) }" ${ mode === controller.mode ? 'selected' : '' }>${ escapeHtml( mode ) }</option>` ).join( '' );
	const cameraOptions = contract.cameras.map( ( camera ) => `<option value="${ escapeHtml( camera ) }" ${ camera === controller.camera ? 'selected' : '' }>${ escapeHtml( camera ) }</option>` ).join( '' );
	const routeBase = new URL( `../${ contract.id }/tier/`, import.meta.url );

	root.innerHTML = `
		<p class="eyebrow">Integration flagship contract · schema v2</p>
		<h1>${ escapeHtml( contract.title ) }</h1>
		<p class="lede">This page imports real stage factories where host-safe adapters exist. It never constructs a generic proxy renderer. Missing host adapters and absent WebGPU evidence keep the flagship incomplete.</p>
		<div class="warning"><strong>INCOMPLETE:</strong> ${ missing.length } required adapter(s) are absent; native WebGPU pixels, timings, and lifecycle evidence are not claimed.</div>
		<div class="toolbar">
			<label>Tier <select id="tier" ${ controller.lockedTier ? 'disabled' : '' }>${ tierOptions }</select></label>
			<label>Mode <select id="mode">${ modeOptions }</select></label>
			<label>Camera <select id="camera">${ cameraOptions }</select></label>
			<span class="status">${ escapeHtml( controller.validation.code ) }</span>
		</div>
		<section class="grid">
			<article class="card">
				<h2>Locked budget graph</h2>
				<div class="row"><span>targetFrameMs</span><code>${ escapeHtml( evidenceText( tier.targetFrameMs ) ) }</code></div>
				${ tier.stageBudgets.map( ( stage ) => `<div class="row"><span>${ escapeHtml( stage.id ) }</span><code>${ escapeHtml( evidenceText( stage.budgetMs ) ) }</code></div>` ).join( '' ) }
				<div class="row"><span>Stage sum</span><code>${ summary.stageBudgetMs.toFixed( 2 ) } ms [Derived]</code></div>
			</article>
			<article class="card">
				<h2>Adapter readiness</h2>
				<p><strong>Loaded:</strong> ${ loaded.length ? loaded.map( escapeHtml ).join( ', ' ) : 'none' }</p>
				<ul>${ missing.map( ( adapter ) => `<li><code>${ escapeHtml( adapter.id ) }</code> requires ${ escapeHtml( adapter.requiredExport ?? 'stable adapter export' ) }</li>` ).join( '' ) }</ul>
				${ errors.length ? `<pre>${ escapeHtml( JSON.stringify( errors, null, 2 ) ) }</pre>` : '' }
			</article>
			<article class="card wide">
				<h2>Exclusive owner graph</h2>
				<div class="owner-grid">${ contract.owners.map( ( claim ) => `<div><code>${ escapeHtml( claim.semantic ) }</code><span>${ escapeHtml( claim.owner ) }</span></div>` ).join( '' ) }</div>
			</article>
			<article class="card wide">
				<h2>Runtime signal graph</h2>
				<ul>${ contract.signals.map( ( signal ) => `<li><code>${ escapeHtml( signal.id ) }</code>: ${ escapeHtml( signal.producer ) } → ${ escapeHtml( signal.consumers.join( ', ' ) ) }</li>` ).join( '' ) }</ul>
			</article>
			<article class="card">
				<h2>Tier routes</h2>
				<ul>${ contract.tiers.map( ( candidate ) => `<li><a href="${ new URL( `${ candidate.id }/`, routeBase ).href }">${ candidate.id }</a></li>` ).join( '' ) }</ul>
			</article>
			<article class="card">
				<h2>Evidence boundary</h2>
				<pre>${ escapeHtml( JSON.stringify( contract.runtimeEvidence, null, 2 ) ) }</pre>
			</article>
		</section>`;

	root.querySelector( '#tier' ).addEventListener( 'change', ( event ) => controller.setTier( event.target.value ) );
	root.querySelector( '#mode' ).addEventListener( 'change', ( event ) => controller.setMode( event.target.value ) );
	root.querySelector( '#camera' ).addEventListener( 'change', ( event ) => controller.setCamera( event.target.value ) );

}
