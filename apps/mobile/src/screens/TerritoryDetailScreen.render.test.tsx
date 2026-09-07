import React from 'react';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { TerritoryClaim, TerritoryClaimHistoryResponse } from '@runsphere/contracts';

const ME = '00000000-0000-4000-8000-00000000000a';
const RIVAL = '00000000-0000-4000-8000-00000000000b';

vi.mock('react-native', async () => {
  const React = await import('react');
  const native =
    (name: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      React.createElement(name as React.ElementType, props, children as React.ReactNode);
  return {
    Pressable: native('Pressable'),
    ScrollView: native('ScrollView'),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
    Text: native('Text'),
    View: native('View')
  };
});
vi.mock('../theme/theme', () => ({
  useAppTheme: () => ({
    colorScheme: 'light',
    reduceMotion: true,
    tokens: {
      background: { canvas: '#fff', surface: '#f7f7f7', surfaceInset: '#eee' },
      border: { subtle: '#ddd' },
      action: { primary: '#184F3D' },
      text: { primary: '#111', secondary: '#555', tertiary: '#888', onAccent: '#fff' },
      mascot: {
        body: '#D9EAE0',
        outline: '#386755',
        orbit: '#5D8500',
        pointer: '#087B69',
        eye: '#10251F',
        beacon: '#8FBD18'
      }
    }
  })
}));

const { TerritoryDetailScreen } = await import('./TerritoryDetailScreen.js');

const claim = (overrides: Partial<TerritoryClaim> = {}): TerritoryClaim => ({
  id: 'claim-1',
  owner: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
  boundary: [
    [72.8777, 19.076],
    [72.8804, 19.076],
    [72.8804, 19.0787]
  ],
  centroid: [72.879, 19.0773],
  areaSqm: 482_000,
  distanceMetres: 5100,
  durationSeconds: 1662,
  speedMps: 5100 / 1662,
  seasonMonth: '2026-09',
  captureCount: 4,
  status: 'contested',
  claimedAt: '2026-09-06T05:10:00.000Z',
  ...overrides
});

const history = (
  overrides: Partial<TerritoryClaimHistoryResponse> = {}
): TerritoryClaimHistoryResponse => ({
  lineageId: 'lineage-1',
  captureCount: 3,
  recordSeconds: 1662,
  battleCount: 18,
  defendedCount: 11,
  entries: [
    {
      claimId: 'c1',
      owner: { id: ME, displayName: 'Me', avatarKey: 'orbit-01', isSelf: true },
      durationSeconds: 1900,
      areaSqm: 470_000,
      claimedAt: '2026-08-01T05:00:00.000Z',
      releasedAt: '2026-08-20T05:00:00.000Z'
    },
    {
      claimId: 'c2',
      owner: { id: RIVAL, displayName: 'Ravi', avatarKey: 'orbit-04', isSelf: false },
      durationSeconds: 1662,
      areaSqm: 482_000,
      claimedAt: '2026-09-06T05:10:00.000Z'
    }
  ],
  ...overrides
});

const render = async (
  props: Parameters<typeof TerritoryDetailScreen>[0]
): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(TerritoryDetailScreen, props));
  });
  return renderer;
};

const textOf = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAllByType('Text' as unknown as React.ElementType)
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' | ');

const byLabel = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAll(
    (node) => (node.props as { accessibilityLabel?: string }).accessibilityLabel === label
  );

describe('the territory detail page', () => {
  it('names the holder and what it takes to beat them', async () => {
    const renderer = await render({ claim: claim(), history: history(), onBack: () => {} });
    const rendered = textOf(renderer);

    expect(rendered).toContain('Ravi’s ground');
    expect(rendered).toContain('Run this loop in under 27:42 and it is yours.');
  });

  it('shows the statistics the page promises', async () => {
    const renderer = await render({ claim: claim(), history: history(), onBack: () => {} });

    expect(byLabel(renderer, 'AREA: 48.2 ha').length).toBeGreaterThan(0);
    expect(byLabel(renderer, 'RECORD: 27:42').length).toBeGreaterThan(0);
    expect(byLabel(renderer, 'LOOP: 5.1 km').length).toBeGreaterThan(0);
    // Battles and defences are real counts now that failed challenges are
    // recorded; before that they could only have been invented.
    expect(byLabel(renderer, 'BATTLES: 18').length).toBeGreaterThan(0);
    expect(byLabel(renderer, 'DEFENCES: 11').length).toBeGreaterThan(0);
  });

  it('tells the holder what keeps their ground theirs', async () => {
    const mine = claim({
      owner: { id: ME, displayName: 'Me', avatarKey: 'orbit-01', isSelf: true }
    });
    const renderer = await render({ claim: mine, history: history(), onBack: () => {} });

    expect(textOf(renderer)).toContain('Anybody who runs this loop faster takes it.');
  });

  it('separates the record from the current holder time', async () => {
    // Somebody faster may have held it and lost it since, and a page showing
    // only one of those numbers would be quietly wrong.
    const renderer = await render({
      claim: claim({ durationSeconds: 1900 }),
      history: history({ recordSeconds: 1500 }),
      onBack: () => {}
    });

    expect(textOf(renderer)).toContain('The record here is 25:00, set by an earlier holder');
  });

  it('lists every owner the ground has passed through, in order', async () => {
    const renderer = await render({ claim: claim(), history: history(), onBack: () => {} });
    const rendered = textOf(renderer);

    expect(rendered).toContain('You — 31:40, held from 2026-08-01');
    expect(rendered).toContain('Ravi — 27:42, holding since 2026-09-06');
  });

  it('says the history is loading rather than showing an empty story', async () => {
    const renderer = await render({ claim: claim(), history: undefined, onBack: () => {} });

    expect(textOf(renderer)).toContain('Loading the history of this ground');
    // Falls back to the claim's own time so no statistic is blank.
    expect(byLabel(renderer, 'RECORD: 27:42').length).toBeGreaterThan(0);
  });

  it('says when a loop has no recorded distance instead of inventing one', async () => {
    const older = claim();
    delete (older as { distanceMetres?: number }).distanceMetres;
    const renderer = await render({ claim: older, history: history(), onBack: () => {} });

    expect(byLabel(renderer, 'LOOP: —').length).toBeGreaterThan(0);
  });

  it('goes back to the map', async () => {
    const onBack = vi.fn();
    const renderer = await render({ claim: claim(), history: history(), onBack });

    const [back] = byLabel(renderer, 'Back to the map');
    await act(async () => {
      (back!.props as { onPress: () => void }).onPress();
    });

    expect(onBack).toHaveBeenCalled();
  });

  describe('the Ghost Race button', () => {
    it('offers a race against the holder', async () => {
      const onGhostRace = vi.fn();
      const renderer = await render({
        claim: claim(),
        history: history(),
        onBack: () => {},
        onGhostRace
      });

      const [button] = byLabel(renderer, "Race Ravi's ghost");
      await act(async () => {
        (button!.props as { onPress: () => void }).onPress();
      });

      expect(onGhostRace).toHaveBeenCalled();
    });

    it('is absent on your own ground', async () => {
      // `screens.md` 1.3: "No Ghost Race button on your own territory." The
      // server refuses it too, but a button that exists only to be refused is
      // worse than no button.
      const renderer = await render({
        claim: claim({
          owner: { id: ME, displayName: 'You', avatarKey: 'orbit-01', isSelf: true }
        }),
        history: history(),
        onBack: () => {},
        onGhostRace: vi.fn()
      });

      expect(byLabel(renderer, "Race You's ghost")).toHaveLength(0);
      expect(textOf(renderer)).not.toContain('Ghost Race');
    });

    it('is absent when the caller has nowhere to send the runner', async () => {
      const renderer = await render({ claim: claim(), history: history(), onBack: () => {} });

      expect(textOf(renderer)).not.toContain('Ghost Race');
    });
  });

  it('names the club when ground is held for one', async () => {
    const renderer = await render({
      claim: claim({ status: 'club_controlled', club: { id: 'c', name: 'Somaiya Run Club' } }),
      history: history(),
      onBack: () => {}
    });

    expect(textOf(renderer)).toContain('Somaiya Run Club');
  });
});
