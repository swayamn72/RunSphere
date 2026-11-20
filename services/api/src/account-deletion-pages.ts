import type { FastifyInstance } from 'fastify';

/**
 * The public, web-based account-deletion path (ADR-0012).
 *
 * Google Play requires apps that support account creation to let people
 * request deletion from the web as well as in the app, so somebody who has
 * uninstalled RunSphere, or lost the phone, can still have their data erased.
 * The JSON endpoints already exist (`/v1/account/deletion-request` and
 * `/complete`); these two pages are the human front door to them, and the
 * second is where the confirmation email's link lands.
 *
 * Deliberate choices:
 *
 * - **A GET never deletes anything.** Mail providers and link scanners
 *   prefetch URLs in messages. The confirmation page only shows a button;
 *   erasure happens on the POST that button sends.
 * - **No external resources.** No fonts, scripts, or analytics: a page about
 *   deleting your data must not leak that visit to a third party.
 * - **The token stays out of logs.** It travels in the POST body, never in a
 *   URL the server builds, and pino already redacts `req.body.token`.
 * - **The request page never reveals whether an address has an account.** The
 *   API answers the same either way, and so does this page.
 *
 * These are served by the API, so `APP_BASE_URL` (used for email links) must
 * point at the public API origin for the confirmation link to land here.
 */

const page = (title: string, body: string, script: string): string => `<!doctype html>
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
           background: #b3261e; color: #fff; cursor: pointer; }
  button[disabled] { opacity: 0.6; cursor: default; }
  .note { color: #44544c; font-size: 0.95rem; }
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

const erasureSummary = `<p class="note">Deleting your account erases your profile, runs and routes,
territory claims, XP, achievements, friends, clubs, and safety contacts. A minimal record that an
account was deleted is kept to prevent abuse, and an address that bounced or complained stays on our
do-not-email list. Deletion cannot be undone.</p>`;

const requestPage = page(
  'Delete your RunSphere account',
  `<p>Enter the email address of your RunSphere account. If an account exists, we will email a link
to confirm the deletion. The link works for 24 hours.</p>
${erasureSummary}
<p class="note">You can also delete your account in the app: Profile → Account and data → Delete my
account.</p>
<form id="form">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" autocomplete="email" required maxlength="320">
  <button type="submit" id="submit">Send confirmation link</button>
</form>`,
  `
const form = document.getElementById('form');
const status = document.getElementById('status');
const submit = document.getElementById('submit');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  status.textContent = 'Sending…';
  try {
    const response = await fetch('/v1/account/deletion-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value })
    });
    status.textContent = response.status === 429
      ? 'Too many attempts. Please wait a minute and try again.'
      : response.ok
        ? 'If an account exists for that address, a confirmation link is on its way.'
        : 'Something went wrong. Please try again.';
  } catch {
    status.textContent = 'Could not reach RunSphere. Check your connection and try again.';
  } finally {
    submit.disabled = false;
  }
});`
);

const confirmPage = page(
  'Confirm account deletion',
  `<p>Press the button below to permanently delete your RunSphere account. You will be signed out
everywhere and your data will be erased within minutes.</p>
${erasureSummary}
<button type="button" id="confirm">Delete my account permanently</button>`,
  `
const status = document.getElementById('status');
const button = document.getElementById('confirm');
const token = new URLSearchParams(window.location.search).get('token') || '';
// Take the token out of the address bar so it is not left in history or shared by copy-paste.
window.history.replaceState(null, '', window.location.pathname);
if (!token) {
  button.disabled = true;
  status.textContent = 'This link is incomplete. Request a new one from the deletion page.';
}
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Deleting…';
  try {
    const response = await fetch('/v1/account/deletion-request/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (response.ok) {
      button.hidden = true;
      status.textContent = 'Your account is being deleted. You have been signed out everywhere.';
    } else {
      status.textContent = 'This link has expired or was already used. Request a new one from the deletion page.';
    }
  } catch {
    button.disabled = false;
    status.textContent = 'Could not reach RunSphere. Check your connection and try again.';
  }
});`
);

const securityHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // Inline script and style only; nothing may be loaded from elsewhere, and
  // fetch may only reach this origin.
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
} as const;

export const ACCOUNT_DELETION_PAGE_PATHS = ['/account/delete', '/confirm-deletion'] as const;

export const registerAccountDeletionPages = ({ routes }: { routes: FastifyInstance }) => {
  routes.get('/account/delete', { schema: { hide: true } }, async (_request, reply) =>
    reply.headers(securityHeaders).type('text/html; charset=utf-8').send(requestPage)
  );
  routes.get('/confirm-deletion', { schema: { hide: true } }, async (_request, reply) =>
    reply.headers(securityHeaders).type('text/html; charset=utf-8').send(confirmPage)
  );
};
