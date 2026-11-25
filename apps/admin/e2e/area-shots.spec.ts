import { test } from '@playwright/test';
import { goTo, mockApi, signIn } from './mock-api';

/**
 * Every area, with realistic data, at three widths in both themes, saved to
 * `test-results/areas/`. For looking at: they assert nothing.
 */
const quest = { id: 'q-1', title: 'River Bend Run', checkpointCount: 4, estimatedActiveMinutes: 14, timeLimitMinutes: 25, published: true };
const responses = {
  'GET /v1/staff/activity-review-queue': {
    data: [
      { id: '7f3a9c1e-2b4d-4e8a-9c1d-0a1b2c3d4e5f', status: 'rejected', submittedAt: '2026-11-24T09:12:00.000Z', rejectionReason: 'Speed was not possible on foot.', validationErrors: [] },
      { id: '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5', status: 'validating', submittedAt: '2026-11-24T10:40:00.000Z', validationErrors: [] },
      { id: '9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', status: 'received', submittedAt: '2026-11-25T07:05:00.000Z', validationErrors: ['gap in trace'] }
    ]
  },
  'GET /v1/staff/reports': {
    data: [
      { id: 'r-1', subjectType: 'account', subjectId: 'a-1', subjectName: 'Ravi K', reason: 'abusive_name', note: 'Offensive handle on the Bandra board.', openReportCount: 2 },
      { id: 'r-2', subjectType: 'club', subjectId: 'c-1', subjectName: 'Dawn Patrol', reason: 'spam', note: '', openReportCount: 1 }
    ]
  },
  'GET /v1/staff/appeals': { data: [{ id: 'ap-1', sanctionKind: 'social_suspension', sanctionStatement: 'Your handle broke the rules.', statement: 'It was a joke between friends.' }] },
  'GET /v1/competitions': { data: [
    { id: 'c-1', title: 'December Dash', status: 'draft', periodStart: '2026-12-01', periodEnd: '2026-12-14', participantCount: 0 },
    { id: 'c-2', title: 'November Streak', status: 'finalized', periodStart: '2026-11-01', periodEnd: '2026-11-30', participantCount: 214 }
  ] },
  'GET /v1/staff/quests': { data: [quest, { ...quest, id: 'q-2', title: 'Carter Road Promenade', timeLimitMinutes: null, published: false }] },
  'GET /v1/staff/campaigns': { data: [{ id: 'k-1', templateKey: 'winter-welcome', status: 'draft', sendCap: 500, queuedCount: 0, sentCount: 0 }] },
  'GET /v1/staff/email-templates': { data: [{ key: 'winter-welcome', version: 2, subject: 'Welcome back', live: true }] },
  'GET /v1/staff/privacy/requests': { data: [{ accountId: 'a-77', kind: 'deletion', requestedAt: '2026-11-20T00:00:00.000Z', openForHours: 80 }, { accountId: 'a-78', kind: 'export', requestedAt: '2026-11-25T00:00:00.000Z', openForHours: 3 }], completedDeletions: 12 },
  'GET /v1/staff/rules': { data: [{ kind: 'territory.points', version: 2, definition: { sqmPerPoint: 100 }, effectiveAt: '2026-11-01T00:00:00.000Z', live: true }, { kind: 'quest.limits', version: 1, definition: { max: 600 }, effectiveAt: '2026-10-01T00:00:00.000Z', live: false }] },
  'GET /v1/staff/territory/concentration': { holders: 40, totalAreaSqm: 2500000, topDecileShare: 0.31, topHolderShare: 0.08, applicable: true, breached: false, scopeNote: 'Measured over ground held right now.' },
  'GET /v1/staff/territory/trade-flags': { data: [{ id: 'f-1', lineageId: 'l-1', exchanges: 6, pairShare: 0.9, firstAt: '2026-11-01T00:00:00.000Z', lastAt: '2026-11-10T00:00:00.000Z' }], note: 'A flag is a question, not a verdict.' },
  'GET /v1/staff/territory/seasons': { data: [{ id: 's-1', title: 'November', status: 'live' }] }
};
const areas = ['Activity review', 'Moderation', 'Competitions', 'Turf claims', 'Quests', 'Territory seasons', 'Campaign email', 'Privacy requests', 'Data stewardship', 'Support'];
const sizes = [{ n: 'phone', width: 375, height: 900 }, { n: 'desktop', width: 1280, height: 900 }];

for (const theme of ['light', 'dark'] as const)
  for (const size of sizes)
    test(`areas: ${theme} ${size.n}`, async ({ page }) => {
      await page.addInitScript((v) => localStorage.setItem('rs-theme', v), theme);
      await page.setViewportSize({ width: size.width, height: size.height });
      await mockApi(page, { roles: ['admin', 'support'], responses });
      await page.goto('/');
      await signIn(page);
      for (const area of areas) {
        await goTo(page, area);
        await page.getByRole('heading', { level: 1, name: area, exact: true }).waitFor();
        await page.waitForTimeout(150);
        await page.screenshot({ path: `test-results/areas/${theme}-${size.n}-${area.replace(/ /g, '-')}.png`, fullPage: true });
      }
    });
