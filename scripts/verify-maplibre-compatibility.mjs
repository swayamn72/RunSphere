import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'apps/mobile/package.json'), 'utf8'));
const appConfig = await readFile(resolve(root, 'apps/mobile/app.config.ts'), 'utf8');
const mapLibreVersion = packageJson.dependencies?.['@maplibre/maplibre-react-native'];

if (!mapLibreVersion) {
  console.log('MapLibre React Native is not installed; compatibility check deferred until map rendering is enabled.');
  process.exit(0);
}
if (!/^\^?11\./.test(mapLibreVersion)) {
  throw new Error(`MapLibre React Native must be pinned to v11 for New Architecture builds; found ${mapLibreVersion}.`);
}
if (!/newArchEnabled:\s*true/.test(appConfig)) {
  throw new Error('MapLibre React Native v11 requires Expo New Architecture; app.config.ts must enable it.');
}
console.log(`MapLibre ${mapLibreVersion} is compatible with the enabled Expo New Architecture.`);
