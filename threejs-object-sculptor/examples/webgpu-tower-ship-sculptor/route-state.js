function pathnameRoute(pathname, kind) {
  const match = String(pathname).match(new RegExp(`/${kind}/([^/]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function reconcileRoute(kind, queryValue, pathnameValue) {
  if (queryValue && pathnameValue && queryValue !== pathnameValue) {
    throw new RangeError(`Conflicting ${kind} route "${pathnameValue}" and query "${queryValue}"`);
  }
  return queryValue ?? pathnameValue ?? null;
}

export function towerShipRouteFromLocation({ pathname = '', search = '' } = {}) {
  const params = new URLSearchParams(search);
  return Object.freeze({
    mechanism: reconcileRoute('mechanism', params.get('mechanism'), pathnameRoute(pathname, 'mechanism')),
    tier: reconcileRoute('tier', params.get('tier'), pathnameRoute(pathname, 'tier')),
  });
}

export function towerShipInitialMode(route) {
  return route?.mechanism ?? 'interaction';
}
