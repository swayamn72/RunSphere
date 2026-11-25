import { useState } from 'react';
import type { StaffAppeal, StaffReport, StaffSanction } from '@runsphere/contracts';
import {
  OPEN_APPEAL_WARNING,
  SANCTION_CHOICES,
  SANCTION_LIFT_HINT,
  SANCTION_STATEMENT_HINT,
  sanctionLiftable
} from './areas.js';
import {
  decideAppeal,
  getAccountSanctions,
  getAppealQueue,
  getReportQueue,
  liftSanction,
  resolveReport
} from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import {
  Button,
  ConfirmButton,
  EmptyState,
  Field,
  Notice,
  Section,
  StatusTag
} from './ui/index.js';

const readable = (value: string) => value.replace(/_/g, ' ');

/**
 * One report, with the two things a moderator needs to act: the ability to
 * dismiss it, and a form to issue a sanction whose statement the account will
 * actually read (milestone 3.11).
 *
 * The subject's existing sanctions are loaded on demand rather than with the
 * queue: most reports are dismissed, and reading somebody's moderation history
 * is itself an audited act that should happen because a moderator asked for it.
 */
function ReportDetail({
  accessToken,
  report,
  loading,
  onChanged,
  run
}: AreaContext & { report: StaffReport; onChanged: () => void }) {
  const [sanctioning, setSanctioning] = useState(false);
  const [kind, setKind] = useState<StaffSanction['kind']>('warning');
  const [statement, setStatement] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [history, setHistory] = useState<StaffSanction[]>();
  const [liftReason, setLiftReason] = useState('');

  const canSanction = report.subjectType === 'account';

  return (
    <article className="rs-detail" aria-label={`Report on ${report.subjectName}`}>
      <header className="rs-detail__head">
        <h3 className="rs-detail__title">{report.subjectName}</h3>
        <div className="rs-tags">
          <StatusTag tone="warning">{readable(report.reason)}</StatusTag>
          <StatusTag>
            {report.openReportCount} open on this {report.subjectType}
          </StatusTag>
        </div>
      </header>
      <p className="rs-detail__note">{report.note || 'No note was written.'}</p>

      <div className="rs-actions">
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() =>
            void run(
              () => resolveReport(accessToken, report.id, { action: 'dismiss' }),
              'Report dismissed.'
            ).then(onChanged)
          }
        >
          Dismiss
        </Button>
        {canSanction ? (
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => setSanctioning(!sanctioning)}
          >
            {sanctioning ? 'Cancel' : 'Sanction…'}
          </Button>
        ) : (
          // A club is moderated by acting on its owner or by archiving it; the
          // API refuses a club sanction, so the console never offers one.
          <Notice tone="readonly">
            A club cannot be sanctioned. Act on its owner, or archive it.
          </Notice>
        )}
        {canSanction ? (
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() =>
              void run(async () => {
                setHistory((await getAccountSanctions(accessToken, report.subjectId)).data);
              })
            }
          >
            Their history
          </Button>
        ) : null}
      </div>

      {sanctioning && canSanction ? (
        <form
          className="rs-form"
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
          <fieldset className="rs-choices">
            <legend>What to do</legend>
            {SANCTION_CHOICES.map((choice) => (
              <label key={choice.kind} className="rs-choice">
                <input
                  type="radio"
                  name={`kind-${report.id}`}
                  value={choice.kind}
                  checked={kind === choice.kind}
                  onChange={() => setKind(choice.kind)}
                />
                <span>
                  <strong>{choice.label}</strong>
                  <span className="rs-choice__effect">{choice.effect}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="What they are told" hint={SANCTION_STATEMENT_HINT}>
            <textarea
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              required
            />
          </Field>
          {kind === 'warning' ? null : (
            <Field label="Hours (leave blank for no end date)">
              <input
                type="number"
                min={1}
                value={durationHours}
                onChange={(event) => setDurationHours(event.target.value)}
              />
            </Field>
          )}
          <div>
            <Button type="submit" busy={loading}>
              Issue sanction
            </Button>
          </div>
        </form>
      ) : null}

      {history ? (
        <ul className="rs-history">
          {history.map((sanction) => (
            <li key={sanction.id} className="rs-history__item">
              <div className="rs-tags">
                <StatusTag>{readable(sanction.kind)}</StatusTag>
                {sanction.inForce ? <StatusTag tone="warning">in force</StatusTag> : null}
                {sanction.hasOpenAppeal ? <StatusTag tone="info">appeal open</StatusTag> : null}
              </div>
              <p>{sanction.statement}</p>
              {sanction.hasOpenAppeal ? (
                <Notice tone="warning">{OPEN_APPEAL_WARNING}</Notice>
              ) : null}
              {sanctionLiftable(sanction) ? (
                <form
                  className="rs-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      () => liftSanction(accessToken, sanction.id, liftReason),
                      'Sanction lifted. The account has been told.'
                    ).then(onChanged);
                  }}
                >
                  <Field label="Why it is ending early" hint={SANCTION_LIFT_HINT}>
                    <input
                      value={liftReason}
                      onChange={(event) => setLiftReason(event.target.value)}
                      required
                    />
                  </Field>
                  <div>
                    <Button type="submit" variant="secondary" busy={loading}>
                      Lift it
                    </Button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
          {history.length === 0 ? <li>Nothing has been issued to this account.</li> : null}
        </ul>
      ) : null}
    </article>
  );
}

export function ModerationView({
  reports,
  appeals,
  onChanged,
  ...context
}: AreaContext & {
  reports: readonly StaffReport[];
  appeals: readonly StaffAppeal[];
  onChanged: () => void;
}) {
  const { accessToken, loading, run } = context;
  const [selectedId, setSelectedId] = useState<string>();
  // The first report is open until another is chosen, so a moderator lands on work.
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0];

  return (
    <>
      <Section
        title="Report queue"
        description="Oldest first."
        actions={
          <Button variant="secondary" busy={loading} onClick={onChanged}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      >
        {reports.length === 0 ? (
          <EmptyState title={loading ? 'Loading…' : 'No open reports.'} />
        ) : (
          <div className="rs-split">
            <ul className="rs-queue" aria-label="Open reports">
              {reports.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    className="rs-queue__item"
                    aria-current={report.id === selected?.id}
                    onClick={() => setSelectedId(report.id)}
                  >
                    <span className="rs-queue__name">{report.subjectName}</span>
                    <span className="rs-queue__meta">
                      {readable(report.reason)} · {report.openReportCount} open
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <ReportDetail
                key={selected.id}
                {...context}
                report={selected}
                onChanged={onChanged}
              />
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Appeals" description="Decisions being answered.">
        {appeals.length === 0 ? (
          <EmptyState title={loading ? 'Loading…' : 'No open appeals.'} />
        ) : (
          <ul className="rs-cards">
            {appeals.map((appeal) => (
              <li key={appeal.id} className="rs-card">
                <div>
                  <StatusTag tone="warning">{readable(appeal.sanctionKind)}</StatusTag>
                  <p>
                    <em>What they were told:</em> {appeal.sanctionStatement}
                  </p>
                  <p>
                    <em>What they say:</em> {appeal.statement}
                  </p>
                </div>
                <div className="rs-actions">
                  <ConfirmButton
                    disabled={loading}
                    title="Uphold this sanction?"
                    description="The appeal is declined and the sanction stands. The account is told the decision stands after review."
                    confirmLabel="Uphold the sanction"
                    onConfirm={() =>
                      void run(
                        () =>
                          decideAppeal(accessToken, appeal.id, {
                            decision: 'upheld',
                            decisionNote: 'The decision stands after review.'
                          }),
                        'Appeal declined; the sanction stands.'
                      ).then(onChanged)
                    }
                  >
                    Uphold the sanction
                  </ConfirmButton>
                  <ConfirmButton
                    disabled={loading}
                    title="Overturn this sanction?"
                    description="The appeal is accepted and the sanction is lifted now. The account is told."
                    confirmLabel="Overturn it"
                    onConfirm={() =>
                      void run(
                        () =>
                          decideAppeal(accessToken, appeal.id, {
                            decision: 'overturned',
                            decisionNote: 'The sanction is lifted after review.'
                          }),
                        'Appeal accepted; the sanction is lifted.'
                      ).then(onChanged)
                    }
                  >
                    Overturn it
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export function ModerationArea(context: AreaContext) {
  const [reports, setReports] = useState<StaffReport[]>([]);
  const [appeals, setAppeals] = useState<StaffAppeal[]>([]);
  const reload = () =>
    context.run(async () => {
      setReports((await getReportQueue(context.accessToken)).data);
      setAppeals((await getAppealQueue(context.accessToken)).data);
    });
  useAreaLoad(reload);
  return (
    <ModerationView
      {...context}
      reports={reports}
      appeals={appeals}
      onChanged={() => void reload()}
    />
  );
}
