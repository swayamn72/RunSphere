-- Where a claim is: city, country, continent (pending-work 2.12-2.14).
--
-- Territory went global on 2026-09-06: anybody can claim ground anywhere, and
-- the boards are city-scoped, country-scoped, and worldwide. That needs every
-- claim to carry a place, and getting one means reverse geocoding.
--
-- **The geocoder is never told where a runner was.** `territory_geo_cells` is
-- keyed by a coarse H3 cell (~33 km²), and it is the *centre of the cell* that
-- gets geocoded — a fixed point on a grid, the same for everybody who ever runs
-- in it, usually kilometres from any of them. One lookup per cell, cached
-- forever, because a cell does not move. See `territory-geo.ts`.
--
-- **The tags are nullable, and the plan asked for NOT NULL.** A geocoder is a
-- third party that can be unreachable, rate limited, or simply not configured
-- yet, and a claim must never be refused because of that: an untagged claim is
-- real held ground that is missing from its city board, while a refused claim
-- is a run somebody did for nothing. Untagged claims still count on the global
-- board, and `territory-geo-backfill.ts` tags them once a provider exists. The
-- alternative — NOT NULL with a placeholder — would put a city called
-- `unknown` on the leaderboard.

ALTER TABLE territory_claims
  ADD COLUMN IF NOT EXISTS city_tag text
    CHECK (city_tag IS NULL OR char_length(city_tag) BETWEEN 1 AND 80),
  -- ISO 3166-1 alpha-2, upper case. Constrained because it ends up in a URL
  -- path and is compared as an equality key on every country board.
  ADD COLUMN IF NOT EXISTS country_tag text
    CHECK (country_tag IS NULL OR country_tag ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS continent_tag text
    CHECK (continent_tag IS NULL OR char_length(continent_tag) BETWEEN 1 AND 20);

-- A country without a city would sit on a country board while being invisible
-- on every city board — worse than being untagged, and a sign the geocoder
-- answered partially. `parseGeoTags` drops such an answer whole; this is the
-- database saying the same thing.
ALTER TABLE territory_claims
  DROP CONSTRAINT IF EXISTS territory_claims_geo_tags_together;
ALTER TABLE territory_claims
  ADD CONSTRAINT territory_claims_geo_tags_together
    CHECK ((city_tag IS NULL) = (country_tag IS NULL)
       AND (city_tag IS NULL) = (continent_tag IS NULL));

-- Every place board is "this scope, this season, ground still held".
CREATE INDEX IF NOT EXISTS territory_claims_city_board_idx
  ON territory_claims (city_tag, season_month, area_sqm DESC)
  WHERE released_at IS NULL AND city_tag IS NOT NULL;

CREATE INDEX IF NOT EXISTS territory_claims_country_board_idx
  ON territory_claims (country_tag, season_month, area_sqm DESC)
  WHERE released_at IS NULL AND country_tag IS NOT NULL;

-- The backfill job's work list.
CREATE INDEX IF NOT EXISTS territory_claims_untagged_idx
  ON territory_claims (claimed_at)
  WHERE city_tag IS NULL;

-- The cache. One row per coarse cell, and the only thing that is ever sent to a
-- geocoding provider.
CREATE TABLE IF NOT EXISTS territory_geo_cells (
  h3_cell text PRIMARY KEY CHECK (char_length(h3_cell) BETWEEN 1 AND 32),
  -- Stored so raising `GEO_TAG_RESOLUTION` invalidates nothing silently: rows
  -- at the old resolution are simply not read, and re-seeding is additive.
  resolution smallint NOT NULL CHECK (resolution BETWEEN 0 AND 15),
  city_tag text NOT NULL CHECK (char_length(city_tag) BETWEEN 1 AND 80),
  country_tag text NOT NULL CHECK (country_tag ~ '^[A-Z]{2}$'),
  continent_tag text NOT NULL CHECK (char_length(continent_tag) BETWEEN 1 AND 20),
  -- `seed` rows shipped with a migration; `geocode` rows came from a provider.
  -- Kept apart so a bad provider answer can be found and removed without
  -- touching the reviewed launch data.
  source text NOT NULL DEFAULT 'geocode' CHECK (source IN ('seed', 'geocode')),
  resolved_at timestamptz NOT NULL DEFAULT now()
);

-- The launch market, seeded so it needs no provider at all.
--
-- 104 resolution-6 cells covering the Mumbai Metropolitan Region, from
-- Vasai-Virar in the north to Uran and Panvel in the south-east. Generated with
-- the pinned h3-js (4.1.0) over that bounding box.
--
-- All of MMR is tagged `Mumbai`, which is what `screens.md` shows ("#4 in
-- Mumbai"). Telling Thane and Navi Mumbai apart as their own city boards needs
-- the geocoder; until then their runners share Mumbai's board, which is the
-- right answer for a launch market of one metro anyway.
INSERT INTO territory_geo_cells (h3_cell, resolution, city_tag, country_tag, continent_tag, source)
VALUES
  ('8642db48fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db49fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db4d7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db4dfffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db687ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db68fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db697ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db69fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('8642db6b7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608a24fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608a25fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608a26fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608a2cfffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b007ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b017ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b027ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b037ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b087ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b097ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b09fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b0a7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b0afffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b0b7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b117ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b11fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b187ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b18fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b197ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b19fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b1a7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b1afffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b1b7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b407ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b40fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b417ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b41fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b427ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b42fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b437ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b447ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b44fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b457ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b45fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b467ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b46fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b477ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b487ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b48fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b497ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b49fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4a7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4afffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4b7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4c7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4cfffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4d7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4dfffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4e7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4efffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b4f7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b507ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b50fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b517ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b51fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b527ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b52fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b537ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b547ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b54fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b557ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b55fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b567ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b56fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b577ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b587ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b58fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b597ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b59fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b5a7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b5afffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b5b7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608b7b7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc07ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc0fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc17ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc1fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc27ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc2fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc47ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc4fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc57ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc5fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc77ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc87ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc8fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bc9fffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bcafffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bcc7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bccfffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bcd7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bcdfffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bce7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bcefffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed'),
  ('86608bcf7ffffff', 6, 'Mumbai', 'IN', 'Asia', 'seed')
ON CONFLICT (h3_cell) DO NOTHING;
