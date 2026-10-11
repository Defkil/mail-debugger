import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Names of the packages that ship this server. */
const PACKAGE_NAMES = new Set([
  'mail-debugger',
  'mail-debugger-api',
  'mail-debugger-cli',
]);

/** Version reported when no published package manifest is found (source runs). */
export const DEVELOPMENT_VERSION = '0.0.0-development';

/**
 * Finds the version of the distribution this code runs from by walking up
 * from `startUrl` to the nearest manifest of a published mail-debugger
 * package. The bundles live in `apps/server/dist` (mail-debugger) and
 * `dist` (mail-debugger-api), so the manifest is a few levels up.
 */
export function findPackageVersion(startUrl: string): string {
  let directory = path.dirname(fileURLToPath(startUrl));
  for (let depth = 0; depth < 5; depth++) {
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(directory, 'package.json'), 'utf8'),
      ) as { name?: unknown; version?: unknown };
      if (
        typeof manifest.name === 'string' &&
        PACKAGE_NAMES.has(manifest.name) &&
        typeof manifest.version === 'string'
      ) {
        return manifest.version;
      }
    } catch {
      // No readable manifest here; keep looking further up.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return DEVELOPMENT_VERSION;
}

let cachedVersion: string | undefined;

/** Version of the running mail-debugger distribution. */
export function getVersion(): string {
  cachedVersion ??= findPackageVersion(import.meta.url);
  return cachedVersion;
}
