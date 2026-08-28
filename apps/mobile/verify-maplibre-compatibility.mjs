import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mobileRoot = resolve(import.meta.dirname);
const packageJson = JSON.parse(await readFile(resolve(mobileRoot, 'package.json'), 'utf8'));
const appConfig = await readFile(resolve(mobileRoot, 'app.config.ts'), 'utf8');
const gradleProperties = await readFile(resolve(mobileRoot, 'android/gradle.properties'), 'utf8');
const mapLibreVersion = packageJson.dependencies?.['@maplibre/maplibre-react-native'];

if (mapLibreVersion !== '11.3.7') {
  throw new Error(
    `MapLibre React Native must be pinned to 11.3.7; found ${mapLibreVersion ?? 'absent'}.`
  );
}
if (!/newArchEnabled:\s*true/.test(appConfig) || !/^newArchEnabled=true$/m.test(gradleProperties)) {
  throw new Error(
    'MapLibre React Native v11 requires Expo New Architecture in app.config.ts and android/gradle.properties.'
  );
}
if (!/['"]@maplibre\/maplibre-react-native['"]/.test(appConfig)) {
  throw new Error('app.config.ts must register the MapLibre Expo plugin.');
}
if (!/nativeVariant:\s*['"]opengl['"]/.test(appConfig)) {
  throw new Error(
    'app.config.ts must deliberately select the supported Android OpenGL map variant.'
  );
}

console.log(`MapLibre ${mapLibreVersion} is registered for the enabled Expo New Architecture.`);
