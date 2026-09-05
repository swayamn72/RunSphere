import { useState, type FormEvent } from 'react';
import {
  AUDIT_NOTICE,
  AREAS,
  CONCENTRATION_NOTE,
  CONCENTRATION_NOT_APPLICABLE_NOTE,
  NO_ROLES_MESSAGE,
  OPEN_APPEAL_WARNING,
  PRIVACY_READ_ONLY_NOTE,
  ROLLBACK_NOTE,
  ROLLBACK_REASON_HINT,
  RULES_READ_ONLY_NOTE,
  SANCTION_CHOICES,
  SANCTION_LIFT_HINT,
  SANCTION_STATEMENT_HINT,
  initialArea,
  permittedAreas,
  privacyNeedsAttention,
  roleLabels,
  sanctionLiftable,
  type AreaKey
} from './areas.js';
import {
  cancelCampaign,
  createCampaign,
  createCompetition,
  decideAppeal,
  getAccountSanctions,
  getAppealQueue,
  getCampaigns,
  getCompetitions,
  getEmailTemplates,
  getPrivacyQueue,
  getReportQueue,
  getRuleVersions,
  getStaffReviewQueue,
  getStaffRoles,
  getTerritoryConcentration,
  getTerritoryDivisions,
  getTerritorySeasons,
  getTerritoryWeeks,
  liftSanction,
  rollBackTerritoryWeek,
  publishEmailTemplate,
  resolveReport,
  scheduleCampaign,
  setCompetitionStatus,
  signIn,
  type PrivacyRequest,
  type RuleVersion,
  type StaffReviewItem,
  type TerritoryConcentrationRow,
  type TerritoryDivisionSize,
  type TerritoryWeekRow
} from './api.js';
import type {
  CampaignSummary,
  CompetitionSummary,
  EmailTemplate,
  StaffAppeal,
  StaffReport,
  StaffSanction,
  TerritorySeasonView
} from '@runsphere/contracts';

const readableStatus = (status: StaffReviewItem['status']) => status.replace('_', ' ');

/**
 * The operations console (Phase 3, milestone 3.10).
 *
 * Five milestones shipped staff routes with nothing in front of them. This is
 * the interface, gated by the same predicates the API enforces, so what a
 * person can see here is exactly what their role can do there.
 *
 * Areas without a route say so instead of pretending — a console that looks
 * operational and quietly does nothing is worse than one that admits the gap.
 */
export function AdminShell() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState<string>();
  const [roles, setRoles] = useState<readonly string[]>([]);
  const [area, setArea] = useState<AreaKey>();
  const [seasons, setSeasons] = useState<readonly TerritorySeasonView[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState<StaffReviewItem[]>([]);
  const [reports, setReports] = useState<StaffReport[]>([]);
  const [appeals, setAppeals] = useState<StaffAppeal[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [privacyRequests, setPrivacyRequests] = useState<PrivacyRequest[]>([]);
  const [completedDeletions, setCompletedDeletions] = useState(0);
  const [rules, setRules] = useState<RuleVersion[]>([]);

  const run = async (work: () => Promise<unknown>, success?: string) => {
    setLoading(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
      if (success) setNotice(success);
    } catch (reason) {
      // The server's message is the useful one: a role refusal, a rule that
      // does not allow something, a state that has moved on.
      setError(reason instanceof Error ? reason.message : 'That did not work');
    } finally {
      setLoading(false);
    }
  };

  const openArea = (next: AreaKey, token = accessToken) => {
    setArea(next);
    if (!token) return;
    void run(async () => {
      if (next === 'review') setItems((await getStaffReviewQueue(token)).data);
      if (next === 'moderation') {
        setReports((await getReportQueue(token)).data);
        setAppeals((await getAppealQueue(token)).data);
      }
      if (next === 'competitions') setCompetitions((await getCompetitions(token)).data);
      if (next === 'campaigns') {
        setCampaigns((await getCampaigns(token)).data);
        setTemplates((await getEmailTemplates(token)).data);
      }
      if (next === 'privacy') {
        const queue = await getPrivacyQueue(token);
        setPrivacyRequests(queue.data);
        setCompletedDeletions(queue.completedDeletions);
      }
      if (next === 'seasons') setSeasons((await getTerritorySeasons(token)).data);
      if (next === 'data') setRules((await getRuleVersions(token)).data);
    });
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      const session = await signIn(email, password);
      setAccessToken(session.accessToken);
      const staff = await getStaffRoles(session.accessToken);
      setRoles(staff.roles);
      const first = initialArea(staff.roles);
      if (first) openArea(first, session.accessToken);
    });
  };

  const visible = permittedAreas(roles);
  const current = AREAS.find((definition) => definition.key === area);

  return (
    <main>
      <header>
        <div>
          <span>RUNSPHERE / OPERATIONS</span>
          <h1>{current?.title ?? 'Operations'}</h1>
          <p>
            Authenticated staff access. Raw GPS and account contact details are unavailable here.
            Season operations show divisions, concentration, and week snapshots — never a
            participant against a cell.
          </p>
        </div>
        {accessToken ? (
          <div className="status">
            Staff session active{roles.length ? ` · ${roleLabels(roles).join(', ')}` : ''}
          </div>
        ) : (
          <div className="status neutral">Sign in required</div>
        )}
      </header>

      {!accessToken ? (
        <section className="panel sign-in-panel">
          <div className="panel-heading">
            <div>
              <small>STAFF AUTHENTICATION</small>
              <h2>Sign in to review</h2>
            </div>
          </div>
          <form onSubmit={handleSignIn}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <nav aria-label="Operations areas">
            {visible.map((definition) => (
              <button
                key={definition.key}
                type="button"
                aria-current={definition.key === area}
                onClick={() => openArea(definition.key)}
              >
                {definition.title}
              </button>
            ))}
          </nav>

          {!visible.length ? <p className="error">{NO_ROLES_MESSAGE}</p> : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="status">{notice}</p> : null}

          {current?.unbuiltReason ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <small>NOT BUILT YET</small>
                  <h2>{current.title}</h2>
                </div>
              </div>
              <p>{current.unbuiltReason}</p>
              <p className="status neutral">{current.roleNote}</p>
            </section>
          ) : null}

          {area === 'review' ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <small>DATA REVIEW QUEUE</small>
                  <h2>Activities requiring attention</h2>
                </div>
                <button type="button" onClick={() => openArea('review')} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh queue'}
                </button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Submission</th>
                    <th>Status</th>
                    <th>Submitted</th>
                    <th>Validation notes</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code>{item.id}</code>
                      </td>
                      <td>
                        <span className="tag">{readableStatus(item.status)}</span>
                      </td>
                      <td>{new Date(item.submittedAt).toLocaleString()}</td>
                      <td>
                        {item.rejectionReason ??
                          (item.validationErrors.join(', ') || 'Awaiting validation')}
                      </td>
                    </tr>
                  ))}
                  {!loading && items.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No activities currently require review.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          ) : null}

          {area === 'moderation' ? (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <small>REPORT QUEUE</small>
                    <h2>Oldest first</h2>
                  </div>
                  <button type="button" onClick={() => openArea('moderation')} disabled={loading}>
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
                {reports.map((report) => (
                  <ReportRow
                    key={report.id}
                    accessToken={accessToken}
                    report={report}
                    loading={loading}
                    onChanged={() => openArea('moderation')}
                    run={run}
                  />
                ))}
                {!loading && reports.length === 0 ? <p>No open reports.</p> : null}
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <small>APPEALS</small>
                    <h2>Decisions being answered</h2>
                  </div>
                </div>
                {appeals.map((appeal) => (
                  <article key={appeal.id} className="row">
                    <div>
                      <span className="tag">{appeal.sanctionKind.replace(/_/g, ' ')}</span>
                      <p>
                        <em>What they were told:</em> {appeal.sanctionStatement}
                      </p>
                      <p>
                        <em>What they say:</em> {appeal.statement}
                      </p>
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void run(
                            () =>
                              decideAppeal(accessToken, appeal.id, {
                                decision: 'upheld',
                                decisionNote: 'The decision stands after review.'
                              }),
                            'Appeal declined; the sanction stands.'
                          ).then(() => openArea('moderation'))
                        }
                      >
                        Uphold the sanction
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void run(
                            () =>
                              decideAppeal(accessToken, appeal.id, {
                                decision: 'overturned',
                                decisionNote: 'The sanction is lifted after review.'
                              }),
                            'Appeal accepted; the sanction is lifted.'
                          ).then(() => openArea('moderation'))
                        }
                      >
                        Overturn it
                      </button>
                    </div>
                  </article>
                ))}
                {!loading && appeals.length === 0 ? <p>No open appeals.</p> : null}
              </section>
            </>
          ) : null}

          {area === 'privacy' ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <small>OPEN REQUESTS</small>
                  <h2>Exports and erasures</h2>
                </div>
                <button type="button" onClick={() => openArea('privacy')} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              <p className="status neutral">{PRIVACY_READ_ONLY_NOTE}</p>
              <p className="status">
                {completedDeletions} erasures have converged. Who they were is not recorded here —
                that is what erasure means.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Request</th>
                    <th>Open for</th>
                  </tr>
                </thead>
                <tbody>
                  {privacyRequests.map((request) => (
                    <tr key={`${request.accountId}-${request.kind}`}>
                      <td>
                        <code>{request.accountId}</code>
                      </td>
                      <td>
                        <span className="tag">{request.kind}</span>
                      </td>
                      <td>
                        {request.openForHours} h
                        {privacyNeedsAttention(request) ? (
                          <span className="tag">needs a look</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!loading && privacyRequests.length === 0 ? (
                    <tr>
                      <td colSpan={3}>Nothing is waiting.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          ) : null}

          {area === 'data' ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <small>PUBLISHED RULES</small>
                  <h2>What is live, and since when</h2>
                </div>
                <button type="button" onClick={() => openArea('data')} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              <p className="status neutral">{RULES_READ_ONLY_NOTE}</p>
              <table>
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Version</th>
                    <th>Effective</th>
                    <th>Definition</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={`${rule.kind}-${rule.version}`}>
                      <td>
                        {rule.kind}
                        {rule.live ? <span className="tag">live</span> : null}
                      </td>
                      <td>v{rule.version}</td>
                      <td>{new Date(rule.effectiveAt).toLocaleDateString()}</td>
                      <td>
                        <code>{JSON.stringify(rule.definition)}</code>
                      </td>
                    </tr>
                  ))}
                  {!loading && rules.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No rule has been published on this deployment.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          ) : null}

          {area === 'competitions' ? (
            <CompetitionsArea
              accessToken={accessToken}
              competitions={competitions}
              loading={loading}
              onChanged={() => openArea('competitions')}
              run={run}
            />
          ) : null}

          {area === 'seasons' ? (
            <SeasonsArea accessToken={accessToken} seasons={seasons} run={run} />
          ) : null}

          {area === 'campaigns' ? (
            <CampaignsArea
              accessToken={accessToken}
              campaigns={campaigns}
              templates={templates}
              loading={loading}
              onChanged={() => openArea('campaigns')}
              run={run}
            />
          ) : null}
        </>
      )}
      <footer>{AUDIT_NOTICE} Territory capture remains off.</footer>
    </main>
  );
}

type Runner = (work: () => Promise<unknown>, success?: string) => Promise<void>;

/**
 * Territory seasons (Phase 4, milestone 4.6).
 *
 * Everything here is empty on any current deployment, because capture is off
 * and no week has ever been finalized. That is stated rather than hidden: an
 * operator looking at a blank concentration table needs to know whether it
 * means "nothing is wrong" or "nothing has run".
 */
function SeasonsArea({
  accessToken,
  seasons,
  run
}: {
  accessToken: string;
  seasons: readonly TerritorySeasonView[];
  run: Runner;
}) {
  const [seasonId, setSeasonId] = useState('');
  const [divisions, setDivisions] = useState<readonly TerritoryDivisionSize[]>([]);
  const [concentration, setConcentration] = useState<readonly TerritoryConcentrationRow[]>([]);
  const [weeks, setWeeks] = useState<readonly TerritoryWeekRow[]>([]);
  const [reason, setReason] = useState('');

  const openSeason = (id: string) => {
    setSeasonId(id);
    if (!id) return;
    void run(async () => {
      setDivisions((await getTerritoryDivisions(accessToken, id)).data);
      setConcentration((await getTerritoryConcentration(accessToken, id)).data);
      setWeeks((await getTerritoryWeeks(accessToken, id)).data);
    });
  };

  const concentrationState = (row: TerritoryConcentrationRow): string => {
    if (!row.applicable) return CONCENTRATION_NOT_APPLICABLE_NOTE;
    if (row.pausesAwards)
      return `Breached ${row.breachRunDays} days running. Pause awards analysis.`;
    if (row.breached) return `Breached ${row.breachRunDays} days running.`;
    return 'Within the limits.';
  };

  return (
    <section>
      <h2>Territory seasons</h2>
      <p>{CONCENTRATION_NOTE}</p>
      <label htmlFor="season">Season</label>
      <select id="season" value={seasonId} onChange={(event) => openSeason(event.target.value)}>
        <option value="">Choose a season</option>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {`${season.title} — ${season.status}`}
          </option>
        ))}
      </select>
      {seasons.length === 0 ? <p>No season has been announced on this deployment.</p> : null}

      {seasonId ? (
        <>
          <h3>Divisions</h3>
          <table>
            <thead>
              <tr>
                <th>Division</th>
                <th>Enrolled</th>
                <th>Advice for the next season start</th>
              </tr>
            </thead>
            <tbody>
              {divisions.map((division) => (
                <tr key={division.division}>
                  <td>{division.division}</td>
                  <td>{division.enrolledCount}</td>
                  <td>{division.advice}</td>
                </tr>
              ))}
              {divisions.length === 0 ? (
                <tr>
                  <td colSpan={3}>Nobody has enrolled in this season.</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <h3>Concentration</h3>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Division</th>
                <th>Top 10%</th>
                <th>Top participant</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {concentration.map((row) => (
                <tr key={`${row.observedOn}-${row.division}`}>
                  <td>{row.observedOn}</td>
                  <td>{row.division}</td>
                  <td>{`${Math.round(row.topDecileShare * 100)}%`}</td>
                  <td>{`${Math.round(row.topParticipantShare * 100)}%`}</td>
                  <td>{concentrationState(row)}</td>
                </tr>
              ))}
              {concentration.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    Nothing has been observed. Concentration is recorded daily once a season is
                    scoring, and territory capture is off.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <h3>Weeks</h3>
          <p>{ROLLBACK_NOTE}</p>
          <label htmlFor="rollback-reason">Reason for a rollback</label>
          <textarea
            id="rollback-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={ROLLBACK_REASON_HINT}
          />
          <table>
            <thead>
              <tr>
                <th>Week</th>
                <th>Showing</th>
                <th>Newest</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.weekStartsOn}>
                  <td>{week.weekStartsOn}</td>
                  <td>
                    {week.rolledBack ? `${week.currentVersion} (rolled back)` : week.currentVersion}
                  </td>
                  <td>{week.latestVersion}</td>
                  <td>
                    <button
                      type="button"
                      disabled={week.currentVersion <= 1 || reason.trim().length === 0}
                      onClick={() =>
                        void run(async () => {
                          await rollBackTerritoryWeek(accessToken, seasonId, week.weekStartsOn, {
                            toVersion: week.currentVersion - 1,
                            reason: reason.trim()
                          });
                          setWeeks((await getTerritoryWeeks(accessToken, seasonId)).data);
                          setReason('');
                        }, 'The week now shows the earlier snapshot.')
                      }
                    >
                      Roll back one version
                    </button>
                  </td>
                </tr>
              ))}
              {weeks.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    No week has been finalized. A week is snapshotted after it ends, and territory
                    capture is off.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

function CompetitionsArea({
  accessToken,
  competitions,
  loading,
  onChanged,
  run
}: {
  accessToken: string;
  competitions: readonly CompetitionSummary[];
  loading: boolean;
  onChanged: () => void;
  run: Runner;
}) {
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [lengthDays, setLengthDays] = useState('7');
  const [rewards, setRewards] = useState('');

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <small>SCHEDULE</small>
            <h2>Draft a competition</h2>
          </div>
        </div>
        <p className="status neutral">
          A new competition is created as a draft. Announcing it is a second, deliberate act, and it
          cannot be un-announced.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await createCompetition(accessToken, {
                title,
                mode: 'active_minutes',
                periodStart,
                lengthDays: Number(lengthDays),
                ...(rewards ? { rewards } : {})
              });
            }, 'Draft created. It is not announced yet.').then(onChanged);
          }}
        >
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            First day
            <input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              required
            />
          </label>
          <label>
            Days
            <select value={lengthDays} onChange={(event) => setLengthDays(event.target.value)}>
              <option value="7">7</option>
              <option value="14">14</option>
              <option value="30">30</option>
            </select>
          </label>
          <label>
            Rewards
            <input
              value={rewards}
              onChange={(event) => setRewards(event.target.value)}
              placeholder="Cosmetic or status only"
            />
          </label>
          <button type="submit" disabled={loading}>
            Create draft
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <small>SCHEDULED AND PAST</small>
            <h2>Competitions</h2>
          </div>
        </div>
        {competitions.map((competition) => (
          <article key={competition.id} className="row">
            <div>
              <strong>{competition.title}</strong>
              <span className="tag">{competition.status}</span>
              <p>
                {competition.periodStart} to {competition.periodEnd} ·{' '}
                {competition.participantCount} entrants
              </p>
            </div>
            <div>
              {competition.status === 'draft' ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    void run(
                      () => setCompetitionStatus(accessToken, competition.id, true),
                      'Announced. Members can enter it now.'
                    ).then(onChanged)
                  }
                >
                  Announce
                </button>
              ) : null}
              {competition.status !== 'finalized' && competition.status !== 'cancelled' ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    void run(
                      () => setCompetitionStatus(accessToken, competition.id, false),
                      'Cancelled. Nothing will be scored for it.'
                    ).then(onChanged)
                  }
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!loading && competitions.length === 0 ? <p>No competitions yet.</p> : null}
      </section>
    </>
  );
}

function CampaignsArea({
  accessToken,
  campaigns,
  templates,
  loading,
  onChanged,
  run
}: {
  accessToken: string;
  campaigns: readonly CampaignSummary[];
  templates: readonly EmailTemplate[];
  loading: boolean;
  onChanged: () => void;
  run: Runner;
}) {
  const [templateKey, setTemplateKey] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [campaignTemplate, setCampaignTemplate] = useState('');
  const [sendCap, setSendCap] = useState('500');
  const [scheduledFor, setScheduledFor] = useState('');

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <small>TEMPLATES</small>
            <h2>Approved copy</h2>
          </div>
        </div>
        <p className="status neutral">
          Publishing a version is the approval. A new version supersedes the live one; a campaign
          already scheduled keeps the version it resolved.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => publishEmailTemplate(accessToken, { key: templateKey, subject, body }),
              'Template published. It is now the live version for that key.'
            ).then(onChanged);
          }}
        >
          <label>
            Key
            <input
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value)}
              required
            />
          </label>
          <label>
            Subject
            <input value={subject} onChange={(event) => setSubject(event.target.value)} required />
          </label>
          <label>
            Body
            <textarea value={body} onChange={(event) => setBody(event.target.value)} required />
          </label>
          <button type="submit" disabled={loading}>
            Publish version
          </button>
        </form>
        <ul>
          {templates.map((template) => (
            <li key={`${template.key}-${template.version}`}>
              <code>{template.key}</code> v{template.version}
              {template.live ? <span className="tag">live</span> : null} — {template.subject}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <small>CAMPAIGNS</small>
            <h2>Consented sends</h2>
          </div>
        </div>
        <p className="status neutral">
          Every audience requires consent. You see counts here, never the people in them.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                createCampaign(accessToken, {
                  templateKey: campaignTemplate,
                  audience: { consentRequired: true },
                  sendCap: Number(sendCap)
                }),
              'Draft created. Nothing has been sent.'
            ).then(onChanged);
          }}
        >
          <label>
            Template key
            <input
              value={campaignTemplate}
              onChange={(event) => setCampaignTemplate(event.target.value)}
              required
            />
          </label>
          <label>
            Send cap
            <input
              type="number"
              min={1}
              value={sendCap}
              onChange={(event) => setSendCap(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            Create draft
          </button>
        </form>
        {campaigns.map((campaign) => (
          <article key={campaign.id} className="row">
            <div>
              <strong>{campaign.templateKey}</strong>
              <span className="tag">{campaign.status}</span>
              <p>
                cap {campaign.sendCap} · queued {campaign.queuedCount} · sent {campaign.sentCount}
              </p>
            </div>
            <div>
              {campaign.status === 'draft' ? (
                <>
                  <label>
                    Send at
                    <input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(event) => setScheduledFor(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={loading || !scheduledFor}
                    onClick={() =>
                      void run(
                        () =>
                          scheduleCampaign(
                            accessToken,
                            campaign.id,
                            new Date(scheduledFor).toISOString()
                          ),
                        'Scheduled. It can still be cancelled until it sends.'
                      ).then(onChanged)
                    }
                  >
                    Schedule
                  </button>
                </>
              ) : null}
              {campaign.status !== 'sent' && campaign.status !== 'cancelled' ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    void run(
                      () => cancelCampaign(accessToken, campaign.id),
                      'Cancelled. Anything still queued was dropped.'
                    ).then(onChanged)
                  }
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!loading && campaigns.length === 0 ? <p>No campaigns yet.</p> : null}
      </section>
    </>
  );
}

/**
 * One report, with the two things a moderator needs to act: the ability to
 * dismiss it, and a form to issue a sanction whose statement the account will
 * actually read (milestone 3.11).
 *
 * The subject's existing sanctions are loaded on demand rather than with the
 * queue: most reports are dismissed, and reading somebody's moderation history
 * is itself an audited act that should happen because a moderator asked for it.
 */
function ReportRow({
  accessToken,
  report,
  loading,
  onChanged,
  run
}: {
  accessToken: string;
  report: StaffReport;
  loading: boolean;
  onChanged: () => void;
  run: Runner;
}) {
  const [sanctioning, setSanctioning] = useState(false);
  const [kind, setKind] = useState<StaffSanction['kind']>('warning');
  const [statement, setStatement] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [history, setHistory] = useState<StaffSanction[]>();
  const [liftReason, setLiftReason] = useState('');

  const canSanction = report.subjectType === 'account';

  return (
    <article className="row">
      <div>
        <strong>{report.subjectName}</strong>
        <span className="tag">{report.reason.replace(/_/g, ' ')}</span>
        <span className="tag">
          {report.openReportCount} open on this {report.subjectType}
        </span>
        <p>{report.note || 'No note was written.'}</p>

        {sanctioning && canSanction ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  resolveReport(accessToken, report.id, {
                    action: 'sanction',
                    sanctionKind: kind,
                    statement,
                    // A warning never expires, so no duration is sent with one.
                    ...(kind !== 'warning' && durationHours
                      ? { durationHours: Number(durationHours) }
                      : {})
                  }),
                'Sanction issued. The account has been told.'
              ).then(onChanged);
            }}
          >
            <fieldset>
              <legend>What to do</legend>
              {SANCTION_CHOICES.map((choice) => (
                <label key={choice.kind}>
                  <input
                    type="radio"
                    name={`kind-${report.id}`}
                    value={choice.kind}
                    checked={kind === choice.kind}
                    onChange={() => setKind(choice.kind)}
                  />
                  {choice.label} — {choice.effect}
                </label>
              ))}
            </fieldset>
            <label>
              What they are told
              <textarea
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                required
              />
            </label>
            <p className="status neutral">{SANCTION_STATEMENT_HINT}</p>
            {kind === 'warning' ? null : (
              <label>
                Hours (leave blank for no end date)
                <input
                  type="number"
                  min={1}
                  value={durationHours}
                  onChange={(event) => setDurationHours(event.target.value)}
                />
              </label>
            )}
            <button type="submit" disabled={loading}>
              Issue sanction
            </button>
          </form>
        ) : null}

        {history ? (
          <ul>
            {history.map((sanction) => (
              <li key={sanction.id}>
                <span className="tag">{sanction.kind.replace(/_/g, ' ')}</span>
                {sanction.inForce ? <span className="tag">in force</span> : null}
                {sanction.hasOpenAppeal ? <span className="tag">appeal open</span> : null}
                <p>{sanction.statement}</p>
                {sanction.hasOpenAppeal ? (
                  <p className="status neutral">{OPEN_APPEAL_WARNING}</p>
                ) : null}
                {sanctionLiftable(sanction) ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(
                        () => liftSanction(accessToken, sanction.id, liftReason),
                        'Sanction lifted. The account has been told.'
                      ).then(onChanged);
                    }}
                  >
                    <label>
                      Why it is ending early
                      <input
                        value={liftReason}
                        onChange={(event) => setLiftReason(event.target.value)}
                        required
                      />
                    </label>
                    <p className="status neutral">{SANCTION_LIFT_HINT}</p>
                    <button type="submit" disabled={loading}>
                      Lift it
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
            {history.length === 0 ? <li>Nothing has been issued to this account.</li> : null}
          </ul>
        ) : null}
      </div>
      <div>
        <button
          type="button"
          disabled={loading}
          onClick={() =>
            void run(
              () => resolveReport(accessToken, report.id, { action: 'dismiss' }),
              'Report dismissed.'
            ).then(onChanged)
          }
        >
          Dismiss
        </button>
        {canSanction ? (
          <button type="button" disabled={loading} onClick={() => setSanctioning(!sanctioning)}>
            {sanctioning ? 'Cancel' : 'Sanction…'}
          </button>
        ) : (
          // A club is moderated by acting on its owner or by archiving it; the
          // API refuses a club sanction, so the console never offers one.
          <span className="status neutral">
            A club cannot be sanctioned. Act on its owner, or archive it.
          </span>
        )}
        {canSanction ? (
          <button
            type="button"
            disabled={loading}
            onClick={() =>
              void run(async () => {
                setHistory((await getAccountSanctions(accessToken, report.subjectId)).data);
              })
            }
          >
            Their history
          </button>
        ) : null}
      </div>
    </article>
  );
}
