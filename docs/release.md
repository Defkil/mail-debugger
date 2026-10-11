# Releasing

`mail-debugger`, `mail-debugger-api` and `mail-debugger-cli` are released together, with the same version, from one tag on `main`. Pushing the tag starts [`publish.yml`](../.github/workflows/publish.yml), which runs every gate again and publishes the tarballs it tested to npm with trusted publishing and provenance. Only maintainers release.

## How the pipeline protects a release

- The workflow accepts only stable tags `vMAJOR.MINOR.PATCH`; pre-releases need a dist-tag policy first. Manual runs are allowed only from `main` and only for an existing tag.
- `scripts/verify-release.mjs` requires the tag commit to be the checked-out commit and part of `origin/main`, all three package versions to equal the tag, and `CHANGELOG.md` to have a dated section for the version.
- `pnpm verify` runs formatting, `pnpm audit --prod`, lint, typecheck, unit tests, builds, end-to-end tests and the smoke test, which packs the three tarballs into `$RUNNER_TEMP/release`, checks their contents and runs them installed.
- `scripts/publish-tarballs.mjs` publishes exactly those tarballs with npm 12.2.0 through OIDC: no npm token exists in the repository. Before any upload it looks all three versions up on the registry: a missing version is published, a version with the same tarball integrity is skipped, a version with other contents or missing integrity stops the run. A failed or malformed registry response also stops the run before any upload.

The npm packages trust this repository and the workflow file name `publish.yml` without a GitHub environment. Renaming the workflow or adding an environment requires changing the trusted publisher of all three packages on npmjs.com first.

## Checklist

1. **Before the release**
   - `main` contains everything for the release, and CI on `main` is green.
   - The three manifests (`package.json`, `packages/api/package.json`, `packages/cli/package.json`) carry the new version.
   - `CHANGELOG.md` has `## [X.Y.Z] - YYYY-MM-DD` with the release date and the compare links at the bottom; `[Unreleased]` is empty.
   - On npmjs.com, each of the three packages has the trusted publisher `Defkil/mail-debugger`, workflow `publish.yml`, no environment, with direct `npm publish` allowed. [npm's trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/) explains these settings; newer configurations default to staged publishing, while this workflow publishes directly.
   - Private vulnerability reporting is enabled in the repository settings (SECURITY.md links to it).
2. **Tag and push**

   ```sh
   git switch main
   git pull --ff-only
   git tag -a vX.Y.Z -m "mail-debugger X.Y.Z"
   node scripts/verify-release.mjs vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Watch** the "Publish to npm" run. It takes about five minutes.
4. **Check the result**
   - `npm view mail-debugger@X.Y.Z version`, and the same for `mail-debugger-api` and `mail-debugger-cli`.
   - The npm page of each version shows the provenance statement linking to the workflow run.
   - `npx --yes mail-debugger@X.Y.Z --version` prints the version; `npx --yes mail-debugger-cli@X.Y.Z --help` works.
5. **Publish the release notes**: create a GitHub release from the tag with the changelog section.

## When something fails

- **Before publishing** (a gate failed): nothing was published. Fix the problem on `main` with a new commit; since the tag points to the old commit, release a new patch version with a new tag rather than moving the tag.
- **During publishing** (the run lists what it published and what not): rerun the failed job, or start the workflow manually from `main` with the same tag. Versions already on npm with the same tarball are skipped, so the rerun publishes only the missing packages. If the rebuilt tarball differs from the published one, the run stops instead; then compare the two before deciding, and never unpublish or overwrite a version on npm.
- **After publishing** (a broken release): publish a fixed patch release. Use `npm deprecate` for the broken version only after a maintainer decided it.

## Maintenance

- **Dependencies** are exact pins, updated deliberately in reviewed batches: read the release notes, update the lockfile with the pinned pnpm, run `pnpm verify` and keep `pnpm audit --prod` clean. There are no automated update bots. Install scripts of new dependencies must be allowed or denied in `pnpm-workspace.yaml`.
- **Actions** are pinned to full commit SHAs with the version in a comment. Resolve a new version with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha`.
- **Runner image**: all jobs use `ubuntu-24.04` rather than `ubuntu-latest`, which GitHub moves to Ubuntu 26.04 from 2026-10-19, so that CI and releases run on the image the gates last passed on. Move to `ubuntu-26.04` in a separate change once one CI run on it is green; the trusted publishers do not depend on the image.
- **Node.js**: CI tests the engines floor (22.17.0), the latest 22, 24 and 26. Raising the floor is a breaking change for the changelog.
