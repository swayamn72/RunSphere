import { withTransaction, type Database } from '@runsphere/db';
import { cappedRecipientCount, type CampaignAudience } from '@runsphere/domain';

/**
 * Campaign send preparation (Phase 3, milestone 3.9).
 *
 * When a scheduled campaign comes due, this resolves its audience *at that
 * moment* and writes one recipient row per account, capped. Resolving at send
 * time rather than at schedule time is the point: somebody who unsubscribed
 * between scheduling and sending is simply not in the list, and nothing has to
 * remember to go back and remove them.
 *
 * Delivery itself is not here. Transactional and campaign email are a gated
 * dependency (ADR-0010) and no provider is configured on this deployment, so a
 * queued recipient stays queued — visibly, in a row somebody can count —
 * rather than being marked sent by a worker that sent nothing. That is the
 * same shape push took before FCM credentials existed.
 */

export const CAMPAIGN_TOPIC = 'email.campaign';

interface DueCampaignRow {
  id: string;
  audience: unknown;
  send_cap: number;
}

/**
 * Queue one campaign's recipients and mark it sending.
 *
 * Consent is re-read here, not trusted from the preview: all three switches
 * (`marketing_consent`, the `marketing` category, the `email` channel), plus a
 * verified address and a live account. An unverified address is skipped
 * because sending to it would be sending to somebody who never proved it was
 * theirs.
 */
export const queueCampaign = async (db: Database, campaign: DueCampaignRow): Promise<number> => {
  const audience = campaign.audience as CampaignAudience;
  const matched = await db.query<{ account_id: string }>(
    `SELECT preference.account_id
     FROM notification_preferences preference
     JOIN accounts account ON account.id = preference.account_id
       AND account.deleted_at IS NULL AND account.email_verified_at IS NOT NULL
     WHERE preference.marketing_consent = true
       AND coalesce((preference.categories ->> 'marketing')::boolean, false) = true
       AND coalesce((preference.channels ->> 'email')::boolean, false) = true
       AND ($1::int IS NULL OR EXISTS (
         SELECT 1 FROM activity_submissions recent
         WHERE recent.account_id = account.id AND recent.status = 'derived'
           AND recent.deleted_at IS NULL
           AND recent.processed_at >= now() - make_interval(days => $1)))
     ORDER BY preference.account_id
     LIMIT $2`,
    [audience.recencyBandDays ?? null, cappedRecipientCount(campaign.send_cap, campaign.send_cap)]
  );

  return withTransaction(db, async (client) => {
    const claimed = await client.query<{ id: string }>(
      `UPDATE email_campaigns SET status = 'sending', started_at = now()
       WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [campaign.id]
    );
    // Another sweep got there first, or it was cancelled between the read and
    // the claim. Either way this pass writes nothing.
    if (!claimed.rows[0]) return 0;
    for (const row of matched.rows) {
      await client.query(
        `INSERT INTO email_campaign_recipients (campaign_id, account_id)
         VALUES ($1, $2) ON CONFLICT (campaign_id, account_id) DO NOTHING`,
        [campaign.id, row.account_id]
      );
    }
    // One event per campaign, not per recipient: the provider does not exist
    // yet, and a queue of thousands of undeliverable events would be noise in
    // the outbox rather than work. The recipients table is the list.
    await client.query(
      `INSERT INTO outbox_events (topic, aggregate_id, payload)
       VALUES ($1, $2, jsonb_build_object('campaignId', $2::text, 'recipientCount', $3::int))`,
      [CAMPAIGN_TOPIC, campaign.id, matched.rows.length]
    );
    return matched.rows.length;
  });
};

/**
 * Start every campaign whose scheduled time has passed.
 *
 * A time that went by while nobody swept still starts: the send is late, not
 * skipped, and a campaign silently never going out would be worse than one
 * arriving an hour after it was meant to.
 */
export const processCampaigns = async (db: Database): Promise<number> => {
  const due = await db.query<DueCampaignRow>(
    `SELECT id, audience, send_cap FROM email_campaigns
     WHERE status = 'scheduled' AND scheduled_for <= now()
     ORDER BY scheduled_for
     LIMIT 10`
  );

  let queued = 0;
  for (const campaign of due.rows) {
    queued += await queueCampaign(db, campaign);
  }
  return queued;
};
