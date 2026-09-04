import type { CrewCharacter } from './crew';
import type { SecureKeyValueStore } from './auth-storage-core';

/**
 * Loop guidance (milestone 2.8). The crew are calm guides, never authorities:
 * a cue explains what the app is doing or offers a next step, and it never
 * claims a result, a reward, or a judgement. `isSafeMascotLabel` in `mascot.ts`
 * is the rule the copy below is held to, and the tests enforce it.
 *
 * Two limits keep guidance from becoming noise, and both live here rather than
 * in the screens, so every surface obeys the same discipline:
 *
 * - a **frequency cap** per cue per local day, and
 * - a **dismissal** that holds for a stated number of days.
 *
 * A screen offers its candidate cues in priority order and shows at most the
 * one this module returns. Guidance is never the only route to information:
 * every cue restates something the surface already shows, so silencing it
 * loses nothing.
 */

export const loopGuidanceCues = [
  'pending-result',
  'friends-empty',
  'weekly-reset',
  'challenge-invite',
  'play-empty',
  'quest-empty',
  'hike-prep'
] as const;

export type LoopGuidanceCue = (typeof loopGuidanceCues)[number];

export interface LoopGuidanceCopy {
  readonly character: CrewCharacter;
  /** Whom the cue is from, spoken before the message by a screen reader. */
  readonly speaker: string;
  readonly message: string;
  /** Frequency cap: times this cue may appear in one local day. */
  readonly maxPerDay: number;
  /** How long a dismissal holds, in local days. */
  readonly dismissalDays: number;
}

export const loopGuidance: Readonly<Record<LoopGuidanceCue, LoopGuidanceCopy>> = {
  'pending-result': {
    character: 'rho',
    speaker: 'Rho',
    message:
      'RunSphere is still checking this activity. Your totals appear here once the server answers, and nothing is shared while it waits.',
    maxPerDay: 2,
    dismissalDays: 1
  },
  'weekly-reset': {
    character: 'rho',
    speaker: 'Rho',
    message:
      'A new week started. Last week stays in your history; this week begins its own count at zero.',
    maxPerDay: 1,
    dismissalDays: 7
  },
  'friends-empty': {
    character: 'coda',
    speaker: 'Coda',
    message:
      'Challenges and the friend board need a friend on both sides. Adding someone takes the exact email they signed up with, and they choose whether to accept.',
    maxPerDay: 1,
    dismissalDays: 7
  },
  'challenge-invite': {
    character: 'coda',
    speaker: 'Coda',
    message:
      'A friend is waiting on your answer. There is no clock on it, so answer when you like.',
    maxPerDay: 2,
    dismissalDays: 1
  },
  'play-empty': {
    character: 'coda',
    speaker: 'Coda',
    message:
      'Nothing is running yet. A challenge counts active minutes or active days, so pace never decides it.',
    maxPerDay: 1,
    dismissalDays: 7
  },
  'quest-empty': {
    character: 'mira',
    speaker: 'Mira',
    message:
      'No quests are listed here yet. Quests are curated for a place, so more appear as an area is mapped.',
    maxPerDay: 1,
    dismissalDays: 7
  },
  'hike-prep': {
    character: 'bram',
    speaker: 'Bram',
    message:
      'Heading out on a hike? A delayed, coarse safety share lets one contact know roughly where you are, without a live route.',
    maxPerDay: 1,
    dismissalDays: 7
  }
};

export interface LoopGuidanceMemory {
  /** Per-cue count for one local day; a new day starts the count over. */
  readonly shown: Readonly<Record<string, { readonly day: string; readonly count: number }>>;
  /** Local day each dismissal happened on. */
  readonly dismissed: Readonly<Record<string, string>>;
  /** Most recent week the app has rendered, so a reset can be recognised once. */
  readonly lastWeekSeen?: string;
}

export const emptyGuidanceMemory: LoopGuidanceMemory = { shown: {}, dismissed: {} };

/**
 * Asia/Kolkata is a fixed UTC+05:30 with no daylight saving, so the local day
 * is arithmetic. This deliberately avoids `Intl`, which Hermes builds do not
 * always carry, and matches the day boundary the server scores on.
 */
const KOLKATA_OFFSET_MS = 19_800_000;

export const guidanceDay = (now: Date): string =>
  new Date(now.getTime() + KOLKATA_OFFSET_MS).toISOString().slice(0, 10);

const daysBetween = (from: string, to: string): number => {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / 86_400_000);
};

const dismissalHolds = (memory: LoopGuidanceMemory, cue: LoopGuidanceCue, day: string): boolean => {
  const dismissedOn = memory.dismissed[cue];
  if (!dismissedOn) return false;
  return daysBetween(dismissedOn, day) < loopGuidance[cue].dismissalDays;
};

const withinDailyCap = (memory: LoopGuidanceMemory, cue: LoopGuidanceCue, day: string): boolean => {
  const record = memory.shown[cue];
  if (!record || record.day !== day) return true;
  return record.count < loopGuidance[cue].maxPerDay;
};

export const isGuidanceEligible = (
  memory: LoopGuidanceMemory,
  cue: LoopGuidanceCue,
  now: Date
): boolean => {
  const day = guidanceDay(now);
  return !dismissalHolds(memory, cue, day) && withinDailyCap(memory, cue, day);
};

/**
 * At most one cue per surface. Candidates are given in the screen's priority
 * order, so a cue about something waiting on the reader outranks a cue about
 * an empty list.
 */
export const selectGuidance = (
  candidates: readonly LoopGuidanceCue[],
  memory: LoopGuidanceMemory,
  now: Date = new Date()
): LoopGuidanceCue | undefined => candidates.find((cue) => isGuidanceEligible(memory, cue, now));

export const recordGuidanceShown = (
  memory: LoopGuidanceMemory,
  cue: LoopGuidanceCue,
  now: Date = new Date()
): LoopGuidanceMemory => {
  const day = guidanceDay(now);
  const record = memory.shown[cue];
  return {
    ...memory,
    shown: {
      ...memory.shown,
      [cue]: { day, count: record && record.day === day ? record.count + 1 : 1 }
    }
  };
};

export const recordGuidanceDismissed = (
  memory: LoopGuidanceMemory,
  cue: LoopGuidanceCue,
  now: Date = new Date()
): LoopGuidanceMemory => ({
  ...memory,
  dismissed: { ...memory.dismissed, [cue]: guidanceDay(now) }
});

/**
 * A weekly reset is only worth mentioning to someone who saw the previous
 * week. A first run records the week and says nothing, so a new account is
 * never told that something it never had has reset.
 */
export const weeklyResetPending = (
  memory: LoopGuidanceMemory,
  weekStartsOn: string | undefined
): boolean =>
  weekStartsOn !== undefined &&
  memory.lastWeekSeen !== undefined &&
  memory.lastWeekSeen !== weekStartsOn;

export const recordWeekSeen = (
  memory: LoopGuidanceMemory,
  weekStartsOn: string
): LoopGuidanceMemory =>
  memory.lastWeekSeen === weekStartsOn ? memory : { ...memory, lastWeekSeen: weekStartsOn };

const isCue = (value: string): value is LoopGuidanceCue =>
  (loopGuidanceCues as readonly string[]).includes(value);

/** Unknown keys are dropped, so a cue removed in a later release cannot resurface. */
export const parseGuidanceMemory = (raw: string | null): LoopGuidanceMemory => {
  if (!raw) return emptyGuidanceMemory;
  try {
    const parsed = JSON.parse(raw) as Partial<LoopGuidanceMemory>;
    const shown: Record<string, { day: string; count: number }> = {};
    for (const [cue, record] of Object.entries(parsed.shown ?? {}))
      if (isCue(cue) && typeof record?.day === 'string' && Number.isFinite(record.count))
        shown[cue] = { day: record.day, count: record.count };
    const dismissed: Record<string, string> = {};
    for (const [cue, day] of Object.entries(parsed.dismissed ?? {}))
      if (isCue(cue) && typeof day === 'string') dismissed[cue] = day;
    return {
      shown,
      dismissed,
      ...(typeof parsed.lastWeekSeen === 'string' ? { lastWeekSeen: parsed.lastWeekSeen } : {})
    };
  } catch {
    return emptyGuidanceMemory;
  }
};

export interface LoopGuidanceStore {
  read(): Promise<LoopGuidanceMemory>;
  save(memory: LoopGuidanceMemory): Promise<void>;
}

const memoryKey = 'runsphere.guidance.memory';

/**
 * Guidance memory is per-installation UI state, not account data: it holds no
 * activity, location, identity, or score, and is cleared with everything else
 * on sign-out.
 */
export const createGuidanceStore = (store: SecureKeyValueStore): LoopGuidanceStore => ({
  async read() {
    return parseGuidanceMemory(await store.getItemAsync(memoryKey));
  },
  async save(memory) {
    await store.setItemAsync(memoryKey, JSON.stringify(memory));
  }
});

/** In-memory fallback so screens and tests never reach a native module. */
export const createMemoryGuidanceStore = (
  initial: LoopGuidanceMemory = emptyGuidanceMemory
): LoopGuidanceStore => {
  let memory = initial;
  return {
    read: () => Promise.resolve(memory),
    save: (next) => {
      memory = next;
      return Promise.resolve();
    }
  };
};

let activeGuidanceStore: LoopGuidanceStore = createMemoryGuidanceStore();

/**
 * The app installs the persistent store at startup. Screens resolve it through
 * `guidanceStore()` rather than importing it, so no screen pulls a native
 * secure-storage module into its import graph.
 */
export const setGuidanceStore = (store: LoopGuidanceStore): void => {
  activeGuidanceStore = store;
};

export const guidanceStore = (): LoopGuidanceStore => activeGuidanceStore;
