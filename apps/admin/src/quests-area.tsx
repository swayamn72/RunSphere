import { useState } from 'react';
import type { StaffQuest } from '@runsphere/contracts';
import { getStaffQuests, setQuestTimeLimit } from './api.js';
import type { AreaContext } from './area-types.js';
import { useAreaLoad } from './use-area-load.js';
import { Button, SearchableTable, Section, StatusTag } from './ui/index.js';

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
    <Section
      title="Time limits"
      description="Set how long a runner has, from starting their quest run, to pass every stop. Leave it blank for no limit. 1 to 600 minutes."
    >
      <SearchableTable
        searchLabel="Search quests"
        searchText={(quest) => quest.title}
        caption="Quest time limits"
        columns={[
          {
            key: 'quest',
            header: 'Quest',
            render: (quest) => (
              <>
                {quest.title}{' '}
                {quest.published ? null : <StatusTag tone="warning">unpublished</StatusTag>}
              </>
            )
          },
          {
            key: 'stops',
            header: 'Stops',
            numeric: true,
            render: (quest) => quest.checkpointCount
          },
          {
            key: 'estimated',
            header: 'Estimated',
            numeric: true,
            render: (quest) => `${quest.estimatedActiveMinutes} min`
          },
          { key: 'limit', header: 'Time limit', numeric: true, render: limitLabel },
          {
            key: 'new',
            header: 'New limit (min)',
            render: (quest) => (
              <input
                aria-label={`New time limit for ${quest.title}`}
                inputMode="numeric"
                value={drafts[quest.id] ?? ''}
                placeholder="none"
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [quest.id]: event.target.value }))
                }
              />
            )
          },
          {
            key: 'save',
            header: 'Action',
            render: (quest) => {
              const parsed = parseLimit(drafts[quest.id] ?? '');
              return (
                <Button
                  variant="secondary"
                  disabled={loading || parsed === undefined}
                  onClick={() => onSetLimit(quest.id, parsed ?? null)}
                >
                  {parsed === null ? 'Clear limit' : 'Save'}
                </Button>
              );
            }
          }
        ]}
        rows={quests}
        rowKey={(quest) => quest.id}
        emptyMessage={loading ? 'Loading…' : 'No quests yet. Import reviewed quests first.'}
      />
    </Section>
  );
}

export function QuestsAreaLoader({ accessToken, loading, run }: AreaContext) {
  const [quests, setQuests] = useState<readonly StaffQuest[]>([]);
  useAreaLoad(() => run(async () => setQuests((await getStaffQuests(accessToken)).data)));
  return (
    <QuestsArea
      quests={quests}
      loading={loading}
      onSetLimit={(questId, minutes) =>
        void run(async () => {
          const saved = await setQuestTimeLimit(accessToken, questId, minutes);
          setQuests((current) => current.map((quest) => (quest.id === saved.id ? saved : quest)));
        }, 'Time limit saved.')
      }
    />
  );
}
