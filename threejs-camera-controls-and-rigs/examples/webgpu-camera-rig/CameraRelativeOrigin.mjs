import { Matrix4, StorageBufferAttribute, Vector3 } from "three/webgpu";
import {
  positionGeometry,
  storage,
  uniform,
  uint,
  vec4,
} from "three/tsl";

const RECORD = Object.freeze({
  currentOriginHigh: 0,
  currentOriginLow: 1,
  previousOriginHigh: 2,
  previousOriginLow: 3,
  currentObjectHigh: 4,
  currentObjectLow: 5,
  previousObjectHigh: 6,
  previousObjectLow: 7,
});

function writeSplit(array, highRecord, lowRecord, vector) {
  const highBase = highRecord * 4;
  const lowBase = lowRecord * 4;
  const hx = Math.fround(vector.x);
  const hy = Math.fround(vector.y);
  const hz = Math.fround(vector.z);
  array[highBase + 0] = hx;
  array[highBase + 1] = hy;
  array[highBase + 2] = hz;
  array[highBase + 3] = 0;
  array[lowBase + 0] = vector.x - hx;
  array[lowBase + 1] = vector.y - hy;
  array[lowBase + 2] = vector.z - hz;
  array[lowBase + 3] = 0;
}

export class CameraRelativeOrigin {
  constructor() {
    this.currentOrigin = new Vector3();
    this.previousOrigin = new Vector3();
    this.currentObject = new Vector3();
    this.previousObject = new Vector3();
    this.currentRelative = new Vector3();
    this.previousRelative = new Vector3();
    this.velocityRelative = new Vector3();
    this.currentProjection = new Matrix4();
    this.previousProjection = new Matrix4();
    this.currentView = new Matrix4();
    this.previousView = new Matrix4();
    this.currentModel = new Matrix4();
    this.previousModel = new Matrix4();
    this.currentModelInverse = new Matrix4();
    this.previousModelInverse = new Matrix4();
    this.currentProjectionNode = uniform(this.currentProjection).setName("camera:current-projection");
    this.previousProjectionNode = uniform(this.previousProjection).setName("camera:previous-projection");
    this.currentViewNode = uniform(this.currentView).setName("camera:current-view");
    this.previousViewNode = uniform(this.previousView).setName("camera:previous-view");
    this.currentModelNode = uniform(this.currentModel).setName("camera:current-model");
    this.previousModelNode = uniform(this.previousModel).setName("camera:previous-model");
    this.currentModelInverseNode = uniform(this.currentModelInverse).setName("camera:current-model-inverse");
    this.previousModelInverseNode = uniform(this.previousModelInverse).setName("camera:previous-model-inverse");
    this.epoch = 0;
    this.array = new Float32Array(8 * 4);
    this.attribute = new StorageBufferAttribute(this.array, 4);
    this.node = storage(this.attribute, "vec4", 8).setName("camera:origin-and-object-high-low");
    this._syncStorage();
  }

  setInitial(origin, object) {
    this.currentOrigin.copy(origin);
    this.previousOrigin.copy(origin);
    this.currentObject.copy(object);
    this.previousObject.copy(object);
    this._syncStorage();
    return this;
  }

  beginFrame(object = this.currentObject) {
    this.previousOrigin.copy(this.currentOrigin);
    this.previousObject.copy(this.currentObject);
    this.previousProjection.copy(this.currentProjection);
    this.previousView.copy(this.currentView);
    this.previousModel.copy(this.currentModel);
    this.previousModelInverse.copy(this.currentModelInverse);
    this.currentObject.copy(object);
    return this;
  }

  setInitialMatrices(camera, object) {
    this.setCurrentMatrices(camera, object);
    this.previousProjection.copy(this.currentProjection);
    this.previousView.copy(this.currentView);
    this.previousModel.copy(this.currentModel);
    this.previousModelInverse.copy(this.currentModelInverse);
    return this;
  }

  setCurrentMatrices(camera, object) {
    if (camera?.isCamera !== true) throw new TypeError("floating-origin matrices require a camera");
    if (object?.isObject3D !== true) throw new TypeError("floating-origin matrices require an Object3D");
    object.updateWorldMatrix(true, false);
    camera.updateMatrixWorld(true);
    this.currentProjection.copy(camera.projectionMatrix);
    this.currentView.copy(camera.matrixWorldInverse);
    this.currentModel.copy(object.matrixWorld);
    this.currentModelInverse.copy(object.matrixWorld).invert();
    return this;
  }

  rebase(origin) {
    if (!origin.equals(this.currentOrigin)) {
      this.previousOrigin.copy(this.currentOrigin);
      this.currentOrigin.copy(origin);
      this.epoch += 1;
    }
    this._syncStorage();
    return this;
  }

  setObject(object) {
    this.currentObject.copy(object);
    this._syncStorage();
    return this;
  }

  commit() {
    this._syncStorage();
    return this;
  }

  _syncStorage() {
    writeSplit(this.array, RECORD.currentOriginHigh, RECORD.currentOriginLow, this.currentOrigin);
    writeSplit(this.array, RECORD.previousOriginHigh, RECORD.previousOriginLow, this.previousOrigin);
    writeSplit(this.array, RECORD.currentObjectHigh, RECORD.currentObjectLow, this.currentObject);
    writeSplit(this.array, RECORD.previousObjectHigh, RECORD.previousObjectLow, this.previousObject);
    this.currentRelative.subVectors(this.currentObject, this.currentOrigin);
    this.previousRelative.subVectors(this.previousObject, this.previousOrigin);
    this.velocityRelative.subVectors(this.currentRelative, this.previousRelative);
    this.attribute.needsUpdate = true;
  }

  createTslContract() {
    // Never reconstruct objectHigh + objectLow before subtracting. At planetary
    // coordinates that f32 addition discards the low lane. Subtract each lane
    // first, then combine the already-small deltas.
    const currentRelative = this.node.element(uint(RECORD.currentObjectHigh)).xyz
      .sub(this.node.element(uint(RECORD.currentOriginHigh)).xyz)
      .add(
        this.node.element(uint(RECORD.currentObjectLow)).xyz
          .sub(this.node.element(uint(RECORD.currentOriginLow)).xyz),
      );
    const previousRelative = this.node.element(uint(RECORD.previousObjectHigh)).xyz
      .sub(this.node.element(uint(RECORD.previousOriginHigh)).xyz)
      .add(
        this.node.element(uint(RECORD.previousObjectLow)).xyz
          .sub(this.node.element(uint(RECORD.previousOriginLow)).xyz),
      );
    // positionNode is a local-space contract. Convert the world-relative
    // camera-origin delta by the model's inverse linear transform (w=0), so a
    // rotated/scaled visible object and the CPU camera target still coincide.
    const currentLocalOffset = this.currentModelInverseNode.mul(vec4(currentRelative, 0)).xyz;
    const previousLocalOffset = this.previousModelInverseNode.mul(vec4(previousRelative, 0)).xyz;
    const currentLocal = positionGeometry.add(currentLocalOffset);
    const previousLocal = positionGeometry.add(previousLocalOffset);
    const currentClip = this.currentProjectionNode
      .mul(this.currentViewNode)
      .mul(this.currentModelNode)
      .mul(vec4(currentLocal, 1));
    const previousClip = this.previousProjectionNode
      .mul(this.previousViewNode)
      .mul(this.previousModelNode)
      .mul(vec4(previousLocal, 1));
    const velocityNdc = currentClip.xy.div(currentClip.w)
      .sub(previousClip.xy.div(previousClip.w));
    return {
      positionOffset: currentLocalOffset,
      previousPositionOffset: previousLocalOffset,
      velocityNdc,
      storageNode: this.node,
      currentProjection: this.currentProjectionNode,
      previousProjection: this.previousProjectionNode,
      currentView: this.currentViewNode,
      previousView: this.previousViewNode,
      currentModel: this.currentModelNode,
      previousModel: this.previousModelNode,
      currentModelInverse: this.currentModelInverseNode,
      previousModelInverse: this.previousModelInverseNode,
    };
  }

  describe() {
    return {
      epoch: this.epoch,
      storageBytes: this.array.byteLength,
      recordCount: 8,
      currentOrigin: this.currentOrigin.toArray(),
      previousOrigin: this.previousOrigin.toArray(),
      currentRelative: this.currentRelative.toArray(),
      previousRelative: this.previousRelative.toArray(),
      velocityRelative: this.velocityRelative.toArray(),
    };
  }

  dispose() {
    this.attribute.dispose?.();
  }
}

export { RECORD as CAMERA_ORIGIN_RECORD };
