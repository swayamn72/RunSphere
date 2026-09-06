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
    console.log(`P${index}: (${lng1}, ${lat1}) -> (${lng2}, ${lat2}) | dLng: ${dLng} | term: ${term}`);
  }
  console.log('Total:', total);
  return Math.abs((total * EARTH_RADIUS_METRES * EARTH_RADIUS_METRES) / 2);
};

const ring = [
  [-122.0311, 37.3318],
  [-122.0311, 37.332300000000004],
  [-122.0311, 37.3328],
  [-122.03059999999999, 37.3328],
  [-122.03009999999999, 37.3328],
  [-122.03009999999999, 37.332300000000004],
  [-122.03009999999999, 37.3318],
  [-122.03059999999999, 37.3318],
  [-122.0311, 37.3318]
];

console.log('Area:', ringAreaSqm(ring));
