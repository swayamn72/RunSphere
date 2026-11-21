# AGENTS.md — RunSphere

Instructions for any coding agent (Claude Code reads `CLAUDE.md` directly).

**Read [`CLAUDE.md`](CLAUDE.md) first.** It is the maintained guide: layout, commands, conventions,
where shared rules live, local pitfalls and guardrails. Then:

1. [`IMPLEMENTATION_ROADMAP.md`](IMPLEMENTATION_ROADMAP.md): what is done (✅), partial (🟡) and open.
   Pick work from here.
2. [`BUGS_AND_RISKS.md`](BUGS_AND_RISKS.md): known bugs and risks, with fixed ones marked.
3. [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md): the state of each feature, per surface.
4. [`PROJECT_ARCHITECTURE.md`](PROJECT_ARCHITECTURE.md): how the pieces fit, and where `docs/`
   disagrees with the code (§9).
5. [`docs/adr/`](docs/adr/): product decisions. Supersede one with a new ADR rather than contradict it.
6. [`docs/plans/m9-run-modes-metrics-tutorial.md`](docs/plans/m9-run-modes-metrics-tutorial.md): the
   detailed plan for the current milestone (M9: independent run modes, run metrics, run log and
   detail with the drawn route, guided tour). The owner's decisions in its section 1 are settled.
7. Launch compliance (M8) lives in [`docs/play-store-submission.md`](docs/play-store-submission.md),
   [`docs/incident-response.md`](docs/incident-response.md) and `services/api/src/legal-pages.ts`.
   Keep them true when behaviour changes. All user-facing copy follows [`docs/voice.md`](docs/voice.md).

Trust the code over `docs/`; `docs/pending-work.md` is superseded.
