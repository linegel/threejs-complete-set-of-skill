#!/usr/bin/env node
import { chromium } from 'playwright';

const SITE = new URL(process.env.SITE_URL ?? 'https://threejs-skills.com/');
const currentMobileRoutes = ['/', '/skills/threejs-choose-skills.html', '/skills/threejs-water-optics.html'];
const decisionRoutes = [
  '/guides/',
  '/compare/threejs-webgpu-skill-pack-vs-threejs-game-skills/',
  '/pricing/',
  '/migrate/webglrenderer-to-webgpurenderer/',
  '/industries/product-visualization-and-configurators/',
  '/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/',
];
const uniqueRoutes = (...groups) => [...new Set(groups.flat())];
const viewAudits = [
  {
    name: 'mobile',
    routes: uniqueRoutes(currentMobileRoutes, decisionRoutes),
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    },
  },
  {
    name: 'desktop',
    routes: uniqueRoutes(decisionRoutes),
    context: {
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    },
  },
];
const noScriptRoutes = [
  { route: '/', label: 'homepage', minimumText: 3_000, minimumLinks: 50 },
  { route: '/guides/', label: 'Guides hub', minimumText: 1_200, minimumLinks: 10 },
  {
    route: '/faq/why-does-my-tsl-post-processing-look-double-tone-mapped/',
    label: 'FAQ answer',
    minimumText: 900,
    minimumLinks: 6,
  },
];
const errors = [];
const warnings = [];
const reports = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const audit of viewAudits) {
    const context = await browser.newContext(audit.context);
    await context.addInitScript(() => {
      window.__SEO_VITALS__ = { cls: 0, lcp: 0, longTasks: 0 };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__SEO_VITALS__.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__SEO_VITALS__.lcp = entries.at(-1).startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        window.__SEO_VITALS__.longTasks += list.getEntries().length;
      }).observe({ type: 'longtask', buffered: true });
    });

    for (const route of audit.routes) {
      const page = await context.newPage();
      const consoleErrors = [];
      const failedRequests = [];
      const label = `${route} [${audit.name}]`;
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('requestfailed', (request) => failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'failed'})`));

      const url = new URL(route, SITE).href;
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      assert(response?.status() === 200, `${label}: expected 200, received ${response?.status() ?? 'no response'}`);
      await page.waitForTimeout(250);
      const report = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource');
        const visibleImages = [...document.images].filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        });
        return {
          title: document.title,
          h1: document.querySelectorAll('h1').length,
          main: document.querySelectorAll('main').length,
          landmarks: document.querySelectorAll('header, main, nav, footer').length,
          links: document.querySelectorAll('a[href]').length,
          nodes: document.querySelectorAll('*').length,
          horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
          fonts: document.fonts.status,
          visibleBrokenImages: visibleImages.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
          imagesWithoutDimensions: [...document.images].filter((image) => !image.hasAttribute('width') || !image.hasAttribute('height')).map((image) => image.currentSrc || image.src),
          ttfbMs: navigation ? navigation.responseStart - navigation.requestStart : null,
          domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
          loadMs: navigation?.loadEventEnd ?? null,
          transferBytes: resources.reduce((sum, resource) => sum + (resource.transferSize || 0), navigation?.transferSize || 0),
          resourceCount: resources.length,
          thirdPartyResources: resources.filter((resource) => new URL(resource.name).origin !== location.origin).length,
          vitals: window.__SEO_VITALS__,
        };
      });
      reports.push({ route, view: audit.name, ...report, consoleErrors: consoleErrors.length, failedRequests: failedRequests.length });

      assert(report.h1 === 1, `${label}: expected one h1, found ${report.h1}`);
      assert(report.main === 1, `${label}: expected one main landmark, found ${report.main}`);
      assert(report.landmarks >= 4, `${label}: incomplete semantic landmark structure`);
      assert(report.links > 5, `${label}: insufficient crawlable links`);
      assert(report.horizontalOverflow <= 1, `${label}: ${report.horizontalOverflow}px horizontal overflow at ${audit.name} width`);
      assert(report.visibleBrokenImages.length === 0, `${label}: broken visible images (${report.visibleBrokenImages.join(', ')})`);
      assert(report.imagesWithoutDimensions.length === 0, `${label}: images lack intrinsic dimensions (${report.imagesWithoutDimensions.slice(0, 3).join(', ')})`);
      assert(consoleErrors.length === 0, `${label}: console errors (${consoleErrors.join(' | ')})`);
      assert(failedRequests.length === 0, `${label}: failed requests (${failedRequests.join(' | ')})`);
      assert(report.vitals.cls <= 0.1, `${label}: CLS ${report.vitals.cls.toFixed(3)} exceeds 0.1`);
      if (report.vitals.lcp > 4_000) warnings.push(`${label}: observed LCP ${Math.round(report.vitals.lcp)}ms`);
      if (report.ttfbMs > 800) warnings.push(`${label}: observed TTFB ${Math.round(report.ttfbMs)}ms`);
      if (report.transferBytes > 3_000_000) warnings.push(`${label}: transferred ${(report.transferBytes / 1_000_000).toFixed(2)}MB before scrolling`);
      await page.close();
    }
    await context.close();
  }

  const noScript = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false,
    isMobile: true,
  });
  for (const target of noScriptRoutes) {
    const page = await noScript.newPage();
    const response = await page.goto(new URL(target.route, SITE).href, { waitUntil: 'load', timeout: 30_000 });
    const label = `no-JavaScript ${target.label}`;
    assert(response?.status() === 200, `${label} did not return 200`);
    const staticReport = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      main: document.querySelectorAll('main').length,
      textLength: document.querySelector('main')?.innerText.trim().length ?? 0,
      links: document.querySelectorAll('a[href]').length,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
    }));
    assert(staticReport.h1 === 1, `${label} lost its h1`);
    assert(staticReport.main === 1, `${label} lost its main landmark`);
    assert(staticReport.textLength > target.minimumText, `${label} lacks substantial static content (${staticReport.textLength} characters)`);
    assert(staticReport.links > target.minimumLinks, `${label} lacks crawlable navigation (${staticReport.links} links)`);
    assert(staticReport.horizontalOverflow <= 1, `${label} has ${staticReport.horizontalOverflow}px horizontal overflow`);
    await page.close();
  }
  await noScript.close();
} finally {
  await browser.close();
}

for (const report of reports) {
  console.log(`${report.route} [${report.view}]: LCP=${Math.round(report.vitals.lcp)}ms CLS=${report.vitals.cls.toFixed(3)} TTFB=${Math.round(report.ttfbMs)}ms transfer=${(report.transferBytes / 1_000_000).toFixed(2)}MB resources=${report.resourceCount} third-party=${report.thirdPartyResources}`);
}
for (const warning of warnings) console.warn(`warning: ${warning}`);
if (errors.length) {
  console.error(`Live presentation audit failed (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Live presentation audit passed for ${reports.length} route-view checks across mobile and desktop plus ${noScriptRoutes.length} no-JavaScript pages.`);
}
