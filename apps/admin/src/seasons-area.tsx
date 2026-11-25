import { useState } from 'react';
import type { TerritorySeasonView } from '@runsphere/contracts';
import {
  CONCENTRATION_NOTE,
  CONCENTRATION_NOT_APPLICABLE_NOTE,
  ROLLBACK_NOTE,
  ROLLBACK_REASON_HINT
} from './areas.js';
import {
  getTerritoryConcentration,
  getTerritoryDivisions,
  getTerritorySeasons,
  getTerritoryWeeks,
  rollBackTerritoryWeek,
  type TerritoryConcentrationRow,
  type TerritoryDivisionSize,
  type TerritoryWeekRow
} from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import { ConfirmButton, DataTable, Field, Notice, Section, StatusTag } from './ui/index.js';

export const concentrationState = (row: TerritoryConcentrationRow): string => {
  if (!row.applicable) return CONCENTRATION_NOT_APPLICABLE_NOTE;
  if (row.pausesAwards) return `Breached ${row.breachRunDays} days running. Pause awards analysis.`;
  if (row.breached) return `Breached ${row.breachRunDays} days running.`;
  return 'Within the limits.';
};

const stateTone = (row: TerritoryConcentrationRow) =>
  !row.applicable ? 'neutral' : row.pausesAwards ? 'danger' : row.breached ? 'warning' : 'success';

/**
 * Territory seasons (Phase 4, milestone 4.6).
 *
 * Everything here is empty on any current deployment, because capture is off
 * and no week has ever been finalized. That is stated rather than hidden: an
 * operator looking at a blank concentration table needs to know whether it
 * means "nothing is wrong" or "nothing has run".
 */
export function SeasonsView({
  accessToken,
  seasons,
  loading,
  run
}: AreaContext & { seasons: readonly TerritorySeasonView[] }) {
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

  return (
    <>
      <Notice tone="info">{CONCENTRATION_NOTE}</Notice>
      <Section
        title="Season"
        description={
          seasons.length === 0 && !loading
            ? 'No season has been announced on this deployment.'
            : undefined
        }
      >
        <div className="rs-season-picker">
          <Field label="Season">
            <select value={seasonId} onChange={(event) => openSeason(event.target.value)}>
              <option value="">Choose a season</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {`${season.title} — ${season.status}`}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {seasonId ? (
        <>
          <Section title="Divisions">
            <DataTable
              caption="Division sizes"
              columns={[
                { key: 'division', header: 'Division', render: (d) => d.division },
                {
                  key: 'enrolled',
                  header: 'Enrolled',
                  numeric: true,
                  render: (d) => d.enrolledCount
                },
                {
                  key: 'advice',
                  header: 'Advice for the next season start',
                  render: (d) => d.advice
                }
              ]}
              rows={divisions}
              rowKey={(division) => String(division.division)}
              emptyMessage="Nobody has enrolled in this season."
            />
          </Section>

          <Section title="Concentration">
            <DataTable
              caption="Daily concentration"
              columns={[
                { key: 'day', header: 'Day', render: (row) => row.observedOn },
                { key: 'division', header: 'Division', render: (row) => row.division },
                {
                  key: 'decile',
                  header: 'Top 10%',
                  numeric: true,
                  render: (row) => `${Math.round(row.topDecileShare * 100)}%`
                },
                {
                  key: 'top',
                  header: 'Top participant',
                  numeric: true,
                  render: (row) => `${Math.round(row.topParticipantShare * 100)}%`
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (row) => (
                    <>
                      <StatusTag tone={stateTone(row)}>
                        {!row.applicable ? 'not evaluated' : row.breached ? 'breached' : 'within'}
                      </StatusTag>{' '}
                      {concentrationState(row)}
                    </>
                  )
                }
              ]}
              rows={concentration}
              rowKey={(row) => `${row.observedOn}-${row.division}`}
              emptyMessage="Nothing has been observed. Concentration is recorded daily once a season is scoring, and territory capture is off."
            />
          </Section>

          <Section title="Weeks" description={ROLLBACK_NOTE}>
            <div className="rs-season-picker">
              <Field label="Reason for a rollback" hint={ROLLBACK_REASON_HINT}>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
            </div>
            <DataTable
              caption="Week snapshots"
              columns={[
                { key: 'week', header: 'Week', render: (week) => week.weekStartsOn },
                {
                  key: 'showing',
                  header: 'Showing',
                  numeric: true,
                  render: (week) =>
                    week.rolledBack ? `${week.currentVersion} (rolled back)` : week.currentVersion
                },
                {
                  key: 'newest',
                  header: 'Newest',
                  numeric: true,
                  render: (week) => week.latestVersion
                },
                {
                  key: 'action',
                  header: 'Action',
                  render: (week) => (
                    <ConfirmButton
                      danger
                      disabled={week.currentVersion <= 1 || reason.trim().length === 0}
                      title="Roll this week back one version?"
                      description={`The week starting ${week.weekStartsOn} goes back to version ${week.currentVersion - 1}. Your reason is recorded against your staff account.`}
                      confirmLabel="Roll back"
                      onConfirm={() =>
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
                    </ConfirmButton>
                  )
                }
              ]}
              rows={weeks}
              rowKey={(week) => week.weekStartsOn}
              emptyMessage="No week has been finalized. A week is snapshotted after it ends, and territory capture is off."
            />
          </Section>
        </>
      ) : null}
    </>
  );
}

export function SeasonsArea(context: AreaContext) {
  const [seasons, setSeasons] = useState<readonly TerritorySeasonView[]>([]);
  useAreaLoad(() =>
    context.run(async () => setSeasons((await getTerritorySeasons(context.accessToken)).data))
  );
  return <SeasonsView {...context} seasons={seasons} />;
}
