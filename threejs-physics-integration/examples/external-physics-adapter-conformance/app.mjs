import { scorePhysicsDecision } from './decision-record.js';
import { decisionFixtures, externalAdapterCostFixture, externalAdapterFixture } from './fixtures.js';
import { validateExternalSolverAdapterBoundary } from './external-adapter-contract.js';

const params = new URLSearchParams( location.search );
const requested = params.get( 'scenario' );
let selected = decisionFixtures.find( ( fixture ) => fixture.problemId === requested ) ?? decisionFixtures[ 0 ];

const nav = document.querySelector( '#scenarios' );
const observable = document.querySelector( '#observable' );
const summary = document.querySelector( '#summary' );
const head = document.querySelector( '#head' );
const body = document.querySelector( '#body' );

validateExternalSolverAdapterBoundary( structuredClone( externalAdapterFixture ), structuredClone( externalAdapterCostFixture ) );

function render() {

	const result = scorePhysicsDecision( structuredClone( selected ) );
	const axes = Object.keys( selected.frozenWeights );
	nav.replaceChildren( ...decisionFixtures.map( ( fixture ) => {

		const button = document.createElement( 'button' );
		button.textContent = fixture.problemId;
		button.setAttribute( 'aria-pressed', String( fixture.problemId === selected.problemId ) );
		button.onclick = () => {

			selected = fixture;
			history.replaceState( null, '', `?scenario=${ encodeURIComponent( fixture.problemId ) }` );
			render();

		};
		return button;

	} ) );
	observable.textContent = selected.observable;
	summary.innerHTML = `
		<div class="metric"><strong>${ selected.candidates.length }</strong>distinct solutions</div>
		<div class="metric"><strong>${ axes.length }</strong>frozen score axes</div>
		<div class="metric"><strong>${ Object.keys( selected.hardGates ).length }</strong>hard gates</div>
		<div class="metric"><strong>${ result.winner }</strong>selected top-1</div>`;
	head.innerHTML = `<tr><th>Rank</th><th>Candidate</th><th>Eligible</th><th>Weighted</th>${ axes.map( ( axis ) => `<th>${ axis }</th>` ).join( '' ) }</tr>`;
	body.innerHTML = result.ranked.map( ( ranked, index ) => {

		return `<tr data-winner="${ ranked.candidateId === result.winner }"><td>${ index + 1 }</td><td>${ ranked.candidateId }</td><td class="${ ranked.eligible ? 'pass' : 'fail' }">${ ranked.eligible ? 'PASS' : 'FAIL' }</td><td>${ ranked.weightedScore.toFixed( 3 ) }</td>${ axes.map( ( axis ) => `<td>${ ranked.scores[ axis ] }</td>` ).join( '' ) }</tr>`;

	} ).join( '' );
	document.documentElement.dataset.labReady = 'true';
	window.__PHYSICS_INTEGRATION_LAB__ = Object.freeze( { status: 'READY — CONTRACT ONLY', problemId: selected.problemId, winner: result.winner, nativeEvidence: 'INSUFFICIENT_EVIDENCE' } );

}

render();
