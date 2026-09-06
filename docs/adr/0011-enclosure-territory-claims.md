# ADR-0011: Enclosure territory claims — named holders and pace-based takeovers

- **Status:** Accepted
- **Date:** 2026-09-06
- **Supersedes, in part:** ADR-0005, ADR-0008 (see "What this reverses")

## Context

The product owner asked for a second, different territory mechanic: run a closed
loop and hold the ground it encloses; your name and picture sit on the map; when
somebody runs the same ground faster, they take it.

That is a well-understood game — the Qix/paper.io lineage applied to running —
and it is the mechanic the reference design shows. It is also, in three specific
ways, the opposite of what this codebase had already committed to. Those
conflicts were raised before implementation and the direction was confirmed, so
this ADR records the reversal rather than leaving two documents contradicting
each other.

## Decision

Ship **enclosure claims** as a mechanic independent of the H3 cell engine.

- A run's **longest closed stretch** — the widest-separated pair of points that
  return within 60 m of each other — becomes a polygon.
- The **time across that stretch** is the claim's price. A warm-up before and a
  cool-down after are excluded, so approaching the loop costs nothing.
- A new loop **contests** a held claim when at least 60% of its area lies inside
  it, and **takes** it only if strictly faster. A tie leaves the ground where it
  is.
- The map shows the boundary, the holder's display name and avatar, and the time
  to beat.
- Claiming is an **explicit act**. A run does not reach the map because somebody
  went running; they choose to claim it.

The two mechanics do not share tables, rules, or feature flags.
`TERRITORY_CAPTURE_ENABLED` still gates the cell engine and stays false.

## What this reverses

| Earlier decision                    | What it said                                                     | What this does                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **ADR-0005** pace-neutral scoring   | Scoring must not reward faster movement                          | Speed is the whole contest. Worse: enclosed area grows with the _square_ of the perimeter, so distance compounds too |
| **ADR-0008** anonymous cells        | A cell may expose that it is held and nothing about who holds it | The holder is named and pictured, and the boundary **is** the path they ran                                          |
| **`gameplay.md`** out-of-scope list | "pace-based takeovers" listed as explicitly not built            | Built                                                                                                                |

Nothing about the H3 cell engine changes. ADR-0005 and ADR-0008 still govern it,
and `territory-scoring.ts` still refuses to run.

## Consequences

**Accepted, with eyes open:**

- **This is not a fair contest between runners of different ability.** The
  quadratic area payoff means a faster runner covering more ground wins more than
  proportionally. Anyone reading the standing should read it as a game result,
  not as a measure of effort.
- **Publishing a claim publishes a route.** A polygon's boundary is where
  somebody ran. There is no version of this mechanic that shows held ground
  without showing the path that enclosed it.
- **Named holders on a map of real streets is a safety surface.** The mitigations
  below are what stand between the mechanic and the obvious harms, and they are
  the part to review hardest.

**Mitigations kept from the existing design:**

- Claims from an account under a **sharing suspension** are neither made nor
  shown, the same as every other social surface.
- Only **display identity** appears — the same projection friends and boards
  already use. No email, no contact details, no activity detail beyond the loop.
- A loop above **5 km²** is refused. That is a ~9 km perimeter at best and in
  practice means a vehicle, which is the cheapest way to abuse an area-times-speed
  mechanic.
- A loop below **5,000 m²** is refused, so a roundabout or GPS drift is not a
  claim.
- Claims are **never deleted**, only released, so "who took mine" is always
  answerable.
- Claiming is **opt-in per run**, so nobody's routine appears on a public map
  because they forgot a setting.

**Closed since (2026-09-06):**

- **Abuse review, in part.** `run-integrity.ts` refuses a claim from a trace no
  runner could have produced and records it for a human. It judges physics only
  — speed, acceleration, teleports, straightness — never where or when somebody
  ran. It flags; it never punishes.
- **Privacy zones now apply to claims**, which they did not when this ADR was
  written. ADR-0002 requires zones before any activity geometry is shared, and a
  claim boundary is shared activity geometry — so the first version of this
  mechanic broke a documented invariant. A loop within 200 m of one of the
  claimant's own zones (the same radius the activity trimmer uses) is **refused
  rather than trimmed**: a polygon cannot be partly published, because removing a
  segment does not leave a closed ring. Only the claimant's own zones apply — a
  zone protects its owner's route from publication, and this is their route.
- **The stored ring no longer says where the run began.** A polygon never showed
  the starting point, but the coordinate array did, and on a loop run from home
  the first coordinate is the front door. Rings are rotated to a vertex chosen by
  geography before storage.

**Known gaps, not yet addressed:**

- **Home-address protection depends on the runner having set a zone.** Claims
  now respect privacy zones, but a zone is something somebody has to create.
  Nothing detects that a loop starts and ends at the same building every time
  and asks whether that should be protected, and the most exposed people are
  exactly the ones who have not thought about it.
- **Coordinated claim-trading** is still unexamined: two accounts can hand
  ground back and forth, and nothing looks at the pattern.
- **No concentration guardrail.** `product.md`'s top-10%/top-user limits apply to
  the cell engine's divisions; this mechanic has no equivalent.
- Nothing has run against a real database or a real trace.

## Alternatives considered

- **Keep enclosure but score it pace-neutrally** (hold ground by returning on
  more days, as the cell engine does). Rejected: it removes the takeover, which
  is the mechanic that was asked for.
- **Show held ground without naming holders.** Rejected for the same reason — the
  reference design is a map of _people_, and an anonymous version is the cell map
  that already exists.
- **Claim automatically after every run.** Rejected: putting somebody's name on a
  public map is an act they should take deliberately.
