export function buildSiteRoutePresentation(fixtures, routeId, titleBySkill = {}) {
  if (!fixtures || typeof fixtures !== 'object') throw new TypeError('router fixtures must be an object');
  if (!Array.isArray(fixtures.routes)) throw new TypeError('router fixtures must declare routes');

  const fixture = fixtures.routes.find((route) => route.id === routeId);
  if (!fixture) throw new Error(`router fixture is missing: ${routeId}`);

  const selectedSkills = fixture.route?.selectedSkills;
  const primaryOwner = fixture.route?.primaryOwner;
  if (!Array.isArray(selectedSkills) || selectedSkills.length === 0) {
    throw new Error(`router fixture has no selected skills: ${routeId}`);
  }
  if (typeof primaryOwner !== 'string' || !selectedSkills.includes(primaryOwner)) {
    throw new Error(`router fixture has an invalid primary owner: ${routeId}`);
  }
  if (fixture.expected && fixture.expected.verdict !== 'PASS') {
    throw new Error(`router fixture is not a positive presentation route: ${routeId}`);
  }

  return {
    id: fixture.id,
    title: fixture.title,
    primaryOwner,
    primaryOwnerTitle: titleBySkill[primaryOwner] ?? primaryOwner,
    selectedSkills: selectedSkills.map((skill) => ({
      id: skill,
      title: titleBySkill[skill] ?? skill,
    })),
  };
}
