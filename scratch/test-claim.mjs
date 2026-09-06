import fs from 'fs';
import { detectLoopClaim, ringAreaSqm } from '../packages/domain/src/territory-claim.js';

const ndjson = fs.readFileSync('apps/mobile/.env', 'utf8')
  .split('\n')
  .find(line => line.startsWith('EXPO_PUBLIC_SYNTHETIC_LOCATION_NDJSON'))
  .split('=')[1]
  .replace(/^'/, '').replace(/'$/, '');

const points = ndjson.split('\n').map(line => {
  const p = JSON.parse(line);
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    at: new Date(p.recordedAt)
  };
});

const result = detectLoopClaim(points);
console.log('Result:', JSON.stringify(result, null, 2));

if (result.claim) {
  console.log('Area:', ringAreaSqm(result.claim.boundary));
}
