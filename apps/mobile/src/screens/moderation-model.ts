import type { ReportReason, Sanction, SanctionKind } from '@runsphere/contracts';
import { AuthFailure } from '../auth-failure';
import { ApiFailure } from '../api-client';

/**
 * Reporting, sanctions, and appeals (milestone 3.7).
 *
 * Blocking hides somebody; reporting asks staff to look. Both are offered,
 * because they answer different needs — and reporting stays available for an
 * account you have already blocked.
 *
 * Nothing here infers an outcome. A reporter is told their report was
 * received and never hears more about somebody else's account, so this module
 * has no notion of a report's status at all.
 */

/** The published reasons, in the order they are offered. */
export const REPORT_REASON_LABEL: Readonly<Record<ReportReason, string>> = {
  impersonation: 'Pretending to be someone else',
  harassment: 'Harassment or bullying',
  hate_or_violence: 'Hate or violence',
  sexual_content: 'Sexual content',
  spam_or_scam: 'Spam or a scam',
  self_harm: 'Self-harm or someone at risk',
  other: 'Something else'
};

export const REPORT_REASONS_IN_ORDER: readonly ReportReason[] = [
  'impersonation',
  'harassment',
  'hate_or_violence',
  'sexual_content',
  'spam_or_scam',
  'self_harm',
  'other'
];

/**
 * Said where reporting is offered. Two things have to be clear: what a report
 * is *about*, and that no outcome will come back — otherwise somebody waits
 * for an answer that would breach the other account's privacy to give.
 */
export const REPORT_CONSEQUENCE_HINT =
  'A report goes to our moderators and covers what someone published — a name, a profile, a club. You will not hear the outcome, because it concerns someone else’s account. Blocking is separate and stays available.';

export const REPORT_ACKNOWLEDGED_NOTICE =
  'Report sent. Our moderators will look at it. You can also block this account.';

export const reportFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure && error.status === 400)
    return 'That report could not be filed. Nothing was sent.';
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'Reporting needs a connection. Nothing was sent.';
  return 'That report could not be sent. Nothing was sent.';
};

/** What each sanction actually does, in the words the sanctioned account reads. */
export const SANCTION_KIND_LABEL: Readonly<Record<SanctionKind, string>> = {
  warning: 'Warning',
  social_suspension: 'Sharing paused',
  account_suspension: 'Account suspended'
};

export const SANCTION_KIND_EFFECT: Readonly<Record<SanctionKind, string>> = {
  warning: 'Nothing has changed about your account. This is on your record.',
  social_suspension:
    'Boards, clubs, challenges, and competitions are paused for you. Recording, your history, and your export are untouched.',
  account_suspension: 'Your account cannot be used while this applies.'
};

export interface SanctionRow {
  readonly id: string;
  readonly kindLabel: string;
  readonly effectLabel: string;
  readonly statement: string;
  readonly statusLabel: string;
  readonly endsLabel: string;
  readonly canAppeal: boolean;
  readonly appealStatusLabel: string | undefined;
  readonly accessibilityLabel: string;
}

/**
 * An appeal decision is named from the appellant's side, which is the one place
 * this vocabulary trips people up: "upheld" is the *sanction* being upheld —
 * the appeal did not succeed.
 */
const appealStatusLabel = (sanction: Sanction): string | undefined => {
  if (!sanction.appeal) return undefined;
  if (sanction.appeal.status === 'open') return 'Appeal sent — waiting for a decision';
  return sanction.appeal.status === 'overturned'
    ? 'Appeal accepted. This no longer applies.'
    : 'Appeal declined. This still applies.';
};

export const sanctionRows = (sanctions: readonly Sanction[]): readonly SanctionRow[] =>
  sanctions.map((sanction) => {
    const kindLabel = SANCTION_KIND_LABEL[sanction.kind];
    const statusLabel = sanction.inForce ? 'In force' : 'Ended';
    const endsLabel = sanction.expiresAt
      ? `Ends ${sanction.expiresAt.slice(0, 10)}`
      : sanction.kind === 'warning'
        ? 'A record, with no end date'
        : 'No end date';
    return {
      id: sanction.id,
      kindLabel,
      effectLabel: SANCTION_KIND_EFFECT[sanction.kind],
      statement: sanction.statement,
      statusLabel,
      endsLabel,
      canAppeal: sanction.canAppeal,
      appealStatusLabel: appealStatusLabel(sanction),
      accessibilityLabel: `${kindLabel}. ${statusLabel}. ${sanction.statement}`
    };
  });

/** Said where an account has nothing against it. */
export const NO_SANCTIONS_MESSAGE = 'Nothing has been raised about your account.';

/** Said before appealing, so the one-attempt rule is not a surprise. */
export const APPEAL_CONSEQUENCE =
  'You can appeal once. Write what you want a moderator to know, and you will be told the decision and the reason for it.';

export const validateAppeal = (
  raw: string
): { ok: true; statement: string } | { ok: false; message: string } => {
  const statement = raw.trim();
  if (!statement) return { ok: false, message: 'Write what you want a moderator to know.' };
  if (statement.length > 2000)
    return { ok: false, message: 'Keep the appeal to 2000 characters or fewer.' };
  return { ok: true, statement };
};

export const appealFailureNotice = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    if (error.status === 409) return 'That decision cannot be appealed any more.';
    if (error.status === 404) return 'That decision is no longer listed. Reload to refresh.';
  }
  if (error instanceof AuthFailure && (error.kind === 'network' || error.kind === 'tls'))
    return 'Appealing needs a connection. Nothing was sent.';
  return 'That appeal could not be sent. Nothing was sent.';
};
