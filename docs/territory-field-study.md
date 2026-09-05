# Territory field study protocol (MMR)

**Status:** Written, never run. **This is the one Phase 4 deliverable that
cannot be produced by writing code**, because what it measures is what happens
when real phones move through a real city. It is written now so that the study
is designed before anybody is under pressure to pass it.

The release plan gates the territory pilot on this study
([`release-plan.md`](release-plan.md), M3). Nothing below can be answered from
the unit tests: every one of them uses a fake indexer that reads a cell off a
latitude, and no part of the engine has ever processed a real trace.

## What the study is for

Four questions, in the order they can invalidate each other. There is no point
measuring fairness in a city where the cell inventory cannot support a season.

1. **Is there enough ground?** `product.md` sets the cell-scarcity guardrail: no
   launch area is eligible unless its reachable public cell inventory supports a
   modelled **10 distinct eligible cells per enrolled participant at target
   enrollment**. At the 100–250 division target that is 1,000–2,500 eligible
   cells in reach of the people in it.
2. **Does the same route produce the same cells?** GPS noise at H3 resolution 9
   (roughly 174 m across) will move a point over a cell edge. If two runs of one
   route disagree materially, control is being decided by noise.
3. **Is the measure actually pace-neutral?** ADR-0005 and ADR-0008 both depend
   on it. The engine counts distinct cells once per day, so a faster participant
   should gain nothing per hour that a slower one covering the same ground does
   not.
4. **What does it cost the phone?** The release plan sets battery and background
   behaviour targets for Android v1; territory adds no new sensor, but it does
   extend the window in which a trace must be retained (see below).

## Who runs it, and what they are told

Recruited participants, not staff who know what the study is checking. Each
person is told, before consenting: exactly what is recorded, that the raw trace
is kept only for the retention window and then purged, that the study data is
separable from their account, and that they can withdraw and have their
contribution deleted. Consent is per-participant and written.

**Nobody is recruited for a route that takes them somewhere they would not
otherwise go.** A study that asks people to walk unfamiliar ground after dark to
fill in a cell map is a safety problem wearing a research badge.

## Protocol

### A. Cell inventory (desk work, before anybody walks)

Model the eligible public-space cells in the candidate MMR cluster at the
season's pinned resolution. This depends on the public-space eligibility dataset
that **does not exist yet** — it is the first blocker in
[`HANDOFF.md`](HANDOFF.md), and this step cannot start without it.

Record: total eligible cells, cells within 2 km of each candidate division's
enrolled centroid, and the modelled cells-per-participant at 100, 175, and 250
enrolled. **Fail the cluster** below 10 per participant rather than shrinking the
division to make the number work.

### B. Route repeatability (2 people × 3 routes × 3 repetitions)

Three routes chosen for different signal conditions: open park, mixed street
canyon, and a covered or dense-building stretch. Each walked or run three times
by the same person at a consistent effort.

Record per repetition: the accepted cell set, the best-window start, and the
count of cells that appear in some repetitions and not others.

**Threshold:** the symmetric difference between any two repetitions of the same
route by the same person should be **under 10% of the mean cell count**. Above
that, control is noise-driven and the resolution or an edge-hysteresis rule
needs revisiting before a season runs.

### C. Pace neutrality (2 people × 1 route × 2 paces)

The same route covered by the same person at an easy pace and at a hard pace,
and by two people of clearly different speeds.

**Threshold:** accepted cell counts within **5%** across paces. A faster pace
producing materially more cells means the daily window is rewarding speed, which
is the failure ADR-0005 exists to prevent.

### D. Concentration simulation (desk work)

Replay the collected traces as a synthetic 6-week season across a simulated
division, and compute the guardrails daily
([`product.md`](product.md)): top 10% ≤ 35% of season points, top participant
≤ 8%.

Note the finding already recorded in the code: **below 13 participants the 8%
limit is arithmetically unreachable**, so the simulation must run at realistic
division sizes or it will report a breach that is about arithmetic rather than
about the game.

### E. Device cost (all participants)

Battery drain per hour of tracking, background-restriction behaviour, and
thermal state, on the reference Android device set. Compared against the same
routes recorded without a territory season active — territory adds no sensor, so
any difference is processing and retention, not capture.

## The scheduling constraint this study must respect

Timestamped points live only in `activity_chunks`, which are purged on the
raw-trace retention clock; `activity_derivations.shareable_route` is a geometry
with no time dimension, and the best-contiguous-window rule needs times.

**Territory scoring must therefore run inside the retention window, and a season
cannot be scored retroactively once traces are purged.** For the study this
means the analysis window is bounded by retention, and any re-analysis has to be
planned before the traces go — not discovered afterwards. This is the right
privacy outcome (the trace goes, the cells remain) and a real constraint on how
the study is run.

## What the study cannot answer

- **Abuse.** Deliberate manipulation — spoofed locations, vehicle traversal
  dressed as running, coordinated cell farming — is an adversarial question, and
  a recruited study of cooperative participants will not surface it. The
  anti-abuse review in the Territory gate is a separate piece of work.
- **Whether people want this.** Repeatability and neutrality are correctness
  properties. They say nothing about whether a season is worth running.

## Exit criteria

The Territory gate should read this study and be able to answer yes to all of:

- cell inventory ≥ 10 eligible cells per participant at target enrollment;
- route repeatability within 10%;
- pace neutrality within 5%;
- simulated concentration inside the guardrails at realistic division size;
- device cost within the Android v1 battery and background targets.

Any "no" is a reason to ship quests without a season
([`release-plan.md`](release-plan.md) says exactly that), not a reason to adjust
the threshold.
