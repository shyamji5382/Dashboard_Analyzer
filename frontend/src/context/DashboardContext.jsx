import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { api } from '../services/api';

const DashboardContext = createContext(null);
const emptyFilters = { start_date: '', end_date: '', category: '', delivery_status: '', search: '', currency: 'USD' };

function initialFilters() {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(Object.entries(emptyFilters).map(([key, value]) => [key, params.get(key) || value]));
}

function reducer(state, action) {
  switch (action.type) {
    case 'filters': return { ...state, filters: { ...state.filters, ...action.value }, page: 1 };
    case 'reset': return { ...state, filters: { ...emptyFilters, currency: state.filters.currency }, page: 1 };
    case 'page': return { ...state, page: action.value };
    case 'pageSize': return { ...state, pageSize: action.value, page: 1 };
    default: return state;
  }
}

export function DashboardProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, () => ({ filters: initialFilters(), page: 1, pageSize: 8 }));
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState(null);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState('');
  const [tableError, setTableError] = useState('');
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [metric, setMetric] = useState('revenue');
  const { filters, page, pageSize } = state;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(filters).forEach(([key, value]) => { params.delete(key); if (value && value !== emptyFilters[key]) params.set(key, value); });
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    Promise.all([api.summary(filters, controller.signal), api.options(controller.signal)])
      .then(([nextSummary, nextOptions]) => {
        if (controller.signal.aborted) return;
        setSummary(nextSummary);
        setOptions(nextOptions.data);
        setUpdatedAt(new Date());
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setTableLoading(true);
    setTableError('');
    api.orders({ ...filters, page, page_size: pageSize }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.pagination.total_pages > 0 && page > result.pagination.total_pages) {
          dispatch({ type: 'page', value: result.pagination.total_pages });
        } else setOrders(result);
      })
      .catch((err) => { if (!controller.signal.aborted) setTableError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setTableLoading(false); });
    return () => controller.abort();
  }, [filters, page, pageSize, revision]);

  const setFilters = useCallback((value) => dispatch({ type: 'filters', value }), []);
  const resetFilters = useCallback(() => dispatch({ type: 'reset' }), []);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const context = useMemo(() => ({ ...state, summary, orders, options, loading, tableLoading, error, tableError,
    updatedAt, metric, setMetric, setFilters, resetFilters, refresh,
    setPage: (value) => dispatch({ type: 'page', value }),
    setPageSize: (value) => dispatch({ type: 'pageSize', value }),
  }), [state, summary, orders, options, loading, tableLoading, error, tableError, updatedAt, metric, setFilters, resetFilters, refresh]);
  return <DashboardContext.Provider value={context}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) throw new Error('useDashboard requires DashboardProvider');
  return context;
}
