# Gamified Product Expansion — Detailed Implementation Plan

**Status:** Phase 1 (Foundation Gate) complete. Phase 4 (Territory Pilot) has started with 4.1 (season enrollment and divisions) and 4.2 (the traversal and control engine, written but switched off); territory capture remains disabled behind the Territory gate, and two required inputs do not exist yet. Phase 2 (MVP) complete: milestones 2.1 through 2.9 are implemented. Phase 3 (Community Beta) has started: milestones 3.1 (clubs), 3.2 (club relays), 3.3 (club boards), 3.4 (club challenges), 3.5 (global boards), 3.6 (scheduled competitions), 3.7 (moderation), 3.8 (sanction enforcement), 3.9 (campaign email), 3.10 (the operations console), 3.11 (sanction management), and 3.12 (privacy and data-stewardship reads) are implemented.
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

### Milestone 3.3 — Club boards (complete)

The competitive half of clubs, and the counterpart to the cooperative relay:
`GET /v1/clubs/:clubId/board` ranks the club members who joined the board by
this week's capped validated active minutes, and
`PUT /v1/clubs/board/participation` opens or revokes the `club` scope in
`leaderboard_opt_ins`. No migration was needed — 019 already carries the scope
— and the Clubs tab shows the board where it used to say boards did not exist.

Rules worth carrying forward: two gates stand in front of an entry list —
active membership of that club, and the reader's own live opt-in — so reading
other members' scores means publishing your own; a non-member is answered `404`
as everywhere else in clubs, so the board is not an oracle for club ids; a block
hides two accounts from each other on a board as in a roster, and a blocked
member is never scored either; the entry is the same privacy-minimized
projection the friend board publishes (display identity, one pace-neutral score,
a rank), so a board entry means the same thing wherever it is read; the score is
the capped weekly active-minute total from the published progression rule, so it
can never disagree with the reader's own Home card; with no published rule the
board is empty rather than a column of zeroes; participation is one account-level
decision covering every club the account is in, which is why no club id appears
in that path; and leaving revokes rather than deletes, so the opt-in history
stays auditable.

The board publishes a per-member score where the relay deliberately does not.
That is the difference between the two: relay minutes are counted whether or not
you asked, so they stay aggregate forever, while a board score is opt-in, off by
default, and revocable (ADR-0007).

Validation: API 126 passed + 4 PostGIS integration tests still skipped (11 new
in `club-routes.test.ts`); mobile 398 tests across 53 files (12 new); workspace
`typecheck`, `test`, `build`, and `lint` (3 pre-existing
`react-hooks/exhaustive-deps` warnings, 0 errors).

### Milestone 3.4 — Club challenges (complete)

The last unbuilt club surface. `023_club_challenges.sql` adds `club_challenges`,
`club_challenge_participants`, and `club_challenge_results`, and seeds club
challenge rule v1 in the same shape as the 1v1 rule (240-minute daily cap,
lengths of 7 or 14 days, `active_minutes` and `active_days`).
`services/api/src/club-routes.ts` serves open, list, join/leave, cancel, and
standings; `services/worker/src/club-challenges.ts` finishes a contest when its
window closes; and the Clubs tab runs the whole thing.

Rules worth carrying forward: opening a contest needs owner or admin authority
because it is a club-wide act, while joining publishes _your_ score and is
therefore yours alone to give and revoke — opening one enrols nobody, including
the member who opened it; a partial unique index keeps exactly one live
challenge per club, so a member is never asked which contest their minutes count
toward; the window is derived from the day it was opened and is never a request
parameter, so a contest can neither be backdated nor parked in the future;
joining is retroactive within the window because every participant is scored
over the same days, and the UI says so before you join; leaving records a
departure rather than deleting the row, and from that moment you are neither
scored nor shown; standings are gated on the reader's own participation, exactly
as the club board is gated on its opt-in; a running contest is scored live while
a finished one reads the stored result and is never recomputed; a contest is
always scored under the rule version it was opened with; and cancelling writes
no result at all, so nobody is ranked in a contest that was called off.

The worker deliberately has no outbox row: the `status = 'active'` claim inside
the finishing transaction is the idempotence, so a failed pass simply retries on
the next sweep, and a scored challenge is never selected again. The finish
notification reuses the existing `challenge_finished` inbox kind, so a member's
"challenges" notification preference governs it exactly as it already does for a
1v1 result, and the body carries neither score nor rank.

Validation: domain 107 tests; API 147 passed + 4 PostGIS integration tests still
skipped (21 new in `club-routes.test.ts`); worker 63 (a new 12-test
`club-challenges.test.ts`); mobile 416 across 53 files (18 new). Workspace
`typecheck`, `test`, `build`, and `lint` (3 pre-existing
`react-hooks/exhaustive-deps` warnings, 0 errors).

### Milestone 3.5 — Global boards (complete)

The first board outside a private room. `024_global_boards.sql` adds
`global_board_entries` and seeds global-board rule v1;
`services/worker/src/global-boards.ts` materializes the open week and the week
just closed; `services/api/src/global-board-routes.ts` serves
`GET /v1/boards/global` and `PUT /v1/boards/global/participation`; and the Play
tab shows the board beneath friend standings.

Rules worth carrying forward: the board is **materialized, not computed on
read** — ranking every opted-in account per request would scan everyone's
activity history, so the worker writes the week and a read is one indexed page,
which is what keeps a cache out of the critical path while PostgreSQL stays
authoritative; divisions are **published activity-history bands**, derived from
how many earlier weeks an account was active and never from a score, a pace, or
a place, so a first week is never ranked against a fiftieth; a division is
recomputed per period rather than carried, so nobody is stuck in a band they
have grown out of; an account with no counted minutes is **absent rather than
ranked at zero**; ranks are shared on a tie and computed within the division;
reading the board requires being on it; a block hides two accounts from each
other and **leaves a gap in the visible ranks rather than renumbering them**,
because a rank is a fact about the period rather than about who is looking; the
reader's own standing comes back as a rank and a score with no second copy of
their identity; and leaving deletes the reader's rows from the open week
immediately rather than waiting for the next sweep, because an opt-out that is
still visible for hours is not an opt-out.

Validation: domain 116 tests (9 new in `global-board.test.ts`); API 157 passed +
4 PostGIS integration tests still skipped (10 new in
`global-board-routes.test.ts`); worker 74 (a new 11-test `global-boards.test.ts`);
mobile 427 across 53 files (11 new). Workspace `typecheck`, `test`, `build`, and
`lint` (3 pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors).

### Milestone 3.6 — Scheduled competitions (complete)

The most formal contest in the product, and the only one an ordinary member
cannot create. `025_competitions.sql` adds `competitions`,
`competition_enrollments`, and `competition_results`, and seeds competition rule
v1 (240-minute daily cap; 7, 14, or 30 days; `active_minutes` and
`active_days`). `services/api/src/competition-routes.ts` serves the member list,
enrollment, and standings plus two `season_operator`/`admin` staff routes;
`services/worker/src/competitions.ts` advances the lifecycle; and the Play tab
lists competitions, enters them, and shows standings.

Rules worth carrying forward: staff schedule, members enter themselves — a
competition is created as a **draft** because an announcement is a commitment,
so publishing is a second deliberate act; a cancelled event stays visible,
because an event people arranged their weeks around is a fact they are owed;
eligibility is a published band of earlier active weeks, checked on the server
and **stated whether or not the reader clears it**, since a rule that only
appears when it excludes you reads as a rejection; entering scores the whole
window however late you enter, because everyone is measured over the same days;
withdrawing is recorded rather than deleted, and is never gated on eligibility;
**the clock, not a person, moves a competition** through open, closed, and
finalized, each decided by a pure predicate, and a window that passed while
nobody swept lands straight on `closed` rather than opening for a day that is
gone; results are written once in the transaction that closes the event and are
**flagged provisional until the stated dispute period elapses** — finalizing
records that the span passed and rescores nothing; and a cancelled competition
writes no result at all.

Validation: domain 129 tests (13 new in `competition.test.ts`); API 181 passed +
4 PostGIS integration tests still skipped (24 new in
`competition-routes.test.ts`); worker 86 (a new 12-test `competitions.test.ts`);
mobile 443 across 53 files (16 new). Workspace `typecheck`, `test`, `build`, and
`lint` (3 pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors).

### Milestone 3.7 — Moderation (complete)

Reports, sanctions, and appeals — and with them the gap the plan has carried
since 2.9: **a blocked account can now be reported**. `026_moderation.sql` adds
`reports`, `sanctions`, and `sanction_appeals`;
`services/api/src/moderation-routes.ts` serves three member routes and four
`moderator`/`admin` staff routes; the worker closes out expired sanctions; the
Friends screen offers Report beside Block (including on blocked accounts), and
the You tab shows the account its own standing and lets it appeal.

Rules worth carrying forward: **a reporter is told the report was received and
nothing else** — an answer that varied by outcome, or by whether the subject
exists, would make reporting a lookup; a second report on the same subject is
folded into the first rather than refused, since refusing both discloses state
and discourages a second attempt; reporting never consults blocks, because
hiding somebody does not revoke your ability to raise what they did; **a
sanction is written for the account that receives it** and the route refuses to
issue one without that statement; a `social_suspension` removes only the
sharing surfaces and leaves recording, history, and export untouched, because
withholding somebody's own data is a punishment aimed at the wrong thing; a
club cannot be sanctioned from a report, which would punish every member for
one person's name; **one appeal per sanction**, only while it still applies,
answered with a reason; an overturned appeal revokes the sanction in the same
transaction, so a lifted sanction is never briefly still in force; a sanction
record is never deleted or hidden once it ends, because a record that vanishes
cannot be checked; and expiry sets `revoked_at` to the stated expiry rather
than to sweep time, so an account was free from the moment its sanction ended.

Validation: domain 144 tests (15 new in `moderation.test.ts`); API 208 passed +
4 PostGIS integration tests still skipped (27 new in
`moderation-routes.test.ts`); worker 88 (2 new); mobile 458 across 54 files (15
new). Workspace `typecheck`, `test`, `build`, and `lint` (3 pre-existing
`react-hooks/exhaustive-deps` warnings, 0 errors).

### Milestone 3.8 — Sanction enforcement (complete)

3.7 recorded sanctions and told the account about them; nothing acted on them.
This wires them in. `services/api/src/sanction-guard.ts` is the single place
that decides what a suspension stops, and every enforcement point reads it.

Two shapes of enforcement, kept apart on purpose. **Your own actions**: joining
any board scope, entering any contest, opening a 1v1 or club challenge,
creating or joining a club, and sending a friend request are refused with the
statement staff wrote — a refusal is never mysterious. **Other people's
views**: the friend board, club board, club challenge standings, competition
standings, and the materialized global board all drop a suspended account. A
suspension that only stopped _new_ participation would leave the account on
every board it had already joined, which is not a pause of anything.

Rules worth carrying forward: **leaving is never guarded** — an account may
always remove itself from something, sanction or no sanction, so a paused
member is never trapped in a club board or a competition; a `warning` changes
nothing at all; a sharing suspension never touches recording, history, export,
club membership, or reading; sign-in is refused for an `account_suspension`
**only after the password has checked out**, so sign-in can never become a way
to test whether somebody else has been suspended; refresh is checked too, so a
suspension applied mid-session takes effect at the next rotation rather than
waiting for a sign-out; the guard runs _before_ a friend request looks at the
address and before a club join looks up the code, so a refusal discloses
nothing about anyone else; and the mobile notices pass a `403` through
verbatim, so a paused member reads the decision rather than "something went
wrong".

Validation: domain 150 tests (6 new in `moderation.test.ts`); API 228 passed +
4 PostGIS integration tests still skipped (20 new, most in a new
`sanction-enforcement.test.ts` that drives every guarded route); worker 89 (1
new); mobile 459 (1 new). Workspace `typecheck`, `test`, `build`, and `lint` (3
pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors).

### Milestone 3.9 — Consented campaign email (complete)

`027_email_campaigns.sql` adds `email_templates`, `email_campaigns`,
`email_campaign_recipients`, and `email_unsubscribe_tokens`.
`services/api/src/campaign-routes.ts` serves four `campaign_manager`/`admin`
routes plus a public unsubscribe; `services/worker/src/campaigns.ts` resolves
an audience and queues recipients when a scheduled campaign comes due; and the
notification settings screen gained the consent toggle that makes any of it
reachable.

`notification_preferences.marketing_consent` has existed since 011 and had
never been read or written by anything. It is now the authoritative consent
flag, wired through the preferences contract, route, and mobile screen, and
recorded in `consent_history` on every change.

Rules worth carrying forward: **consent is all three switches** — the consent
flag, the `marketing` category, and the `email` channel — so no single
forgotten toggle can put mail in an inbox, and the mobile control sets and
clears all three together; a campaign references a **reviewed template
version**, resolved and recorded at schedule time, so editing a template
afterwards cannot change what a scheduled send contains; **a campaign manager
sees counts, never people** — the preview is three integers, and no route
returns an account id or an address; the audience is **re-resolved at send
time**, so somebody who unsubscribed after scheduling is simply not in the
list; the send cap bounds the query itself and the recipients table is the
record of what it did; **an audience dimension nothing records is refused**
rather than silently matching nobody (locale, app version, and feature cohort
are in the contract but have no source here yet); a recency band must be at
least 7 days, so it stays a broad band rather than behavioural targeting;
**unsubscribe needs no session**, answers identically whatever the token was,
and clears all three switches; and the token is stored hashed and never
reissued, so the link in an email already sent keeps working.

Delivery itself is still a gated dependency (ADR-0010): no email provider is
configured, so recipients stay `queued` — visibly, in rows somebody can
count — rather than being marked sent by a worker that sent nothing. That is
the same shape push took before FCM credentials existed.

Validation: domain 162 tests (12 new in `campaign.test.ts`); API 252 passed + 4
PostGIS integration tests still skipped (24 new); worker 98 (9 new in
`campaigns.test.ts`); mobile 464 (5 new). Workspace `typecheck`, `test`,
`build`, and `lint` (3 pre-existing `react-hooks/exhaustive-deps` warnings, 0
errors).

### Milestone 3.10 — The operations console (complete)

Five milestones had added staff routes with nothing in front of them, so
running a competition or working a report meant an HTTP client. `apps/admin`
is now a real console: sign in, read your roles, and see exactly the areas your
roles can operate.

`apps/admin/src/areas.ts` maps roles to areas and **gates on the server's own
predicates** — the same `canModerate`, `canOperateCompetitions`, and
`canManageCampaigns` the routes enforce — so the console can never offer an
action the API will refuse nor hide one it would allow. Four areas are backed by
real routes (activity review, moderation, competitions, campaign email); the
three that are not (privacy requests, data stewardship, support) **say what is
missing and why** instead of rendering a screen that looks operational.

This also closed the gap 3.9 left behind: `POST /v1/staff/email-templates`
publishes a template version, superseding the live one inside a transaction so
the "one live version per key" index is never briefly violated. Publishing only
ever adds — a version a campaign already used is never edited — so a campaign
that went out under version 1 stays readable as version 1.

Rules worth carrying forward: the activity review queue is allow-listed by
account id rather than by role (it predates RBAC), so the console offers it to
any signed-in staff account and lets the server decide, and the area note says
so; an account with no staff role is told plainly that signing in worked and
there is nothing to operate; issuing a sanction is deliberately _not_ a
one-click action in the queue, because it needs a statement written for the
account that receives it; and the footer tells staff their own reads are
recorded against their account.

Validation: admin 17 tests (16 new, in `areas.test.ts` and a rewritten
`shell.test.tsx`); API 257 passed + 4 PostGIS integration tests still skipped (5
new for templates). Workspace `typecheck`, `test`, `build`, and `lint` (3
pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors).

### Milestone 3.11 — Sanction management (complete)

The last moderation action with no audited path. Before this, issuing a
sanction from the console was impossible (it needs a written statement) and
ending one early meant a database change nobody could review.

Two routes: `GET /v1/staff/accounts/:accountId/sanctions` shows a moderator
what an account was actually told and whether an appeal is open, and
`POST /v1/staff/sanctions/:sanctionId/lift` ends one early with a required
reason. The console gained the form that makes both usable.

Rules worth carrying forward: **the lift reason is required and kept with the
sanction** — an action that changes what somebody may do, with no record of
why, is precisely what an audit exists to catch; the account is told in the
same transaction, so a lifted sanction is never left unannounced; the reason
staff wrote is for the record and is **not** in the notice, because the account
is owed the decision rather than the internal note; a lifted sanction is
revoked, never deleted; an already-ended sanction answers `409` instead of
silently rewriting why it ended; the history read is itself audited, because
reading somebody's moderation record is an act; **an open appeal is flagged**
so two staff do not answer the same question in different directions; and the
console never offers to sanction a club, because the API refuses it — a club is
moderated by acting on its owner or by archiving it.

Validation: API 268 passed + 4 PostGIS integration tests still skipped (11 new
in `moderation-routes.test.ts`); admin 23 tests (6 new). Workspace `typecheck`,
`test`, `build`, and `lint` (3 pre-existing `react-hooks/exhaustive-deps`
warnings, 0 errors).

### Milestone 3.12 — Privacy and data-stewardship reads (complete)

Two of the three placeholder console areas become real.
`services/api/src/governance-routes.ts` serves
`GET /v1/staff/privacy/requests` (open exports and erasures, oldest first, with
how long each has been waiting, plus a count of erasures that converged) and
`GET /v1/staff/rules` (every published rule version, and which is live).

Both are **read-only on purpose**. A privacy officer's job is to see that
requests converge, not to run erasure by hand: the worker performs it, and a
console button outside that path would be a second way to destroy data with
none of the worker's ordering guarantees. Rules are published by migration, so
editing them here would change gameplay without a reviewed change behind it.
The console states both reasons rather than leaving somebody hunting for a
button that was never built.

Rules worth carrying forward: the privacy queue carries **account ids, states,
and timestamps and nothing else** — no email address, no display name, no
activity — because a compliance queue is not a directory of who asked;
completed erasures are a **count**, since a list of who was erased would
rebuild what erasure removed; `openForHours` is the number that matters,
because the failure mode a privacy officer is watching for is the request that
stopped moving; and both reads are audited, since looking at a queue is itself
an act.

**A schema defect was found and fixed while reading for this milestone.**
`023_club_challenges.sql` and `024_global_boards.sql` seed rule kinds
(`club_challenge`, `global_board`) that the `011` CHECK constraint forbids, so
**both would have failed on first apply**. `023` now widens the constraint
before its own seed, covering both kinds. This is exactly the class of bug the
"never applied against PostGIS" caveat has been hiding.

Validation: API 276 passed + 4 PostGIS integration tests still skipped (8 new in
`governance-routes.test.ts`); admin 26 tests (3 new, and two rewritten now that
the areas exist). Workspace `typecheck`, `test`, `build`, and `lint` (3
pre-existing `react-hooks/exhaustive-deps` warnings, 0 errors).

### Remaining Phase 3 deliverables:

- **Mobile UI:** The `Clubs` tab is real as of 3.1, shows relay progress as of 3.2, the weekly board as of 3.3, and runs club challenges as of 3.4; the `Play` tab shows the global board as of 3.5 and competitions as of 3.6; reporting and the account's own standing arrived with 3.7. Every member-facing surface in this phase now exists.
- **The support console area:** still an honest placeholder, and still waiting on a privacy review rather than on implementation time. An account-lookup surface is the most sensitive thing in this product.
- **An email provider**, before any campaign sends anything.

---

## 🗺️ Phase 4: Territory Pilot

**Goal:** Introduce location-based seasonal gameplay safely in the MMR market.

### Milestone 4.1 — Season enrollment and divisions (complete)

The part of territory that can exist before the Territory gate opens: a season
people can be told about, an opt-in, and a division. **No cell is captured, no
location is read, and no rank is calculated** — `028_territory_seasons.sql`
creates `territory_seasons` and `territory_enrollments` and nothing else,
because a contributions table sitting empty would invite use.

`services/api/src/territory-routes.ts` serves the member season read and
enrollment plus three `season_operator` routes (announce, open or end, division
sizes). The Play tab shows the three states `product.md` asks for: no season, a
season not joined, and one joined — with no rank displayed, because none is
calculated.

Rules worth carrying forward: **a division is assigned once, at enrollment**,
from the published activity-history band, and re-joining keeps the division
already assigned — leaving is not a way to reroll it, and `product.md` permits
rebalancing between seasons only; the band an assignment was read from is
stored and shown, so it can be explained to the person it was made about rather
than being a label they cannot question; a season may be joined while it is
running, for the same reason a competition may be entered late; `live` is
deliberately unreachable, because that status would say the engine is running;
division sizes are reported with merge/split advice for the **next** season
start and nothing is ever moved automatically; and `TERRITORY_CAPTURE_NOTE` is
the single place the whole product says capture is off, returned whether or not
a season exists.

Validation: domain 175 tests (13 new in `territory.test.ts`); API 296 passed + 4
PostGIS integration tests still skipped (20 new in `territory-routes.test.ts`);
mobile 471 (7 new). Workspace `typecheck`, `test`, `build`, `lint`, and
`verify:migrations`.

### Milestone 4.2 — The traversal and control engine (complete, and switched off)

The arithmetic of a season, written as pure functions so the rules can be
argued with before anything runs. `packages/domain/src/territory-scoring.ts`
implements ADR-0008 exactly: the best contiguous 60-minute window of a local
day chosen by distinct eligible cells and tied on earliest start; one cell per
participant per local day; a published daily cap; weekly control by most
distinct days, tied on earliest accepted contribution and then on a stable
opaque reference; and capped control-days for the ladder.
`029_territory_contributions.sql` adds the contribution, control-snapshot, and
ladder tables, and publishes territory rule v2 with the scoring parameters v1
deliberately omitted.

**It does not run, and three things must be true before it can:**

1. the Territory gate passes (`TERRITORY_CAPTURE_ENABLED` is false);
2. an H3 indexer is supplied — no H3 library is a dependency of this workspace,
   and ADR-0001 requires its version pinned per contribution, so it is injected
   rather than imported;
3. a public-space eligibility source is supplied — **no such dataset exists**.

Each is a named refusal before the first query, not a silent no-op, because a
scoring job that quietly does nothing looks exactly like one that is broken.

Two facts found while building it, both worth carrying: **timestamped points
live only in `activity_chunks`**, which are purged on the raw-trace retention
clock (`shareable_route` is a geometry with no time dimension), so scoring must
run inside the retention window and a season cannot be scored retroactively;
and **the ladder formula is an interpretation** — ADR-0008 says "capped
control-days" without saying over what period or per what, and this reads it as
per participant per week. That needs confirming before a season runs for real.

Validation: domain 194 tests (19 new in `territory-scoring.test.ts`, covering
pace neutrality, the tie-breaks, and order independence); worker 102 (4 new,
which assert the refusals and will be the first tests to fail when the gate
opens — which is the point of them).

### Pending Deliverables:

- **Territory Engine:** built in 4.2 and switched off. What remains before it can run: an H3 library dependency with a pinned version, a public-space eligibility dataset, and the gate. **Gated:** ADR-0008 keeps territory disabled until the Territory gate in the release plan passes — fair scoring, division, concentration, and anti-abuse review, plus the MMR field study. 4.1 built everything up to that line and stopped at it.
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
4. **Migrations:** `pnpm verify:migrations` now checks seeded values against the CHECK constraints in force and catches the class of defect found in 3.12, but it is a static check only. `018_challenges.sql` through `027_email_campaigns.sql` have not been executed against a real PostGIS from this checkout, and the four PostGIS integration tests remain skipped locally. Applying them and running those tests is the first thing to do in CI or on a machine with a database. On `023`, watch the `club_challenges_open_idx` partial unique index (the one-live-challenge-per-club rule the create route relies on for its `409`) and the `period_end = period_start + length_days` CHECK.
