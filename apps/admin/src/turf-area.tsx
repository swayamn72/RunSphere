import { useState } from 'react';
import type { TerritoryConcentrationReport, TerritoryTradeFlag } from '@runsphere/contracts';

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

export function TurfArea({ concentration, flags, flagNote, loading, onReview }: TurfAreaProps) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteFor = (id: string) => notes[id]?.trim() ?? '';

  return (
    <section>
      <h2>Turf claims</h2>

      <h3>Concentration</h3>
      {concentration ? (
        <>
          <p className={concentration.breached ? 'status error' : 'status neutral'}>
            {concentrationSummary(concentration)}
          </p>
          <table>
            <tbody>
              <tr>
                <th>Holders</th>
                <td>{concentration.holders}</td>
              </tr>
              <tr>
                <th>Ground held</th>
                <td>{`${(concentration.totalAreaSqm / 1_000_000).toFixed(2)} km²`}</td>
              </tr>
              <tr>
                <th>Top 10% of holders</th>
                <td>{percent(concentration.topDecileShare)}</td>
              </tr>
              <tr>
                <th>Largest single holder</th>
                <td>{percent(concentration.topHolderShare)}</td>
              </tr>
            </tbody>
          </table>
          <p>{concentration.scopeNote}</p>
        </>
      ) : (
        <p className="status neutral">Concentration needs a season operator or admin role.</p>
      )}

      <h3>Flagged trades</h3>
      {flags === undefined ? (
        <p className="status neutral">Trade flags need a moderator or admin role.</p>
      ) : (
        <>
          {flagNote ? <p>{flagNote}</p> : null}
          <table>
            <thead>
              <tr>
                <th>Exchanges</th>
                <th>Share between the pair</th>
                <th>Window</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.id}>
                  <td>{flag.exchanges}</td>
                  <td>{percent(flag.pairShare)}</td>
                  <td>
                    {`${new Date(flag.firstAt).toLocaleDateString()} – ${new Date(flag.lastAt).toLocaleDateString()}`}
                  </td>
                  <td>
                    {flag.reviewOutcome ? (
                      <span className="tag">{flag.reviewOutcome}</span>
                    ) : (
                      <>
                        <label htmlFor={`note-${flag.id}`}>Note</label>
                        <input
                          id={`note-${flag.id}`}
                          value={notes[flag.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [flag.id]: event.target.value }))
                          }
                        />
                        <button
                          type="button"
                          disabled={loading || !noteFor(flag.id)}
                          onClick={() => onReview(flag.id, 'upheld', noteFor(flag.id))}
                        >
                          Uphold
                        </button>
                        <button
                          type="button"
                          disabled={loading || !noteFor(flag.id)}
                          onClick={() => onReview(flag.id, 'dismissed', noteFor(flag.id))}
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && flags.length === 0 ? (
                <tr>
                  <td colSpan={4}>No trades are flagged.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
