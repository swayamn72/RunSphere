import { useState } from 'react';
import type { TerritoryConcentrationReport, TerritoryTradeFlag } from '@runsphere/contracts';
import { canModerate, canOperateCompetitions } from '@runsphere/domain';
import { getTradeFlags, getTurfConcentration, reviewTradeFlag } from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import { Button, DataTable, Field, Notice, Section, StatusTag } from './ui/index.js';

/**
 * Turf claims for staff (the claim-era model, not the cell seasons that are
 * still off). Two parts with two gates: the trade-flag queue needs a moderator
 * and concentration needs a season operator, so each arrives as `undefined`
 * when the account's role doesn't admit it, and the part says why instead of
 * showing an empty table that reads as "nothing to do".
 *
 * A trade flag is a question, never a verdict: two runners swapping the same
 * ground back and forth can be a real rivalry. A review therefore always
 * carries the moderator's note, and nothing here changes who holds what.
 */
export interface TurfAreaProps {
  concentration: TerritoryConcentrationReport | undefined;
  flags: readonly TerritoryTradeFlag[] | undefined;
  flagNote: string | undefined;
  loading: boolean;
  onReview: (flagId: string, outcome: 'upheld' | 'dismissed', note: string) => void;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

export const concentrationSummary = (report: TerritoryConcentrationReport): string => {
  if (!report.applicable) return 'Too few holders for the limits to apply yet.';
  return report.breached ? 'Over the concentration limit.' : 'Within the concentration limits.';
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rs-stat">
      <dt className="rs-stat__label">{label}</dt>
      <dd className="rs-stat__value">{value}</dd>
    </div>
  );
}

export function TurfArea({ concentration, flags, flagNote, loading, onReview }: TurfAreaProps) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteFor = (id: string) => notes[id]?.trim() ?? '';

  return (
    <>
      <Section title="Concentration" description={concentration?.scopeNote}>
        {concentration ? (
          <>
            <Notice tone={concentration.breached ? 'warning' : 'info'}>
              {concentrationSummary(concentration)}
            </Notice>
            <dl className="rs-stats">
              <Stat label="Holders" value={concentration.holders} />
              <Stat
                label="Ground held"
                value={`${(concentration.totalAreaSqm / 1_000_000).toFixed(2)} km²`}
              />
              <Stat label="Top 10% of holders" value={percent(concentration.topDecileShare)} />
              <Stat label="Largest single holder" value={percent(concentration.topHolderShare)} />
            </dl>
          </>
        ) : (
          <Notice tone="readonly">Concentration needs a season operator or admin role.</Notice>
        )}
      </Section>

      <Section title="Flagged trades" description={flags === undefined ? undefined : flagNote}>
        {flags === undefined ? (
          <Notice tone="readonly">Trade flags need a moderator or admin role.</Notice>
        ) : (
          <DataTable
            caption="Flagged trades"
            columns={[
              { key: 'exchanges', header: 'Exchanges', numeric: true, render: (f) => f.exchanges },
              {
                key: 'share',
                header: 'Share between the pair',
                numeric: true,
                render: (f) => percent(f.pairShare)
              },
              {
                key: 'window',
                header: 'Window',
                render: (f) =>
                  `${new Date(f.firstAt).toLocaleDateString()} – ${new Date(f.lastAt).toLocaleDateString()}`
              },
              {
                key: 'review',
                header: 'Review',
                render: (flag) =>
                  flag.reviewOutcome ? (
                    <StatusTag tone={flag.reviewOutcome === 'upheld' ? 'warning' : 'neutral'}>
                      {flag.reviewOutcome}
                    </StatusTag>
                  ) : (
                    <div className="rs-review">
                      <Field label="Note">
                        <input
                          value={notes[flag.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [flag.id]: event.target.value }))
                          }
                        />
                      </Field>
                      <div className="rs-actions">
                        <Button
                          variant="secondary"
                          disabled={loading || !noteFor(flag.id)}
                          onClick={() => onReview(flag.id, 'upheld', noteFor(flag.id))}
                        >
                          Uphold
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={loading || !noteFor(flag.id)}
                          onClick={() => onReview(flag.id, 'dismissed', noteFor(flag.id))}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  )
              }
            ]}
            rows={flags}
            rowKey={(flag) => flag.id}
            emptyMessage={loading ? 'Loading…' : 'No trades are flagged.'}
          />
        )}
      </Section>
    </>
  );
}

export function TurfAreaLoader({ accessToken, roles, loading, run }: AreaContext) {
  const [concentration, setConcentration] = useState<TerritoryConcentrationReport>();
  const [flags, setFlags] = useState<readonly TerritoryTradeFlag[]>();
  const [flagNote, setFlagNote] = useState<string>();

  useAreaLoad(() =>
    run(async () => {
      // Each part loads only for the role its route admits.
      setConcentration(
        canOperateCompetitions(roles) ? await getTurfConcentration(accessToken) : undefined
      );
      if (canModerate(roles)) {
        const queue = await getTradeFlags(accessToken);
        setFlags(queue.data);
        setFlagNote(queue.note);
      } else setFlags(undefined);
    })
  );

  return (
    <TurfArea
      concentration={concentration}
      flags={flags}
      flagNote={flagNote}
      loading={loading}
      onReview={(flagId, outcome, note) =>
        void run(async () => {
          const queue = await reviewTradeFlag(accessToken, flagId, { outcome, note });
          setFlags(queue.data);
        }, 'Review recorded.')
      }
    />
  );
}
