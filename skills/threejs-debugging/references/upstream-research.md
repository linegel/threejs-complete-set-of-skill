# Upstream Research

Use this procedure after the local debug record identifies the installed
revision, suspect APIs, backend, and reproducible symptom. Search is a diagnostic
operation, not background context for unrelated scene work.

## Source Order

Use primary evidence in this order:

1. resolved installed package source, exports, types, tests, and examples;
2. official documentation and migration material for the installed revision;
3. official `mrdoob/three.js` issues, pull requests, commits, blame, tests, tags,
   releases, and current source;
4. the npm package registry for published-version availability and package
   contents;
5. external web results only to discover primary evidence or compare independent
   reproductions.

Do not use a search-result excerpt, forum summary, generated cheat sheet, or
remembered issue number as fix proof.

## Search Construction

Search both open and closed issues and both merged and unmerged pull requests.
Start from identifiers present in the repro:

```text
repo:mrdoob/three.js is:issue "APIName" symptom
repo:mrdoob/three.js is:pr "APIName" symptom
repo:mrdoob/three.js "exact console error"
repo:mrdoob/three.js path:src "symbolName"
```

Vary one axis at a time: API/class, renderer/backend, observable symptom, error
text, and suspected lifecycle transition. Search removed and renamed symbols in
migration notes and commit history. Use GitHub, an available GitHub connector or
CLI, and internet search as access paths; the cited evidence must still resolve
to official source.

For a local Three.js checkout, inspect history directly when useful:

```bash
git log -S 'symbolName' -- path/to/suspect/source.js
git log -G 'relevantPattern' -- path/to/suspect/source.js
git blame -L <start>,<end> path/to/suspect/source.js
git tag --contains <fixing-commit>
git branch -r --contains <fixing-commit>
```

Use `-S` for changes in occurrence count and `-G` for diffs matching a pattern.
Inspect the commit diff and adjacent tests; a matching commit message alone is
insufficient.

## Fix And Release Proof

For every credible candidate, record:

- issue and PR URLs, status, labels, duplicates, and maintainer conclusion;
- exact matching and differing conditions between upstream and local repros;
- affected or first-bad revision, with evidence quality;
- fixing commit and target branch;
- tags containing the fixing commit;
- first published npm version whose package contents contain the fix;
- installed and candidate-fixed repro results.

Query the registry when publication status matters:

```bash
npm view three versions --json
npm view three@<version> dist.tarball gitHead
```

Do not assume a revision-to-semver mapping from naming convention alone. Check
the package metadata and runtime `THREE.REVISION`. A fix can be merged to `dev`,
excluded from a release branch, superseded, reverted, or present in source while
the tested bundle resolves another package copy.

## Version Matrix

Keep environment variables fixed and change one Three.js version at a time:

| Candidate | Package | Runtime revision | Contains fix | Repro result | Meaning |
| --- | --- | --- | --- | --- | --- |
| installed | exact | measured | yes/no/unknown | pass/fail | local baseline |
| last known good | exact | measured | no | pass/fail | regression bound |
| first bad | exact | measured | no | pass/fail | regression bound |
| fixing commit | commit build | measured | yes | pass/fail | patch causality |
| first fixed release | exact | measured | yes | pass/fail | upgrade proof |
| current checked | exact | measured | yes/no | pass/fail | present upstream state |

Do not mix browser, GPU, renderer backend, import entrypoint, build flags, assets,
or scene state across rows. When exact hardware reproduction is unavailable,
state that limitation instead of generalizing.

## Stop Conditions

Stop searching when one conclusion has direct local and upstream proof, or when
all available candidates are classified and the missing evidence is explicit.
Do not keep collecting loosely related issues after the root cause and action are
settled. Do not declare an engine defect solely because local hypotheses failed;
current-source reproduction or equivalent upstream evidence is still required.
