const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export function queryString(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) params.set(key, String(value));
  });
  return params.toString();
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Unable to reach the analytics API. Check that the backend is running.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  if (!payload) throw new Error('The API returned an invalid response.');
  return payload;
}

export const api = {
  summary: (filters, signal) => request(`/analytics/summary?${queryString(filters)}`, { signal }),
  orders: (filters, signal) => request(`/analytics/orders?${queryString(filters)}`, { signal }),
  options: (signal) => request('/analytics/filters', { signal }),
  detail: (id, currency, signal) => request(`/analytics/orders/${encodeURIComponent(id)}?${queryString({ currency })}`, { signal }),
  countrySummary: (filters, signal) => request(`/analytics/countries/summary?${queryString(filters)}`, { signal }),
  countries: (filters, signal) => request(`/analytics/countries?${queryString(filters)}`, { signal }),
  countryOptions: (signal) => request('/analytics/countries/filters', { signal }),
  countryDetail: (code, signal) => request(`/analytics/countries/${encodeURIComponent(code)}`, { signal }),
  syncCountries: (source = 'api', preview = false) => request(`/ingest/countries?${queryString({ source, preview })}`, { method: 'POST' }),
  ingest: (type, file, signal) => {
    const body = new FormData();
    if (file) body.append('file', file);
    return request(`/ingest/${type}`, { method: 'POST', ...(file ? { body } : {}), signal });
  },
};
