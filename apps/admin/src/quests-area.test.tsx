import type { StaffQuest } from '@runsphere/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AREAS, permittedAreas } from './areas.js';
import { QuestsArea, limitLabel, parseLimit } from './quests-area.js';

const quest = (overrides: Partial<StaffQuest> = {}): StaffQuest => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'River Bend Run',
  checkpointCount: 4,
  estimatedActiveMinutes: 14,
  timeLimitMinutes: null,
  published: true,
  ...overrides
});

describe('Quests area', () => {
  it('opens for a season operator or admin, matching /v1/staff/quests', () => {
    const area = AREAS.find((definition) => definition.key === 'quests');
    expect(area?.unbuiltReason).toBeUndefined();
    expect(permittedAreas(['season_operator']).map((a) => a.key)).toContain('quests');
    expect(permittedAreas(['admin']).map((a) => a.key)).toContain('quests');
    expect(permittedAreas(['moderator']).map((a) => a.key)).not.toContain('quests');
  });

  it('reads a typed limit: blank clears it, 1 to 600 whole minutes, nothing else', () => {
    expect(parseLimit('')).toBeNull();
    expect(parseLimit(' 25 ')).toBe(25);
    expect(parseLimit('0')).toBeUndefined();
    expect(parseLimit('601')).toBeUndefined();
    expect(parseLimit('12.5')).toBeUndefined();
    expect(parseLimit('abc')).toBeUndefined();
  });

  it('lists each quest with its current limit', () => {
    const html = renderToStaticMarkup(
      <QuestsArea
        quests={[
          quest(),
          quest({ id: 'b', title: 'Kurla Loop', timeLimitMinutes: 20, published: false })
        ]}
        loading={false}
        onSetLimit={() => undefined}
      />
    );
    expect(html).toContain('River Bend Run');
    expect(html).toContain('No limit');
    expect(html).toContain('20 min');
    expect(html).toContain('unpublished');
    expect(limitLabel(quest({ timeLimitMinutes: 45 }))).toBe('45 min');
  });

  it('says so when there are no quests', () => {
    const html = renderToStaticMarkup(
      <QuestsArea quests={[]} loading={false} onSetLimit={() => undefined} />
    );
    expect(html).toContain('No quests yet');
  });
});
