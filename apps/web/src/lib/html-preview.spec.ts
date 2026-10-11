import {
  buildPreviewDocument,
  hasRemoteImages,
  previewPolicy,
} from './html-preview';

const blocked = { allowRemoteImages: false };
const META_START = '<meta http-equiv="Content-Security-Policy"';

describe('previewPolicy', () => {
  it('blocks scripts, requests, frames and forms', () => {
    const policy = previewPolicy(blocked);
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      'img-src data: cid:',
    ]) {
      expect(policy).toContain(directive);
    }
    expect(policy).not.toMatch(/https?:/);
  });

  it('allows remote images only on request', () => {
    expect(previewPolicy({ allowRemoteImages: true })).toContain(
      'img-src data: cid: https: http:',
    );
  });
});

describe('buildPreviewDocument', () => {
  it('puts the policy first in a fragment', () => {
    const doc = buildPreviewDocument(
      '<p>Hi <img src="https://t.example/x.gif"></p>',
      blocked,
    );
    expect(doc.startsWith(META_START)).toBe(true);
    expect(doc).toContain('<p>Hi');
  });

  it('keeps a leading doctype first so standards mode stays', () => {
    const doc = buildPreviewDocument(
      '<!-- note -->\n<!DOCTYPE html><html><head><title>x</title></head><body>y</body></html>',
      blocked,
    );
    expect(doc).toMatch(
      /^<!-- note -->\n<!DOCTYPE html><meta http-equiv="Content-Security-Policy"/,
    );
    expect(doc).toContain('<head><title>x</title></head>');
  });

  it('precedes anything the email puts before its head', () => {
    const doc = buildPreviewDocument(
      '<img src="https://tracker.example/open.gif"><html><head></head><body>x</body></html>',
      blocked,
    );
    expect(doc.indexOf(META_START)).toBe(0);
  });

  it('removes meta refreshes that a policy cannot block', () => {
    const doc = buildPreviewDocument(
      '<head><META HTTP-EQUIV="Refresh" CONTENT="0; url=https://evil.example"><meta http-equiv=refresh content="1"><meta charset="utf-8"></head>',
      blocked,
    );
    expect(doc).not.toMatch(/refresh/i);
    expect(doc).toContain('<meta charset="utf-8">');
  });

  it('escapes the policy for the attribute', () => {
    expect(buildPreviewDocument('', blocked)).not.toContain(
      'content="default-src "',
    );
  });
});

describe('hasRemoteImages', () => {
  it.each([
    ['<img src="https://a.example/x.png">', true],
    [
      '<img src="cid:logo" srcset="cid:logo 1x, https://a.example/2.png 2x">',
      true,
    ],
    [
      '<picture><source srcset=//cdn.example/x.png><img src="cid:logo"></picture>',
      true,
    ],
    ['<svg><image href="https://cdn.example/logo.svg" /></svg>', true],
    ['<input type="image" src="https://cdn.example/submit.png">', true],
    ["<img alt='' src='//cdn.example/x.png'>", true],
    ['<div style="background: url(http://a.example/b.png)">', true],
    ['<img src="cid:logo">', false],
    ['<img src="data:image/png;base64,AAAA">', false],
    ['<a href="https://example.com">link</a>', false],
  ])('%s -> %s', (html, expected) => {
    expect(hasRemoteImages(html)).toBe(expected);
  });
});
