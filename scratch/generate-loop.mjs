import fs from 'fs';

const points = [];
const startLat = 37.3318;
const startLng = -122.0311;
const step = 0.001;
let time = Date.now();

const addPoint = (lat, lng) => {
  points.push({
    recordedAt: new Date(time).toISOString(),
    latitude: lat,
    longitude: lng,
    accuracy: 5,
    altitude: 10
  });
  time += 15000;
};

addPoint(startLat, startLng);
addPoint(startLat + step * 0.5, startLng);
addPoint(startLat + step, startLng);
addPoint(startLat + step, startLng + step * 0.5);
addPoint(startLat + step, startLng + step);
addPoint(startLat + step * 0.5, startLng + step);
addPoint(startLat, startLng + step);
addPoint(startLat, startLng + step * 0.5);
addPoint(startLat, startLng);

const ndjson = points.map(p => JSON.stringify(p)).join('\\n');

const envPath = 'apps/mobile/.env';
let env = fs.readFileSync(envPath, 'utf-8');

env = env.split('\\n').filter(line => !line.startsWith('EXPO_PUBLIC_SYNTHETIC_LOCATION')).join('\\n');

env += '\\nEXPO_PUBLIC_SYNTHETIC_LOCATION=true\\n';
env += "EXPO_PUBLIC_SYNTHETIC_LOCATION_NDJSON='" + ndjson + "'\\n";

fs.writeFileSync(envPath, env);
