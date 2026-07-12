#!/usr/bin/env node
import { chromium } from 'playwright';
import { preview } from 'vite';
import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  authoritativeSkillDirs,
  buildDemoRegistry,
  loadCanonicalTargets,
} from './lib/lab-registry.mjs';
import {
  LAB_CONTROLLER_GLOBALS,
  assertPagesBrowserObservation,
  assertPagesRouteResponse,
  plannedPagesBrowserRoutes,
  plannedPagesSmokeRoutes,
} from './lib/page-routes.mjs';

const server = await preview({
  root: REPO_ROOT,
  logLevel: 'warn',
  build: { outDir: 'docs' },
  preview: { host: '127.0.0.1', port: 4173, strictPort: false },
});
const baseUrl = server.resolvedUrls?.local?.[0];
if (!baseUrl) {
  await server.httpServer.close();
  throw new Error('Vite preview did not expose a local URL');
}

let browser = null;
try {
  const registry = buildDemoRegistry();
  const skillIds = authoritativeSkillDirs(loadCanonicalTargets());
  const routes = plannedPagesSmokeRoutes({ registry, skillIds, primaryDemoKinds: PRIMARY_DEMO_KINDS });
  for (const route of routes) {
    const response = await fetch(new URL(route.path.replace(/^\//, ''), baseUrl), { redirect: 'manual' });
    assertPagesRouteResponse(route, {
      status: response.status,
      url: response.url,
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    });
  }
  const browserRoutes = plannedPagesBrowserRoutes(routes);
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--disable-gpu-sandbox'],
  });
  for (const route of browserRoutes) {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const requestErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack ?? error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      requestErrors.push(`${request.url()} (${request.failure()?.errorText ?? 'request failed'})`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        requestErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    page.on('crash', () => pageErrors.push('page crashed'));
    try {
      const response = await page.goto(new URL(route.path.replace(/^\//, ''), baseUrl).href, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      if (response?.status() !== 200) {
        throw new Error(`${route.path} browser returned ${response?.status() ?? 'no response'}`);
      }
      await page.waitForFunction(({ controllerGlobals, category }) => {
        const frameWindow = document.querySelector('#canonical-lab')?.contentWindow ?? null;
        const windows = [window, frameWindow].filter(Boolean);
        const blocker = windows.some((candidateWindow) => (
          candidateWindow.__LAB_ROUTE_ERROR__
          ?? candidateWindow.__LAB_ERROR__
          ?? candidateWindow.__labError
          ?? candidateWindow.__lab?.error
          ?? null
        ));
        if (blocker) return true;
        if (category === 'primary-fixed') {
          return window.labController !== undefined && window.labController !== null;
        }
        return windows.some((candidateWindow) => controllerGlobals.some((name) => (
          candidateWindow[name] !== undefined && candidateWindow[name] !== null
        )));
      }, { controllerGlobals: LAB_CONTROLLER_GLOBALS, category: route.category }, { timeout: 60_000 });
      const runtime = await page.evaluate(async ({ controllerGlobals, route }) => {
        const frame = document.querySelector('#canonical-lab');
        const frameWindow = frame?.contentWindow ?? null;
        const frameDocument = frame?.contentDocument ?? null;
        const windows = [window, frameWindow].filter(Boolean);
        const runtimeErrors = [];
        const deviceErrors = [];
        const stringify = (value) => {
          if (value === null || value === undefined || value === false) return null;
          if (typeof value === 'string') return value;
          if (value instanceof Error) return value.stack ?? value.message;
          if (typeof value === 'object' && (value.message || value.reason)) {
            return String(value.message ?? value.reason);
          }
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        };
        const appendDeviceEntries = (label, value) => {
          const entries = Array.isArray(value) ? value : [value];
          for (const entry of entries) {
            const error = stringify(entry);
            if (error) deviceErrors.push(`${label}: ${error}`);
          }
        };
        const collectDeviceState = (label, source) => {
          if (!source || typeof source !== 'object') return;
          for (const key of [
            'deviceErrors',
            'deviceError',
            'deviceLossErrors',
            'deviceLossError',
            'uncapturedErrors',
            'lastDeviceError',
            'deviceLossDetails',
            'deviceLoss',
            'gpuErrors',
          ]) {
            appendDeviceEntries(`${label}.${key}`, source[key]);
          }
          if (source.deviceLostObserved === true) {
            deviceErrors.push(`${label}.deviceLostObserved: true`);
          }
          for (const key of ['deviceErrorCount', 'uncapturedErrorCount', 'gpuErrorCount']) {
            if (Number.isFinite(source[key]) && source[key] > 0) {
              deviceErrors.push(`${label}.${key}: ${source[key]}`);
            }
          }
          if (Number.isFinite(source.deviceLossGeneration) && source.deviceLossGeneration > 0) {
            deviceErrors.push(`${label}.deviceLossGeneration: ${source.deviceLossGeneration}`);
          }
        };
        const collectWindowState = () => {
          for (const candidateWindow of windows) {
            for (const key of ['__LAB_ROUTE_ERROR__', '__LAB_ERROR__', '__labError']) {
              const error = stringify(candidateWindow[key]);
              if (error) runtimeErrors.push(error);
            }
            const nestedError = stringify(candidateWindow.__lab?.error);
            if (nestedError) runtimeErrors.push(nestedError);
            for (const key of [
              '__LAB_DEVICE_ERROR__',
              '__WEBGPU_DEVICE_ERROR__',
              '__LAB_DEVICE_LOSS__',
              '__LAB_DEVICE_ERRORS__',
            ]) {
              appendDeviceEntries(`window.${key}`, candidateWindow[key]);
            }
            for (const key of [
              '__imagePipelineGpuEvents',
              '__LAB_GPU_EVENTS__',
              '__THREEJS_GPU_EVENTS__',
              '__WEBGPU_GPU_EVENTS__',
              '__GPU_EVENTS__',
              '__labGpuEvents',
            ]) {
              collectDeviceState(`window.${key}`, candidateWindow[key]);
            }
          }
        };
        collectWindowState();
        if (runtimeErrors.length > 0) throw new Error(runtimeErrors.join(' | '));

        let controller = null;
        let ownerWindow = null;
        for (const candidateWindow of windows) {
          for (const name of controllerGlobals) {
            const candidate = candidateWindow[name];
            if (candidate !== undefined && candidate !== null) {
              controller = await Promise.resolve(candidate);
              ownerWindow = candidateWindow;
              break;
            }
          }
          if (controller) break;
        }
        if (!controller) throw new Error('Canonical lab did not expose a controller.');
        if (route.category === 'primary-base') {
          const readyPromise = ownerWindow?.__LAB_READY__;
          if (typeof controller.ready !== 'function') {
            throw new Error('Canonical lab controller has no ready() method.');
          }
          if (readyPromise) await Promise.resolve(readyPromise);
          else await controller.ready();
        } else if (typeof controller.ready !== 'function') {
          throw new Error('Locked route exposed a controller without ready().');
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const metrics = typeof controller.getMetrics === 'function'
          ? await controller.getMetrics()
          : {};
        const pipeline = typeof controller.describePipeline === 'function'
          ? await controller.describePipeline()
          : {};
        const resources = typeof controller.describeResources === 'function'
          ? await controller.describeResources()
          : {};
        const normalizeRouteValue = (value) => (
          value && typeof value === 'object' ? (value.id ?? value.name ?? null) : value
        );
        const routeKeys = new Set([
          ...(route.acknowledgementKeys ?? []),
          ...Object.values(route.startupAcknowledgementKeys ?? {}).flat(),
          route.routeKind,
          'kind',
          'id',
          'labId',
        ].filter(Boolean));
        const routeMetrics = {};
        for (const key of routeKeys) routeMetrics[key] = normalizeRouteValue(metrics?.[key]);
        if (metrics?.routeSelection && typeof metrics.routeSelection === 'object') {
          routeMetrics.routeSelection = {};
          for (const key of routeKeys) {
            routeMetrics.routeSelection[key] = normalizeRouteValue(metrics.routeSelection[key]);
          }
        }

        const consistentIdentity = (values) => {
          const identities = [...new Set(values.filter((value) => (
            typeof value === 'string' && value.length > 0
          )))];
          return identities.length === 1 ? identities[0] : null;
        };
        const documentLabId = consistentIdentity([
          document.querySelector('meta[name="lab-id"]')?.content,
          document.querySelector('[data-demo-id]')?.getAttribute('data-demo-id'),
          frameDocument?.querySelector('meta[name="lab-id"]')?.content,
          frameDocument?.querySelector('[data-demo-id]')?.getAttribute('data-demo-id'),
        ]);
        const controllerLabId = consistentIdentity([
          controller.labId,
          metrics?.labId,
          metrics?.routeSelection?.labId,
        ]);

        const directRenderer = controller.renderer?.backend ? controller.renderer : null;
        const directBackend = directRenderer?.backend ?? null;
        const directDevice = directBackend?.device ?? null;
        const directBackendProof = directRenderer
          ? {
              source: 'controller.renderer',
              isWebGPUBackend: directBackend?.isWebGPUBackend === true,
              initialized: directRenderer.initialized === true,
              deviceIdentityObserved: directDevice !== null && directDevice !== undefined,
              lossPromiseObservedOnActualDevice: typeof directDevice?.lost?.then === 'function',
            }
          : null;
        const backendEvidence = metrics?.rendererBackendEvidence
          ?? metrics?.backendEvidence
          ?? metrics?.rendererInfo?.backendEvidence
          ?? null;
        const structuredBackendProof = backendEvidence && typeof backendEvidence === 'object'
          ? {
              rendererBackendEvidence: {
                isWebGPUBackend: backendEvidence.isWebGPUBackend === true,
                initialized: backendEvidence.initialized === true,
                deviceIdentityVerified: backendEvidence.deviceIdentityVerified === true,
                lossPromiseObservedOnActualDevice: backendEvidence.lossPromiseObservedOnActualDevice === true,
              },
              rendererDeviceStatus: metrics?.rendererDeviceStatus,
              deviceLossGeneration: metrics?.deviceLossGeneration,
              deviceLostObserved: metrics?.deviceLostObserved,
              uncapturedErrors: Array.isArray(metrics?.uncapturedErrors)
                ? metrics.uncapturedErrors.map((entry) => stringify(entry))
                : null,
              deviceErrors: Array.isArray(metrics?.deviceErrors)
                ? metrics.deviceErrors.map((entry) => stringify(entry))
                : null,
              deviceErrorCount: metrics?.deviceErrorCount,
              lastDeviceError: Object.hasOwn(metrics, 'lastDeviceError')
                ? (metrics.lastDeviceError === null ? null : stringify(metrics.lastDeviceError))
                : undefined,
            }
          : null;
        for (const [label, source] of [
          ['controller', controller],
          ['metrics', metrics],
          ['pipeline', pipeline],
          ['resources', resources],
          ['metrics.rendererInfo', metrics?.rendererInfo],
          ['metrics.backend', metrics?.backend],
        ]) {
          collectDeviceState(label, source);
        }
        const devices = new Set([
          directDevice,
          ownerWindow?.__labDevice,
          frameWindow?.__labDevice,
        ].filter((device) => device?.lost && typeof device.lost.then === 'function'));
        const deviceObservers = [];
        for (const device of devices) {
          const observer = { device, lossInfo: null, lossObservedBeforeDispose: false, uncapturedErrors: [] };
          device.lost.then((info) => { observer.lossInfo = info; });
          observer.uncapturedHandler = (event) => {
            observer.uncapturedErrors.push(event?.error ?? event ?? 'uncaptured GPU error');
          };
          device.addEventListener?.('uncapturederror', observer.uncapturedHandler);
          const settledLoss = await Promise.race([
            device.lost.then((info) => ({ observed: true, info })),
            new Promise((resolve) => setTimeout(() => resolve({ observed: false }), 0)),
          ]);
          if (settledLoss.observed) {
            observer.lossObservedBeforeDispose = true;
            appendDeviceEntries('GPUDevice.lost before dispose', settledLoss.info);
          }
          deviceObservers.push(observer);
        }

        if (typeof controller.dispose !== 'function') {
          throw new Error('Canonical lab controller has no dispose() method.');
        }
        // Every smoke observation owns an isolated Page, so its controller can
        // be disposed without affecting another route or shared browser state.
        await controller.dispose();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        collectWindowState();
        for (const observer of deviceObservers) {
          for (const error of observer.uncapturedErrors) {
            appendDeviceEntries('GPUDevice uncapturederror after dispose', error);
          }
          if (
            observer.lossInfo
            && !observer.lossObservedBeforeDispose
            && observer.lossInfo.reason !== 'destroyed'
          ) {
            appendDeviceEntries('GPUDevice.lost after dispose', observer.lossInfo);
          }
          observer.device.removeEventListener?.('uncapturederror', observer.uncapturedHandler);
        }
        return {
          ready: true,
          documentLabId,
          controllerLabId,
          lockedKind: route.category === 'primary-fixed' ? route.routeKind : null,
          lockedId: route.category === 'primary-fixed'
            ? document.querySelector(`meta[name="lab-${route.routeKind}"]`)?.content ?? null
            : null,
          routeMetrics,
          backendProof: {
            direct: directBackendProof,
            structured: structuredBackendProof,
          },
          disposed: true,
          runtimeErrors,
          deviceErrors,
        };
      }, { controllerGlobals: LAB_CONTROLLER_GLOBALS, route });
      await page.waitForTimeout(0);
      assertPagesBrowserObservation(route, {
        ...runtime,
        url: page.url(),
        pageErrors: [...pageErrors, ...(runtime.runtimeErrors ?? [])],
        consoleErrors,
        requestErrors,
      });
    } finally {
      await page.close();
    }
  }
  const primaryBaseCount = routes.filter((route) => route.category === 'primary-base').length;
  const primaryFixedCount = routes.filter((route) => route.category === 'primary-fixed').length;
  console.log(`Pages smoke passed for ${routes.length} static routes and ${browserRoutes.length} primary browser routes (${primaryBaseCount} bases + ${primaryFixedCount} fixed states).`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
}
