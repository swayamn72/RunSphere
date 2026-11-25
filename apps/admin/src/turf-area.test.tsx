import type { TerritoryConcentrationReport, TerritoryTradeFlag } from '@runsphere/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AREAS, permittedAreas } from './areas.js';
import { TurfArea, concentrationSummary } from './turf-area.js';

const report = (overrides: Partial<TerritoryConcentrationReport> = {}) => ({
  holders: 40,
  totalAreaSqm: 2_500_000,
  topDecileShare: 0.31,
  topHolderShare: 0.08,
  applicable: true,
  breached: false,
  scopeNote: 'Measured over ground held right now.',
  ...overrides
});

const flag = (overrides: Partial<TerritoryTradeFlag> = {}): TerritoryTradeFlag => ({
  id: '00000000-0000-4000-8000-000000000001',
  lineageId: '00000000-0000-4000-8000-000000000002',
  exchanges: 6,
  pairShare: 0.9,
  firstAt: '2026-11-01T00:00:00.000Z',
  lastAt: '2026-11-10T00:00:00.000Z',
  ...overrides
});

const render = (props: Partial<Parameters<typeof TurfArea>[0]> = {}) =>
  renderToStaticMarkup(
    <TurfArea
      concentration={report()}
      flags={[]}
      flagNote="A flag is a question, not a verdict."
      loading={false}
      onReview={() => undefined}
      {...props}
    />
  );

describe('Turf claims area', () => {
  it('opens for a moderator or a season operator, matching the two routes', () => {
    const keys = (roles: string[]) => permittedAreas(roles).map((area) => area.key);
    expect(keys(['moderator'])).toContain('turf');
    expect(keys(['season_operator'])).toContain('turf');
    expect(keys(['campaign_manager'])).not.toContain('turf');
    expect(AREAS.find((area) => area.key === 'turf')?.unbuiltReason).toBeUndefined();
  });

  it('shows concentration plainly, as shares of held ground', () => {
    const markup = render();
    expect(markup).toContain('Within the concentration limits.');
    expect(markup).toContain('2.50 km²');
    expect(markup).toContain('31%');
    expect(concentrationSummary(report({ breached: true }))).toBe('Over the concentration limit.');
    expect(concentrationSummary(report({ applicable: false }))).toMatch(/Too few holders/);
  });

  it('lists flags with uphold and dismiss, and shows a decided flag’s outcome', () => {
    const markup = render({
      flags: [
        flag(),
        flag({ id: '00000000-0000-4000-8000-000000000003', reviewOutcome: 'dismissed' })
      ]
    });
    expect(markup).toContain('Uphold');
    expect(markup).toContain('Dismiss');
    expect(markup).toContain('90%');
    expect(markup).toContain('dismissed');
    // Review buttons stay disabled until a note is written.
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*disabled=""[^>]*>Uphold<\/button>/);
  });

  it('says which role a part needs instead of showing an empty table', () => {
    const markup = render({ concentration: undefined, flags: undefined });
    expect(markup).toContain('Concentration needs a season operator or admin role.');
    expect(markup).toContain('Trade flags need a moderator or admin role.');
  });
});
