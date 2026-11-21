/**
 * The shell shared by the few HTML pages the API serves: the web deletion path
 * (`account-deletion-pages.ts`) and the pages email links land on
 * (`email-link-pages.ts`).
 *
 * Every page is self-contained: no fonts, scripts or analytics from elsewhere,
 * so a visit never leaks to a third party, and the CSP below forbids loading
 * anything at all. A GET never changes data, because mail providers and link
 * scanners prefetch URLs in messages; each page acts only on a button press,
 * and the token travels in a POST body, which pino already redacts.
 */

export const page = (title: string, body: string, script: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${title} · RunSphere</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem;
         line-height: 1.5; color: #12201a; background: #f6faf7; }
  h1 { font-size: 1.5rem; }
  label { display: block; margin: 1rem 0 0.25rem; font-weight: 600; }
  input { width: 100%; box-sizing: border-box; padding: 0.6rem; font-size: 1rem; }
  button { margin-top: 1rem; padding: 0.7rem 1.2rem; font-size: 1rem; border: 0; border-radius: 6px;
           background: #14532d; color: #fff; cursor: pointer; }
  button.danger { background: #b3261e; }
  button[disabled] { opacity: 0.6; cursor: default; }
  .note { color: #44544c; font-size: 0.95rem; }
  .draft { padding: 0.6rem 0.8rem; border-radius: 6px; background: #fff4d6; color: #4a3500; }
  h2 { font-size: 1.15rem; margin-top: 1.8rem; }
  li { margin: 0.35rem 0; }
  [role="status"] { margin-top: 1rem; font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
${body}
<p role="status" id="status" aria-live="polite"></p>
</main>
<script>${script}</script>
</body>
</html>`;

/**
 * Read `?token=` once, then take it out of the address bar so it is not left in
 * history or shared by copy-paste. Pages put this at the top of their script.
 */
export const readTokenScript = `
const token = new URLSearchParams(window.location.search).get('token') || '';
window.history.replaceState(null, '', window.location.pathname);`;

export const securityHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // Inline script and style only; nothing may be loaded from elsewhere, and
  // fetch may only reach this origin.
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
} as const;
