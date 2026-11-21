import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return { Text: native('Text'), View: native('View') };
});

const { SeasonHistory } = await import('./SeasonHistory.js');

const styles = {
  sectionHeader: {},
  sectionTitle: {},
  card: {},
  cardTitle: {},
  body: {},
  helper: {}
};

const texts = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => [node.props.children].flat().join(''));

const render = async (api: React.ComponentProps<typeof SeasonHistory>['api']) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SeasonHistory api={api} styles={styles} />);
  });
  return renderer;
};

describe('season history (M2.5, M2.6)', () => {
  it('shows the recap, the records and the seasons', async () => {
    const renderer = await render({
      getTerritorySeasonRecap: async () => ({
        recap: {
          seasonMonth: '2026-10',
          rank: 2,
          peakAreaSqm: 90_000,
          finalAreaSqm: 80_000,
          claimCount: 3,
          longestHeldDays: 5,
          records: []
        }
      }),
      getTerritoryHallOfFame: async () => ({
        scope: 'city' as const,
        entries: [
          {
            recordType: 'largest_holding' as const,
            valueSqm: 300_000,
            displayName: 'Ravi',
            seasonMonth: '2026-10',
            achievedAt: '2026-10-20T00:00:00.000Z',
            note: 'x'
          }
        ],
        note: 'Records are per place.'
      }),
      getTerritorySeasons: async () => ({
        data: [
          {
            seasonMonth: '2026-11',
            startedAt: '2026-11-01T00:00:00.000Z',
            claimsArchived: 0,
            isCurrent: true
          }
        ],
        currentSeasonMonth: '2026-11',
        currentSeasonEndsAt: '2026-12-01T00:00:00.000Z'
      })
    });
    const shown = texts(renderer).join(' | ');
    expect(shown).toContain('October 2026 recap');
    expect(shown).toContain('Ravi · October 2026');
    expect(shown).toContain('Running now');
  });

  it('hides a part that failed and keeps the others', async () => {
    const renderer = await render({
      getTerritorySeasonRecap: async () => {
        throw new Error('down');
      },
      getTerritoryHallOfFame: async () => ({
        scope: 'city' as const,
        entries: [],
        unavailableReason: 'no_place_yet' as const,
        note: 'Records are per place.'
      }),
      getTerritorySeasons: async () => {
        throw new Error('down');
      }
    });
    const shown = texts(renderer).join(' | ');
    expect(shown).not.toContain('Last season');
    expect(shown).toContain('Records appear once your ground is on the map.');
    expect(shown).not.toContain('Seasons');
  });
});
