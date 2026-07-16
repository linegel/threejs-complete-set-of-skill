import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDemoRoadmap } from '../../scripts/lib/demo-roadmap.mjs';
import { buildDemoRegistry } from '../../scripts/lib/lab-registry.mjs';

const registry = buildDemoRegistry();
const demosById = new Map(registry.demos.map((demo) => [demo.id, demo]));

test('incomplete tiered demos expose performance, evidence, and tier closure', () => {
  for (const demo of registry.demos.filter((entry) => entry.status === 'incomplete' && entry.tiers.length > 0)) {
    const roadmap = buildDemoRoadmap(demo);
    if (demo.tiers.some((tier) => tier.frameTargetMs == null)) {
      assert.ok(roadmap.items.some((item) => item.id === 'performance:target-contract'), `${demo.id} hides its missing performance contract`);
    }
    if (!demo.evidenceBundle) {
      assert.ok(roadmap.items.some((item) => item.id === 'evidence:current-source-bundle'), `${demo.id} hides its missing evidence bundle`);
    }
    assert.ok(roadmap.items.some((item) => item.id === 'tiers:acceptance'), `${demo.id} hides incomplete tier acceptance`);
  }
});

test('creature roadmap keeps current-adapter timing open until timestamp evidence exists', () => {
	const creature = demosById.get('webgpu-procedural-creature-lab');
	const roadmap = buildDemoRoadmap(creature);
	const performanceProof = roadmap.items.find((item) => item.id === 'runtime:current-adapter-performance');
	assert.ok(performanceProof, 'creature lab lacks a current-adapter performance closure item');
	assert.match(performanceProof.detail, /submission/i);
	assert.match(performanceProof.detail, /timestamp/i);
	assert.ok(creature.tiers.every((tier) => tier.frameTargetMs?.value === 16.6667), 'creature 60 Hz frame contracts are not frozen');
	assert.ok(!roadmap.items.some((item) => item.id === 'performance:target-contract'), 'frozen frame targets are still reported as undefined');
});
