import { useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDollarSign, Database, Globe2, Map, RefreshCw, Users } from 'lucide-react';
import { useCountries } from '../context/CountryContext';
import { countryNumber } from '../services/countryFormat';
import KPICard from '../components/KPICard';
import CountryFilters from '../components/CountryFilters';
import CountryCharts from '../components/CountryCharts';
import CountriesTable from '../components/CountriesTable';
import CountryDetail from '../components/CountryDetail';
import LoadingSpinner from '../components/LoadingSpinner';

export default function CountryDashboard() {
  const { summary, options, loading, error, refresh, sync, syncing, actionError, notice, filters } = useCountries();
  const [selected, setSelected] = useState(null);
  const metrics = summary?.data.metrics;
  const source = options?.source;
  return <div className="country-dashboard">
    {actionError && <div className="error-banner" role="alert"><AlertCircle size={17} />{actionError}</div>}
    {notice && <div className="import-result" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}
    {!error && <section className="kpi-grid" aria-label="Country key performance indicators">
      <KPICard label="Countries and territories" value={countryNumber(metrics?.total_countries)} icon={Globe2} loading={loading} footer={filters.region || 'Worldwide'} />
      <KPICard label="Total population" value={countryNumber(metrics?.total_population, true)} icon={Users} tone="cyan" loading={loading} footer="Combined population" />
      <KPICard label="Population density" value={countryNumber(metrics?.population_density)} icon={Map} tone="amber" loading={loading} footer="People / km2, area-weighted" />
      <KPICard label="Currencies" value={countryNumber(metrics?.distinct_currencies)} icon={CircleDollarSign} tone="coral" loading={loading} footer={`${metrics?.distinct_languages || 0} distinct languages`} />
    </section>}
    <CountryFilters />
    <div className="country-source-row"><span><Database size={13} />{source?.source === 'live_api' ? 'REST Countries / Live API' : source?.source === 'repository_snapshot' ? 'REST Countries / Repository snapshot' : 'No country data'}{source?.synced_at && <small>Imported {new Date(source.synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small>}</span><button className="country-source-reset icon-button" title="Restore repository snapshot" aria-label="Restore repository snapshot" onClick={() => sync('snapshot')} disabled={syncing}><RefreshCw size={14} /></button></div>
    {error ? <div className="dashboard-error" role="alert"><AlertCircle size={28} /><h2>Unable to load countries</h2><p>{error}</p><button className="button" onClick={refresh}><RefreshCw size={15} />Retry countries</button></div> : <>
      {loading && !summary ? <div className="charts-loading"><LoadingSpinner label="Loading country analytics" /></div> : <div className={loading ? 'is-updating' : ''} aria-busy={loading}><CountryCharts onSelectCountry={setSelected} /></div>}
      <CountriesTable onSelectCountry={setSelected} />
      {(metrics?.missing_population > 0 || metrics?.missing_density > 0) && <p className="country-quality-note">{metrics.missing_population} missing population values; {metrics.missing_density} countries without a calculable density.</p>}
    </>}
    {selected && <CountryDetail key={selected} code={selected} onClose={() => setSelected(null)} onSelectCountry={setSelected} />}
  </div>;
}
