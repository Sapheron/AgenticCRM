import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// ── System update detection ────────────────────────────────────────────
// Fires a custom event when the API returns 502/503 (container restarting).
// The UpdateOverlay component in providers.tsx listens for this.
let _updateVisible = false;
export function isUpdateVisible() { return _updateVisible; }
export function setUpdateVisible(v: boolean) {
  _updateVisible = v;
  window.dispatchEvent(new CustomEvent('system-update', { detail: v }));
}

// Attach JWT from localStorage
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401, detect 502/503 for update overlay
api.interceptors.response.use(
  (res) => {
    // API is back — dismiss update overlay if it was showing
    if (_updateVisible) setUpdateVisible(false);
    return res;
  },
  async (error) => {
    const status = error.response?.status;

    // 502/503 = API container is down (likely updating)
    if (status === 502 || status === 503) {
      if (!_updateVisible) setUpdateVisible(true);
      return Promise.reject(error);
    }

    const original = error.config;
    if (status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post<{ data: { accessToken: string; refreshToken: string } }>(
          '/api/auth/refresh',
          { refreshToken },
        );
        localStorage.setItem('access_token', data.data.accessToken);
        localStorage.setItem('refresh_token', data.data.refreshToken);
        original.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return api(original);
      } catch {
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    // Network error (no response at all) — also likely an update
    if (!error.response && error.code === 'ERR_NETWORK') {
      if (!_updateVisible) setUpdateVisible(true);
    }

    return Promise.reject(error);
  },
);

export default api;
