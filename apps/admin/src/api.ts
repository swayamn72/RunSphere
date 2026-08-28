export interface StaffReviewItem {
  id: string;
  status: 'received' | 'validating' | 'rejected';
  submittedAt: string;
  rejectionReason?: string;
  validationErrors: string[];
}

interface LoginResponse {
  accessToken: string;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  ''
);

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...init.headers }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new Error(body?.message ?? `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
};

export const signIn = (email: string, password: string) =>
  request<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

export const getStaffReviewQueue = (accessToken: string) =>
  request<{ data: StaffReviewItem[] }>('/v1/staff/activity-review-queue', {
    headers: { authorization: `Bearer ${accessToken}` }
  });
