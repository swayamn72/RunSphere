import { useState } from 'react';
import type { StaffQuest } from '@runsphere/contracts';

/**
 * Quest time limits (season_operator or admin, like `/v1/staff/quests`).
 *
 * A limit is how long a runner has, from the start of their quest run, to pass
 * every stop. Blank means no limit. The server applies it when it checks an
 * uploaded run, so changing it never touches a quest someone already finished.
 */
export interface QuestsAreaProps {
  quests: readonly StaffQuest[];
  loading: boolean;
  onSetLimit: (questId: string, minutes: number | null) => void;
}

/** A typed limit as minutes, `null` for none, or `undefined` when it isn't valid. */
export const parseLimit = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const minutes = Number(trimmed);
  return minutes >= 1 && minutes <= 600 ? minutes : undefined;
};

export const limitLabel = (quest: StaffQuest): string =>
  quest.timeLimitMinutes === null ? 'No limit' : `${quest.timeLimitMinutes} min`;

export function QuestsArea({ quests, loading, onSetLimit }: QuestsAreaProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <section>
      <h2>Quests</h2>
      <p>
        Set how long a runner has, from starting their quest run, to pass every stop. Leave it blank
        for no limit. 1 to 600 minutes.
      </p>
      <table>
        <thead>
          <tr>
            <th>Quest</th>
            <th>Stops</th>
            <th>Estimated</th>
            <th>Time limit</th>
            <th>New limit (min)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {quests.map((quest) => {
            const draft = drafts[quest.id] ?? '';
            const parsed = parseLimit(draft);
            return (
              <tr key={quest.id}>
                <td>
                  {quest.title}
                  {quest.published ? null : <span className="tag">unpublished</span>}
                </td>
                <td>{quest.checkpointCount}</td>
                <td>{`${quest.estimatedActiveMinutes} min`}</td>
                <td>{limitLabel(quest)}</td>
                <td>
                  <input
                    aria-label={`New time limit for ${quest.title}`}
                    inputMode="numeric"
                    value={draft}
                    placeholder="none"
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [quest.id]: event.target.value }))
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    disabled={loading || parsed === undefined}
                    onClick={() => onSetLimit(quest.id, parsed ?? null)}
                  >
                    {parsed === null ? 'Clear limit' : 'Save'}
                  </button>
                </td>
              </tr>
            );
          })}
          {!loading && quests.length === 0 ? (
            <tr>
              <td colSpan={6}>No quests yet. Import reviewed quests first.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
