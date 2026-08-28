# Gamification implementation roadmap

This maps the approved product sequence in [`gameplay.md`](gameplay.md) to
concrete code deliverables. Each work item is a small green change with a
narrow commit, tests proportionate to the boundary, and a feature flag where
behavior is not yet broadly proven. Work is committed and pushed after every
milestone so progress is preserved.

## Phase 1 — Foundation gate (safe gameplay substrate)

Deliver the substrate the later phases build on. Excludes territory, public
social feed, campaign sends, Redis, and WebSockets.

1. **Contracts** — add TypeBox schemas to `@runsphere/contracts` for profiles,
   friend requests, blocks, notification inbox entries and preferences,
   progression/XP, achievements, challenge definitions and participation, club
   membership/roles/relays, competition definitions/enrollment, territory
   enrollment (schema only), legal versions, and campaign drafts.
2. **Schema** — add `infra/postgres/migrations/011_gamification_foundations.sql`
   (and any follow-on migration) for the records listed in
   [`architecture.md`](architecture.md#data-model-and-security), all
   `club_id`-isolated and append-only where required.
3. **Domain evaluators** — pace-neutral progression (capped validated active
   minutes, quest completion, active-day consistency), weekly period
   boundaries (`Asia/Kolkata`), weekly-consistency card, and achievement
   definitions behind `@runsphere/domain`.
4. **Account email lifecycle** — complete signup resend throttling, password
   reset, change-email verification, old-address alert, session revocation,
   suppression/bounce handling, and deletion convergence; public web
   deletion-request path for Play compliance.
5. **Profiles/friends/blocks** — mutual friend authorization, block semantics,
   and the API routes behind them.
6. **Notification inbox/preferences** — durable inbox of record, category
   preferences, quiet hours, frequency caps; outbox fan-out to push with opaque
   notification IDs and safe deep links.
7. **Analytics schema + event fan-out** — versioned non-coordinate events,
   derived counters only; no raw coordinates in analytics or logs.
8. **Legal versions** — Terms/Privacy/Community/Competition-Rules version
   records with consent linkage.
9. **Staff RBAC** — role-gated admin areas replacing the single review page.

## Phase 2 — MVP (private engagement beta)

Cosmetic progression, pace-neutral achievements, weekly consistency reset,
async 1v1 mutual-friend challenges, friend standings, Loop guidance, and push
for invited/finished states. No nearby boards, live battles, or territory.

## Phase 3 — Community beta

Opt-in global period boards, clubs (membership/roles/invites, member-only
boards and challenges, aggregate relays), scheduled competitions, moderation
queue, and consented campaign email tooling.

## Phase 4 — Territory pilot

Optional MMR seasonal territory: H3 traversal, eligible public cells, opt-in
enrollment, divisions, weekly cell resets, season ladder, best contiguous
60-minute daily window, concentration and abuse controls.

## Phase 5 — Measured scale

Only when justified by evidence: iOS parity, optional Redis cache, larger
competitions, more MMR clusters. Wearables, AR, new cities, and public nearby
runners remain deferred pending separate safety and cost decisions.

## Cross-cutting commitments

- Server remains authoritative for scoring, rank, achievements, challenges,
  clubs, competitions, and territory.
- No scoring from rejected/pending activity; deterministic caps and resets.
- Leaderboards are opt-in, pace-neutral, period-scoped, and privacy-minimized.
- Notification/email never contain location or sensitive scores.
- Each phase's forecast and observed spend are reviewed against the operating
  band in [`cost-model.md`](cost-model.md).
