import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'RunSphere',
  slug: 'runsphere',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  android: {
    package: 'com.runsphere.app'
  },
  ios: {
    bundleIdentifier: 'com.runsphere.app'
  },
  plugins: [],
  experiments: {
    typedRoutes: false
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? ''
  }
};

export default config;
