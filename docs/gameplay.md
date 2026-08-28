# Gamification rulebook

**Status:** Approved product decisions for the gamified expansion
**Market:** Mumbai Metropolitan Region (MMR)
**Audience:** Adults only (18+)

This document codifies the server-authoritative, pace-neutral gamification
platform. It supplements [`product.md`](product.md) (core loop and quests) and
[`safety-and-privacy.md`](safety-and-privacy.md). The server remains the single
authority for validation, checkpoint completion, scoring, rank, achievements,
challenges, clubs, competitions, and territory.

## Product sequence

The expansion ships in gated phases. Every phase is preceded by its gate in
[`release-plan.md`](release-plan.md).

| Phase                                         | Product outcome                                                                                                                                                                                                 | Explicitly excluded                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Foundation gate — safe gameplay substrate** | Modular contracts/routes/jobs, versioned rules and periods, event fan-out, account email lifecycle, profiles/friends/blocks, notification inbox/preferences, analytics schema, legal versions, staff RBAC       | Territory, public social feed, campaign sends, Redis, WebSockets                        |
| **MVP — private engagement beta**             | Cosmetic progression, pace-neutral achievements, weekly consistency reset, asynchronous 1v1 mutual-friend challenges, friend standings, Loop guidance, push for invited/finished states                         | Nearby leaderboards, speed/distance contests, live battles, territory ownership         |
| **Community beta**                            | Opt-in global period boards, clubs, member-only club boards/challenges, club roles/invites, aggregate relays, scheduled competitions, moderation queue, consented campaign email tooling                        | Club route feeds, comments/photos, cash/physical prizes                                 |
| **Territory pilot**                           | Optional MMR seasonal territory: H3 traversal, eligible public cells, opt-in enrollment, divisions, weekly cell resets, season ladder, best contiguous 60-minute daily window, concentration and abuse controls | Always-on territory, exact ownership history, live capture alerts, pace-based takeovers |
| **Measured scale**                            | Expand only when justified: iOS parity, optional Redis cache, larger competitions, more MMR clusters                                                                                                            | Wearables, AR, new cities, public nearby runners until separate safety/cost decisions   |

## Approved game modes

1. **Free activity and curated quests** — existing private core. All final
   outcomes remain server-derived.
2. **Weekly consistency** — rewards validated active days and capped active
   minutes, never pace or distance.
3. **Asynchronous 1v1 friend challenge** — mutual, verified friends compete
   during the same 3- or 7-day window on active minutes, active days, or
   mutually eligible quest completion. Each mode has daily caps and supports
   decline, block, and report.
4. **Club relay** — members contribute capped validated minutes or quest
   completions to a shared target. Clubs receive only aggregate completion
   data.
5. **Global period leaderboard** — an explicitly opted-in, server-derived board
   over capped pace-neutral points, segmented by period and cohort/division
   where fairness or scale requires it. Entries reveal no location, route,
   activity detail, or live state.
6. **Scheduled competition** — opt-in event with a published rule version,
   eligibility, window, scope, rewards, and dispute period.
7. **Territory season** — opt-in 6–8 week MMR season with fixed H3 resolution,
   public-space eligibility, division isolation, weekly ownership rounds, and a
   season-long rank ladder.

## Fair scoring rules

- The server is authoritative for validation, checkpoint completion, scoring,
  rank, achievements, challenges, and territory.
- Walk, run, and hike use the same scoring rules. Pace, speed, heart rate,
  calories, and inferred fitness never increase a score.
- Progression grants fixed cosmetic XP from capped validated active minutes,
  quest completion, active-day consistency, and versioned achievements. XP
  grants no gameplay advantage.
- Missed days do not destroy lifetime progress. Daily-streak pressure is
  reframed as an optional weekly consistency card that resets without shame or
  loss.
- Leaderboards rank only published server-derived pace-neutral scores. They
  never rank pace, distance, calories, location, routes, activity detail, or
  live activity. Global participation is off by default and separately
  revocable.
- Weekly periods use Asia/Kolkata, Monday 00:00 through the following Monday.
  Resets create immutable new periods and snapshots; they never delete history.
- Territory selects each participant's best contiguous 60-minute validated
  window per local day by maximum eligible cell contribution, with earliest
  start as the deterministic tie-break.
- A participant can contribute at most once per cell per local day and only up
  to a published daily eligible-cell cap. Season ladder points use capped
  control-days rather than uncapped cell volume, so faster movement cannot
  sweep more ladder points per hour.
- Weekly cell control is recomputed from the final accepted contribution set
  for immutable snapshot version N. Ties use earliest accepted contribution,
  then a stable opaque participant ID only as a reproducibility fallback;
  upload or worker order never decides control. Reversals and late accepted
  contributions produce a new snapshot version.
- Territory cells reset to unclaimed each week while season points and cosmetic
  ladder progress continue. Other participants' map cells expose no route,
  timestamp, exact start/finish, or owner identity.

## Leaderboards and rank ladder

Leaderboards use explicit scopes and immutable periods:

- **Global** — opt-in only; server-derived; pace-neutral; period-scoped;
  privacy-minimized; segmented by cohort/division when needed for fairness,
  scale, eligibility, or newcomer treatment. Public entries expose only an
  approved display identity/cosmetic, score, tier, rank band or numeric rank
  where allowed, and period — never location, route, activity timestamps or
  details, or live state.
- **Friends** — optional friend weekly board plus private 1v1 results, with
  independent visibility controls.
- **Club** — accessible only to active members of that club. Club boards,
  competitions, and challenges are isolated by `club_id`; leaving, removal,
  suspension, or club archive immediately removes access while preserving
  audited historical results according to policy.
- **Competition and territory** — visible only to enrolled participants under
  the published event/division rules.

There is no nearby-runner leaderboard or location-based discovery. Rank tiers
are cosmetic season bands based on capped pace-neutral points. Global and other
numeric ranks appear only after the person opts into the applicable scope.

## Safety reconciliation

| PDF idea                            | Decision       | Safe product form                                                                                                                                                     |
| ----------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Faster runner takes a zone          | Rejected       | Equal-value cell traversal, daily cap, weekly ownership rounds, no speed comparison                                                                                   |
| Nearby live runners                 | Rejected       | Mutual friends and clubs with no live-location discovery                                                                                                              |
| Real-time territory battles         | Rejected       | Asynchronous challenges and post-validation territory updates                                                                                                         |
| Exact friend tracking               | Rejected       | Existing explicit, delayed ≥15-minute, coarse ≥500 m safety-contact sharing only                                                                                      |
| Global/nearby/distance leaderboards | Split decision | Approve opt-in global period boards using privacy-minimized pace-neutral points and cohort/division controls; reject nearby/location boards and distance/pace ranking |
| Smart routes to contested territory | Reframed later | Curated safe quest recommendations using coarse availability and non-pace inputs; no adversary targeting                                                              |
| AI fitness/stamina analysis         | Reframed later | Transparent rules using active-load bands; no health diagnosis or opaque athletic rating                                                                              |
| Route sharing                       | Reframed       | Server-trimmed route or summary-only share; no map when trimming leaves too little geometry                                                                           |
| XP and streaks                      | Reframed       | Cosmetic capped progression and non-punitive weekly consistency                                                                                                       |
| WebSockets and Redis by default     | Deferred       | Durable inbox, push, PostgreSQL read models, ETags, and polling first; add cache only after load evidence                                                             |
| Photos, comments, AR, wearables     | Deferred       | Require separate privacy, moderation, cost, and platform decisions                                                                                                    |

## Architecture direction

Keep one Fastify API, one worker deployment, and one PostgreSQL/PostGIS
authority. Do not split into microservices at this maturity level; scale a
measured bottleneck only when its forecast and operating owner are approved.
See [`architecture.md`](architecture.md) for the applied topology and
[ADR-0009](adr/0009-durable-notifications-first.md) for the
Redis/WebSocket deferral.

Use explicit domain evaluators and tables rather than a generic JSON game
engine. Keep raw traces and account-level H3 traversal restricted. Store H3
indexes as strings with pinned H3 library, resolution, algorithm,
privacy-policy, and scoring-rule versions (see ADR-0008).

PostgreSQL remains authoritative for standings. Maintain rebuildable global,
club, competition, and territory snapshots plus private response caches with
short TTLs/ETags. Add Redis only if measured load shows PostgreSQL cannot meet
defined read/write gates and the forecasted overage has the required approval.

## Mobile information architecture

The recommended five-tab structure is:

- **Home** — start activity, weekly consistency, progression summary, pending
  results, next safe action.
- **Explore** — free activity and curated quests; no initial location
  disclosure.
- **Play** — friend challenges, opted-in global/friend leaderboards,
  competition cards, and truthful season states.
- **Clubs** — club discovery by invite/exact code, active membership,
  club-isolated leaderboards/challenges/competitions, aggregate relays, and
  moderation controls.
- **You** — private history, achievements, progression, account/email,
  notifications, privacy, safety, legal, export, and deletion.

Loop remains a restrained guide. It may explain empty, pending, weekly reset,
challenge-invite, and other safe states, including beside Android modal/dialog
cards. Companion callouts require per-surface/session frequency caps, explicit
dismissal, predictable TalkBack order, static reduced-motion treatment, and no
validation authority, cheating diagnosis, shame, permission pressure, false
urgency, or representation of another person/location. See
[`mascot-assets.md`](mascot-assets.md).

## Admin information architecture

The single review page expands into role-gated areas:

1. Overview and operational health.
2. Activity and scoring review with provenance, but no routine raw GPS access.
3. Quest/place catalog and closure controls.
4. Gameplay rules, weekly periods, competitions, seasons, divisions, and
   feature rollout.
5. Clubs, reports, blocks, sanctions, and appeals.
6. Communications for templates, notification health, and campaign
   draft/test/schedule/pause.
7. Accounts, privacy requests, suppression, legal versions, and audit logs.

Campaign audiences may use consent, locale, app version, feature cohort, and
broad recency bands. They must not use raw/coarse location history, pace,
health inference, exact quest history, or unreviewed free-form SQL.

## Account, notification, and legal foundations

- Complete signup verification, resend throttling, password reset, change-email
  verification, old-address alert, session revocation, suppression/bounce
  handling, and deletion convergence.
- Provide both in-app deletion and a public web deletion-request path for
  Google Play account-deletion compliance.
- Separate transactional email from opt-in product campaigns. Add visible and
  one-click unsubscribe for campaigns, provider authentication, signed webhook
  handling, send caps, test sends, and audited pause/cancel.
- Use a durable in-app inbox as source of truth. Push contains an opaque
  notification ID and safe deep link, not location or sensitive scores. Request
  Android notification permission in context and honor category preferences,
  quiet hours, and frequency caps.
- Version Terms, Privacy Notice, Community Guidelines, Competition/Season
  Rules, retention, and consent records. Update disclosures for location
  derivation, H3 territory, social identity, challenges, clubs, moderation,
  profiling/recommendations, analytics, processors, push, email, export, and
  deletion.
- Confirm the final implementation against current MeitY DPDP Rules, Google
  Play UGC/account deletion policies, Android notification requirements, and
  sender-provider rules before public rollout.

## Cost governance

₹3,000/month is a soft operating target, not a launch ceiling. Every phase
needs base, expected-growth, and stress forecasts with feature-unit assumptions
and actual-versus-forecast review. Recommended approval bands:

| Band   | Range                                | Approval                                                        |
| ------ | ------------------------------------ | --------------------------------------------------------------- |
| Green  | ≤ ₹3,000                             | Normal                                                          |
| Amber  | > ₹3,000–₹4,500                      | Product/operations owner                                        |
| Orange | > ₹4,500–₹7,500                      | Budget/finance owner, with a growth or territory case           |
| Red    | > ₹7,500 or a material forecast miss | Executive budget approval and an explicit continuation decision |

Owners may tune band values before rollout, but must not remove the bands.
Alerts fire before and within each band. Graceful controls reduce staging
uptime, campaign throughput, optional analytics/log volume, map/geocoding
misses, and snapshot refresh frequency before limiting enrollment or deferring
expansion. Cost controls must never weaken authentication, privacy trimming,
validation, deletion, moderation, legal/security notices, backups, or audit
evidence. Justified overage is allowed for measured growth, territory
processing, or reliability when the approval, owner, duration, success metric,
and rollback are documented. See [`cost-model.md`](cost-model.md).

## Primary dependencies

- Production HTTPS API route that preserves authorization for authenticated
  Android testing.
- Approved map provider origin and attribution terms.
- Physical-device GPS, distance, battery, and MMR territory-cell field study.
- Transactional/campaign email provider, Android FCM credentials, and signed
  webhook configuration.
- Staff role ownership for data stewardship, moderation, privacy requests,
  campaigns, and season operations.
- Legal review of adult eligibility, DPDP notices/rights, community rules,
  competition terms, retention, and promotional email consent.
