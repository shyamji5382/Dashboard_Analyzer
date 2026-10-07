import { Fragment, useState } from 'react';
import { Activity, AlertCircle, ArrowDownToLine, Boxes, Check, ChevronRight, CircleDollarSign, CloudDownload, Database, Globe2, LayoutDashboard, Menu, RefreshCw, ShoppingBag, Truck, X } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { useCountries } from '../context/CountryContext';
import { api } from '../services/api';
import { downloadCsv } from '../services/export';
import { formatDate, formatMoney, formatNumber } from '../services/format';
import KPICard from '../components/KPICard';
import FilterBar from '../components/FilterBar';
import RevenueChart from '../components/RevenueChart';
import CategoryChart from '../components/CategoryChart';
import DeliveryChart from '../components/DeliveryChart';
import OrdersTable from '../components/OrdersTable';
import DataSources from '../components/DataSources';
import LoadingSpinner from '../components/LoadingSpinner';
import CountryDashboard from './CountryDashboard';

const navigation = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'sources', label: 'Data sources', icon: Database },
  { id: 'countries', label: 'Countries', icon: Globe2 },
];

export default function Dashboard() {
  const { summary, filters, setFilters, options, loading, error, refresh, updatedAt } = useDashboard();
  const country = useCountries();
  const [view, setView] = useState(() => {
    const initial = new URLSearchParams(location.search).get('view');
    return navigation.some((entry) => entry.id === initial) ? initial : 'overview';
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const metrics = summary?.data.metrics;
  const period = summary?.data.period;
  const quality = summary?.meta.data_quality;
  const currencies = options?.currencies || ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY'];
  const isCountry = view === 'countries';
  const activeLoading = isCountry ? country.loading : loading;
  const activeError = isCountry ? country.error : error;
  const activeRefresh = isCountry ? country.refresh : refresh;
  const activeUpdatedAt = isCountry ? country.updatedAt : updatedAt;
  const activeExporting = isCountry ? country.exporting : exporting;
  const sourceLabel = country.options?.source.source === 'live_api' ? 'Live API' : 'Repository snapshot';
  const title = isCountry ? 'Countries Analytics' : view === 'sources' ? 'Data sources' : view === 'orders' ? 'Orders' : 'Commerce Analytics Dashboard';
  async function exportOrders() {
    setExporting(true); setExportError('');
    try {
      const data = [];
      let page = 1, totalPages = 1;
      do {
        const result = await api.orders({ ...filters, page, page_size: 100 });
        data.push(...result.data); totalPages = result.pagination.total_pages; page += 1;
      } while (page <= totalPages);
      const header = ['Order ID', 'Date', 'Customer', 'Category', 'Order Value', 'Currency', 'Delivery Status'];
      const rows = data.map((order) => [order.order_id, order.order_date, order.customer_name,
        [...new Set(order.items.map((item) => item.category))].join('; '), order.total_value, order.currency, order.delivery_status]);
      downloadCsv(header, rows, `commerce-orders-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) { setExportError(err.message); }
    finally { setExporting(false); }
  }
  function navigate(next) {
    setView(next); setMobileNav(false);
    const url = new URL(location.href);
    if (next === 'overview') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    history.replaceState(null, '', `${url.pathname}${url.search}`);
  }
  return <div className="app-shell">
    {mobileNav && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate('overview'); }}><span className="brand-mark"><Activity size={23} strokeWidth={2.3} /></span><span>Analytics</span></a>
      <button className="workspace-switch" onClick={() => navigate('overview')}><span className="workspace-icon"><ShoppingBag size={18} /></span><span>Commerce workspace<small>Data analytics</small></span><ChevronRight size={15} /></button>
      <span className="nav-heading">COMMERCE</span>
      <nav aria-label="Main navigation">{navigation.map(({ id, label, icon: Icon }) => <Fragment key={id}>
        {id === 'countries' && <span className="nav-heading secondary-nav-heading">EXTERNAL API</span>}
        <button className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-label={label} aria-current={view === id ? 'page' : undefined}>
        <Icon size={18} strokeWidth={1.7} /><span>{label}</span>{id === 'sources' && <span className="nav-count">{options?.imports?.length || 0}</span>}
      </button></Fragment>)}</nav>
      <div className="sidebar-bottom"><div className="connection-state"><i /><span>{activeError ? 'Connection issue' : activeLoading ? 'Connecting' : 'Data connected'}</span><Database size={13} /></div>
        <div className="workspace-profile"><span className="profile-avatar">CA</span><div><strong>Commerce Analytics</strong><small>Workspace</small></div><Check size={14} /></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button menu-toggle" title="Open navigation" aria-label="Open navigation" onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={19} /> : <Menu size={19} />}</button><span>Workspace</span><ChevronRight size={13} /><strong>{navigation.find((entry) => entry.id === view).label}</strong></div>
        <div className="topbar-right"><span className="workspace-status"><i />{isCountry ? sourceLabel : 'Commerce workspace'}</span><span className="profile-avatar small-avatar">CA</span></div></header>
      <main className="dashboard-main" id="main-content">
        <div className="page-heading"><div><span className="eyebrow">{isCountry ? 'EXTERNAL API' : 'COMMERCE ANALYTICS'}</span><h1>{title}</h1><p>{isCountry ? 'Countries, populations and currencies' : view === 'sources' ? 'Source records and import activity' : 'Revenue, orders and delivery at a glance'}</p></div>
          <div className="page-actions"><button className={`icon-button refresh-button ${activeLoading ? 'is-refreshing' : ''}`} title="Refresh data" aria-label="Refresh data" disabled={activeLoading} onClick={activeRefresh}><RefreshCw size={17} /></button>
            {view !== 'sources' && <button className="button export-button" disabled={activeExporting || activeLoading || !!activeError} onClick={isCountry ? country.exportCountries : exportOrders}>{activeExporting ? <RefreshCw className="spin" size={15} /> : <ArrowDownToLine size={15} />}<span>{activeExporting ? 'Exporting' : 'Export'}</span></button>}
            {isCountry ? <button className="button primary" onClick={() => country.sync()} disabled={country.syncing || activeLoading}>{country.syncing ? <RefreshCw className="spin" size={15} /> : <CloudDownload size={15} />}{country.syncing ? 'Syncing' : 'Sync API'}</button> : <button className="button primary" onClick={() => navigate(view === 'sources' ? 'overview' : 'sources')}>{view === 'sources' ? <LayoutDashboard size={15} /> : <Database size={15} />}{view === 'sources' ? 'Dashboard' : 'Manage data'}</button>}</div>
        </div>
        {!isCountry && exportError && <div className="error-banner" role="alert"><AlertCircle size={17} />{exportError}</div>}
        {isCountry ? <CountryDashboard /> : view === 'sources' ? <DataSources /> : <>
          {view === 'overview' && !error && <section className="kpi-grid" aria-label="Key performance indicators">
            <KPICard label="Total revenue" value={formatMoney(metrics?.total_revenue, filters.currency)} icon={CircleDollarSign} loading={loading} footer={`${filters.currency} / selected period`} />
            <KPICard label="Total orders" value={formatNumber(metrics?.total_orders)} icon={ShoppingBag} tone="cyan" loading={loading} footer="Orders placed" />
            <KPICard label="Average order value" value={formatMoney(metrics?.average_order_value, filters.currency)} icon={Boxes} tone="amber" loading={loading} footer="Revenue per order" />
            <KPICard label="Delayed orders" value={formatNumber(metrics?.delayed_orders)} icon={Truck} tone="coral" loading={loading} footer={`${metrics?.total_orders ? (metrics.delayed_orders / metrics.total_orders * 100).toFixed(1) : '0'}% of total orders`} />
          </section>}
          <FilterBar />
          <div className="period-row"><span>{period?.start_date ? `${formatDate(period.start_date, { year: 'numeric' })} - ${formatDate(period.end_date, { year: 'numeric' })}` : 'All time'}<span className="period-tag">{filters.category || 'All categories'}</span></span>
            <label className="currency-select"><CircleDollarSign size={14} /><select aria-label="Reporting currency" value={filters.currency} onChange={(event) => setFilters({ currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div>
          {error ? <div className="dashboard-error" role="alert"><AlertCircle size={28} /><h2>Unable to load analytics</h2><p>{error}</p><button className="button" onClick={refresh}><RefreshCw size={15} />Try again</button></div> : view === 'overview' ? <>
            {loading && !summary ? <div className="charts-loading"><LoadingSpinner label="Loading analytics" /></div> : <div className={`analytics-grid ${loading ? 'is-updating' : ''}`} aria-busy={loading}><RevenueChart /><DeliveryChart /><CategoryChart /></div>}
            <OrdersTable />
          </> : <OrdersTable standalone />}
        </>}
        <footer className="dashboard-footer"><span><i />{activeLoading ? 'Updating data' : activeUpdatedAt ? `Fetched at ${activeUpdatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting data'}</span>
          <span>{isCountry ? `REST Countries / ${sourceLabel}` : <>{quality?.unpriced_items ? `${quality.unpriced_items} unpriced items excluded` : summary?.meta.exchange_rates?.some((rate) => rate.stale) ? 'Cached exchange rates' : 'Commerce Analytics'}{quality?.unknown_delivery_orders > 0 && view !== 'sources' ? ` / ${quality.unknown_delivery_orders} unknown deliveries` : ''}</>}</span></footer>
      </main>
    </div>
  </div>;
}
