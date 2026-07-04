# WebGPU Camera Rig

Canonical camera-controls fixture.

The controller owns one camera, independent chase/side/orbit pose producers,
explicit handoff early-return, exp-decay follow, spring dt clamp/substep,
controls reacquire hooks, obstruction clamp, floating-origin offset hook,
projection snapshot/restore, and disposal.

Run:

```sh
node --check main.mjs
node --check CameraDirectionController.mjs
node cameraValidation.mjs
```
