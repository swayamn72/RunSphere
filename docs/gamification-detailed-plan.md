# Gamified Product Expansion — Detailed Implementation Plan

**Status:** Phase 1 (Foundation Gate) complete. Phase 2 (MVP) complete: milestones 2.1 through 2.9 are implemented. Phase 3 (Community Beta) has started: milestones 3.1 (clubs) and 3.2 (club relays) are implemented.
**Purpose:** This document provides a detailed, technical breakdown of the remaining work for the gamified product expansion so that multiple contributors can pick up milestones and work in parallel.

---

## ✅ Phase 1: Foundation Gate (Completed in PR #8)

The safe gameplay substrate has been merged into `main`. It includes:

- **Contracts:** TypeBox schemas for social, notifications, progression, challenges, clubs, competitions, territory, legal, and campaigns.
- **Database:** Migrations 011-017 for profiles, friends, blocks, inbox, preferences, weekly periods, rules, RBAC, progression ledger, and achievements.
- **Domain:** Pace-neutral scoring, Asia/Kolkata weekly periods, progression/achievement evaluation.
- **API:** Fastify routes for profiles, friends/blocks, notifications, account lifecycle, progression, and achievements.
- **Worker:** Fan-out scaffolding for notifications/email.
- **Mascots:** Character storyline and React Native image-swap hook setup for the crew (Loop, Rho, Mira, Coda, Bram).

---

## 🚧 Phase 2: MVP (Private Engagement Beta)

**Goal:** Build useful gamification without location competition.
**Focus:** Cosmetic progression, pace-neutral achievements, weekly consistency reset, async 1v1 mutual-friend challenges, friend standings, Loop guidance, and push notifications.

### Milestone 2.1 — Mobile API Client Extensions (complete)

`apps/mobile/src/api-client.ts` now covers every Phase 1 gamification route with
typed methods over the existing auth-refresh, `AuthFailure`, and `ApiFailure`
boundary:

- **Profile:** `getProfile`, `updateProfile`. A missing profile raises
  `ApiFailure` with status `404`, so a caller must render an explicit
  create-profile state instead of a fabricated identity.
- **Friends and blocks:** `sendFriendRequest`, `listFriendRequests`,
  `respondFriendRequest`, `listFriends`, `blockAccount`, `unblockAccount`. The
  invite response stays generic, so no caller can confirm that an address
  exists (ADR-0007).
- **Notifications:** `getNotificationInbox`, `markNotificationsRead`,
  `getNotificationPreferences`, `updateNotificationPreferences`.
- **Progression and achievements:** `getProgressionSummary`, `syncProgression`,
  `getAchievements`, `syncAchievements`. The server stays authoritative; the
  client never derives XP, level, or weekly consistency locally (ADR-0005).
- **Challenges:** `createChallenge`, `listChallenges`, `respondChallenge`, and
  `getChallengeResult` are written against the frozen contract but have no
  server yet, so they raise `ApiFailure(404)` until milestone 2.5 lands
  `018_challenges.sql` and `/v1/challenges`. No product surface may present a
  challenge as live before then.

Contracts gained the missing `Static` type exports the client needs
(`ChallengeListResponse`, `ChallengeRespondRequest`, `ChallengeLengthDays`,
`ChallengeStatus`, `FriendRequestCreateResponse`, `FriendRequestStatus`).

Two pre-existing client defects were corrected in the same boundary: Fastify
answers `400 FST_ERR_CTP_EMPTY_JSON_BODY` when `content-type` is
`application/json` and the body is empty, so `requestEmailVerification` and
`acceptSafetyContact` could never have succeeded against the real API. Both now
send an explicit empty JSON object, and a regression test pins that behavior
alongside the two new sync calls.

Validation: mobile `api-client` suite 16 tests; workspace lint, typecheck,
build, `verify:maplibre`, and `git diff --check` clean; full test run 36 mobile
files / 144 tests with every package green. The four PostGIS API integration
tests stayed skipped because no local PostGIS was reachable; they cover
unchanged server routes and run in CI.

### Milestone 2.2 — Tab Navigation Update (complete)

The `Season` tab is now `Play`, matching the PRD information architecture where
Play owns challenges and friend standings. `navigation/types.ts`,
`navigation/tab-style.ts`, `navigation/TabBar.tsx`, and `App.tsx` carry the
rename, and `SeasonScreen` became `PlayScreen` in `screens/ProductScreens.tsx`.

`TabBar` no longer picks its glyph from a nested ternary. `tab-style.ts` exports
`tabIcons: Record<Tab, string>`, so adding a tab is a type error until it
declares an icon, and a test pins that every tab has a distinct non-empty glyph.
Play uses `◆`; the retired `⬡` glyph is free for a future territory surface.

`PlayScreen` stays a truthful placeholder. It states that challenges are not
live, names what they will count (active minutes, active days, quest
completions) and what they will never count (pace or speed), and shows no
invite, score, or rank. It also carries the territory disclosure the old Season
tab owned, so the "before first territory season" non-state in
[`product.md`](product.md) still has a home. Play remains a quiet-emphasis tab;
milestone 2.4 should promote it to primary when the real UI lands.

Validation: mobile lint (0 errors, 3 pre-existing `exhaustive-deps` warnings),
typecheck, and the full workspace `typecheck`, `test` (36 mobile files / 145
tests, all 17 turbo tasks green), `build`, `verify:maplibre`, and
`git diff --check`. No new device evidence is claimed: nothing user-facing
changed beyond a tab label, icon, and placeholder copy.

### Milestone 2.3 — Home Tab: Progression & Consistency (complete)

Home now renders a progression card and a weekly consistency card from
`GET /v1/progression`, plus the cosmetic tier from `GET /v1/profile`.
`screens/home-progression-model.ts` owns every derivation as pure functions and
`screens/home-progression-model.test.ts` plus
`screens/HomeScreen.progression.render.test.tsx` cover the model and the real
render.

The cards sit after the free-activity Start card rather than directly under the
weekly goal, so two cosmetic cards do not push the screen's one primary action
below the fold. Home reads `GET /v1/progression` only; it never calls
`POST /v1/progression/sync`, which would make rendering Home a write.

Four truthfulness decisions came out of reading the served payload:

- **`level` is optional.** It exists only while a `progression` rule version is
  published, so a missing level is presented as `unpublished` — the XP total
  with "Cosmetic levels are not published yet" — never as a fabricated level 1.
- **`nextLevelAt` is the next band's cumulative threshold, not a delta.** The
  band width is `nextLevelAt - (totalXp - xpInLevel)`. A non-positive width
  means the served rule and totals disagree, so the bar is dropped instead of
  rendered from a divide-by-zero; the render test asserts no `NaN%` or
  `undefined%` width ever reaches a style.
- **`questsCompleted` is a server stub.** `progression-routes.ts` hardcodes `0`,
  so presenting it would render a fabricated zero. No surface shows it, and a
  test pins that the presentation carries no quest wording.
- **`weeklyConsistency` reports how many days were active, never which ones.**
  The card is therefore seven unlabelled count pips, not a weekday calendar.
  Inactive pips use the neutral inset token — never error or warning — nothing
  is marked as missed, and the card closes with "A quieter week never reduces XP
  you have already earned" (ADR-0005). TalkBack reads the row once as
  "3 of 7 active days this week, 182 counted active minutes".

A `503` from `/v1/progression` (no database, or no progression rule on `sync`)
now maps to a distinct `unavailable` state instead of a generic error, and
`homeStatusMessage` gained an optional secondary message so Home keeps exactly
one live region: progression only speaks when the weekly goal and quest list are
both fine. The tier chip is decoration — a `404` from `getProfile` leaves it off
and never blocks the card or invents an identity.

Validation: mobile lint (0 errors, 3 pre-existing `exhaustive-deps` warnings),
typecheck, `src/screens` 7 files / 40 tests, and the full workspace `typecheck`,
`test` (38 mobile files / 161 tests, 17/17 turbo tasks green), `build`,
`verify:maplibre`, and `git diff --check`. No Android device evidence is claimed;
authenticated device capture is still blocked by the documented
authorization-stripping tunnel.

### Milestone 2.4 — Play Tab: Challenges & Friend Standings (complete)

Built after 2.5 and 2.6 so every surface reads a real route.
`screens/PlayScreen.tsx` replaces the placeholder and `screens/play-model.ts`
owns the derivations; `play-model.test.ts` and `PlayScreen.render.test.tsx`
cover them. Play is now a primary-emphasis tab in `navigation/tab-style.ts`.

Delivered: incoming invites with accept/decline, outgoing invites shown as
waiting, in-progress challenges, finished challenges with their stored result,
the friend board with its join/leave control, Loop guidance on the empty state,
and a compose sheet for friend, mode, and duration.

Two features in the original plan text could not be built as written, because
the server has no data for them:

- **"Active challenges with live scores" does not exist.** Scores are computed
  by the worker when the window closes, and `GET /v1/challenges/:id/result`
  answers `409` until then. An in-progress card therefore shows the mode, the
  opponent, and the days remaining, and states that scores are counted at the
  end. A running total would have to be invented client-side, which ADR-0005
  and ADR-0006 forbid. A real live projection needs its own route plus a
  decision about exposing an opponent's in-progress total — neither exists yet.
- **`quest_completion` is not offered as a mode.** Nothing records a quest
  completion server-side, so the published v1 challenge rule omits the mode and
  the API answers `422`. The compose sheet offers `active_minutes` and
  `active_days` only.

Building the screen also exposed a contract gap that 2.5 had not: a
`ChallengeSummary` did not say which side the reader was on, so a client could
not tell an invite it must answer from one it sent. `ChallengeSummary.role`
(`challenger` | `opponent`) was added and the route projects it.

Other decisions: declined and cancelled challenges are dropped rather than shown
as history, since nothing was scored; a friend who already has a live challenge
is not offered in the compose sheet; finished-challenge results are fetched with
at most three concurrent requests; and a finished window the worker has not
scored reads "Counting", never a zero or a loss.

Validation: mobile 188 tests across 41 files, including 9 `src/screens` files /
67 tests; workspace `typecheck`, `test` (17/17 turbo tasks), `build`, `lint`,
`verify:maplibre`, and `git diff --check`.

### Milestone 2.5 — Challenge API & Scoring Worker (complete)

Implemented ahead of milestone 2.4 so the Play tab is built against real routes
rather than a contract that answers `404`.

`018_challenges.sql` adds `challenges`, `challenge_results`, and
`challenge_participant_results`, plus a partial unique index that allows one
live challenge per pair in either direction. The schema invariant everything
else leans on: **`finished` implies a stored result**, so a finished challenge
can never render an empty or half-computed score.

`services/api/src/challenge-routes.ts` implements `POST /v1/challenges`,
`GET /v1/challenges`, `PATCH /v1/challenges/:challengeId`, and
`GET /v1/challenges/:challengeId/result`. Mutual friendship is the
authorization boundary and is checked together with blocks in one statement, so
a stranger, a one-way friendship, and a blocked friend are indistinguishable
(ADR-0007). A summary exposes the opponent's `Profile` only; an opponent with no
profile is named "RunSphere member" rather than by account id.

`services/worker/src/challenge-scoring.ts` sweeps closed windows into a
`challenge.finished` outbox event (idempotent via `NOT EXISTS`), scores both
participants with `challengeModeScore()` over server-derived activity only, and
writes the result, the `finished` status, and one inbox row per participant in a
single transaction. The existing 014 inbox trigger fans those rows out to
`notification.created`, so no new trigger was needed. Notice copy carries no
score — only the opaque challenge id, in the deep link.

Four decisions worth carrying forward:

- **`quest_completion` is not scoreable and is refused.** Nothing in the schema
  records that an account completed a quest, which is also why
  `/v1/progression` still hardcodes `questsCompleted: 0`. Scoring it would give
  every pair a fabricated 0-0 tie, so the published rule's `modes` list omits it
  and `POST /v1/challenges` answers `422` with the reason. **Milestone 2.4 must
  offer only `active_minutes` and `active_days`.**
- **The window starts on accept, not on invite.** `period_start`/`period_end`
  are proposed at invite time and rewritten exactly once, while status is still
  `invited`, so a slow reply never costs the invitee scoring days. Invites lapse
  after 7 days and the worker cancels them.
- **A tie has no winner.** `winner_account_id` is nullable and a tie is never
  broken on pace, time, or distance — none of which a challenge may read.
- **Scoring uses the rule version recorded on the challenge**, so publishing a
  v2 rule never rescores a window under terms the participants did not agree to.

`rule_versions` gains a version-1 `challenge` rule
(`dailyCapMinutes`, `minMinutesPerActiveDay`, `lengthDays`, `modes`) parsed by
the new `parseChallengeRule` in `@runsphere/domain`, alongside
`challengeWindow`, `challengeWinner`, `kolkataDayStart`, and `kolkataDateStart`.
`challengeModeScore` gained an optional `minMinutesPerActiveDay` so the
published rule is authoritative for `active_days` too.

Validation: domain 50 tests, worker 23, API 31 (+4 PostGIS integration tests
still skipped locally), mobile 161; workspace `typecheck`, `test` (17/17 turbo
tasks), `build`, `lint`, `verify:maplibre`, and `git diff --check`. The API
route tests run against a fake `Database` through `app.inject`, so real Fastify
schema validation and authorization are exercised without PostGIS.

One pre-existing defect surfaced and was fixed: `services/worker` was the only
package with no `vitest.config.ts`, so after `pnpm build` the default glob also
matched the compiled tests in `dist` and every worker test ran twice against
stale output. It now matches the `src/**/*.test.ts` convention used by
`services/api`, `packages/domain`, and `apps/mobile`.

### Milestone 2.6 — Friend Standings API (complete)

`GET /v1/friends/standings` and `PUT /v1/friends/standings/participation` are
implemented in `gamification-routes.ts`, taken before 2.4 so the Play tab had a
real board to render.

`019_friend_standings.sql` adds `leaderboard_opt_ins (account_id, scope, …)`.
ADR-0007 requires friend boards to use a visibility control independent of
activity visibility, so this deliberately does not reuse
`accounts.profile_visibility`. Absence of a row means "not on the board", so no
existing account is enrolled by the migration, and leaving revokes rather than
deletes so the opt-in stays auditable. A read path without a write path would
have left the endpoint permanently empty, which is why the participation route
ships with it.

Board rules:

- **Not on the board means not reading it.** `entries` is empty whenever
  `participating` is false, and the route does not even query for members. The
  opt-in is reciprocal, not a one-way window into friends' numbers.
- Membership is mutual friendship **and** a live opt-in on both sides, minus any
  block in either direction, evaluated in one statement.
- The score is one number: capped weekly active minutes, computed by
  `cappedWeeklyActiveMinutes` in `@runsphere/domain` from the published
  progression rule — the same value the account sees on its own Home consistency
  card, so the two can never disagree. Active days were deliberately **not**
  added: ADR-0007 describes a board entry as carrying one score.
- Ties share a rank and the next rank skips (`competitionRanking`, new in
  domain). A tie is never broken, because the only available tiebreaks would be
  pace, distance, or timing.

Validation: domain 53 tests; API 45 passed + 4 PostGIS integration tests still
skipped locally, including a new 14-test `friend-standings.test.ts` driving both
routes through `app.inject` against a fake `Database`.

### Milestone 2.7 — Notification Push Wiring (complete)

`services/worker/src/push-delivery.ts` delivers `notification.created` through
FCM HTTP v1, signing a service-account assertion with `node:crypto` so no
third-party auth dependency was added. `020_push_devices.sql` adds
`push_devices` and `push_dispatches`; `POST /v1/notifications/devices` and
`DELETE /v1/notifications/devices/:deviceId` register and revoke an address.

Decisions worth carrying forward:

- **The message is data-only.** It carries the notification id and the deep
  link already stored on the inbox row, and nothing else. A `notification`
  payload would ask the provider to render the title and body, which is exactly
  the content ADR-0009 keeps server-side. The client reads the entry back from
  the durable inbox.
- **Registering is an address, not consent.** Whether a push is sent is a pure
  decision in `@runsphere/domain` (`pushDeliveryDecision`) over the account's
  existing preferences: channel, category, live devices, quiet hours, then the
  daily cap. Standing "no" answers are evaluated before timing limits so an
  audit row says why, not merely that the clock forbade it.
- **Every decision is recorded.** `push_dispatches` is keyed by notification id,
  which is both the idempotency guard against an outbox retry and the counter
  the daily cap reads. `no_devices` covers both never-registered and
  every-address-expired.
- **A dead address is not a failure.** A provider `UNREGISTERED` revokes the
  row with `revoke_reason = 'provider_unregistered'`; a transient failure throws
  so the outbox retries under its existing attempt budget.
- **Credentials are all or nothing.** `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and
  `FCM_PRIVATE_KEY` must all be present. Without them the worker logs
  `push.provider_unconfigured`, drains the event, and the in-app inbox is
  unaffected — the stub the task asked for. Transactional email stays
  explicitly deferred rather than silently dropped.

**Still blocked:** no FCM project is provisioned, and `apps/mobile` has no
native token source (`expo-notifications` is not a dependency).
`apps/mobile/src/push-registration.ts` takes an injected `PushTokenSource`,
persists the registration in SecureStore, re-registers on token rotation, and
revokes on sign-out through `coordinateLogout`; it reports `unavailable` until
a real source is wired.

### Milestone 2.8 — Loop Guidance & Polish (complete)

`apps/mobile/src/loop-guidance.ts` owns the cue registry and both limits;
`components/LoopCallout.tsx` renders one; `components/useLoopGuidance.ts`
resolves at most one cue per surface.

Six cues ship, and each is spoken by the crew member whose role it belongs to:
`pending-result` and `weekly-reset` (Rho), `challenge-invite` and `play-empty`
(Coda), `quest-empty` (Mira), `hike-prep` (Bram). They appear on the activity
results screen, Home, Play, Explore, and activity preparation respectively.

- **Two limits, both in the model rather than the screens:** a per-cue daily
  frequency cap and a dismissal that holds for a stated number of days. The cap
  is charged once, when the cue is first shown, so a cue cannot flicker away
  mid-read.
- **One cue per surface.** A screen offers candidates in priority order; an
  invite waiting on the reader outranks an empty list.
- **Guidance is never the only route to information.** Every cue restates
  something the surface already shows, so dismissing one loses nothing.
- **A weekly reset is only news to a client that saw the previous week.** A
  first run records the week and says nothing.
- **Tone is enforced, not merely intended.** `LoopCallout` throws on copy that
  fails `isSafeMascotLabel`, the same rule Loop and the crew already obey.
- TalkBack: each callout is one politely-announced unit labelled
  "<speaker> says: …", the mascot inside it is decorative so the message is not
  read twice, and dismiss is a separate 48dp control with a hint. Card titles
  across Home and Play gained `accessibilityRole="header"`, and a challenge
  heading and a finished result are each read as one fact rather than as
  fragments.

This is also the first surface to render the crew: `CrewMascot` existed but no
screen used it. The `crew-assets.ts` swap point for user-provided PNGs is
unchanged, so blocker 1 below still stands — the vector stand-ins are what
ship today.

### Milestone 2.9 — Surfaces for the shipped social and notification routes (complete)

2.1 through 2.8 left the Foundation gate's friends, blocks, inbox, preference,
and achievement routes with no mobile surface at all: the client methods existed
from 2.1 and no screen called them. The result was that **no account could add a
friend** (so the friend board and every challenge were unreachable on a fresh
install) and **no account had a profile** (`GET /v1/profile` answers `404` until
a display name is set, and the friend-request route joins `profiles`).

Added: `FriendsScreen` from the Play tab (requests, friends, add-by-email,
block/unblock), and `NotificationsScreen`, `AchievementsScreen`, and
`ProfileIdentityScreen` from the You tab. Each has a pure model beside it, as in
2.3 and 2.4.

Rules worth carrying forward:

- A friend request is never reported as delivered: the route answers the same
  `202` whatever it finds, so the address cannot be probed (ADR-0007).
- No outgoing-request list is shown, because the API has none.
- `GET /v1/blocks` was added, because blocking hides the account from every
  other list and a block that cannot be found again cannot be undone.
- An inbox entry offers navigation only where it can honestly go: Play for a
  challenge link, friends for a friend request, nothing otherwise.
- Preference saves send only the changed field; the push switch states that
  push is not being delivered on this build; toggles with no producer say so.
- The `ProfileScreen` head no longer shows a fabricated identity.

**Contract fix:** `NotificationPreferencesUpdateRequest` was a `Type.Partial`,
which could not express _clearing_ quiet hours (`undefined` reads as
"unchanged"), so the window could be set and never switched off. `quietHours` is
now `QuietHours | null` and the route treats `null` as the clear signal.

Validation: API 70 passed + 4 PostGIS integration tests still skipped locally,
including new `block-list.test.ts` and `notification-preferences.test.ts`;
mobile 326 tests across 51 files.

---

## 📅 Phase 3: Community Beta

**Goal:** Expand social features to clubs and global boards.

### Milestone 3.1 — Clubs (complete)

`021_clubs.sql` adds `clubs` and `club_memberships`; `club-routes.ts` serves
create, list, join-by-code, roster, leave, remove, role change, and archive;
`@runsphere/domain/club.ts` holds every authority rule; and the Clubs tab is a
real screen rather than the "coming later" placeholder. Built end to end in one
milestone on purpose, after 2.9 spent a milestone paying off the cost of
shipping routes with no surface.

Rules worth carrying forward: a non-member is answered `404` rather than `403`,
and an unknown code, a malformed code, and an archived club are one answer, so
the join route is not an oracle for guessing codes; authority is the same pure
predicate in the route and in the UI; removal needs strictly greater authority;
the owner cannot leave a populated club and there is no silent succession (a
unique partial index makes "exactly one live owner" a schema invariant);
nothing is deleted — leaving, removal, and archiving are recorded; a block hides
two accounts from each other in a roster while the member count stays truthful;
invite codes are server-generated from an alphabet without `I`, `L`, `O`, `0`,
or `1`. The worker now archives clubs an erased account owned, before deleting
it, so a club is never left ownerless.

Validation: domain 91 tests (19 new in `club.test.ts`); API 103 passed + 4
PostGIS integration tests still skipped, including a 33-test
`club-routes.test.ts`; mobile 364 tests across 53 files.

### Milestone 3.2 — Club relays (complete)

`022_club_relays.sql` adds `club_relays` and `club_relay_contributions` and
seeds club rule v1 (240 minutes a day, 600 a week per member, targets of
60-20000). `services/worker/src/club-relays.ts` computes the totals,
`POST`/`GET /v1/clubs/:clubId/relays` set and read them, and the Clubs tab shows
real progress instead of the note saying relays did not exist.

Rules worth carrying forward: a club sees aggregates and a member additionally
sees their own units, with no per-member breakdown in the response and none
derivable from it; the per-member weekly ceiling is what makes a relay
cooperative rather than a race; the worker recomputes rather than increments, so
the job is idempotent and self-heals after a late or withdrawn validation; only
currently active members count; the open week and the week just closed are
recomputed and older weeks are never rewritten; the week is never a parameter,
so a counted week cannot be retargeted; progress is clamped at 100% because
there is no league table of clubs; an out-of-range target is a `422` because the
request is fine and the published rule is not.

Validation: domain 103 tests; API 114 passed + 4 PostGIS integration tests still
skipped; worker 51 (a new 9-test `club-relays.test.ts`); mobile 386 tests. No
relay has been computed against real activity — the aggregation is covered by
unit tests with a fake database only.

### Remaining Phase 3 deliverables:

- **Club boards and challenges:** member-only, isolated by `club_id`.
- **Global Boards:** Opt-in, server-derived period leaderboards using privacy-minimized pace-neutral points. Segmented by division.
- **Scheduled Competitions:** API and UI for opt-in time-boxed events with published rules and rewards.
- **Moderation:** Staff queues for reviewing reported user profiles/club names.
- **Campaign Tooling:** Admin API for drafting, testing, scheduling, and sending consented email campaigns with unsubscribe flows.
- **Mobile UI:** The `Clubs` tab is real as of 3.1 and shows relay progress as of 3.2. Club leaderboards still need their server side before the tab can show them.
- **Reporting:** No reports/sanctions/appeals records exist. Blocking ships (2.9), reporting does not, so a blocked account cannot be reported.

---

## 🗺️ Phase 4: Territory Pilot

**Goal:** Introduce location-based seasonal gameplay safely in the MMR market.

### Pending Deliverables:

- **Territory Engine:** Server-side H3 traversal and mapping to eligible public cells.
- **Enrollment:** Opt-in enrollment API with division assignment.
- **Weekly Resets:** Worker jobs to compute cell control at week's end based on best contiguous 60-minute daily windows, then reset cells to unclaimed.
- **Season Ladder:** Compute and store season-long rank points based on capped control-days.
- **Mobile UI:** Map rendering of controlled cells (no live tracking, no exact timestamps, no identity exposure).
- **Abuse Controls:** Implement top-10% and top-user concentration guardrails, plus season rollback mechanisms.
- **Field Study:** Physical-device GPS, distance, battery, and territory-cell field study in MMR to validate fairness.

---

## 📈 Phase 5: Measured Scale

**Goal:** Expand platform reach based on concrete evidence and cost approvals.

### Pending Deliverables:

- **iOS Parity:** Implement all Phase 1-4 features in the iOS app, ensuring background behavior and battery drain meet defined targets.
- **Redis Cache:** Implement optional Redis caching for leaderboards and high-traffic endpoints ONLY if PostgreSQL hits defined read/write gates and overage is approved.
- **Scale:** Larger scheduled competitions and expansion to more MMR clusters. (Wearables, AR, and new cities remain deferred pending new safety/cost reviews).

---

## ⚠️ Blockers & Open Items for Next Steps

1. **Mascot Artwork:** Mascot images (Rho, Mira, Coda, Bram) need to be provided and placed in `apps/mobile/assets` so the image-swap hook can use them. The crew now appear in Loop guidance callouts as hand-authored vector stand-ins.
2. **FCM Credentials:** A Firebase project and a service account are required before any push is actually delivered. The worker side is implemented; set `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY`. The mobile client additionally needs a native token source (`expo-notifications` plus `google-services.json`) before `registerForPush` has a token to register.
3. **Admin Web App:** The `apps/admin` skeleton exists, but requires the full React UI for staff RBAC, moderation, and campaign management (Phase 3+).
4. **Migrations:** `018_challenges.sql`, `019_friend_standings.sql`, and `020_push_devices.sql` have not been executed against a real PostGIS from this checkout, and the four PostGIS integration tests remain skipped locally. Applying them and running those tests is the first thing to do in CI or on a machine with a database.
