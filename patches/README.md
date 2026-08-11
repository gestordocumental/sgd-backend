# patches/

Patches applied automatically on every `npm install` via the root `postinstall`
script (`patch-package`).

## `@nestjs+swagger++js-yaml+5.2.3.patch`

**Why this exists:** `@nestjs/swagger@11.4.6` pins its own `js-yaml` dependency
to an exact version, `5.2.1`, which is vulnerable to
[GHSA-pm4m-ph32-ghv5](https://github.com/advisories/GHSA-pm4m-ph32-ghv5) —
"Exponential parsing time in flow collections leads to denial of service"
(CWE-407, CVSS 7.5, affects `>=5.0.0 <=5.2.1`, fixed in `5.2.2`). No newer
stable `@nestjs/swagger` release exists yet that depends on a patched
`js-yaml` (checked: `11.4.6` is the latest stable; only `12.0.0-alpha.*`
pre-releases exist).

**Why it's a patch and not the `overrides` field in `package.json`:** the root
`package.json` *does* declare `"@nestjs/swagger": { "js-yaml": "^5.2.3" }` in
`overrides` — that's the textbook-correct way to force this. It doesn't work:
this is a confirmed, currently-unfixed npm bug where `overrides` fail to
propagate into a nested dependency reached through a workspace package
(`@sgd/common` → `@nestjs/swagger` → `js-yaml`). Verified directly against
this repo (clean `rm -rf node_modules && npm install`, with and without a
manually-added `overrides` mirror in the lockfile's root entry, with both the
bare-name and version-pinned override key syntax) — `js-yaml` under
`@nestjs/swagger` stays at `5.2.1` every time. See npm/cli issues
[#4834](https://github.com/npm/cli/issues/4834),
[#4205](https://github.com/npm/cli/issues/4205), and
[#7660](https://github.com/npm/cli/issues/7660) for the upstream bug reports.

The `overrides` entry is left in `package.json` anyway (harmless today, since
npm ignores it here) — if npm ever fixes this, the override will start
working on its own. If that happens, this patch will fail to apply (its base
state assumes `js-yaml@5.2.1`, which would no longer be what's installed) and
`patch-package` will error loudly on `npm install`; at that point this patch
and this note should just be deleted.

**What the patch does:** replaces the entire content of
`node_modules/@nestjs/swagger/node_modules/js-yaml` — including its
`package.json`'s own `version` field — with the real, published
`js-yaml@5.2.3` package (downloaded from the npm registry and verified against
its official `dist.integrity` hash before diffing). Not just a version bump:
the actual fixed source (verified the patched `dist/*` files byte-for-byte
identical to the real published `5.2.3` tarball).

**Known limitation:** this patches files on disk *after* npm's own install
bookkeeping is done, so `package-lock.json` still records the resolved
`5.2.1` metadata, and `npm audit` / Dependabot / similar tools that only read
lockfile metadata will keep reporting this as present even though the actual
executed code is `5.2.3`. The runtime risk is genuinely eliminated; the
manifest-level noise isn't. If that false positive becomes a problem (e.g. a
CI gate on `npm audit`), it'll need an explicit audit exception referencing
this file instead.

**Regenerating it** (e.g. after `npm update` touches `@nestjs/swagger`):

```sh
rm -rf node_modules/@nestjs/swagger/node_modules/js-yaml
# replace with a verified js-yaml@5.2.3 (or newer patched version) checkout
npx patch-package @nestjs/swagger/js-yaml
```
