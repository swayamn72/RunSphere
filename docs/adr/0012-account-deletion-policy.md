# ADR-0012: Account deletion — prompt, verified, complete erasure

- **Status:** Accepted
- **Date:** 2026-11-20
- **Decided by:** product owner ("make account deletion comply with the laws")

## Context

The code and the user-facing copy disagreed about deletion:

- `DELETE /v1/account` (the in-app path) needed only a bearer token, did not sign other devices out,
  and the worker erased the account on its next sweep.
- The confirmation email promised "a 30-day waiting period, and signing in to RunSphere cancels it".
  Neither existed.
- The public (web) deletion path required by Google Play existed only as JSON endpoints, and the
  email's confirmation link pointed at a page that did not exist.
- The erasure left one address-keyed table (`public_deletion_requests`) holding the deleted
  person's email address.

RunSphere launches in India and runs territory globally, so the relevant obligations are:

- **India — Digital Personal Data Protection Act, 2023 (DPDP) and DPDP Rules, 2025.** A data
  principal may request erasure (s.12). A fiduciary must erase personal data when consent is
  withdrawn or the purpose is no longer served, unless retention is necessary for compliance with
  law (s.8(7)), and must use reasonable security safeguards (s.8(5)).
- **EU/UK GDPR** (for users there). Right to erasure "without undue delay" (Art. 17), acted on
  within one month (Art. 12(3)), with reasonable steps to verify the requester's identity
  (Art. 12(6)) and appropriate security (Art. 32).
- **Google Play User Data policy (account deletion).** Apps that let people create accounts must
  offer deletion **in the app and through a web link usable without the app**, must delete the
  associated data, and must disclose anything retained and why.

## Decision

1. **No grace period.** Once a verified request is accepted, the account is withdrawn at once and
   erased on the worker's next sweep (minutes). This is the simplest posture that unambiguously
   meets "without undue delay" and the one-month limit, and it avoids holding data for a period
   no law requires. Signing in does **not** cancel a request. Login treats an account with a
   pending erasure exactly like an unknown address.
2. **Identity is verified before erasure.**
   - In app: the **current password** is required (`AccountDeletionRequestSchema`). A wrong password
     returns 403 and changes nothing. Attempts are rate-limited per account.
   - On the web: possession of the account's **email address** is proven through the existing
     24-hour single-use token (`/v1/account/deletion-request` → email → `/confirm-deletion`).
3. **Immediate withdrawal on acceptance.** Every refresh-token family is revoked (signed out
   everywhere), active safety shares are revoked, and the profile becomes private, all in the same
   transaction that records the request.
4. **Complete erasure.** `convergeAccountDeletion` deletes the account row, and with it every
   account-keyed table via `ON DELETE CASCADE` (verified for every foreign key to `accounts`).
   It also explicitly removes the address-keyed rows (`safety_contacts` by email,
   `public_deletion_requests`). Owned clubs are archived so they are not left ownerless.
5. **What is retained, and why** (disclosed on the deletion pages and in-app):
   - `account_deletion_tombstones` (account id and time only), to prevent abuse such as re-using
     a sanctioned identity, and as the record that the request was honoured.
   - `email_suppressions` entries for addresses that bounced, complained, or opted out, so a past
     objection to email stays honoured.
   - `staff_audit_events` keep their rows with the staff reference set to `NULL`.
   - Data already irreversibly anonymised (aggregate analytics, ML features with no identifiers).
6. **Web path.** The API serves two self-contained pages, `GET /account/delete` (request) and
   `GET /confirm-deletion` (confirm). Neither deletes on GET; confirmation needs a button press, so
   mail-scanner prefetches cannot erase an account. They load nothing from third parties and send
   `Cache-Control: no-store`, a strict CSP and `Referrer-Policy: no-referrer`. `APP_BASE_URL` must
   be the public API origin so the email link lands on them.

## Consequences

- An accidental deletion cannot be undone. The in-app screen and the email say so plainly, and the
  password requirement is the safeguard against mistakes and stolen tokens.
- An access token minted before the request stays valid for up to 15 minutes (it is stateless).
  It can no longer be refreshed, and the account is erased within minutes, after which its
  requests find nothing.
- The Privacy Notice must state the retention list above before public launch. This ADR is an
  engineering reading of the law, **not legal advice**: have counsel confirm it, including any
  sector-specific retention duty (e.g. tax or payment records once payments exist).

## Verification

- `services/api/src/account-deletion.test.ts`: password required and checked, sessions revoked,
  login refused during a pending erasure, web pages never touch data on GET.
- `services/worker/src/account-deletion.integration.test.ts` (PostGIS): request → refresh fails →
  login fails → erasure → no account, zones, consent, sessions, audit, or address-keyed request
  rows remain; the tombstone exists.
- `services/worker/src/email-delivery.test.ts`: the deletion email promises no waiting period.
