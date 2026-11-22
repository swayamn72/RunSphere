# ADR-0015: Who sees your runs by default

- **Status:** Accepted
- **Date:** 2026-11-22
- **Decided by:** product owner (M9 plan section 1.6, answered 2026-11-22)
- **Amends:** [ADR-0014](0014-social-identity-and-privacy-controls.md), its "Never shared,
  whatever the settings" list: exact start and finish points come off it. Everything else in
  ADR-0014 stands.

## Context

M9 adds a run log to profiles (tasks 9.13–9.15), so other people will see runs for the first
time. The privacy settings already exist (migration 050, 053) but nothing read them. The owner
was asked who sees runs by default, whether viewers see the route, and whether runs recorded
during the closed beta become visible.

ADR-0014 listed exact start and finish points as never shared. The owner chose to show the full
route by default instead, knowing that many runs start and end at home: the runner decides, and
can hide them.

## Decision

- **Each runner chooses** who sees their runs: Everyone, Friends or Only me. The default for a
  runner who hasn't chosen is **Friends**.
- **The route map is shown** to those viewers by default (`show_route_maps` on).
- **Start and finish are not trimmed by default** (`trim_start_finish` off for new accounts,
  migration 056). "Hide start and finish" in Privacy settings still cuts the first and last
  200 m for viewers when a runner turns it on.
- **Privacy zones always apply**, whatever the settings: route inside a zone is removed on the
  server before anyone else sees it (ADR-0002).
- **Start times stay hidden** by default (`show_start_times` off): viewers see the date only.
- **Runs recorded before the run log ships become visible** under these settings straight away.
  Beta runs are cleaned up before launch, so no one-off migration of them is needed.
- Blocks hide runs both ways, as ADR-0014 already says for everything else.

## Consequences

- Friends can see where a runner starts and finishes unless the runner saves a privacy zone or
  turns on the trim. The one-time "Who sees your runs?" prompt (9.27) and onboarding's privacy
  zone prompt are where a runner learns this; their copy must say it plainly (`docs/voice.md`
  rule 8).
- The legal pages and Play listing must say that runs, stats and routes are visible to others per
  these settings (9.26, 9.28).
- Accounts created before migration 056 keep the trim on, because nothing records whether they
  chose it.
