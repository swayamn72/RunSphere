# RunSphere voice guide

How the app talks. Applies to every user-facing string: screens, errors, empty states, notifications,
emails and Rho. Milestone 2.5 (UX.5) introduced it; UX.6–UX.8 apply it.

## The voice in one line

A calm training partner who knows the ground: short, direct, specific, and on your side.

## Rules

1. **Short.** One idea per sentence. Most labels are 1–3 words; most messages fit on one line.
2. **Active, second person.** "You claimed 1.2 km²", not "1.2 km² has been claimed".
3. **Runner words, not system words.** Say _run, loop, ground, pace, zone, crew_. Never say
   _server, deployment, configured, validated, derivation, provenance, canonical, policy version,
   payload, trace_ in normal UI. (Legal, privacy and permission screens may be precise; keep them
   plain anyway.)
4. **Numbers first.** "3.2 km · 18:40" before any adjective. Use the unit the runner thinks in: km,
   min/km, m².
5. **Say what happens next.** Every error and empty state ends with what the runner can do, or with
   the reassurance that nothing was lost.
6. **Never blame or shame.** No "you failed", "too slow" or "you missed". Pace is never a judgement
   (ADR-0005). Rivals beat ground, not people.
7. **Honest.** Don't claim what the server hasn't confirmed ("Claimed!" only after the claim lands).
   Don't fake data: an empty state is better than a zero we made up.
8. **Privacy stays plain and visible.** When we hide or trim something, say so in one line, without
   alarm.

## Tone by moment

| Moment       | Tone                            | Example                                                       |
| ------------ | ------------------------------- | ------------------------------------------------------------- |
| Before a run | Encouraging, practical          | "Warm up 5 min, then loop the block once."                    |
| During a run | Few words, glanceable           | "Close the loop · 240 m"                                      |
| After a run  | Specific, proud, factual        | "3.4 km in 19:02. Your loop holds 0.8 km² of Bandra."         |
| Lost ground  | Matter-of-fact, with a way back | "Ravi took 0.2 km². Run it faster to win it back."            |
| Errors       | Calm, what to do, nothing lost  | "No connection. Your run is saved and will upload later."     |
| Empty states | Inviting, one action            | "No ground yet. Run a closed loop to claim your first block." |

## Before → after (from the current app)

| Before                                                                                                      | After                                                            |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| "Friends are unavailable until RunSphere is configured."                                                    | "Friends aren't available right now. Try again later."           |
| "Challenges are not available on this server yet."                                                          | "Challenges are coming soon."                                    |
| "Club boards are unavailable until scoring is published on this deployment."                                | "Club boards aren't live yet."                                   |
| "GPS has been unavailable for over a minute. Route and distance contribution are paused until it recovers." | "GPS lost. Keep running; distance resumes when signal is back."  |
| "Saved privately — not eligible for validated totals"                                                       | "Saved, but not counted: GPS was too patchy."                    |
| "That club could not be created. Nothing was created."                                                      | "Couldn't create the club. Check your connection and try again." |
| "RunSphere could not reach the service. You can still run the loop."                                        | "Offline. You can still run; we'll sync when you're back."       |

## Rho, the field coach

Rho is a steady training partner, not a drill sergeant (`crew.ts`, `loop-guidance.ts`).

- Speaks in cues: "Hold this line 400 m to close the loop." "Easy pace here, the hill comes next."
- Pace-neutral: talks about routes, loops and consistency, never about being faster than someone.
- One line at a time, at most one cue per screen.
- Never says: "push harder", "don't be lazy", "you're behind", "beat them".

## Checklist for a new string

- [ ] Could a runner mid-stride read it in two seconds?
- [ ] No banned system words (rule 3)?
- [ ] Says what to do next, or that nothing was lost?
- [ ] Nothing shaming about pace or effort?
- [ ] Only states what the server has confirmed?
