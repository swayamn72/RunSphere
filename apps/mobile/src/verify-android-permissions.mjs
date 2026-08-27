import { readFile } from 'node:fs/promises';

const manifestUrl = new globalThis.URL(
  '../android/app/src/main/AndroidManifest.xml',
  import.meta.url
);
const manifest = await readFile(manifestUrl, 'utf8');
const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"([^>]*)\/>/g)]
  .filter((match) => !match[2]?.includes('tools:node="remove"'))
  .map((match) => match[1]);
const allowed = new Set([
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.INTERNET',
  'android.permission.VIBRATE'
]);
const unexpected = permissions.filter((permission) => !allowed.has(permission));
if (unexpected.length) {
  throw new Error(`Unexpected Android permissions: ${unexpected.join(', ')}`);
}
if (
  permissions.length !== allowed.size ||
  [...allowed].some((permission) => !permissions.includes(permission))
) {
  throw new Error(`Android permission allowlist mismatch: ${permissions.join(', ')}`);
}
globalThis.console.log(`Verified Android permission allowlist: ${permissions.join(', ')}`);
