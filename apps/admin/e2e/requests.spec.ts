import { expect, test } from '@playwright/test';
import { goTo, mockApi, signIn } from './mock-api';

/**
 * The redesign changed no request. These specs submit each form and assert the
 * exact method, path and body the API receives.
 */
const open = async (page: import('@playwright/test').Page, area: string) => {
  await page.goto('/');
  await signIn(page);
  await goTo(page, area);
  await expect(page.getByRole('heading', { level: 1, name: area })).toBeVisible();
};

test.describe('moderation', () => {
  const report = {
    id: 'r-1',
    subjectType: 'account',
    subjectId: 'acct-9',
    subjectName: 'Ravi K',
    reason: 'abusive_name',
    note: 'Offensive handle.',
    openReportCount: 1
  };

  test('dismisses a report', async ({ page }) => {
    const api = await mockApi(page, { responses: { 'GET /v1/staff/reports': { data: [report] } } });
    await open(page, 'Moderation');
    await expect(page.getByText('Offensive handle.')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('status')).toContainText('Report dismissed.');
    expect(api.calls).toContainEqual({
      method: 'POST',
      path: '/v1/staff/reports/r-1/resolve',
      body: { action: 'dismiss' }
    });
  });

  test('issues a timed sanction with the statement the account will read', async ({ page }) => {
    const api = await mockApi(page, { responses: { 'GET /v1/staff/reports': { data: [report] } } });
    await open(page, 'Moderation');
    await page.getByRole('button', { name: 'Sanction…' }).click();
    await page.getByLabel(/Pause sharing/).check();
    await page.getByLabel('What they are told').fill('Your handle broke the rules.');
    await page.getByLabel('Hours (leave blank for no end date)').fill('24');
    await page.getByRole('button', { name: 'Issue sanction' }).click();
    await expect(page.getByRole('status')).toContainText('Sanction issued.');
    expect(api.last()).toEqual({
      method: 'POST',
      path: '/v1/staff/reports/r-1/resolve',
      body: {
        action: 'sanction',
        sanctionKind: 'social_suspension',
        statement: 'Your handle broke the rules.',
        durationHours: 24
      }
    });
  });

  test('sends no duration with a warning, which never expires', async ({ page }) => {
    const api = await mockApi(page, { responses: { 'GET /v1/staff/reports': { data: [report] } } });
    await open(page, 'Moderation');
    await page.getByRole('button', { name: 'Sanction…' }).click();
    await page.getByLabel('What they are told').fill('Please change your handle.');
    await page.getByRole('button', { name: 'Issue sanction' }).click();
    await expect(page.getByRole('status')).toContainText('Sanction issued.');
    expect(api.last()?.body).toEqual({
      action: 'sanction',
      sanctionKind: 'warning',
      statement: 'Please change your handle.'
    });
  });

  test('loads a history on request and lifts a sanction with a reason', async ({ page }) => {
    const api = await mockApi(page, {
      responses: {
        'GET /v1/staff/reports': { data: [report] },
        'GET /v1/staff/accounts/acct-9/sanctions': {
          data: [
            {
              id: 'sn-1',
              kind: 'social_suspension',
              statement: 'Earlier statement.',
              inForce: true,
              hasOpenAppeal: true
            }
          ]
        }
      }
    });
    await open(page, 'Moderation');
    await page.getByRole('button', { name: 'Their history' }).click();
    await expect(page.getByText('Earlier statement.')).toBeVisible();
    await expect(page.getByText(/appeal on this sanction is still open/i)).toBeVisible();
    await page.getByLabel('Why it is ending early').fill('Resolved with the runner.');
    await page.getByRole('button', { name: 'Lift it' }).click();
    expect(api.calls).toContainEqual({
      method: 'POST',
      path: '/v1/staff/sanctions/sn-1/lift',
      body: { reason: 'Resolved with the runner.' }
    });
  });

  test('decides an appeal', async ({ page }) => {
    const api = await mockApi(page, {
      responses: {
        'GET /v1/staff/appeals': {
          data: [
            {
              id: 'ap-1',
              sanctionKind: 'warning',
              sanctionStatement: 'Told this.',
              statement: 'Says that.'
            }
          ]
        }
      }
    });
    await open(page, 'Moderation');
    await page.getByRole('button', { name: 'Overturn it' }).click();
    // Nothing is sent until the dialog's own confirmation.
    await expect(page.getByRole('dialog', { name: 'Overturn this sanction?' })).toBeVisible();
    expect(api.calls.some((call) => call.path.includes('/appeals/'))).toBe(false);
    await page
      .getByRole('dialog', { name: 'Overturn this sanction?' })
      .getByRole('button', { name: 'Overturn it' })
      .click();
    await expect(page.getByRole('status')).toContainText('Appeal accepted');
    expect(api.calls).toContainEqual({
      method: 'POST',
      path: '/v1/staff/appeals/ap-1/decision',
      body: { decision: 'overturned', decisionNote: 'The sanction is lifted after review.' }
    });
  });
});

test.describe('quests', () => {
  test('saves a time limit and shows the saved value', async ({ page }) => {
    const quest = {
      id: 'q-1',
      title: 'River Bend Run',
      checkpointCount: 4,
      estimatedActiveMinutes: 14,
      timeLimitMinutes: null,
      published: true
    };
    const api = await mockApi(page, {
      responses: {
        'GET /v1/staff/quests': { data: [quest] },
        'PUT /v1/staff/quests/q-1/time-limit': { ...quest, timeLimitMinutes: 25 }
      }
    });
    await open(page, 'Quests');
    await expect(page.getByRole('cell', { name: 'No limit' })).toBeVisible();
    await page.getByLabel('New time limit for River Bend Run').fill('25');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toContainText('Time limit saved.');
    await expect(page.getByRole('cell', { name: '25 min' })).toBeVisible();
    expect(api.last()).toEqual({
      method: 'PUT',
      path: '/v1/staff/quests/q-1/time-limit',
      body: { timeLimitMinutes: 25 }
    });
  });

  test('refuses a limit outside 1 to 600 minutes before it is sent', async ({ page }) => {
    const api = await mockApi(page, {
      responses: {
        'GET /v1/staff/quests': {
          data: [
            {
              id: 'q-1',
              title: 'River Bend Run',
              checkpointCount: 4,
              estimatedActiveMinutes: 14,
              timeLimitMinutes: null,
              published: true
            }
          ]
        }
      }
    });
    await open(page, 'Quests');
    await page.getByLabel('New time limit for River Bend Run').fill('601');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    // Only the sign-in was sent: no PUT left the page.
    expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });
});

test.describe('competitions', () => {
  test('drafts a competition, then announces a draft', async ({ page }) => {
    const api = await mockApi(page, {
      responses: {
        'GET /v1/competitions': {
          data: [
            {
              id: 'c-1',
              title: 'December Dash',
              status: 'draft',
              periodStart: '2026-12-01',
              periodEnd: '2026-12-14',
              participantCount: 0
            }
          ]
        }
      }
    });
    await open(page, 'Competitions');
    await page.getByLabel('Title').fill('January Streak');
    await page.getByLabel('First day').fill('2027-01-04');
    await page.getByLabel('Days').selectOption('14');
    await page.getByLabel('Rewards').fill('Cosmetic badge');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('status')).toContainText('Draft created.');
    expect(api.calls).toContainEqual({
      method: 'POST',
      path: '/v1/staff/competitions',
      body: {
        title: 'January Streak',
        mode: 'active_minutes',
        periodStart: '2027-01-04',
        lengthDays: 14,
        rewards: 'Cosmetic badge'
      }
    });

    await page.getByRole('button', { name: 'Announce' }).click();
    await expect(page.getByRole('status')).toContainText('Announced.');
    expect(api.last()).toEqual({
      method: 'POST',
      path: '/v1/staff/competitions/c-1/status',
      body: { publish: true }
    });
  });
});

test.describe('campaigns', () => {
  test('creates a consented draft and publishes a template', async ({ page }) => {
    const api = await mockApi(page);
    await open(page, 'Campaign email');

    await page.getByLabel('Template key').fill('winter-welcome');
    await page.getByLabel('Send cap').fill('250');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('status')).toContainText('Nothing has been sent.');
    expect(api.last()).toEqual({
      method: 'POST',
      path: '/v1/staff/campaigns',
      body: { templateKey: 'winter-welcome', audience: { consentRequired: true }, sendCap: 250 }
    });

    await page.getByLabel('Key', { exact: true }).fill('winter-welcome');
    await page.getByLabel('Subject').fill('Welcome back');
    await page.getByLabel('Body').fill('See you out there.');
    await page.getByRole('button', { name: 'Publish version' }).click();
    await expect(page.getByRole('status')).toContainText('Template published.');
    expect(api.last()).toEqual({
      method: 'POST',
      path: '/v1/staff/email-templates',
      body: { key: 'winter-welcome', subject: 'Welcome back', body: 'See you out there.' }
    });
  });
});

test.describe('turf claims', () => {
  test('records a review only once a note is written', async ({ page }) => {
    const api = await mockApi(page, {
      roles: ['moderator'],
      responses: {
        'GET /v1/staff/territory/trade-flags': {
          data: [
            {
              id: 'f-1',
              lineageId: 'l-1',
              exchanges: 6,
              pairShare: 0.9,
              firstAt: '2026-11-01T00:00:00.000Z',
              lastAt: '2026-11-10T00:00:00.000Z'
            }
          ],
          note: 'A flag is a question, not a verdict.'
        },
        'POST /v1/staff/territory/trade-flags/f-1/review': { data: [] }
      }
    });
    await page.goto('/');
    await signIn(page);
    await goTo(page, 'Turf claims');
    // A moderator is not a season operator, and the page says which part needs which role.
    await expect(
      page.getByText('Concentration needs a season operator or admin role.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Uphold' })).toBeDisabled();
    await page.getByLabel('Note').fill('Looks like a genuine rivalry.');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('status')).toContainText('Review recorded.');
    expect(api.last()?.body).toEqual({
      outcome: 'dismissed',
      note: 'Looks like a genuine rivalry.'
    });
  });
});

test.describe('read-only areas', () => {
  test('offer no way to change anything', async ({ page }) => {
    await mockApi(page, {
      responses: {
        'GET /v1/staff/privacy/requests': {
          data: [
            {
              accountId: 'a-1',
              kind: 'deletion',
              requestedAt: '2026-11-01T00:00:00.000Z',
              openForHours: 80
            }
          ],
          completedDeletions: 3
        }
      }
    });
    await page.goto('/');
    await signIn(page);
    await goTo(page, 'Privacy requests');
    await expect(page.getByText('Read-only.')).toBeVisible();
    await expect(page.getByText('needs a look', { exact: true })).toBeVisible();
    await expect(page.getByText('3 erasures have converged')).toBeVisible();
    // Only Refresh: nothing here can erase or export an account.
    await expect(page.locator('main').getByRole('button')).toHaveCount(1);
  });

  test('an area with no route says so instead of pretending', async ({ page }) => {
    await mockApi(page, { roles: ['support'] });
    await page.goto('/');
    await signIn(page);
    await goTo(page, 'Support');
    await expect(page.getByText('Not built yet')).toBeVisible();
    await expect(page.getByText(/support console that can find any account/)).toBeVisible();
  });
});
