// metro.config.js
//
// Custom resolver to break Metro's .native.ts self-cycle and prevent
// incorrect native resolution of platform-neutral imports.
//
// Problem: Metro's native-platform resolver maps any import of './X' to
// 'X.native.ts' when a .native.ts variant exists. This breaks two patterns
// used in this project:
//
// 1. Self-cycles: loop-guidance.native.ts imports './loop-guidance' which
//    resolves back to itself.
// 2. Dual imports in App.tsx: the app imports both `setGuidanceStore` from
//    './src/loop-guidance' (wants the .ts file) and `persistentGuidanceStore`
//    from './src/loop-guidance.native' (explicitly wants the native file).
//    Metro resolves both to the .native.ts file, making `setGuidanceStore`
//    undefined.
//
// Fix: when the import resolves to a .native.ts file but the CALLER already
// explicitly imported from a .native module elsewhere, or when the .native.ts
// file imports its own base name, redirect to the plain .ts file.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Files whose .native.ts variant should NOT shadow the .ts file when imported
// by their bare name. The key is the base module name (without extension) and
// the value is the relative path suffix that should be resolved to the .ts file.
const FORCE_PLAIN_TS = new Set([
  'loop-guidance',
  'push-registration',
]);

const originalResolveRequest = config.resolver?.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Only intercept relative imports on native platforms
  if (platform && (platform === 'android' || platform === 'ios') && moduleName.startsWith('.')) {
    const baseName = path.basename(moduleName);

    if (FORCE_PLAIN_TS.has(baseName)) {
      const resolvedDir = path.dirname(
        path.resolve(path.dirname(context.originModulePath), moduleName)
      );
      return {
        type: 'sourceFile',
        filePath: path.join(resolvedDir, `${baseName}.ts`),
      };
    }
  }

  // Fall through to the default resolver for everything else.
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
