# Gamified Product Expansion — Detailed Implementation Plan

**Status:** Phase 1 (Foundation Gate) Complete. Ready to start Phase 2 (MVP).
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

### Milestone 2.1 — Mobile API Client Extensions
- **Task:** Update `apps/mobile/src/api-client.ts` with typed methods for all Phase 1 and Phase 2 API routes.
- **Endpoints:** `getProfile`, `getProgressionSummary`, `getAchievements`, `listFriends`, `listFriendRequests`, `sendFriendRequest`, `respondFriendRequest`, `getNotificationInbox`, `createChallenge`, `listChallenges`, `respondChallenge`.

### Milestone 2.2 — Tab Navigation Update
- **Task:** Rename the `Season` tab placeholder to `Play` (the PRD IA uses "Play" for challenges/standings).
- **Files:** `navigation/types.ts`, `navigation/TabBar.tsx`, `ProductScreens.tsx`. Update icons and labels.

### Milestone 2.3 — Home Tab: Progression & Consistency
- **Task:** Add new UI cards to the Home screen below the existing weekly goal.
- **Progression Card:** Display current XP, level, tier cosmetic, and progress bar. Fetch from `GET /v1/progression`.
- **Consistency Card:** Display active days this week (0-7 dots) and capped active minutes. Must be non-punitive (no red marks for missed days). Fetch from `weeklyConsistency` in progression summary.
- **Model:** Create `home-progression-model.ts` for pure UI state derivation.

### Milestone 2.4 — Play Tab: Challenges & Friend Standings
- **Task:** Replace the `PlayScreen` placeholder with real gamification UI.
- **Features:** 
  - Pending challenge invites (accept/decline).
  - Active challenges with live scores.
  - Friend weekly standings (ranked by active minutes, opt-in only).
  - Empty state with Loop guidance ("Invite a friend").
  - "Create challenge" sheet to pick friend, mode (active_minutes, active_days, quest_completion), and duration.
- **Model:** Create `play-model.ts` to manage challenge lifecycle states.

### Milestone 2.5 — Challenge API & Scoring Worker
- **Task:** Implement the backend for 1v1 challenges.
- **API:** `POST /v1/challenges`, `GET /v1/challenges`, `PATCH /v1/challenges/:id`, `GET /v1/challenges/:id/result`.
- **Database:** Add `018_challenges.sql` migration to create tables for challenge instances and participation.
- **Worker:** Add `challenge.finished` outbox topic handler in `services/worker/src/worker.ts` that calculates `challengeModeScore()`, records results, and emits `notification.created`.

### Milestone 2.6 — Friend Standings API
- **Task:** Implement `GET /v1/friends/standings` in `gamification-routes.ts`.
- **Logic:** Return weekly friend leaderboard. Must verify mutual friendship. Ranked by capped active minutes. Never expose location/route/pace.

### Milestone 2.7 — Notification Push Wiring
- **Task:** Implement real push delivery in the worker.
- **Logic:** If FCM credentials exist, wire `notification.created` in `worker.ts` to send FCM push. Push payload must only contain an opaque notification ID + safe deep link (no sensitive data). If FCM is not ready, add a stub.

### Milestone 2.8 — Loop Guidance & Polish
- **Task:** Implement companion callouts across the app.
- **Features:** Loop guidance for empty states, pending results, weekly resets, and challenge invites. Add frequency caps, dismissal, and TalkBack accessibility for all new UI cards. Ensure new mascot images (Rho, Mira, Coda, Bram) are imported and displayed.

---

## 📅 Phase 3: Community Beta
**Goal:** Expand social features to clubs and global boards.

### Pending Deliverables:
- **Clubs Backend:** CRUD API for clubs, membership/roles (owner/admin/member), invite flows.
- **Club Relays:** Aggregate club-level goals where members contribute capped minutes or quests.
- **Global Boards:** Opt-in, server-derived period leaderboards using privacy-minimized pace-neutral points. Segmented by division.
- **Scheduled Competitions:** API and UI for opt-in time-boxed events with published rules and rewards.
- **Moderation:** Staff queues for reviewing reported user profiles/club names.
- **Campaign Tooling:** Admin API for drafting, testing, scheduling, and sending consented email campaigns with unsubscribe flows.
- **Mobile UI:** Replace `Clubs` tab placeholder with real club discovery, club leaderboards, and relay progress.

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
1. **Mascot Artwork:** Mascot images (Rho, Mira, Coda, Bram) need to be provided and placed in `apps/mobile/assets` so the image-swap hook can use them.
2. **FCM Credentials:** Firebase Cloud Messaging credentials (`google-services.json` + server key) are required for Milestone 2.7 (Push Notifications).
3. **Admin Web App:** The `apps/admin` skeleton exists, but requires the full React UI for staff RBAC, moderation, and campaign management (Phase 3+).
