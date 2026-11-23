import type { FastifyInstance } from 'fastify';
import {
  OneClickUnsubscribeQuerySchema,
  type OneClickUnsubscribeQuery
} from '@runsphere/contracts';
import type { Database } from '@runsphere/db';
import { unsubscribeByToken } from './campaign-routes.js';
import { page, readTokenScript, securityHeaders } from './web-page.js';

/**
 * Where the links in TURFR's account emails land (M3.4, B7).
 *
 * The worker (`email-delivery.ts`) links to `/verify-email`, `/reset-password`,
 * `/confirm-email-change` and `/unsubscribe` under `APP_BASE_URL`, which must be
 * the public API origin. Until these pages existed every one of those links was
 * a 404, so an email could never be verified, and safety contacts (which need a
 * verified email on both sides) could never be used. `/confirm-deletion` lives in
 * `account-deletion-pages.ts`.
 *
 * Each page only shows a button or a form; the change happens on the POST it
 * sends to the existing JSON endpoint (see `web-page.ts` for why a GET never
 * acts). The app can still complete each flow from a pasted link (M3.5).
 */

const LINK_USED = 'This link has expired or was already used. Open TURFR and ask for a new one.';
const OFFLINE = "Couldn't reach TURFR. Check your connection and try again.";
const INCOMPLETE = 'This link is incomplete. Open the email again and tap the full link.';

/** A page with one button that posts `{ token }` and reports the answer. */
const confirmButtonPage = (options: {
  title: string;
  intro: string;
  button: string;
  endpoint: string;
  /** Status line per HTTP status; `ok` covers every 2xx. */
  answers: { ok: string } & Record<number, string>;
}): string =>
  page(
    options.title,
    `<p>${options.intro}</p>
<button type="button" id="confirm">${options.button}</button>`,
    `${readTokenScript}
const status = document.getElementById('status');
const button = document.getElementById('confirm');
const answers = ${JSON.stringify(options.answers)};
if (!token) {
  button.disabled = true;
  status.textContent = ${JSON.stringify(INCOMPLETE)};
}
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'One moment…';
  try {
    const response = await fetch(${JSON.stringify(options.endpoint)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (response.ok) {
      button.hidden = true;
      status.textContent = answers.ok;
    } else {
      status.textContent = answers[response.status] || ${JSON.stringify(LINK_USED)};
    }
  } catch {
    button.disabled = false;
    status.textContent = ${JSON.stringify(OFFLINE)};
  }
});`
  );

const verifyEmailPage = confirmButtonPage({
  title: 'Confirm your email',
  intro: 'Tap the button to confirm this is your email address.',
  button: 'Confirm my email',
  endpoint: '/v1/account/email-verification/complete',
  answers: {
    ok: 'Your email is confirmed. Head back to TURFR: you can now add followers and safety contacts.'
  }
});

const confirmEmailChangePage = confirmButtonPage({
  title: 'Confirm your new email',
  intro:
    'Tap the button to move your TURFR account to this address. You will be signed out everywhere and can sign in again with it.',
  button: 'Use this email',
  endpoint: '/v1/account/email-change/complete',
  answers: {
    ok: 'Done. Your account now uses this address. Sign in again with it.',
    409: 'Another account already uses this address. Your account keeps its current one.'
  }
});

// The answer comes from the API (`UNSUBSCRIBE_ANSWER`), so the page shows it as given.
const unsubscribePage = page(
  'Unsubscribe',
  `<p>Tap the button to stop TURFR news and campaign emails. You will still get emails about
your own account, like password resets.</p>
<button type="button" id="confirm">Unsubscribe</button>`,
  `${readTokenScript}
const status = document.getElementById('status');
const button = document.getElementById('confirm');
if (!token) {
  button.disabled = true;
  status.textContent = ${JSON.stringify(INCOMPLETE)};
}
button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'One moment…';
  try {
    const response = await fetch('/v1/email/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const body = response.ok ? await response.json() : undefined;
    if (body && body.message) {
      button.hidden = true;
      status.textContent = body.message;
    } else {
      button.disabled = false;
      status.textContent = 'That didn’t go through. Try again.';
    }
  } catch {
    button.disabled = false;
    status.textContent = ${JSON.stringify(OFFLINE)};
  }
});`
);

// Mirrors `PasswordResetCompleteRequestSchema` (12–256 characters); the API still decides.
const resetPasswordPage = page(
  'Set a new password',
  `<p>Choose a new password of at least 12 characters. Once it's set, you're signed out everywhere and
can sign in with the new one.</p>
<form id="form">
  <label for="password">New password</label>
  <input id="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256">
  <label for="confirm">Type it again</label>
  <input id="confirm" type="password" autocomplete="new-password" required minlength="12" maxlength="256">
  <button type="submit" id="submit">Set new password</button>
</form>`,
  `${readTokenScript}
const form = document.getElementById('form');
const status = document.getElementById('status');
const submit = document.getElementById('submit');
if (!token) {
  submit.disabled = true;
  status.textContent = ${JSON.stringify(INCOMPLETE)};
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const newPassword = document.getElementById('password').value;
  if (newPassword.length < 12) {
    status.textContent = 'Use at least 12 characters.';
    return;
  }
  if (newPassword !== document.getElementById('confirm').value) {
    status.textContent = "Those two don't match. Type the same password in both boxes.";
    return;
  }
  submit.disabled = true;
  status.textContent = 'One moment…';
  try {
    const response = await fetch('/v1/account/password-reset/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword })
    });
    if (response.ok) {
      form.hidden = true;
      status.textContent = 'Your password is changed. Sign in to TURFR with the new one.';
    } else {
      submit.disabled = false;
      status.textContent = ${JSON.stringify(LINK_USED)};
    }
  } catch {
    submit.disabled = false;
    status.textContent = ${JSON.stringify(OFFLINE)};
  }
});`
);

export const EMAIL_LINK_PAGE_PATHS = [
  '/verify-email',
  '/reset-password',
  '/confirm-email-change',
  '/unsubscribe'
] as const;

const pages: Record<(typeof EMAIL_LINK_PAGE_PATHS)[number], string> = {
  '/verify-email': verifyEmailPage,
  '/reset-password': resetPasswordPage,
  '/confirm-email-change': confirmEmailChangePage,
  '/unsubscribe': unsubscribePage
};

export const registerEmailLinkPages = ({
  routes,
  database
}: {
  routes: FastifyInstance;
  database: Database | undefined;
}) => {
  for (const path of EMAIL_LINK_PAGE_PATHS) {
    routes.get(path, { schema: { hide: true } }, async (_request, reply) =>
      reply.headers(securityHeaders).type('text/html; charset=utf-8').send(pages[path])
    );
  }

  /**
   * RFC 8058 one-click unsubscribe. The worker sends `List-Unsubscribe` with
   * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so mail clients POST
   * straight to the emailed link, form-encoded, with the token in the query.
   * The parser is scoped to this route so the rest of the API stays JSON-only.
   * The token in the URL is kept out of logs by `redactUrlSecrets`.
   */
  void routes.register(async (scope) => {
    scope.addContentTypeParser(
      ['application/x-www-form-urlencoded', 'multipart/form-data'],
      { parseAs: 'string', bodyLimit: 1024 },
      (_request, _body, done) => done(null, undefined)
    );
    scope.post<{ Querystring: OneClickUnsubscribeQuery }>(
      '/unsubscribe',
      {
        schema: {
          hide: true,
          querystring: OneClickUnsubscribeQuerySchema
        }
      },
      async (request, reply) => {
        if (!database) return reply.code(503).send({ message: 'Service unavailable' });
        const answer = await unsubscribeByToken(database, request.query.token);
        return reply
          .headers(securityHeaders)
          .type('text/plain; charset=utf-8')
          .send(answer.message);
      }
    );
  });
};
