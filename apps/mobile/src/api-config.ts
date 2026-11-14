const isLocalDevelopmentHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '10.0.2.2' ||
  hostname.endsWith('.local') ||
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

export const getApiBaseUrl = (
  value = process.env.EXPO_PUBLIC_API_BASE_URL,
  environment = process.env.EXPO_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? 'development'
): string | undefined => {
  const apiBaseUrl = value?.trim();
  if (!apiBaseUrl) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be a valid absolute URL.');
  }

  const allowsLocalHttp =
    parsed.protocol === 'http:' &&
    environment !== 'production' &&
    isLocalDevelopmentHost(parsed.hostname);
  if (parsed.protocol !== 'https:' && !allowsLocalHttp) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must use HTTPS outside local development.');
  }

  return apiBaseUrl.replace(/\/$/, '');
};
