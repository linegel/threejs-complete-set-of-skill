const REMOTE_URL = /^https?:\/\//i;

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1] ?? '';
}

export function remoteRuntimeAssetViolations(html, documentId = 'document') {
  const violations = [];
  const runtimeTags = [...String(html).matchAll(/<(script|link|img|source|video|audio|iframe)\b[^>]*>/gi)];

  for (const match of runtimeTags) {
    const [tag, tagNameRaw] = match;
    const tagName = tagNameRaw.toLowerCase();
    let urls = [];

    if (tagName === 'script') {
      urls = [attribute(tag, 'src')];
    } else if (tagName === 'link') {
      const rel = attribute(tag, 'rel').toLowerCase().split(/\s+/);
      if (rel.some((value) => ['stylesheet', 'preload', 'modulepreload', 'preconnect', 'dns-prefetch'].includes(value))) {
        urls = [attribute(tag, 'href')];
      }
    } else {
      urls = [
        attribute(tag, 'src'),
        ...attribute(tag, 'srcset').split(',').map((candidate) => candidate.trim().split(/\s+/)[0]),
      ];
    }

    for (const url of urls.filter((value) => REMOTE_URL.test(value))) {
      violations.push(`${documentId} loads remote runtime asset ${url}`);
    }
  }

  if (/url\(\s*["']?https?:\/\//i.test(html)) {
    violations.push(`${documentId} loads a remote CSS asset`);
  }
  if (/\b(?:fetch|import)\(\s*["']https?:\/\//i.test(html)) {
    violations.push(`${documentId} loads a remote script asset`);
  }

  return violations;
}
