import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@runsphere/db';
import { CAMPAIGN_TOPIC, processCampaigns, queueCampaign } from './campaigns.js';

const CAMPAIGN = 'campaign-1';
const ME = 'account-me';
const RAVI = 'account-ravi';

const campaign = (overrides: Record<string, unknown> = {}) => ({
  id: CAMPAIGN,
  audience: { consentRequired: true },
  send_cap: 500,
  ...overrides
});

interface Stubs {
  due?: Record<string, unknown>[];
  matched?: { account_id: string }[];
  /** `[]` makes the status claim find nothing, as a cancel would. */
  claimed?: Record<string, unknown>[];
}

const fakeDatabase = (stubs: Stubs = {}) => {
  const statements: { sql: string; values: readonly unknown[] }[] = [];
  const respond = (sql: string) => {
    if (sql.includes('FROM email_campaigns')) return { rows: stubs.due ?? [] };
    if (sql.includes('FROM notification_preferences preference'))
      return { rows: stubs.matched ?? [] };
    if (sql.includes('UPDATE email_campaigns SET'))
      return { rows: stubs.claimed ?? [{ id: CAMPAIGN }] };
    return { rows: [] };
  };
  const record = (sql: string, values: readonly unknown[] = []) => {
    statements.push({ sql, values });
    return respond(sql);
  };
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => record(sql, values));
  const clientQuery = vi.fn(async (sql: string, values?: readonly unknown[]) =>
    record(sql, values)
  );
  const client = { query: clientQuery, release: vi.fn() };
  return {
    statements,
    query,
    clientQuery,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    sql: () => statements.map((statement) => statement.sql).join('\n'),
    recipients: () =>
      statements
        .filter((statement) => statement.sql.includes('INSERT INTO email_campaign_recipients'))
        .map((statement) => statement.values),
    db(): Database {
      return this as unknown as Database;
    }
  };
};

describe('queueing one campaign', () => {
  it('writes one recipient per consented account and marks it sending', async () => {
    const database = fakeDatabase({ matched: [{ account_id: ME }, { account_id: RAVI }] });

    await expect(queueCampaign(database.db(), campaign())).resolves.toBe(2);
    expect(database.recipients()).toEqual([
      [CAMPAIGN, ME],
      [CAMPAIGN, RAVI]
    ]);
    const claim = database.statements.find((statement) =>
      statement.sql.includes('UPDATE email_campaigns SET')
    )!;
    expect(claim.sql).toContain("status = 'sending'");
    expect(claim.sql).toContain("status = 'scheduled'");
  });

  it('re-reads consent at send time rather than trusting the preview', async () => {
    const database = fakeDatabase({ matched: [{ account_id: ME }] });
    await queueCampaign(database.db(), campaign());

    const audience = database.statements.find((statement) =>
      statement.sql.includes('FROM notification_preferences preference')
    )!;
    // Somebody who unsubscribed between scheduling and sending is simply not
    // in this list; nothing has to remember to remove them.
    expect(audience.sql).toContain('preference.marketing_consent = true');
    expect(audience.sql).toContain("categories ->> 'marketing'");
    expect(audience.sql).toContain("channels ->> 'email'");
    expect(audience.sql).toContain('account.email_verified_at IS NOT NULL');
  });

  it('caps the send, and the cap is what bounds the query', async () => {
    const database = fakeDatabase({ matched: [{ account_id: ME }] });
    await queueCampaign(database.db(), campaign({ send_cap: 3 }));

    const audience = database.statements.find((statement) =>
      statement.sql.includes('FROM notification_preferences preference')
    )!;
    expect(audience.sql).toContain('LIMIT $2');
    expect(audience.values[1]).toBe(3);
  });

  it('writes nothing when the campaign was cancelled between the read and the claim', async () => {
    const database = fakeDatabase({ matched: [{ account_id: ME }], claimed: [] });

    await expect(queueCampaign(database.db(), campaign())).resolves.toBe(0);
    expect(database.recipients()).toEqual([]);
    expect(database.sql()).not.toContain('INSERT INTO outbox_events');
  });

  it('enqueues one delivery event for the campaign, not one per recipient', async () => {
    const database = fakeDatabase({ matched: [{ account_id: ME }, { account_id: RAVI }] });
    await queueCampaign(database.db(), campaign());

    const events = database.statements.filter((statement) =>
      statement.sql.includes('INSERT INTO outbox_events')
    );
    // No provider exists yet, so thousands of undeliverable events would be
    // noise in the outbox. The recipients table is the list.
    expect(events).toHaveLength(1);
    expect(events[0]!.values[0]).toBe(CAMPAIGN_TOPIC);
    expect(events[0]!.values[2]).toBe(2);
  });

  it('queues nothing when nobody consented, and still claims the campaign', async () => {
    const database = fakeDatabase({ matched: [] });

    await expect(queueCampaign(database.db(), campaign())).resolves.toBe(0);
    expect(database.recipients()).toEqual([]);
    // The campaign still moves to sending: it ran, and it reached nobody,
    // which is a truthful outcome rather than one to retry forever.
    expect(database.sql()).toContain("status = 'sending'");
  });

  it('writes recipients and the event in one transaction', async () => {
    const database = fakeDatabase({ matched: [{ account_id: ME }] });
    await queueCampaign(database.db(), campaign());

    const order = database.statements.map((statement) => statement.sql);
    expect(order).toContain('BEGIN');
    expect(order).toContain('COMMIT');
  });
});

describe('the campaign sweep', () => {
  it('takes only scheduled campaigns whose time has passed', async () => {
    const database = fakeDatabase();
    await processCampaigns(database.db());

    expect(database.statements[0]!.sql).toContain("status = 'scheduled'");
    expect(database.statements[0]!.sql).toContain('scheduled_for <= now()');
  });

  it('reports how many recipients it queued', async () => {
    const database = fakeDatabase({ due: [campaign()], matched: [{ account_id: ME }] });

    await expect(processCampaigns(database.db())).resolves.toBe(1);
  });
});
