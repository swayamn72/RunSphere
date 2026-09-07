# Push and email delivery — the credentials to supply

**Last updated:** 2026-09-07

Both delivery paths are built, tested, and wired into the worker sweep. Neither
sends anything until the credentials below exist, and **that is by design**: an
unconfigured provider logs and drops its events rather than failing them, so the
durable inbox stays the delivery of record (ADR-0009) and no queue fills with
mail nobody can send.

Check what is configured at worker startup:

```
worker.delivery_providers { push: false, email: false }
```

That line is the answer to "why did nothing arrive". `push: true` with nothing
arriving is a different problem from `push: false`.

---

## 1. Push (FCM)

### What is already done

- The FCM HTTP v1 sender, with service-account JWT signing (`push-delivery.ts`).
- Data-only messages: an inbox id and a safe deep link, never a title, body,
  score, or coordinate.
- Server-side suppression by category, quiet hours, and daily cap, recorded in
  `push_dispatches`.
- The device token source (`push-registration.native.ts`), the Android 13+
  runtime permission, and registration on sign-in and session restore.

### What you have to supply

**A Firebase project**, then:

1. **`google-services.json`** — Firebase console → Project settings → your
   Android app (`com.runsphere.app`) → download. Put it at
   `apps/mobile/google-services.json`, or point `GOOGLE_SERVICES_JSON` at it.

   It is **gitignored on purpose**. It is not a secret — it ships inside every
   APK — but it names one specific Firebase project, and a checkout building
   against somebody else's would silently register devices into it.

2. **A service account for the worker** — Firebase console → Project settings →
   Service accounts → Generate new private key. From that JSON:

   ```
   FCM_PROJECT_ID=<project_id>
   FCM_CLIENT_EMAIL=<client_email>
   FCM_PRIVATE_KEY=<private_key>
   ```

   `FCM_PRIVATE_KEY` may carry `\n` escapes; the reader unescapes them.

3. **Rebuild the native app.** `expo-notifications` is a native module, so an
   over-the-air update will not pick it up — the APK has to be rebuilt after
   `google-services.json` is in place.

### Verifying it

Sign in on a device, then:

```sql
SELECT platform, revoked_at FROM push_devices WHERE account_id = '<id>';
```

A row means the address arrived. Then trigger any notification and read
`push_dispatches` — `decision` says `sent` or names the reason it was
suppressed.

---

## 2. Email

### What is already done

- The sender, transactional and campaign, behind one seam (`email-delivery.ts`).
- Suppression checks on both paths, consent re-read at campaign send time, and
  RFC 8058 one-click unsubscribe headers.
- Token rotation at send time, so no plaintext token is ever stored — see
  **Why tokens are minted in the worker** below.
- The signed bounce and complaint webhook (`email-webhook-routes.ts`), which is
  what finally writes to `email_suppressions`.
- Every outcome recorded in `email_dispatches`, with no address and no body.

### What you have to supply

**A provider account and an authenticated sending domain** (SPF, DKIM, DMARC —
without these, password resets land in spam), then:

```
EMAIL_API_URL=https://api.provider.example/emails
EMAIL_API_KEY=<key>
EMAIL_FROM=RunSphere <no-reply@yourdomain>
APP_BASE_URL=https://yourdomain
EMAIL_WEBHOOK_SECRET=<signing secret from the provider console>
```

`APP_BASE_URL` is where the links in transactional mail point, so it must be a
host that serves `/verify-email`, `/reset-password`, `/confirm-email-change`,
`/confirm-deletion`, and `/unsubscribe`.

### The provider contract

`createHttpEmailSender` posts JSON with a bearer key:

```json
{
  "from": "...",
  "to": "...",
  "subject": "...",
  "text": "...",
  "headers": { "List-Unsubscribe": "<...>", "List-Unsubscribe-Post": "..." }
}
```

That is Resend's API closely, Postmark's approximately. **A different provider
is a change to that one function** — the rest of the file knows nothing about
who carries the mail. Response handling: 2xx sends, 429 and 5xx retry under the
outbox attempt budget, any other 4xx suppresses the address.

### Point the webhook at

```
POST https://<api host>/v1/email/provider-events
X-Webhook-Signature: <hex HMAC-SHA256 of the raw body, keyed with EMAIL_WEBHOOK_SECRET>
```

Body: `{ "id": "...", "type": "bounce" | "complaint" | "delivered",
"email": "...", "permanent": true }`.

A provider whose signature scheme differs needs an adapter in
`verifyWebhookSignature`. Without `EMAIL_WEBHOOK_SECRET` the route answers 503
and nothing is accepted — so **suppression stays empty until this is set**, and
an unattended sending domain will eventually stop delivering.

`permanent` matters: a soft bounce (full mailbox, temporary outage) does **not**
suppress, because suppressing on one would lock somebody out of their own
password reset. A complaint always suppresses.

### Verifying it

```sql
SELECT kind, outcome, created_at FROM email_dispatches ORDER BY created_at DESC LIMIT 20;
SELECT email, reason FROM email_suppressions;
```

---

## Why tokens are minted in the worker

Worth knowing before changing any of this, because it looks like indirection
until you see the constraint.

Every token table in this schema stores **only a hash** —
`password_reset_tokens.token_hash`, `email_verification_tokens.token_hash`,
`email_unsubscribe_tokens.token_hash`. The API generates a secret, writes its
digest, and discards the plaintext inside the same statement. That is correct,
and it means **the API cannot hand a token to an email**: by the time anything
could send one, the only copy is gone.

So the worker rotates instead. When a queued event comes up, it writes a fresh
digest over the same row and keeps the new plaintext in memory for exactly one
send. Consequences:

- Nothing durable holds a usable token — not the outbox payload, not a log line,
  not a dispatch record.
- The digest is computed **in Node, not in SQL**. Letting PostgreSQL hash it
  would send the secret as a bind parameter, and `infra/compose.yaml` sets
  `log_min_duration_statement=500` — one slow statement and a live reset token
  is in a database log.
- A link's lifetime starts when the mail goes out, not when the request was
  made, so a backed-up queue cannot eat somebody's reset window.

`email-delivery.integration.test.ts` asserts the Node digest and PostgreSQL's
`encode(digest(...), 'hex')` agree. If they ever diverge, every link in every
email stops validating at once.

---

---

## 3. Route suggestions — the curated dataset

Route suggestions are built and tested end to end, and **the dataset ships
empty**, so `GET /v1/routes/suggest` answers `no_curated_routes` with words
explaining why. Same pattern as the two above: the code is real, the data is
yours to supply.

Unlike FCM and email, this is not a credential. It is **review work**, and it is
the long pole for the feature.

### What a published route needs

Every column in `curated_routes` is required because a reviewer has to have an
opinion on it (`041_curated_routes.sql`):

- the loop geometry, closed, 1–10 km
- `surface`, `lit`, `traffic_exposure`, `accessibility`
- `provenance` — where the geometry came from
- `reviewed_by_account_id` and `reviewed_at`
- `revalidate_after` — `product.md` requires volatile data to be rechecked every
  30 days, and a route past that date stops being offered on its own

The database **refuses to publish a route nobody reviewed**
(`curated_routes_published_is_reviewed`), and refuses a withdrawal that does not
say when and why. Those are the two constraints that make "never suggests routes
through unverified or private land" (`product.md`) true rather than aspirational.

### The design decision worth revisiting

`product.md` says the system "generates a loop shape ... using curated public MMR
paths". **It selects among reviewed loops instead of generating one**, because:

- no routing engine is operational (Valhalla has `serve_tiles: False` and no
  tiles), and
- more importantly, a loop spliced from reviewed segments is **not itself
  reviewed** — so it cannot carry the promise above.

`territory-recommendation.ts` had already refused to invent routes for the same
reason: "a generated line across a motorway would be worse than no suggestion at
all."

Consequence: "reduce the distance" picks a shorter published loop nearby rather
than tightening a line. `map-ux.md` already asks for that shape of behaviour
("each suggestion is a different loop shape, not just a scaled version of the
same one"), so the UI is unaffected — but it means **the dataset needs several
loops per area at different distances** to feel responsive, not one per area.

If you want true generation later, it needs a reviewed routable graph plus a
routing engine, and the review question moves from "is this loop safe" to "is
every edge safe in every combination" — which is a much larger review job, not a
smaller one.

### Also needed

- **A data steward and a review cadence.** `pending-work.md` 3.2 lists both as
  unassigned. The 30-day revalidation rule needs somebody whose job it is.
- **An admin surface.** `pending-work.md` §5 lists "Route suggestion path
  dataset management — Not started". Routes are insertable by SQL today.

---

## Still outstanding

- **The 12-type notification catalogue** (`screens.md`). Five types can be
  produced today — challenge invites and results, and the two Turf season
  types. Carve success and defence, ghost-race notices, quest availability and
  completion, the 3-day season warning, and the streak milestone have no
  producers yet.
- **iOS push.** `expo-notifications` is configured for Android only; iOS needs
  an APNs key and its own entitlement, and is gated behind the Android v1 gates
  anyway (`pending-work.md` §6).
