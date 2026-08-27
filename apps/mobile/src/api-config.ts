export const getApiBaseUrl = (value = process.env.EXPO_PUBLIC_API_BASE_URL): string | undefined => {
  const apiBaseUrl = value?.trim();
  if (!apiBaseUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(apiBaseUrl);
    if (!parsed.protocol.startsWith('http')) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be a valid absolute URL.');
  }

  return apiBaseUrl.replace(/\/$/, '');
};
