import { access, readFile, readdir } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
/**
 * Where `aapt` lives, or `undefined` when it cannot be found.
 *
 * Windows ships it as `aapt.exe`, and a developer machine may have a debug APK
 * without the Android build-tools on PATH. Not finding the tool is reported
 * and skipped rather than crashing the whole `pnpm test` run; set
 * `REQUIRE_APK_PERMISSION_CHECK=1` to make it a failure instead.
 */
const aaptBinary = globalThis.process.platform === 'win32' ? 'aapt.exe' : 'aapt';
const resolveAapt = async () => {
  if (globalThis.process.env.AAPT) return globalThis.process.env.AAPT;
  const sdkRoots = [
    globalThis.process.env.ANDROID_HOME,
    globalThis.process.env.ANDROID_SDK_ROOT,
    globalThis.process.platform === 'win32' && globalThis.process.env.LOCALAPPDATA
      ? join(globalThis.process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
    '/usr/lib/android-sdk',
    '/opt/android-sdk'
  ].filter((root) => typeof root === 'string' && root.length > 0);

  for (const sdkRoot of sdkRoots) {
    try {
      const versions = (await readdir(join(sdkRoot, 'build-tools')))
        .filter((version) => /^d+(.d+)+$/.test(version))
        .sort(compareVersions);
      const newest = versions.at(-1);
      if (newest) {
        const candidate = join(sdkRoot, 'build-tools', newest, aaptBinary);
        await access(candidate);
        return candidate;
      }
    } catch {
      // Try the next known SDK root, then PATH as a final fallback.
    }
  }
  try {
    await execFile(aaptBinary, ['version']);
    return aaptBinary;
  } catch {
    return undefined;
  }
};
const mobileRoot = new globalThis.URL('../', import.meta.url);
const manifestUrl = new globalThis.URL('android/app/src/main/AndroidManifest.xml', mobileRoot);
const apkUrl = new globalThis.URL('android/app/build/outputs/apk/debug/app-debug.apk', mobileRoot);
const blocked = new Set([
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  // Nothing reads motion data (M8 C.3); expo-sensors, which declared it, is gone.
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE'
]);
const required = new Set([
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_NETWORK_STATE',
  // A location foreground service keeps a run recording with the screen locked.
  // It starts from the Start tap and ends with the run, which is why it needs no
  // ACCESS_BACKGROUND_LOCATION (still blocked). Play asks for a declaration and
  // a demo video for it (docs/play-store-submission.md).
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.INTERNET',
  // Android 13+ runtime grant, added by the expo-notifications plugin and
  // requested in context after sign-in.
  'android.permission.POST_NOTIFICATIONS',
  // Run verification (`safety-and-privacy.md`). These were on the blocked list
  // until the gate shipped, and moving them here was a deliberate reversal of
  // a stated position, not an oversight — which is why this comment exists.
  //
  // What they permit is asking the OS to raise its own authentication prompt.
  // The match happens in secure hardware and the app receives a boolean, so
  // no face or fingerprint data enters the process, the database, or the API.
  // `USE_FINGERPRINT` is the pre-API-28 predecessor of `USE_BIOMETRIC`; the
  // `expo-local-authentication` config plugin declares both, so both must be
  // listed or prebuild output and this allowlist can never agree.
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
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

const aapt = await resolveAapt();
if (!aapt) {
  const message =
    'Debug APK found but aapt is not available (set AAPT or ANDROID_HOME); APK permission check skipped.';
  if (globalThis.process.env.REQUIRE_APK_PERMISSION_CHECK === '1') throw new Error(message);
  globalThis.console.warn(message);
  globalThis.console.log(
    `Verified Android source permission allowlist: ${manifestPermissions.join(', ')}`
  );
  globalThis.process.exit(0);
}

// fileURLToPath, not URL.pathname: on Windows the latter is "/C:/..." and no
// tool can open it.
const { stdout } = await execFile(aapt, ['dump', 'permissions', fileURLToPath(apkUrl)]);
const apkPermissions = [...stdout.matchAll(/uses-permission: name='([^']+)'/g)]
  .map((match) => match[1])
  .filter((permission) => permission.startsWith('android.permission.'));
verifyPermissions(apkPermissions, 'Debug APK', true);
globalThis.console.log(
  `Verified debug APK excludes blocked permissions: ${[...blocked].join(', ')}`
);
