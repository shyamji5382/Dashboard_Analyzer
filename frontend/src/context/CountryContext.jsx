import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { api } from '../services/api';
import { downloadCsv } from '../services/export';

const CountryContext = createContext(null);
const defaults = { region: '', population_min: '', population_max: '', currency: '', language: '', search: '' };

function reducer(state, action) {
  if (action.type === 'filters') return { ...state, filters: { ...state.filters, ...action.value }, page: 1 };
  if (action.type === 'reset') return { ...state, filters: { ...defaults }, page: 1 };
  if (action.type === 'sort') return { ...state, sort: action.value, page: 1 };
  if (action.type === 'pageSize') return { ...state, pageSize: action.value, page: 1 };
  if (action.type === 'page') return { ...state, page: action.value };
  return state;
}

export function CountryProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, () => ({ filters: Object.fromEntries(Object.keys(defaults).map((key) => [key, new URLSearchParams(location.search).get(`country_${key}`) || ''])), page: 1, pageSize: 10, sort: 'population_desc' }));
  const [summary, setSummary] = useState(null);
  const [options, setOptions] = useState(null);
  const [countries, setCountries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState('');
  const [tableError, setTableError] = useState('');
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [regionMetric, setRegionMetric] = useState('population');
  const { filters, page, pageSize, sort } = state;
  useEffect(() => {
    const url = new URL(location.href);
    Object.entries(filters).forEach(([key, value]) => { url.searchParams.delete(`country_${key}`); if (value !== '') url.searchParams.set(`country_${key}`, value); });
    history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, [filters]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.all([api.countrySummary(filters, controller.signal), api.countryOptions(controller.signal)])
      .then(([next, nextOptions]) => { if (!controller.signal.aborted) { setSummary(next); setOptions(nextOptions.data); setUpdatedAt(new Date()); } })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setTableLoading(true); setTableError('');
    api.countries({ ...filters, page, page_size: pageSize, sort }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (page > Math.max(1, result.pagination.total_pages)) dispatch({ type: 'page', value: Math.max(1, result.pagination.total_pages) });
        else setCountries(result);
      })
      .catch((err) => { if (!controller.signal.aborted) setTableError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setTableLoading(false); });
    return () => controller.abort();
  }, [filters, page, pageSize, sort, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const setFilters = useCallback((value) => dispatch({ type: 'filters', value }), []);
  const resetFilters = useCallback(() => dispatch({ type: 'reset' }), []);
  async function sync(source = 'api') {
    setSyncing(true); setActionError(''); setNotice('');
    try {
      const result = await api.syncCountries(source, source === 'api' && !options?.source.api_configured);
      if (result.data.persisted) { setNotice(`${result.data.imported} countries imported.`); refresh(); }
      else {
        const sample = result.data.preview[0];
        setNotice(`API connection verified: ${sample.name}, ${sample.currencies.map((entry) => entry.code).join(', ')}. Preview only. Full synchronization requires a server-side API key.`);
      }
    } catch (err) { setActionError(err.message); }
    finally { setSyncing(false); }
  }
  async function exportCountries() {
    setExporting(true); setActionError('');
    try {
      const records = [];
      let current = 1, totalPages = 1;
      do {
        const result = await api.countries({ ...filters, sort, page: current, page_size: 100 });
        records.push(...result.data); totalPages = result.pagination.total_pages; current += 1;
      } while (current <= totalPages);
      downloadCsv(['Country Code', 'Country', 'Region', 'Population', 'Area (km2)', 'Density (people/km2)', 'Currencies', 'Languages'],
        records.map((country) => [country.code, country.name, country.region, country.population, country.area_km2, country.density,
          country.currencies.map((entry) => entry.code).join('; '), country.languages.map((entry) => entry.name).join('; ')]),
        `countries-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) { setActionError(err.message); }
    finally { setExporting(false); }
  }
  const value = useMemo(() => ({ ...state, summary, options, countries, loading, tableLoading, error, tableError, updatedAt,
    syncing, exporting, actionError, notice, regionMetric, setRegionMetric, refresh, setFilters, resetFilters, sync, exportCountries,
    setPage: (value) => dispatch({ type: 'page', value }), setPageSize: (value) => dispatch({ type: 'pageSize', value }), setSort: (value) => dispatch({ type: 'sort', value }),
  }), [state, summary, options, countries, loading, tableLoading, error, tableError, updatedAt, syncing, exporting, actionError, notice, regionMetric, refresh, setFilters, resetFilters]);
  return <CountryContext.Provider value={value}>{children}</CountryContext.Provider>;
}

export function useCountries() {
  const value = useContext(CountryContext);
  if (!value) throw new Error('useCountries requires CountryProvider');
  return value;
}
