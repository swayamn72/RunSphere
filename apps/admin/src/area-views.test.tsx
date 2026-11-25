import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  CampaignSummary,
  CompetitionSummary,
  StaffAppeal,
  StaffReport,
  TerritorySeasonView
} from '@runsphere/contracts';
import type { PrivacyRequest, RuleVersion, StaffReviewItem } from './api.js';
import type { AreaContext } from './area-types.js';
import { CampaignsView } from './campaigns-area.js';
import { CompetitionsView } from './competitions-area.js';
import { filterRules, RulesView } from './data-area.js';
import { ModerationView } from './moderation-area.js';
import { PrivacyView } from './privacy-area.js';
import { reviewNote, ReviewView } from './review-area.js';
import { concentrationState, SeasonsView } from './seasons-area.js';
import { lifecycleTone } from './status-tone.js';

const context: AreaContext = {
  accessToken: 'token',
  roles: ['admin'],
  loading: false,
  run: async () => true
};
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const cast = <T,>(value: unknown) => value as T;

describe('review queue', () => {
  const items: StaffReviewItem[] = [
    {
      id: 'run-1',
      status: 'rejected',
      submittedAt: '2026-11-20T10:00:00.000Z',
      rejectionReason: 'Speed was not possible on foot.',
      validationErrors: []
    },
    {
      id: 'run-2',
      status: 'received',
      submittedAt: '2026-11-20T11:00:00.000Z',
      validationErrors: []
    }
  ];

  it('lists submissions with their state and reason, and never any route data', () => {
    const markup = html(<ReviewView items={items} loading={false} onRefresh={() => undefined} />);
    expect(markup).toContain('run-1');
    expect(markup).toContain('rejected');
    expect(markup).toContain('rs-tag--danger');
    expect(markup).toContain('Speed was not possible on foot.');
    expect(markup).toContain('Awaiting validation');
    expect(markup).not.toMatch(/lat|lng|coordinates/i);
  });

  it('says what is missing and keeps refresh available', () => {
    const markup = html(<ReviewView items={[]} loading={false} onRefresh={() => undefined} />);
    expect(markup).toContain('No activities currently require review.');
    expect(markup).toContain('Refresh queue');
  });

  it('prefers the rejection reason, then validation errors', () => {
    expect(reviewNote(items[0]!)).toBe('Speed was not possible on foot.');
    expect(reviewNote({ ...items[1]!, validationErrors: ['gap', 'jump'] })).toBe('gap, jump');
  });
});

describe('privacy requests', () => {
  const requests: PrivacyRequest[] = [
    {
      accountId: 'a-1',
      kind: 'deletion',
      requestedAt: '2026-11-01T00:00:00.000Z',
      openForHours: 72
    },
    { accountId: 'a-2', kind: 'export', requestedAt: '2026-11-24T00:00:00.000Z', openForHours: 2 }
  ];

  it('states why it is read-only and flags only the requests that need a look', () => {
    const markup = html(
      <PrivacyView
        requests={requests}
        completedDeletions={5}
        loading={false}
        onRefresh={() => undefined}
      />
    );
    expect(markup).toContain('Read-only.');
    expect(markup).toContain('5 erasures have converged');
    // Only the 72-hour request is tagged; the 2-hour one is not.
    expect(markup.match(/rs-tag--warning/g)).toHaveLength(1);
    expect(markup).toContain('72 h');
    expect(markup).not.toMatch(/button[^>]*>Erase|Delete account/);
  });

  it('says nothing is waiting when the queue is empty', () => {
    expect(
      html(
        <PrivacyView
          requests={[]}
          completedDeletions={0}
          loading={false}
          onRefresh={() => undefined}
        />
      )
    ).toContain('Nothing is waiting.');
  });
});

describe('published rules', () => {
  const rules: RuleVersion[] = [
    {
      kind: 'territory.points',
      version: 2,
      definition: { cap: 60 },
      effectiveAt: '2026-11-01T00:00:00.000Z',
      live: true
    },
    {
      kind: 'quest.limits',
      version: 1,
      definition: {},
      effectiveAt: '2026-10-01T00:00:00.000Z',
      live: false
    }
  ];

  it('marks the live version and is read-only', () => {
    const markup = html(<RulesView rules={rules} loading={false} onRefresh={() => undefined} />);
    expect(markup).toContain('Read-only.');
    expect(markup).toContain('rs-tag--success');
    expect(markup).toContain('v2');
  });

  it('filters by kind, ignoring case and spaces', () => {
    expect(filterRules(rules, ' QUEST ')).toHaveLength(1);
    expect(filterRules(rules, '')).toHaveLength(2);
    expect(filterRules(rules, 'zzz')).toHaveLength(0);
  });
});

describe('moderation', () => {
  const report = (overrides: Record<string, unknown> = {}) =>
    cast<StaffReport>({
      id: 'r-1',
      subjectType: 'account',
      subjectId: 's-1',
      subjectName: 'Ravi K',
      reason: 'abusive_name',
      note: 'Offensive handle.',
      openReportCount: 2,
      ...overrides
    });
  const appeal = cast<StaffAppeal>({
    id: 'ap-1',
    sanctionKind: 'social_suspension',
    sanctionStatement: 'Your handle broke the rules.',
    statement: 'It was a joke.'
  });
  const view = (reports: StaffReport[], appeals: StaffAppeal[] = []) =>
    html(
      <ModerationView
        {...context}
        reports={reports}
        appeals={appeals}
        onChanged={() => undefined}
      />
    );

  it('opens the first report beside the queue and offers the moderator’s actions', () => {
    const markup = view([report(), report({ id: 'r-2', subjectName: 'Second' })]);
    expect(markup).toContain('aria-label="Open reports"');
    expect(markup).toContain('Second');
    expect(markup).toContain('Offensive handle.');
    expect(markup).toContain('abusive name');
    expect(markup).toContain('>Dismiss<');
    expect(markup).toContain('Sanction…');
    expect(markup).toContain('Their history');
  });

  it('never offers a sanction for a club, because the API refuses one', () => {
    const markup = view([report({ subjectType: 'club', subjectName: 'Dawn Crew' })]);
    expect(markup).toContain('A club cannot be sanctioned.');
    expect(markup).not.toContain('Sanction…');
    expect(markup).not.toContain('Their history');
  });

  it('shows appeals with both decisions, and says so when there are none', () => {
    const markup = view([], [appeal]);
    expect(markup).toContain('No open reports.');
    expect(markup).toContain('What they were told:');
    expect(markup).toContain('Uphold the sanction');
    expect(markup).toContain('Overturn it');
    expect(view([])).toContain('No open appeals.');
  });
});

describe('competitions', () => {
  const competition = (status: string) =>
    cast<CompetitionSummary>({
      id: `c-${status}`,
      title: `Comp ${status}`,
      status,
      periodStart: '2026-12-01',
      periodEnd: '2026-12-07',
      participantCount: 12
    });
  const view = (competitions: CompetitionSummary[]) =>
    html(<CompetitionsView {...context} competitions={competitions} onChanged={() => undefined} />);

  it('lets a draft be announced or cancelled, a live one only cancelled, a finished one neither', () => {
    const markup = view([competition('draft')]);
    expect(markup).toContain('>Announce<');
    expect(markup).toContain('>Cancel<');
    const live = view([competition('announced')]);
    expect(live).not.toContain('>Announce<');
    expect(live).toContain('>Cancel<');
    const done = view([competition('finalized'), competition('cancelled')]);
    expect(done).not.toContain('>Announce<');
    expect(done).not.toContain('>Cancel<');
  });

  it('keeps the draft form and says that announcing is a second, deliberate act', () => {
    const markup = view([]);
    expect(markup).toContain('Create draft');
    expect(markup).toContain('cannot be un-announced');
    expect(markup).toContain('No competitions yet.');
  });
});

describe('campaigns', () => {
  const campaign = (status: string) =>
    cast<CampaignSummary>({
      id: `k-${status}`,
      templateKey: `tpl-${status}`,
      status,
      sendCap: 500,
      queuedCount: 4,
      sentCount: 9
    });
  const view = (campaigns: CampaignSummary[]) =>
    html(
      <CampaignsView
        {...context}
        campaigns={campaigns}
        templates={[]}
        onChanged={() => undefined}
      />
    );

  it('offers scheduling only for a draft, and cancelling only until it has sent', () => {
    const draft = view([campaign('draft')]);
    expect(draft).toContain('>Schedule<');
    expect(draft).toContain('>Cancel<');
    const sent = view([campaign('sent'), campaign('cancelled')]);
    expect(sent).not.toContain('>Schedule<');
    expect(sent).not.toContain('>Cancel<');
  });

  it('keeps consent in the wording and the audience out of sight', () => {
    const markup = view([]);
    expect(markup).toContain('Every audience requires consent.');
    expect(markup).toContain('never the people in them');
    expect(markup).toContain('Publishing a version is the approval.');
  });
});

describe('territory seasons', () => {
  it('describes each concentration state in words', () => {
    const row = (overrides: Record<string, unknown>) =>
      cast<Parameters<typeof concentrationState>[0]>({
        applicable: true,
        breached: false,
        pausesAwards: false,
        breachRunDays: 0,
        ...overrides
      });
    expect(concentrationState(row({}))).toBe('Within the limits.');
    expect(concentrationState(row({ breached: true, breachRunDays: 3 }))).toBe(
      'Breached 3 days running.'
    );
    expect(
      concentrationState(row({ breached: true, pausesAwards: true, breachRunDays: 7 }))
    ).toMatch(/Pause awards analysis/);
    expect(concentrationState(row({ applicable: false }))).toMatch(/too small/);
  });

  it('asks for a season first and says plainly when none exist', () => {
    const none = html(<SeasonsView {...context} seasons={[]} />);
    expect(none).toContain('Choose a season');
    expect(none).toContain('No season has been announced on this deployment.');
    expect(none).not.toContain('Divisions');
    const some = html(
      <SeasonsView
        {...context}
        seasons={[cast<TerritorySeasonView>({ id: 's1', title: 'November', status: 'live' })]}
      />
    );
    expect(some).toContain('November — live');
  });
});

describe('lifecycle tones', () => {
  it('reads cancelled as stopped, finished as done and draft as quiet', () => {
    expect(lifecycleTone('cancelled')).toBe('danger');
    expect(lifecycleTone('finalized')).toBe('success');
    expect(lifecycleTone('sent')).toBe('success');
    expect(lifecycleTone('draft')).toBe('neutral');
    expect(lifecycleTone('announced')).toBe('info');
  });
});
