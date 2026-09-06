import pg from 'pg';
const EARTH_RADIUS_METRES = 6378137;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

const ringAreaSqm = (ring) => {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [lng1, lat1] = ring[index];
    const [lng2, lat2] = ring[(index + 1) % ring.length];
    const dLng = toRadians(lng2 - lng1);
    const term = dLng * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
    total += term;
  }
  return Math.abs((total * EARTH_RADIUS_METRES * EARTH_RADIUS_METRES) / 2);
};

const detectLoopClaim = (points) => {
  const boundary = points.map((p) => [p.longitude, p.latitude]);
  return { claim: { areaSqm: ringAreaSqm(boundary) } };
};

const pointsFrom = (payload) => {
  const chunk = payload;
  if (!Array.isArray(chunk.points)) return [];
  return chunk.points.flatMap((value) => {
    const raw = value;
    if (
      typeof raw.latitude !== 'number' ||
      typeof raw.longitude !== 'number' ||
      typeof raw.recordedAt !== 'string'
    )
      return [];
    const at = new Date(raw.recordedAt);
    return Number.isNaN(at.getTime())
      ? []
      : [{ latitude: raw.latitude, longitude: raw.longitude, at }];
  });
};

const run = async () => {
  const pool = new pg.Pool({
    connectionString: 'postgres://runsphere:runsphere@localhost:5432/runsphere'
  });
  
  const chunks = await pool.query(
    `SELECT payload FROM activity_chunks WHERE activity_id = $1 ORDER BY sequence`,
    ['cabbb8d0-ea80-4dbf-87f2-2770008b53d4']
  );
  
  const points = chunks.rows.flatMap((row) => pointsFrom(row.payload));
  console.log('Points count:', points.length);
  
  const detection = detectLoopClaim(points);
  console.log('Detection:', detection);
  
  if (detection.claim) {
    console.log('Area:', detection.claim.areaSqm);
  }
  
  pool.end();
};

run().catch(console.error);
