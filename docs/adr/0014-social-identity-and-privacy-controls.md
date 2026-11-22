# ADR-0014: Social identity, discovery and privacy controls

- **Status:** Accepted; amended by [ADR-0015](0015-run-visibility-defaults.md) (start and finish
  points may be shown)
- **Date:** 2026-11-21
- **Decided by:** product owner ("I want it kind of like a social platform"; defaults chosen
  2026-11-21)
- **Amends:** [ADR-0007](0007-opt-in-privacy-minimized-leaderboards.md) (discovery and the
  friend board). Everything else in ADR-0007 stands.

## Context

Friends are added by the exact email address the other person signed up with, and nobody can be
found any other way. That protects privacy but makes RunSphere feel closed: it is hard to grow a
running crew when you have to ask for an email first. The product owner wants a social platform
in the style of the large running apps: usernames, profiles, search, and a clear set of privacy
controls the runner owns.

Turf raises the stakes. Held ground is drawn on a public map with the holder's badge, and many
runners start at their front door, so a searchable name next to "holds the block around this
park" can lead a stranger to someone's home. Privacy zones (ADR-0002) already stop a claim near a
zone and trim shared routes, but only for runners who saved one, and the setting is buried.

The launch is in India: the Digital Personal Data Protection Act 2023 and Rules 2025 require
clear notice, specific consent and parental consent for children; the IT (Intermediary
Guidelines) Rules 2021 apply once members publish usernames and profiles.

## Decision

### Identity

- Every account has a unique **@username**: 3–20 characters, lowercase letters, digits and `_`,
  starting with a letter, unique ignoring case, filtered against reserved and offensive words.
  Existing accounts get one generated and are asked to confirm or change it.
- The existing **display name** and cosmetic avatar stay.
- **Date of birth** replaces the "I'm 18 or older" checkbox. Sign-up refuses anyone under 18. It
  is used only for that check and is never shown to anyone, including the account's friends.
- **Home area** is optional: a neighbourhood chosen from a list (for example "Bandra West"), never
  a point or an address. It may be shown on the profile and used for local suggestions.
- **Gender is not collected.** Add it only alongside a feature that needs it, with its own ADR.

### Discovery

- Runners can be found by **username search**, by **QR code** and by **invite link**, and from a
  name on the Turf map or a leaderboard. Adding by email remains as a fallback.
- **No location-based discovery** ("runners near you", nearby lists, distance to a runner). This
  part of ADR-0007 is unchanged.

### Privacy controls

One "Privacy & visibility" screen. Defaults in brackets. The server enforces every one of them;
the app only displays what the server already filtered.

| #   | Control                                  | Options                                           |
| --- | ---------------------------------------- | ------------------------------------------------- |
| 1   | Profile visibility                       | Everyone / Friends / Only me [Everyone]           |
| 2   | Appear in username search                | On / Off [On]                                     |
| 3   | Who can send friend requests             | Everyone / Friends of friends / Nobody [Everyone] |
| 4   | Who can see my runs (stats only)         | Everyone / Friends / Only me [Friends]            |
| 5   | Show route maps on shared runs (trimmed) | On / Off [On]                                     |
| 6   | Privacy zones                            | list, add, remove [prompted at onboarding]        |
| 7   | Show run start times                     | On / Off [Off: shows "Morning run"]               |
| 8   | Show my username on ground I hold        | On / Off [On for Everyone profiles, else Off]     |
| 9   | Draw my ground on the map for others     | On / Off [On]                                     |
| 10  | Friend board                             | On / Off [On]                                     |
| 11  | Club boards                              | On / Off [existing opt-in]                        |
| 12  | Global and city boards                   | On / Off [Off, ADR-0007]                          |
| 13  | Allow Ghost Races on my loops            | On / Off [On]                                     |
| 14  | Notifications by category                | existing                                          |
| 15  | Safety contacts and shares               | existing                                          |

Plus: download my data, delete my account (ADR-0012), and the blocked accounts list.

The profile default is **Everyone**, chosen on screen during onboarding with that option
pre-selected, so the choice is visible and deliberate.

### Never shared, whatever the settings

Live location, raw GPS, anything inside a privacy zone, date of
birth and email address. (Exact start and finish points were on this list until ADR-0015.) A blocked account sees nothing of the blocker, and the blocker does not
appear in the blocked account's search.

### Onboarding

Email and password → date of birth → username, display name, avatar → profile visibility →
optional home area → privacy zone prompt ("Hide your home or work from your routes?", skippable)
→ location and notification permissions.

## Consequences

- The friend board stops being automatic: it becomes control 10, on by default. ADR-0007's
  opt-in rule for the global board is unchanged.
- An **Only me** profile is still shown on boards the runner joined, by username only, so boards
  keep working; it cannot be searched or opened.
- "Anonymous" ground (control 8 off) shows a "Runner" badge to strangers and the username to
  friends. Contested and takeover notices to the other runner use the same rule.
- The operator must publish a privacy policy and terms that describe public profiles, and name a
  grievance officer, before launch. Legal review recommended.
- Migration adds a unique username, date of birth, optional home area and a per-account
  `privacy_settings` row. Existing accounts get defaults that are **no more public** than today
  (profile Friends, search Off) plus a one-time prompt to review them; only new sign-ups get the
  Everyone default.
