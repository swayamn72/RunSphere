import { access, readFile, readdir } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const compareVersions = (left, right) => {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};
const resolveAapt = async () => {
  if (globalThis.process.env.AAPT) return globalThis.process.env.AAPT;
  const sdkRoots = [
    globalThis.process.env.ANDROID_HOME,
    globalThis.process.env.ANDROID_SDK_ROOT,
    '/usr/lib/android-sdk',
    '/opt/android-sdk'
  ].filter((root) => typeof root === 'string' && root.length > 0);

  for (const sdkRoot of sdkRoots) {
    try {
      const versions = (await readdir(join(sdkRoot, 'build-tools')))
        .filter((version) => /^\d+(\.\d+)+$/.test(version))
        .sort(compareVersions);
      const newest = versions.at(-1);
      if (newest) return join(sdkRoot, 'build-tools', newest, 'aapt');
    } catch {
      // Try the next known SDK root, then PATH as a final fallback.
    }
  }
  return 'aapt';
};
const mobileRoot = new globalThis.URL('../', import.meta.url);
const manifestUrl = new globalThis.URL('android/app/src/main/AndroidManifest.xml', mobileRoot);
const apkUrl = new globalThis.URL('android/app/build/outputs/apk/debug/app-debug.apk', mobileRoot);
const blocked = new Set([
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.WRITE_EXTERNAL_STORAGE'
]);
const required = new Set([
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_NETWORK_STATE',
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
  globalThis.process.exit(0);
}

const { stdout } = await execFile(await resolveAapt(), ['dump', 'permissions', apkUrl.pathname]);
const apkPermissions = [...stdout.matchAll(/uses-permission: name='([^']+)'/g)]
  .map((match) => match[1])
  .filter((permission) => permission.startsWith('android.permission.'));
verifyPermissions(apkPermissions, 'Debug APK', true);
globalThis.console.log(
  `Verified debug APK excludes blocked permissions: ${[...blocked].join(', ')}`
);
