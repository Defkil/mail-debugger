export interface PreviewOptions {
  /** Load images from http(s) URLs; off by default so opening a mail is not reported. */
  allowRemoteImages: boolean;
}

/**
 * The Content Security Policy of a previewed email: no scripts, no network
 * requests, frames, plugins or form submissions; inline styles and embedded
 * (data:/cid:) images only, plus remote images when allowed.
 */
export function previewPolicy({ allowRemoteImages }: PreviewOptions): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "style-src 'unsafe-inline'",
    'font-src data:',
    'media-src data:',
    allowRemoteImages
      ? 'img-src data: cid: https: http:'
      : 'img-src data: cid:',
  ].join('; ');
}

const LEADING_DOCTYPE =
  /^\u{FEFF}?(\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>)/iu;
const META_REFRESH = /<meta\b[^>]*\bhttp-equiv\s*=\s*(["']?)refresh\1[^>]*>/gi;

/**
 * Turns untrusted email HTML into the `srcdoc` of a sandboxed preview. The
 * policy is the very first element after an optional doctype, so the
 * parser applies it before anything the email contains can load; meta
 * refreshes are removed because a policy cannot block them.
 */
export function buildPreviewDocument(
  html: string,
  options: PreviewOptions,
): string {
  const policy = previewPolicy(options).replaceAll('"', '&quot;');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const cleaned = html.replaceAll(META_REFRESH, '');
  const doctype = LEADING_DOCTYPE.exec(cleaned);
  if (!doctype) return meta + cleaned;
  const end = doctype[0].length;
  return cleaned.slice(0, end) + meta + cleaned.slice(end);
}

/** Whether the email references images on remote servers. */
export function hasRemoteImages(html: string): boolean {
  return (
    /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)
  );
}
