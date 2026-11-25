import { useState } from 'react';
import type { CompetitionSummary } from '@runsphere/contracts';
import { createCompetition, getCompetitions, setCompetitionStatus } from './api.js';
import type { AreaContext } from './area-types.js';
import { lifecycleTone } from './status-tone.js';
import { useAreaLoad } from './use-area-load.js';
import {
  Button,
  DataTable,
  Field,
  FormDialog,
  Notice,
  Section,
  StatusTag,
  TableToolbar
} from './ui/index.js';

/** The list of competitions, with the form that drafts one in a dialog. */
export function CompetitionsView({
  accessToken,
  competitions,
  loading,
  error,
  onChanged,
  run
}: AreaContext & { competitions: readonly CompetitionSummary[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [lengthDays, setLengthDays] = useState('7');
  const [rewards, setRewards] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? competitions.filter((c) => `${c.title} ${c.status}`.toLowerCase().includes(needle))
    : competitions;

  return (
    <>
      <Section
        title="Competitions"
        description="Scheduled and past."
        actions={<Button onClick={() => setDrafting(true)}>Draft a competition</Button>}
      >
        <TableToolbar
          label="Search competitions"
          query={query}
          onQueryChange={setQuery}
          shown={shown.length}
          total={competitions.length}
        />
        <DataTable
          caption="Competitions"
          columns={[
            { key: 'title', header: 'Competition', render: (c) => <strong>{c.title}</strong> },
            {
              key: 'status',
              header: 'Status',
              render: (c) => <StatusTag tone={lifecycleTone(c.status)}>{c.status}</StatusTag>
            },
            {
              key: 'period',
              header: 'Period',
              render: (c) => (
                <span className="rs-nowrap">{`${c.periodStart} to ${c.periodEnd}`}</span>
              )
            },
            {
              key: 'entrants',
              header: 'Entrants',
              numeric: true,
              render: (c) => c.participantCount
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (competition) => (
                <div className="rs-actions">
                  {competition.status === 'draft' ? (
                    <Button
                      variant="secondary"
                      disabled={loading}
                      onClick={() =>
                        void run(
                          () => setCompetitionStatus(accessToken, competition.id, true),
                          'Announced. Members can enter it now.'
                        ).then(onChanged)
                      }
                    >
                      Announce
                    </Button>
                  ) : null}
                  {competition.status !== 'finalized' && competition.status !== 'cancelled' ? (
                    <Button
                      variant="ghost"
                      disabled={loading}
                      onClick={() =>
                        void run(
                          () => setCompetitionStatus(accessToken, competition.id, false),
                          'Cancelled. Nothing will be scored for it.'
                        ).then(onChanged)
                      }
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              )
            }
          ]}
          rows={shown}
          rowKey={(competition) => competition.id}
          emptyMessage={loading ? 'Loading…' : 'No competitions yet.'}
        />
      </Section>

      <FormDialog
        open={drafting}
        title="Draft a competition"
        submitLabel="Create draft"
        busy={loading}
        error={error}
        onClose={() => setDrafting(false)}
        onSubmit={() =>
          void run(async () => {
            await createCompetition(accessToken, {
              title,
              mode: 'active_minutes',
              periodStart,
              lengthDays: Number(lengthDays),
              ...(rewards ? { rewards } : {})
            });
          }, 'Draft created. It is not announced yet.').then((ok) => {
            if (!ok) return;
            setDrafting(false);
            setTitle('');
            setPeriodStart('');
            setRewards('');
            onChanged();
          })
        }
      >
        <Notice tone="readonly">
          A new competition is created as a draft. Announcing it is a second, deliberate act, and it
          cannot be un-announced.
        </Notice>
        <Field label="Title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </Field>
        <Field label="First day">
          <input
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
            required
          />
        </Field>
        <Field label="Days">
          <select value={lengthDays} onChange={(event) => setLengthDays(event.target.value)}>
            <option value="7">7</option>
            <option value="14">14</option>
            <option value="30">30</option>
          </select>
        </Field>
        <Field label="Rewards">
          <input
            value={rewards}
            onChange={(event) => setRewards(event.target.value)}
            placeholder="Cosmetic or status only"
          />
        </Field>
      </FormDialog>
    </>
  );
}

export function CompetitionsArea(context: AreaContext) {
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const reload = () =>
    context.run(async () => setCompetitions((await getCompetitions(context.accessToken)).data));
  useAreaLoad(reload);
  return (
    <CompetitionsView {...context} competitions={competitions} onChanged={() => void reload()} />
  );
}
