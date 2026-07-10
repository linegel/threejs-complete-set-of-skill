#!/usr/bin/env node
import { chromium } from 'playwright';

const SITE = new URL(process.env.SITE_URL ?? 'https://threejs-skills.com/');
const routes = ['/', '/skills/threejs-choose-skills.html', '/skills/threejs-water-optics.html'];
const errors = [];
const warnings = [];
const reports = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
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

  for (const route of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'failed'})`));

    const url = new URL(route, SITE).href;
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    assert(response?.status() === 200, `${route}: expected 200, received ${response?.status() ?? 'no response'}`);
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
    reports.push({ route, ...report, consoleErrors: consoleErrors.length, failedRequests: failedRequests.length });

    assert(report.h1 === 1, `${route}: expected one h1, found ${report.h1}`);
    assert(report.main === 1, `${route}: expected one main landmark, found ${report.main}`);
    assert(report.landmarks >= 4, `${route}: incomplete semantic landmark structure`);
    assert(report.links > 5, `${route}: insufficient crawlable links`);
    assert(report.horizontalOverflow <= 1, `${route}: ${report.horizontalOverflow}px horizontal overflow at mobile width`);
    assert(report.visibleBrokenImages.length === 0, `${route}: broken visible images (${report.visibleBrokenImages.join(', ')})`);
    assert(report.imagesWithoutDimensions.length === 0, `${route}: images lack intrinsic dimensions (${report.imagesWithoutDimensions.slice(0, 3).join(', ')})`);
    assert(consoleErrors.length === 0, `${route}: console errors (${consoleErrors.join(' | ')})`);
    assert(failedRequests.length === 0, `${route}: failed requests (${failedRequests.join(' | ')})`);
    assert(report.vitals.cls <= 0.1, `${route}: CLS ${report.vitals.cls.toFixed(3)} exceeds 0.1`);
    if (report.vitals.lcp > 4_000) warnings.push(`${route}: observed LCP ${Math.round(report.vitals.lcp)}ms`);
    if (report.ttfbMs > 800) warnings.push(`${route}: observed TTFB ${Math.round(report.ttfbMs)}ms`);
    if (report.transferBytes > 3_000_000) warnings.push(`${route}: transferred ${(report.transferBytes / 1_000_000).toFixed(2)}MB before scrolling`);
    await page.close();
  }
  await context.close();

  const noScript = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false,
    isMobile: true,
  });
  const page = await noScript.newPage();
  const response = await page.goto(SITE.href, { waitUntil: 'load', timeout: 30_000 });
  assert(response?.status() === 200, 'no-JavaScript homepage did not return 200');
  assert(await page.locator('h1').count() === 1, 'no-JavaScript homepage lost its h1');
  assert(await page.locator('main').innerText().then((text) => text.length) > 3_000, 'no-JavaScript homepage lacks substantial crawlable content');
  assert(await page.locator('a[href]').count() > 50, 'no-JavaScript homepage lacks crawlable navigation');
  await noScript.close();
} finally {
  await browser.close();
}

for (const report of reports) {
  console.log(`${report.route}: LCP=${Math.round(report.vitals.lcp)}ms CLS=${report.vitals.cls.toFixed(3)} TTFB=${Math.round(report.ttfbMs)}ms transfer=${(report.transferBytes / 1_000_000).toFixed(2)}MB resources=${report.resourceCount} third-party=${report.thirdPartyResources}`);
}
for (const warning of warnings) console.warn(`warning: ${warning}`);
if (errors.length) {
  console.error(`Live presentation audit failed (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Live presentation audit passed for ${reports.length} mobile pages plus the no-JavaScript homepage.`);
}
