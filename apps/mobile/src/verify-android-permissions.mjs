import { access, readFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const mobileRoot = new globalThis.URL('../', import.meta.url);
const manifestUrl = new globalThis.URL('android/app/src/main/AndroidManifest.xml', mobileRoot);
const apkUrl = new globalThis.URL('android/app/build/outputs/apk/debug/app-debug.apk', mobileRoot);
const blocked = new Set([
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.SYSTEM_ALERT_WINDOW'
]);
const required = new Set([
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.INTERNET',
  'android.permission.VIBRATE'
]);

const verifyPermissions = (permissions, source, exact) => {
  const prohibited = permissions.filter((permission) => blocked.has(permission));
  if (prohibited.length)
    throw new Error(
      `${source} has prohibited Android permissions: ${[...new Set(prohibited)].join(', ')}`
    );
  if (exact) {
    const unexpected = permissions.filter((permission) => !required.has(permission));
    if (
      unexpected.length ||
      permissions.length !== required.size ||
      [...required].some((permission) => !permissions.includes(permission))
    )
      throw new Error(`${source} Android permission allowlist mismatch: ${permissions.join(', ')}`);
  }
};

const manifest = await readFile(manifestUrl, 'utf8');
const manifestPermissions = [
  ...manifest.matchAll(/<uses-permission android:name="([^"]+)"([^>]*)\/>/g)
]
  .filter((match) => !match[2]?.includes('tools:node="remove"'))
  .map((match) => match[1]);
verifyPermissions(manifestPermissions, 'Source manifest', true);

try {
  await access(apkUrl);
} catch {
  globalThis.console.log(
    `Verified Android source permission allowlist: ${manifestPermissions.join(', ')}`
  );
  process.exit(0);
}

const { stdout } = await execFile('aapt', ['dump', 'permissions', apkUrl.pathname]);
const apkPermissions = [...stdout.matchAll(/uses-permission: name='([^']+)'/g)].map(
  (match) => match[1]
);
verifyPermissions(apkPermissions, 'Debug APK', false);
globalThis.console.log(
  `Verified debug APK excludes blocked permissions: ${[...blocked].join(', ')}`
);
