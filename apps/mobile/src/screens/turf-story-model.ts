import type { SecureKeyValueStore } from '../auth-storage-core';
import { easeOut, sliceRoute } from './route-draw-model';

/**
 * "How Turf works": a five-scene story played out on the map (plan:
 * docs/plans/turf-tour-3d-light-map.md, Feature A). The spotlight tour in
 * `tutorial-model.ts` teaches where the buttons are; this teaches the game.
 *
 * Everything drawn here is made up: shapes in metres around a fixed demo spot,
 * with made-up players. No real claim, run or person appears, so the story
 * can't leak anyone's ground. The areas it shows are computed from these same
 * shapes, so the numbers are honest, and the steal is big enough to pass the
 * real carving minimum (`minCarveArea` in packages/domain).
 */

export const TURF_STORY_VERSION = 1;

/** `[longitude, latitude]`. */
export type LngLat = [number, number];
/** Metres east and north of the demo centre. */
type Metres = [number, number];

/** Shivaji Park, Dadar: open ground with streets round it, readable in 3D. */
export const STORY_CENTRE: LngLat = [72.8381, 19.0269];

export interface StoryCamera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface StoryScene {
  id: 'run' | 'claim' | 'steal' | 'defend' | 'season';
  eyebrow: string;
  title: string;
  body: string;
  camera: StoryCamera;
  /** How long the scene's own animation runs once the camera arrives. */
  durationMs: number;
}

const toLngLat = ([east, north]: Metres): LngLat => {
  const metresPerDegree = 111_320;
  return [
    STORY_CENTRE[0] + east / (metresPerDegree * Math.cos((STORY_CENTRE[1] * Math.PI) / 180)),
    STORY_CENTRE[1] + north / metresPerDegree
  ];
};

/** A closed ellipse, counter-clockwise, first point repeated last. */
const ellipse = (centre: Metres, a: number, b: number, rotation = 0, points = 48): Metres[] => {
  const ring: Metres[] = [];
  for (let index = 0; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const x = a * Math.cos(angle);
    const y = b * Math.sin(angle);
    ring.push([
      centre[0] + x * Math.cos(rotation) - y * Math.sin(rotation),
      centre[1] + x * Math.sin(rotation) + y * Math.cos(rotation)
    ]);
  }
  return ring;
};

/** Shoelace area of a closed ring in square metres. */
export const ringArea = (ring: readonly Metres[]): number => {
  let sum = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const [x1, y1] = ring[index - 1]!;
    const [x2, y2] = ring[index]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

/**
 * Sutherland–Hodgman: the part of `subject` inside `clip`. Both rings here are
 * convex and counter-clockwise, which is all this needs.
 */
export const clipConvex = (subject: readonly Metres[], clip: readonly Metres[]): Metres[] => {
  const inside = (point: Metres, a: Metres, b: Metres) =>
    (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) >= 0;
  const cross = (p: Metres, q: Metres, a: Metres, b: Metres): Metres => {
    const a1 = q[1] - p[1];
    const b1 = p[0] - q[0];
    const c1 = a1 * p[0] + b1 * p[1];
    const a2 = b[1] - a[1];
    const b2 = a[0] - b[0];
    const c2 = a2 * a[0] + b2 * a[1];
    const det = a1 * b2 - a2 * b1;
    return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
  };
  let output = subject.slice(0, -1);
  const edges = clip.slice(0, -1);
  for (let index = 0; index < edges.length && output.length > 0; index += 1) {
    const a = edges[index]!;
    const b = edges[(index + 1) % edges.length]!;
    const input = output;
    output = [];
    for (let step = 0; step < input.length; step += 1) {
      const current = input[step]!;
      const previous = input[(step + input.length - 1) % input.length]!;
      if (inside(current, a, b)) {
        if (!inside(previous, a, b)) output.push(cross(previous, current, a, b));
        output.push(current);
      } else if (inside(previous, a, b)) {
        output.push(cross(previous, current, a, b));
      }
    }
  }
  return output.length ? [...output, output[0]!] : [];
};

/** The shapes the story is told with, in metres. */
const shapes = (() => {
  const yours = ellipse([-170, -20], 75, 60, 0.2);
  const rival = ellipse([95, 40], 110, 85, -0.15);
  const steal = ellipse([5, 30], 85, 65, 0.1);
  const taken = clipConvex(steal, rival);
  const challenger = ellipse([-115, -70], 70, 55, 0.4);
  const season: Metres[][] = [
    ellipse([-620, 380], 90, 70, 0.3),
    ellipse([520, 460], 120, 80, -0.2),
    ellipse([-480, -520], 100, 90, 0.1),
    ellipse([610, -380], 80, 75, 0.5),
    ellipse([40, 700], 130, 70, 0),
    ellipse([-60, -760], 90, 60, -0.4)
  ];
  return { yours, rival, steal, taken, challenger, season };
})();

/** Areas the cards quote, from the shapes themselves. */
export const STORY_AREAS = {
  yours: Math.round(ringArea(shapes.yours)),
  rival: Math.round(ringArea(shapes.rival)),
  taken: Math.round(ringArea(shapes.taken))
} as const;

const centreOf = (ring: readonly Metres[]): Metres => {
  const points = ring.slice(0, -1);
  return [
    points.reduce((sum, [x]) => sum + x, 0) / points.length,
    points.reduce((sum, [, y]) => sum + y, 0) / points.length
  ];
};

export const STORY_SCENES: readonly StoryScene[] = [
  {
    id: 'run',
    eyebrow: 'RUN',
    title: 'Close a loop',
    body: 'Run a loop and finish close to where you started.',
    camera: { center: toLngLat([-170, -20]), zoom: 16.3, pitch: 45, bearing: -10 },
    durationMs: 2_400
  },
  {
    id: 'claim',
    eyebrow: 'CLAIM',
    title: 'The inside is yours',
    body: 'Claim the run when you finish. The ground inside goes on the map with your name.',
    camera: { center: toLngLat([-170, -20]), zoom: 16.5, pitch: 58, bearing: 12 },
    durationMs: 1_600
  },
  {
    id: 'steal',
    eyebrow: 'STEAL',
    title: 'Take their ground',
    body: 'Loop through someone’s ground faster than they did. The part you cover becomes yours.',
    camera: { center: toLngLat([20, 30]), zoom: 16, pitch: 60, bearing: 24 },
    durationMs: 3_000
  },
  {
    id: 'defend',
    eyebrow: 'DEFEND',
    title: 'Hold it',
    body: 'Someone quicker can take it back. Race their ghost to win it again.',
    camera: { center: toLngLat([-140, -40]), zoom: 16.2, pitch: 55, bearing: -18 },
    durationMs: 2_400
  },
  {
    id: 'season',
    eyebrow: 'SEASON',
    title: 'A new map every month',
    body: 'The map resets on the 1st. Hold the most ground by the end of the month.',
    camera: { center: toLngLat([0, 0]), zoom: 14.3, pitch: 35, bearing: 0 },
    durationMs: 2_000
  }
];

export interface StoryPin {
  id: string;
  lngLat: LngLat;
  label: string;
  kind: 'you' | 'rival';
}

/** Everything the map draws for one scene at progress `t` (0–1). */
export interface StoryFrame {
  /** Your held ground, and how far its fill has faded in. */
  yours: LngLat[][];
  yoursOpacity: number;
  rivals: LngLat[][];
  rivalsOpacity: number;
  /** The overlap a faster loop takes, filling in as yours. */
  taken?: LngLat[];
  takenOpacity: number;
  /** Your ground under attack, drawn pulsing. */
  contested?: LngLat[];
  /** The line being run, and whose it is. */
  trail?: LngLat[];
  trailKind: 'you' | 'rival';
  head?: LngLat | undefined;
  counter?: { value: number; label: string };
  pins: StoryPin[];
}

const ring = (metres: readonly Metres[]): LngLat[] => metres.map(toLngLat);
const trailOf = (metres: readonly Metres[], fraction: number) => {
  const slice = sliceRoute([ring(metres)], fraction);
  return { trail: slice.lines[0] ?? [], head: slice.head };
};

/** Pure: the scene at `t`, so it can be tested and drawn at any frame. */
export function storyFrame(scene: StoryScene['id'], t: number): StoryFrame {
  const progress = Math.min(1, Math.max(0, t));
  const you: StoryPin = {
    id: 'you',
    lngLat: toLngLat(centreOf(shapes.yours)),
    label: 'You',
    kind: 'you'
  };
  const rivalPin: StoryPin = {
    id: 'rival',
    lngLat: toLngLat(centreOf(shapes.rival)),
    label: 'Arjun',
    kind: 'rival'
  };
  const base = {
    yours: [] as LngLat[][],
    yoursOpacity: 0,
    rivals: [] as LngLat[][],
    rivalsOpacity: 0,
    takenOpacity: 0,
    trailKind: 'you' as const,
    pins: [] as StoryPin[]
  };
  switch (scene) {
    case 'run':
      return { ...base, ...trailOf(shapes.yours, easeOut(progress)) };
    case 'claim':
      return {
        ...base,
        yours: [ring(shapes.yours)],
        yoursOpacity: easeOut(progress),
        counter: { value: Math.round(STORY_AREAS.yours * easeOut(progress)), label: 'YOURS' },
        pins: progress > 0.4 ? [you] : []
      };
    case 'steal': {
      // The loop runs for the first 70%, then the overlap turns yours.
      const running = Math.min(1, progress / 0.7);
      const taking = Math.max(0, (progress - 0.7) / 0.3);
      return {
        ...base,
        yours: [ring(shapes.yours)],
        yoursOpacity: 1,
        rivals: [ring(shapes.rival)],
        rivalsOpacity: 1,
        taken: ring(shapes.taken),
        takenOpacity: easeOut(taking),
        ...(taking > 0 ? {} : trailOf(shapes.steal, running)),
        ...(taking > 0
          ? { counter: { value: Math.round(STORY_AREAS.taken * easeOut(taking)), label: 'TAKEN' } }
          : {}),
        pins: [you, rivalPin]
      };
    }
    case 'defend':
      return {
        ...base,
        yours: [ring(shapes.yours)],
        yoursOpacity: 1,
        rivals: [ring(shapes.rival)],
        rivalsOpacity: 0.6,
        taken: ring(shapes.taken),
        takenOpacity: 1,
        contested: ring(shapes.yours),
        ...trailOf(shapes.challenger, easeOut(progress)),
        trailKind: 'rival',
        pins: [you]
      };
    case 'season':
      // Everyone's ground fades out: the 1st wipes the map for everybody.
      return {
        ...base,
        yours: [ring(shapes.yours), ring(shapes.taken)],
        yoursOpacity: 1 - 0.85 * easeOut(progress),
        rivals: [ring(shapes.rival), ...shapes.season.map(ring)],
        rivalsOpacity: 1 - 0.85 * easeOut(progress)
      };
  }
}

/** "17,778" with the thousands grouped, without leaning on the phone's locale. */
export const formatArea = (value: number): string =>
  String(Math.max(0, Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ── Memory: shown once per account on this device ───────────────────────────

export interface TurfStoryStore {
  seenVersion(accountId: string): Promise<number>;
  markSeen(accountId: string): Promise<void>;
}

const keyFor = (accountId: string) =>
  `runsphere.turf-story.${accountId.replace(/[^a-zA-Z0-9._-]/g, '')}`;

export const createTurfStoryStore = (store: SecureKeyValueStore): TurfStoryStore => ({
  async seenVersion(accountId) {
    try {
      const version = Number(await store.getItemAsync(keyFor(accountId)));
      return Number.isInteger(version) && version > 0 ? version : 0;
    } catch {
      return 0;
    }
  },
  async markSeen(accountId) {
    try {
      await store.setItemAsync(keyFor(accountId), String(TURF_STORY_VERSION));
    } catch {
      // Seeing the story twice is better than a map that won't open.
    }
  }
});

export const createMemoryTurfStoryStore = (): TurfStoryStore => {
  const seen = new Map<string, number>();
  return {
    seenVersion: (accountId) => Promise.resolve(seen.get(accountId) ?? 0),
    markSeen: (accountId) => {
      seen.set(accountId, TURF_STORY_VERSION);
      return Promise.resolve();
    }
  };
};

let activeStore: TurfStoryStore = createMemoryTurfStoryStore();
export const setTurfStoryStore = (store: TurfStoryStore): void => {
  activeStore = store;
};

export const shouldShowTurfStory = async (accountId: string, store = activeStore) =>
  (await store.seenVersion(accountId)) < TURF_STORY_VERSION;

export const markTurfStorySeen = (accountId: string, store = activeStore) =>
  store.markSeen(accountId);
