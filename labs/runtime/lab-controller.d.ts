export type PixelCapture = {
  target: string;
  width: number;
  height: number;
  bytesPerPixel: number;
  bytesPerRow: number;
  data: Uint8Array;
};

export type RuntimeGraphManifest = Record<string, unknown>;
export type RuntimeResourceManifest = Record<string, unknown>;

export interface LabController {
  ready(): Promise<void>;
  setScenario(id: string): Promise<void>;
  setMode(id: string): Promise<void>;
  setTier(id: string): Promise<void>;
  setSeed(seed: number): Promise<void>;
  setCamera(id: string): Promise<void>;
  setTime(seconds: number): Promise<void>;
  step(deltaSeconds: number): Promise<void>;
  resetHistory(cause: string): Promise<void>;
  resize(width: number, height: number, dpr: number): Promise<void>;
  renderOnce(): Promise<void>;
  capturePixels(target: string): Promise<PixelCapture>;
  describePipeline(): RuntimeGraphManifest;
  describeResources(): RuntimeResourceManifest;
  getMetrics(): Record<string, unknown>;
  dispose(): Promise<void>;
}
