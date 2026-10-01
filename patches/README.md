# patches/

Patches applied automatically on every `npm install` via the root `postinstall`
script (`patch-package`). Currently empty — no active patches.

## Removed: `@nestjs+swagger++js-yaml+5.2.3.patch`

Existed to work around `@nestjs/swagger@11.4.6` pinning its own `js-yaml` to
the vulnerable `5.2.1` ([GHSA-pm4m-ph32-ghv5](https://github.com/advisories/GHSA-pm4m-ph32-ghv5)),
since the `overrides` field couldn't reach it (confirmed npm bug, see below).

Removed because `npm audit fix` at the workspace root (non-breaking) bumped
`@nestjs/swagger` to `11.4.7`, whose own `package.json` now pins `js-yaml` to
`5.3.0` directly — already past the `5.2.2` fix threshold for
GHSA-pm4m-ph32-ghv5, no patch needed anymore. This is exactly the scenario the
patch's own note anticipated: "if npm ever fixes this, the override will
start working on its own... at that point this patch and this note should
just be deleted" — same outcome here, just via an upstream version bump
instead of an npm fix. Confirmed by `patch-package` itself erroring on
`npm install` ("js-yaml has changed since you made the patch file... Maybe
this means your patch file is no longer necessary").

The matching `GHSA-pm4m-ph32-ghv5` exception was removed from every
`services/*/.nsprc` — `better-npm-audit` no longer reports it, and explicitly
flagged the old entry as an unused exception once it stopped matching.

**`js-yaml` 5.3.0 is still moderately vulnerable** to
[GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm)
(fixed in `5.4.1`) via the same nested path
(`@nestjs/swagger > js-yaml`), for the same root cause (exact version pin,
`overrides` doesn't reach it). Left undocumented in `.nsprc` on purpose: it's
`moderate`, not `high`, so it doesn't fail the CI gate
(`better-npm-audit --level high`). If `@nestjs/swagger` doesn't ship a release
depending on `js-yaml >= 5.4.1` before this needs to be `high`-gated too (or
before a stricter audit level is adopted), repeat this same patch-package
technique against `5.4.1`:

```sh
rm -rf node_modules/@nestjs/swagger/node_modules/js-yaml
# replace with a verified js-yaml@5.4.1 (or newer patched version) checkout
npx patch-package @nestjs/swagger/js-yaml
```

**Why a patch and not `overrides`:** the root `package.json` *does* declare
`"@nestjs/swagger": { "js-yaml": "^5.2.3" }` in `overrides` — the
textbook-correct way to force this. It doesn't work: this is a confirmed,
currently-unfixed npm bug where `overrides` fail to propagate into a nested
dependency reached through a workspace package
(`@sgd/common` → `@nestjs/swagger` → `js-yaml`). Verified directly against
this repo (clean `rm -rf node_modules && npm install`, with and without a
manually-added `overrides` mirror in the lockfile's root entry, with both the
bare-name and version-pinned override key syntax). See npm/cli issues
[#4834](https://github.com/npm/cli/issues/4834),
[#4205](https://github.com/npm/cli/issues/4205), and
[#7660](https://github.com/npm/cli/issues/7660) for the upstream bug reports.
The `overrides` entry is left in `package.json` anyway (harmless, and starts
working on its own if npm ever fixes this).
