export function authoritativeSiteSkillSlugs(registry, primaryKinds) {
  if (!registry || typeof registry !== 'object') throw new TypeError('demo registry must be an object');
  if (!Array.isArray(registry.demos)) throw new TypeError('demo registry must declare demos');
  if (!Array.isArray(primaryKinds) || primaryKinds.length === 0) {
    throw new TypeError('primary demo kinds must be a non-empty array');
  }

  const primaryKindSet = new Set(primaryKinds);
  const slugs = new Set(registry.demos
    .filter((demo) => primaryKindSet.has(demo.kind))
    .map((demo) => demo.skill));
  if (slugs.has(undefined) || slugs.has(null) || slugs.has('')) {
    throw new Error('primary demo registry contains an invalid skill owner');
  }
  return slugs;
}
