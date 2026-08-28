#!/usr/bin/env node
/**
 * Publishes reviewed quest clusters without a staff console. Input is a reviewed
 * JSON export; it deliberately accepts checkpoint geometry, never turn-by-turn routes.
 * Usage: DATABASE_URL=... node scripts/data/import-reviewed-quests.mjs reviewed-quests.json
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;

const [input] = process.argv.slice(2);
if (!input || !process.env.DATABASE_URL) {
  console.error(
    'Usage: DATABASE_URL=... node scripts/data/import-reviewed-quests.mjs <reviewed-quests.json>'
  );
  process.exit(1);
}
const payload = JSON.parse(await readFile(input, 'utf8'));
if (!Array.isArray(payload.quests)) throw new Error('Expected { quests: [] }.');
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  for (const quest of payload.quests) {
    if (
      !quest.key ||
      !Number.isInteger(quest.version) ||
      !quest.title ||
      !Number.isInteger(quest.distanceMeters) ||
      !Number.isInteger(quest.estimatedActiveMinutes) ||
      !['step-free', 'mixed', 'unknown'].includes(quest.accessibility) ||
      !quest.openHours ||
      !quest.provenance ||
      !quest.reviewedAt ||
      !Array.isArray(quest.checkpoints) ||
      quest.checkpoints.length === 0
    )
      throw new Error(
        `Quest ${quest.key ?? '<unknown>'} is missing review evidence or checkpoints.`
      );
    await client.query(
      `UPDATE quest_versions SET unpublished_at = now()
       WHERE quest_key = $1 AND published_at IS NOT NULL AND unpublished_at IS NULL AND version <> $2`,
      [quest.key, quest.version]
    );
    const version = await client.query(
      `INSERT INTO quest_versions
       (quest_key, version, title, distance_meters, estimated_active_minutes, accessibility, open_hours, source_reviewed_at, provenance, published_at, unpublished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, now(), NULL)
       ON CONFLICT (quest_key, version) DO UPDATE SET title = EXCLUDED.title,
         distance_meters = EXCLUDED.distance_meters, estimated_active_minutes = EXCLUDED.estimated_active_minutes,
         accessibility = EXCLUDED.accessibility, open_hours = EXCLUDED.open_hours,
         source_reviewed_at = EXCLUDED.source_reviewed_at, provenance = EXCLUDED.provenance,
         published_at = now(), unpublished_at = NULL
       RETURNING id`,
      [
        quest.key,
        quest.version,
        quest.title,
        quest.distanceMeters,
        quest.estimatedActiveMinutes,
        quest.accessibility,
        JSON.stringify(quest.openHours),
        quest.reviewedAt,
        JSON.stringify(quest.provenance)
      ]
    );
    await client.query('DELETE FROM quest_version_checkpoints WHERE quest_version_id = $1', [
      version.rows[0].id
    ]);
    for (const [position, checkpoint] of quest.checkpoints.entries()) {
      if (!checkpoint.reviewedAt || !checkpoint.provenance || !checkpoint.geometry)
        throw new Error(`Quest ${quest.key} has an unreviewed checkpoint.`);
      let placeId = null;
      if (checkpoint.kind === 'place') {
        if (!checkpoint.place?.key || !checkpoint.place?.reviewedAt)
          throw new Error(
            `Place-backed checkpoint ${checkpoint.key} is missing reviewed place provenance.`
          );
        const place = await client.query(
          `INSERT INTO curated_places
           (stable_key, title, geometry, open_hours, accessibility, provenance, reviewed_at)
           VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4::jsonb, $5::jsonb, $6::jsonb, $7)
           ON CONFLICT (stable_key) DO UPDATE SET title = EXCLUDED.title, geometry = EXCLUDED.geometry,
             geometry_version = curated_places.geometry_version + 1, open_hours = EXCLUDED.open_hours,
             accessibility = EXCLUDED.accessibility, provenance = EXCLUDED.provenance, reviewed_at = EXCLUDED.reviewed_at,
             retired_at = NULL
           RETURNING id`,
          [
            checkpoint.place.key,
            checkpoint.place.title ?? checkpoint.title,
            JSON.stringify(checkpoint.place.geometry ?? checkpoint.geometry),
            JSON.stringify(checkpoint.place.openHours ?? checkpoint.openHours),
            JSON.stringify(checkpoint.place.accessibility ?? checkpoint.accessibility),
            JSON.stringify(checkpoint.place.provenance ?? checkpoint.provenance),
            checkpoint.place.reviewedAt
          ]
        );
        placeId = place.rows[0].id;
      }
      const saved = await client.query(
        `INSERT INTO curated_checkpoints
         (stable_key, title, checkpoint_kind, place_id, geometry, open_hours, accessibility, provenance, reviewed_at)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6::jsonb, $7::jsonb, $8::jsonb, $9)
         ON CONFLICT (stable_key) DO UPDATE SET title = EXCLUDED.title, place_id = EXCLUDED.place_id,
           geometry = EXCLUDED.geometry, geometry_version = curated_checkpoints.geometry_version + 1,
           open_hours = EXCLUDED.open_hours, accessibility = EXCLUDED.accessibility, provenance = EXCLUDED.provenance,
           reviewed_at = EXCLUDED.reviewed_at, retired_at = NULL
         RETURNING id`,
        [
          checkpoint.key,
          checkpoint.title,
          checkpoint.kind,
          placeId,
          JSON.stringify(checkpoint.geometry),
          JSON.stringify(checkpoint.openHours),
          JSON.stringify(checkpoint.accessibility),
          JSON.stringify(checkpoint.provenance),
          checkpoint.reviewedAt
        ]
      );
      await client.query(
        'INSERT INTO quest_version_checkpoints (quest_version_id, checkpoint_id, position) VALUES ($1, $2, $3)',
        [version.rows[0].id, saved.rows[0].id, position + 1]
      );
    }
  }
  await client.query('COMMIT');
  console.log(`Published ${payload.quests.length} reviewed quest cluster(s).`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
