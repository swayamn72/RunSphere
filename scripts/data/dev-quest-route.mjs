#!/usr/bin/env node
/**
 * Prints a synthetic run through every stop of dev-quests.json, as the one-line
 * NDJSON that EXPO_PUBLIC_SYNTHETIC_LOCATION_NDJSON expects, so a quest can be
 * checked end to end on an emulator without running to the stops.
 *
 * The route starts and ends at the quest start, steps ~6 m every 2 s (about
 * 5:30/km, an ordinary run), and passes within a metre of each stop, well inside
 * the 30 m stop radius. Timestamps are rebased to "now" when the replay starts
 * (location-adapter-core.ts), so it counts as run after the quest was taken on.
 *
 * Dev only: these are public test landmarks, not anybody's recorded location.
 * Usage: node scripts/data/dev-quest-route.mjs [laps]   (paste the output into apps/mobile/.env)
 */
import { readFile } from 'node:fs/promises';

const laps = Math.max(1, Number(process.argv[2] ?? 1) || 1);
const quests = JSON.parse(
  await readFile(new URL('./dev-quests.json', import.meta.url), 'utf8')
).quests;
const start = [72.8808, 19.0726];
const stops = quests[0].checkpoints.map((checkpoint) => checkpoint.geometry.coordinates);

const metresPerDegree = 111_320;
const cos = Math.cos((start[1] * Math.PI) / 180);
const metres = (a, b) =>
  Math.hypot((b[0] - a[0]) * metresPerDegree * cos, (b[1] - a[1]) * metresPerDegree);

const corners = [start];
for (let lap = 0; lap < laps; lap += 1) corners.push(...stops, start);

const stepMetres = 6;
const stepSeconds = 2;
const points = [corners[0]];
for (let index = 1; index < corners.length; index += 1) {
  const [from, to] = [corners[index - 1], corners[index]];
  const steps = Math.max(1, Math.round(metres(from, to) / stepMetres));
  for (let step = 1; step <= steps; step += 1)
    points.push([
      from[0] + ((to[0] - from[0]) * step) / steps,
      from[1] + ((to[1] - from[1]) * step) / steps
    ]);
}

const origin = Date.parse('2026-11-24T06:00:00.000Z');
const lines = points.map(([longitude, latitude], index) =>
  JSON.stringify({
    recordedAt: new Date(origin + index * stepSeconds * 1000).toISOString(),
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: 6,
    altitude: 12
  })
);
// A literal "\n" between records: the parser accepts it, and it keeps the value on one .env line.
console.log(`EXPO_PUBLIC_SYNTHETIC_LOCATION_NDJSON=${lines.join('\\n')}`);
