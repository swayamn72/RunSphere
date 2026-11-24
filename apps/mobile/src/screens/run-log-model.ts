import type { RunLogItem } from '@runsphere/contracts';
import {
  kolkataDate,
  kolkataDateStart,
  weeklyPeriodStart,
  turfPointsLabel
} from '@runsphere/domain';
import { MODE_LABEL } from './run-mode-hud-model';
import type { Lines } from './route-draw-model';

/**
 * The Runs section on a profile (M9 9.15): counted runs as cards, grouped by
 * week (Monday to Sunday in India, ADR-0006), each with its route drawn as a
 * small line rather than a map per row.
 *
 * Everything shown is what the server returned for this reader (9.14): a
 * missing `startedAt` means the runner hides start times, so the card shows
 * the day only; a null `route` means no line.
 */

export interface RunCard {
  id: string;
  /** "Tue 10 Nov · 6:30" for your own runs, "Tue 10 Nov" when times are hidden. */
  when: string;
  distance: string;
  time: string;
  pace: string;
  /** "TURF RUN" etc.; absent for runs from before modes. */
  badge: string | null;
  /** What the mode came to, in one line, or null. */
  result: string | null;
  thumbnail: RouteThumbnail | null;
  /** One sentence for TalkBack. */
  accessibilityLabel: string;
}

export interface RunWeek {
  /** Monday, `YYYY-MM-DD`. */
  weekStart: string;
  title: string;
  cards: RunCard[];
}

export interface RouteThumbnail {
  /** SVG path data within a `size` × `size` box. */
  path: string;
  start: [number, number];
  finish: [number, number];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KOLKATA_OFFSET_MS = 330 * 60_000;

/** "Tue 10 Nov" for a `YYYY-MM-DD` date. */
export const dayLabel = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${DAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
};

/** "6:30" in India time. */
export const timeLabel = (instant: string): string => {
  const local = new Date(Date.parse(instant) + KOLKATA_OFFSET_MS);
  return `${local.getUTCHours()}:${local.getUTCMinutes().toString().padStart(2, '0')}`;
};

/** "25:03", or "1:02:05" past the hour. */
export const durationLabel = (seconds: number): string => {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const rest = (whole % 60).toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

export const paceLabel = (secondsPerKm: number | null): string => {
  if (secondsPerKm === null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
  const whole = Math.round(secondsPerKm);
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')} /km`;
};

/** Ground a run took, in Turf points. */
export const areaLabel = (squareMetres: number): string => turfPointsLabel(squareMetres);

/** One line on what the mode came to. Factual, never a judgement (`docs/voice.md`). */
export const resultLine = (item: RunLogItem): string | null => {
  const { result } = item;
  if (item.runMode === 'quest')
    return result.questCompleted
      ? `Quest done${result.questTitle ? ` · ${result.questTitle}` : ''}`
      : `Quest run${result.questTitle ? ` · ${result.questTitle}` : ''}`;
  if (item.runMode === 'ghost') {
    if (result.ghostWon)
      return `Won the Ghost Race${result.claimedAreaSqm ? ` · ${areaLabel(result.claimedAreaSqm)}` : ''}`;
    return 'Raced a ghost';
  }
  if (result.claimedAreaSqm) return `Claimed ${areaLabel(result.claimedAreaSqm)}`;
  return null;
};

/**
 * The route fitted into a `size` box with `padding`, keeping its shape:
 * longitude is scaled by the cosine of latitude so a square loop stays square.
 */
export const routeThumbnailPath = (
  route: RunLogItem['route'] | Lines | undefined,
  size = 64,
  padding = 6
): RouteThumbnail | null => {
  const points = route?.flat() ?? [];
  if (points.length < 2) return null;
  const meanLat = points.reduce((sum, [, lat]) => sum + lat, 0) / points.length;
  const scale = Math.cos((meanLat * Math.PI) / 180);
  const xs = points.map(([lng]) => lng * scale);
  const ys = points.map(([, lat]) => lat);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys)
  ];
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const inner = size - padding * 2;
  const offsetX = padding + (inner - ((maxX - minX) / span) * inner) / 2;
  const offsetY = padding + (inner - ((maxY - minY) / span) * inner) / 2;
  const project = ([lng, lat]: readonly [number, number]): [number, number] => [
    Math.round((offsetX + ((lng * scale - minX) / span) * inner) * 10) / 10,
    // North is up: larger latitude, smaller y.
    Math.round((offsetY + ((maxY - lat) / span) * inner) * 10) / 10
  ];
  const path = route!
    .filter((line) => line.length >= 2)
    .map((line) =>
      line.map((point, index) => `${index ? 'L' : 'M'}${project(point).join(' ')}`).join(' ')
    )
    .join(' ');
  return { path, start: project(points[0]!), finish: project(points[points.length - 1]!) };
};

export const runCard = (item: RunLogItem): RunCard => {
  const when = item.startedAt
    ? `${dayLabel(item.startedOn)} · ${timeLabel(item.startedAt)}`
    : dayLabel(item.startedOn);
  const distance = `${(item.distanceMeters / 1_000).toFixed(2)} km`;
  const time = durationLabel(item.movingSeconds ?? item.durationSeconds);
  const pace = paceLabel(item.paceSecondsPerKm);
  const badge = item.runMode ? MODE_LABEL[item.runMode] : null;
  const result = resultLine(item);
  return {
    id: item.id,
    when,
    distance,
    time,
    pace,
    badge,
    result,
    thumbnail: routeThumbnailPath(item.route),
    accessibilityLabel: [when, distance, time, pace, badge?.toLowerCase(), result]
      .filter(Boolean)
      .join(', ')
  };
};

const weekStartOf = (date: string) => kolkataDate(weeklyPeriodStart(kolkataDateStart(date)));

export const weekTitle = (weekStart: string, now: Date = new Date()): string => {
  const thisWeek = kolkataDate(weeklyPeriodStart(now));
  if (weekStart === thisWeek) return 'This week';
  const lastWeek = kolkataDate(weeklyPeriodStart(new Date(weeklyPeriodStart(now).getTime() - 1)));
  if (weekStart === lastWeek) return 'Last week';
  return `Week of ${dayLabel(weekStart).slice(4)}`;
};

/** Runs, newest first, into weeks, newest first. Pages append in order, so weeks stay whole. */
export const runWeeks = (items: readonly RunLogItem[], now: Date = new Date()): RunWeek[] => {
  const weeks: RunWeek[] = [];
  for (const item of items) {
    const weekStart = weekStartOf(item.startedOn);
    let week = weeks[weeks.length - 1];
    if (!week || week.weekStart !== weekStart) {
      week = { weekStart, title: weekTitle(weekStart, now), cards: [] };
      weeks.push(week);
    }
    week.cards.push(runCard(item));
  }
  return weeks;
};

/** What the section says when there are no runs to show. */
export const runLogEmptyCopy = (owner: boolean, visible: boolean): string =>
  owner
    ? 'No counted runs yet. Your runs show here once they count.'
    : visible
      ? 'No runs to show yet.'
      : 'This runner keeps their runs to themselves.';
