import type { RunLogItem } from '@runsphere/contracts';
import { describe, expect, it } from 'vitest';
import {
  areaLabel,
  dayLabel,
  durationLabel,
  paceLabel,
  routeThumbnailPath,
  runCard,
  runLogEmptyCopy,
  runWeeks,
  timeLabel,
  weekTitle
} from './run-log-model.js';

const item = (overrides: Partial<RunLogItem> = {}): RunLogItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  startedOn: '2026-11-17',
  startedAt: '2026-11-17T00:45:00.000Z',
  distanceMeters: 5_230,
  durationSeconds: 1_600,
  movingSeconds: 1_560,
  paceSecondsPerKm: 298.3,
  elevationGainMeters: 12,
  runMode: 'turf',
  result: { claimedAreaSqm: 48_200 },
  // A synthetic square, nowhere real.
  route: [
    [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
      [0, 0]
    ]
  ],
  ...overrides
});

// Sunday 22 November 2026, 10:00 in India.
const NOW = new Date('2026-11-22T04:30:00.000Z');

describe('run log cards (M9 9.15)', () => {
  it('reads like a run: day and time, distance, moving time, pace, mode and result', () => {
    expect(runCard(item())).toMatchObject({
      when: 'Tue 17 Nov · 6:15',
      distance: '5.23 km',
      time: '26:00',
      pace: '4:58 /km',
      badge: 'TURF RUN',
      result: 'Claimed 482 Turf points'
    });
    expect(runCard(item()).accessibilityLabel).toBe(
      'Tue 17 Nov · 6:15, 5.23 km, 26:00, 4:58 /km, turf run, Claimed 482 Turf points'
    );
  });

  it('shows the day only when the runner hides start times', () => {
    const rest = item();
    delete rest.startedAt;
    expect(runCard(rest).when).toBe('Tue 17 Nov');
  });

  it('says what each mode came to, without judging', () => {
    expect(
      runCard(item({ runMode: 'quest', result: { questCompleted: true, questTitle: 'Seaface' } }))
        .result
    ).toBe('Quest done · Seaface');
    expect(runCard(item({ runMode: 'quest', result: { questCompleted: false } })).result).toBe(
      'Quest run'
    );
    expect(
      runCard(item({ runMode: 'ghost', result: { ghostWon: true, claimedAreaSqm: 250_000 } }))
        .result
    ).toBe('Won the Ghost Race · 2,500 Turf points');
    expect(runCard(item({ runMode: 'ghost', result: { ghostWon: false } })).result).toBe(
      'Raced a ghost'
    );
    expect(runCard(item({ runMode: 'free', result: {} })).result).toBeNull();
    const preMode = item({ result: {} });
    delete preMode.runMode;
    expect(runCard(preMode)).toMatchObject({ badge: null, result: null });
  });

  it('falls back to total time and a dash when the run has no metrics', () => {
    expect(runCard(item({ movingSeconds: null, paceSecondsPerKm: null }))).toMatchObject({
      time: '26:40',
      pace: '—'
    });
  });
});

describe('route thumbnail', () => {
  it('fits the route in the box, north up, keeping a square square', () => {
    const thumbnail = routeThumbnailPath(item().route, 64, 6)!;
    expect(thumbnail.path.startsWith('M')).toBe(true);
    expect(thumbnail.start).toEqual([6, 58]);
    expect(thumbnail.finish).toEqual([6, 58]);
    const xs = [...thumbnail.path.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[1]));
    const ys = [...thumbnail.path.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
    // Within about 0.1% of square at the equator.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(52, 0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(52, 0);
  });

  it('draws nothing without a route', () => {
    expect(routeThumbnailPath(null)).toBeNull();
    expect(routeThumbnailPath([[[0, 0]]] as never)).toBeNull();
  });

  it('draws each piece of a split route separately', () => {
    const thumbnail = routeThumbnailPath([
      [
        [0, 0],
        [0.001, 0]
      ],
      [
        [0.002, 0],
        [0.003, 0]
      ]
    ])!;
    expect(thumbnail.path.match(/M/g)).toHaveLength(2);
  });
});

describe('weeks', () => {
  it('groups runs into India weeks, Monday first, newest first', () => {
    const weeks = runWeeks(
      [
        item({ id: 'a', startedOn: '2026-11-22' }),
        item({ id: 'b', startedOn: '2026-11-16' }),
        item({ id: 'c', startedOn: '2026-11-15' }),
        item({ id: 'd', startedOn: '2026-10-28' })
      ],
      NOW
    );
    expect(weeks.map((week) => [week.weekStart, week.title, week.cards.map((c) => c.id)])).toEqual([
      ['2026-11-16', 'This week', ['a', 'b']],
      ['2026-11-09', 'Last week', ['c']],
      ['2026-10-26', 'Week of 26 Oct', ['d']]
    ]);
  });

  it('names the weeks around now', () => {
    expect(weekTitle('2026-11-16', NOW)).toBe('This week');
    expect(weekTitle('2026-11-09', NOW)).toBe('Last week');
  });
});

describe('labels', () => {
  it('formats time, pace, distance and ground the runner’s way', () => {
    expect(dayLabel('2026-11-23')).toBe('Mon 23 Nov');
    expect(timeLabel('2026-11-17T13:05:00.000Z')).toBe('18:35');
    expect(durationLabel(3_725)).toBe('1:02:05');
    expect(durationLabel(59)).toBe('0:59');
    expect(paceLabel(359.6)).toBe('6:00 /km');
    expect(areaLabel(99_999)).toBe('999 Turf points');
  });

  it('explains an empty section for you, and for someone else', () => {
    expect(runLogEmptyCopy(true, true)).toMatch(/^No counted runs yet/);
    expect(runLogEmptyCopy(false, false)).toBe('This runner keeps their runs to themselves.');
    expect(runLogEmptyCopy(false, true)).toBe('No runs to show yet.');
  });
});
