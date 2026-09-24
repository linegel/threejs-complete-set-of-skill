import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Matrix4, PerspectiveCamera, Quaternion, Vector2, Vector3, OrthographicCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const reference = readFileSync(new URL('../../skills/threejs-camera-controls-and-rigs/references/camera-rig-and-cinematic-systems.md', import.meta.url), 'utf8');

function aimedCamera() {
  const camera = new PerspectiveCamera(55, 1.5, 0.1, 100);
  camera.position.set(4, 3, 8);
  camera.lookAt(2, 1, -3);
  camera.updateMatrixWorld();
  return camera;
}

test('constructor changes pose before a caller can supply the delivered target', () => {
  const camera = aimedCamera();
  const delivered = camera.quaternion.clone();
  new OrbitControls(camera);
  assert.ok(delivered.angleTo(camera.quaternion) > 0.05);
  assert.ok(reference.includes('constructor calls `update()`'));
});

test('restoring the delivered pose after configuration avoids the constructor jump', () => {
  const camera = aimedCamera();
  const position = camera.position.clone(), orientation = camera.quaternion.clone();
  const projection = camera.projectionMatrix.clone();
  const controls = new OrbitControls(camera);
  controls.target.set(2, 1, -3);
  controls.minDistance = 1;
  controls.maxDistance = 20;
  controls.autoRotate = false;
  camera.position.copy(position);
  camera.quaternion.copy(orientation);
  controls.update(0);
  assert.ok(position.distanceTo(camera.position) < 1e-12);
  assert.ok(orientation.angleTo(camera.quaternion) < 1e-7);
  assert.deepEqual(camera.projectionMatrix.elements, projection.elements);
});

test('stock orbit update cannot preserve arbitrary camera roll', () => {
  const camera = aimedCamera();
  const controls = new OrbitControls(camera);
  controls.target.set(2, 1, -3);
  camera.lookAt(controls.target);
  camera.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6));
  const delivered = camera.quaternion.clone();
  controls.update(0);
  assert.ok(delivered.angleTo(camera.quaternion) > 0.5);
});

test('restored constraints can move a delivered camera even without new input', () => {
  const camera = aimedCamera();
  const controls = new OrbitControls(camera);
  controls.target.set(2, 1, -3);
  const position = camera.position.clone();
  controls.minDistance = 20;
  controls.update(0);
  assert.ok(position.distanceTo(camera.position) > 5);
  assert.ok(Math.abs(camera.position.distanceTo(controls.target) - 20) < 1e-12);
});

test('a zero-duration blend needs an instant-cut branch before division', () => {
  assert.ok(Number.isNaN(Math.min(1, Math.max(0, (10 - 10) / 0))));
  assert.ok(reference.includes('zero-duration'));
});

test('nonuniform parent inversion can require shear', () => {
  const inverseParent = new Matrix4().makeScale(0.5, 1, 1);
  const delivered = new Matrix4().makeRotationZ(Math.PI / 4);
  const local = new Matrix4().multiplyMatrices(inverseParent, delivered);
  const x = new Vector3().setFromMatrixColumn(local, 0).normalize();
  const y = new Vector3().setFromMatrixColumn(local, 1).normalize();
  assert.ok(Math.abs(x.dot(y)) > 0.5);
});

function listenerHost() {
  const listeners = new Map();
  return {
    style: { touchAction: 'pan-y', cursor: 'crosshair' }, listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    getRootNode() { return this; },
    emit(type, event) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); }
  };
}

test('r185 disposal during a held Control key requires owned cleanup', () => {
  const host = listenerHost();
  host.ownerDocument = host;
  const controls = new OrbitControls(aimedCamera(), host);
  host.emit('keydown', { key: 'Control' });
  assert.equal(host.listeners.get('keyup').size, 1);
  controls.dispose();
  assert.equal(host.listeners.get('keyup').size, 1);
  assert.equal(host.style.touchAction, '');
  host.removeEventListener('keyup', controls._interceptControlUp, { capture: true });
  host.style.touchAction = 'pan-y';
  assert.equal(host.listeners.get('keyup').size, 0);
  assert.equal(host.style.touchAction, 'pan-y');
  assert.ok(reference.includes('_interceptControlUp'));
});

test('r185 mouse-dolly cursor coordinates need a pinned correction or disabled mode', () => {
  const controls = new OrbitControls(aimedCamera());
  let coordinates;
  controls._updateZoomParameters = (x, y) => { coordinates = [x, y]; };
  controls._handleMouseDownDolly({ clientX: 30, clientY: 80 });
  assert.deepEqual(coordinates, [30, 30]);
  assert.ok(reference.includes('clientY'));
});

test('shifted perspective view bounds match an orthographic focus plane', () => {
  const camera = new PerspectiveCamera(60, 1.5, 0.1, 100);
  camera.zoom = 2;
  camera.filmOffset = 3;
  camera.setViewOffset(1200, 800, 80, 120, 600, 400);
  const min = new Vector2(), max = new Vector2(), depth = 8;
  camera.getViewBounds(depth, min, max);
  const ortho = new OrthographicCamera(min.x, max.x, max.y, min.y, 0.1, 100);
  const points = [new Vector3(0, 0, -depth), new Vector3(min.x, min.y, -depth)];
  for (const point of points) {
    const a = point.clone().project(camera), b = point.clone().project(ortho);
    assert.ok(Math.abs(a.x - b.x) < 1e-12);
    assert.ok(Math.abs(a.y - b.y) < 1e-12);
  }
});
