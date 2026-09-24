import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OrthographicCamera, PerspectiveCamera, Vector3, Vector4 } from 'three';

const reference = readFileSync(new URL('../../skills/threejs-choose-skills/references/projected-error-contract.md', import.meta.url), 'utf8');

function measuredVerticalPixels(camera, point, delta, height) {
  const before = point.clone().project(camera);
  const after = point.clone().add(delta).project(camera);
  return Math.abs(after.y - before.y) * height / 2;
}

test('router publishes projection-matrix scales rather than nominal camera spans', () => {
  assert.match(reference, /^e_px_y <= e_view_transverse \* H \* abs\(P\[5\]\) \/ \(2 \* z_min\)$/m);
  assert.match(reference, /^e_px_y = abs\(e_view_y\) \* H \* abs\(P\[5\]\) \/ 2$/m);
});

for (const kind of ['Perspective', 'Orthographic']) {
  for (const zoom of [1, 2]) {
    for (const cropped of [false, true]) {
      test(`${kind}: zoom ${zoom}, cropped view ${cropped}`, () => {
        const camera = kind === 'Perspective'
          ? new PerspectiveCamera(60, 1.5, 0.1, 100)
          : new OrthographicCamera(-3, 3, 2, -2, 0.1, 100);
        camera.zoom = zoom;
        if (cropped) camera.setViewOffset(1200, 800, 200, 100, 600, 400);
        camera.updateProjectionMatrix();
        const error = 0.02, depth = 10, height = 800;
        const point = new Vector3(0.4, 0.7, -depth);
        const measured = measuredVerticalPixels(camera, point, new Vector3(0, error, 0), height);
        const denominator = kind === 'Perspective' ? depth : 1;
        const bound = error * height * Math.abs(camera.projectionMatrix.elements[5]) / (2 * denominator);
        assert.ok(Math.abs(bound - measured) < 1e-10, `${bound} != ${measured}`);
        const nominal = kind === 'Perspective'
          ? error * height / (2 * depth * Math.tan(camera.fov * Math.PI / 360))
          : error * height / Math.abs(camera.top - camera.bottom);
        if (zoom > 1 || cropped) assert.ok(nominal < measured - 1e-10);
      });
    }
  }
}

test('the router covers each other installed public skill exactly once', () => {
  const base = new URL('../../', import.meta.url);
  const router = readFileSync(new URL('skills/threejs-choose-skills/SKILL.md', base), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('skills.sh.json', base), 'utf8'));
  const expected = manifest.groupings.flatMap(group => group.skills).filter(name => name !== 'threejs-choose-skills').sort();
  const table = router.split('## Destination map')[1].split('## Explicit gaps')[0];
  const actual = [...table.matchAll(/\$threejs-[a-z0-9-]+/g)].map(match => match[0].slice(1)).sort();
  assert.deepEqual(actual, expected);
});

test('finite clip displacement includes off-axis depth error', () => {
  const camera = new PerspectiveCamera(80, 1.5, 0.1, 100);
  camera.zoom = 2;
  camera.filmOffset = 4;
  camera.setViewOffset(1200, 800, 100, 200, 600, 400);
  const point = new Vector3(1.2, 0.7, -4);
  const delta = new Vector3(0.1, -0.03, 0.8);
  const c = new Vector4(...point.toArray(), 1).applyMatrix4(camera.projectionMatrix);
  const d = new Vector4(...delta.toArray(), 0).applyMatrix4(camera.projectionMatrix);
  const before = point.clone().project(camera);
  const after = point.clone().add(delta).project(camera);
  const dx = 600 * (c.w * d.x - c.x * d.w) / (2 * c.w * (c.w + d.w));
  const dy = 400 * (c.w * d.y - c.y * d.w) / (2 * c.w * (c.w + d.w));
  assert.ok(Math.abs(dx - (after.x - before.x) * 300) < 1e-10);
  assert.ok(Math.abs(dy - (after.y - before.y) * 200) < 1e-10);
});

test('matching outer bounds do not prove matching interior features', () => {
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  const original = [-1, 0, 1];
  const displaced = [-1, 0.25, 1];
  assert.equal(Math.min(...original), Math.min(...displaced));
  assert.equal(Math.max(...original), Math.max(...displaced));
  const error = measuredVerticalPixels(camera, new Vector3(0, 0, -10), new Vector3(0, 0.25, 0), 800);
  assert.equal(error, 50);
  assert.ok(reference.includes('corresponding-point error'));
});
