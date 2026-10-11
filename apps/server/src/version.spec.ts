import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEVELOPMENT_VERSION, findPackageVersion } from './version.js';

describe('findPackageVersion', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-debugger-version-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(file: string, content: unknown) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(content));
  }

  const bundle = (file: string) => pathToFileURL(path.join(root, file)).href;

  it('finds the manifest of the published package above the bundle', () => {
    write('package.json', { name: 'mail-debugger', version: '1.2.3' });
    write('apps/server/package.json', {
      name: '@mail-debugger/server',
      version: '0.0.1',
    });
    expect(findPackageVersion(bundle('apps/server/dist/main.mjs'))).toBe(
      '1.2.3',
    );
  });

  it('finds the manifest of the slim distribution', () => {
    write('package.json', { name: 'mail-debugger-api', version: '4.5.6' });
    expect(findPackageVersion(bundle('dist/main.mjs'))).toBe('4.5.6');
  });

  it('falls back to the development version', () => {
    write('package.json', { name: 'something-else', version: '9.9.9' });
    expect(findPackageVersion(bundle('a/b/c/d/e/f/main.mjs'))).toBe(
      DEVELOPMENT_VERSION,
    );
  });
});
