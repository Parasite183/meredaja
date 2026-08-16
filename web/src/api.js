import { useEffect, useState } from 'react';

const TOKEN_KEY = 'meredaja.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, token = getToken() } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?', 'network');
  }

  const refreshed = res.headers.get('x-meredaja-refresh');
  if (refreshed) setToken(refreshed);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      clearToken();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }
    throw new ApiError(res.status, data.error || 'Request failed', data.code);
  }
  return data;
}

/** Upload a file (multipart) with the auth token. */
export async function uploadFile(path, file, fields = {}) {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${getToken()}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Upload failed', data.code);
  return data;
}

/**
 * Fetch an access-gated /uploads/... file with the auth token and
 * expose it as a blob URL the browser can render directly. Plain
 * <img src> can't send the Authorization header, so raw /uploads paths
 * always 401 — this is how vault documents are displayed.
 */
export function useUploadUrl(path) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!path) {
      setUrl('');
      return undefined;
    }
    let objectUrl = '';
    let cancelled = false;
    fetch(path, { headers: { authorization: `Bearer ${getToken()}` } })
      .then((res) => {
        if (!res.ok) throw new Error(`upload ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl('');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url;
}
