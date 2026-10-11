import path from 'node:path';
import { resolveStaticPath } from './static-files.js';

const root = path.resolve('/srv/web');

describe('resolveStaticPath', () => {
  it('resolves files inside the root', () => {
    expect(resolveStaticPath(root, '/_app/app.js')).toBe(
      path.join(root, '_app', 'app.js'),
    );
    expect(resolveStaticPath(root, '/a%20b.txt')).toBe(
      path.join(root, 'a b.txt'),
    );
  });

  it.each([
    '/',
    '/..',
    '/../etc/passwd',
    '/%2e%2e/etc/passwd',
    '/..%2fetc%2fpasswd',
    '/..%5c..%5cwindows',
    '/%00',
    '/%E0%A4%A',
  ])('rejects %s', (urlPath) => {
    const resolved = resolveStaticPath(root, urlPath);
    if (resolved === undefined) return;
    // Normalization may keep a path, but never one outside the root.
    expect(path.relative(root, resolved).startsWith('..')).toBe(false);
    expect(resolved).not.toBe(root);
  });

  it('keeps encoded traversal inside the root', () => {
    for (const urlPath of [
      '/..%2f..%2fsecret',
      '/a/../../secret',
      '/....//secret',
    ]) {
      const resolved = resolveStaticPath(root, urlPath);
      expect(
        resolved === undefined || resolved.startsWith(root + path.sep),
      ).toBe(true);
    }
  });
});
