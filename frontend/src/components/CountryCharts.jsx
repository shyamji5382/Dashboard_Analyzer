import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CircleDollarSign, Globe2 } from 'lucide-react';
import { useCountries } from '../context/CountryContext';
import { countryNumber } from '../services/countryFormat';
import { chartColors } from '../services/format';
import PiePercentageLabel from './PiePercentageLabel';

const regionColors = { Asia: chartColors[0], Africa: chartColors[1], Americas: chartColors[2], Europe: chartColors[3], Oceania: chartColors[4], Antarctic: chartColors[5] };

export default function CountryCharts({ onSelectCountry }) {
  const { summary, regionMetric, setRegionMetric, setFilters } = useCountries();
  const regions = summary?.data.regions || [];
  const currencies = (summary?.data.currencies || []).slice(0, 6);
  const densities = summary?.data.density_ranking || [];
  const populatedRegions = regions.filter((entry) => entry.population > 0);
  const maxRegion = Math.max(1, ...regions.map((entry) => entry[regionMetric] || 0));
  const maxCurrency = Math.max(1, ...currencies.map((entry) => entry.population));
  return <div className="country-charts">
    <section className="country-chart-panel density-panel" aria-label="Population density ranking"><div className="panel-heading"><div><h2>Highest population density</h2><p>People per square kilometer</p></div></div>
      {densities.length ? <div className="country-density-chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart layout="vertical" data={densities} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="#edf0f1" />
          <XAxis type="number" tickFormatter={(value) => countryNumber(value, true)} axisLine={false} tickLine={false} tick={{ fill: '#859198', fontSize: 10 }} />
          <YAxis type="category" dataKey="name" width={116} tick={{ fill: '#687b85', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => [`${countryNumber(value)} people/km2`, 'Density']} />
          <Bar dataKey="density" fill="#2878e2" barSize={17} radius={[0, 4, 4, 0]} isAnimationActive={false}
            onClick={(entry) => onSelectCountry(entry.payload.code)}
            shape={({ payload, ...props }) => <Rectangle {...props} role="button" tabIndex={0} aria-label={`Open ${payload.name} density details`} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectCountry(payload.code); }
            }} />} />
        </BarChart>
      </ResponsiveContainer></div> : <div className="chart-empty"><Globe2 size={25} /><span>No density data</span></div>}
    </section>
    <section className="country-chart-panel regional-panel" aria-label="Population by region"><div className="panel-heading"><div><h2>{regionMetric === 'population' ? 'Population' : 'Density'} by region</h2><p>{regionMetric === 'population' ? 'People' : 'People per square kilometer'}</p></div><div className="segmented" aria-label="Region metric"><button className={regionMetric === 'population' ? 'selected' : ''} aria-pressed={regionMetric === 'population'} onClick={() => setRegionMetric('population')}>Population</button><button className={regionMetric === 'density' ? 'selected' : ''} aria-pressed={regionMetric === 'density'} onClick={() => setRegionMetric('density')}>Density</button></div></div>
      {regionMetric === 'population' && populatedRegions.length > 0 && <div className="country-region-pie"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <PieChart><Pie data={populatedRegions} dataKey="population" nameKey="region" innerRadius={0} outerRadius="85%" stroke="white" strokeWidth={2} label={PiePercentageLabel} labelLine={false} isAnimationActive={false} onClick={(entry) => setFilters({ region: entry.region })}>
          {populatedRegions.map((entry) => <Cell key={entry.region} fill={regionColors[entry.region] || '#768a9d'} />)}
        </Pie><Tooltip formatter={(value) => [countryNumber(value), 'Population']} /></PieChart>
      </ResponsiveContainer></div>}
      <div className={`country-region-bars ${regionMetric === 'population' ? 'region-pie-legend' : ''}`}>{regions.map((entry) => <button className="category-row" key={entry.region} aria-label={`Filter region ${entry.region}`} onClick={() => setFilters({ region: entry.region })}>
        <div className="category-label"><span><i style={{ background: regionColors[entry.region] || '#768a9d' }} />{entry.region}</span><strong>{countryNumber(entry[regionMetric], regionMetric === 'population')}</strong></div>{regionMetric === 'density' && <div className="bar-track"><div className="bar-fill" style={{ background: regionColors[entry.region] || '#768a9d', width: `${100 * (entry[regionMetric] || 0) / maxRegion}%` }} /></div>}<span className="category-order-count">{entry.countries} countries and territories</span>
      </button>)}{!regions.length && <div className="chart-empty"><Globe2 size={25} /><span>No region data</span></div>}</div></section>
    <section className="country-chart-panel currency-panel" aria-label="Country currency relationships"><div className="panel-heading"><div><h2>Population by currency</h2><p>{summary?.data.metrics.distinct_currencies || 0} currencies</p></div><CircleDollarSign size={18} className="subtle-icon" /></div><div className="country-currency-bars">{currencies.map((entry, index) => <button className="category-row" key={entry.code} aria-label={`Filter currency ${entry.code}`} onClick={() => setFilters({ currency: entry.code })}><div className="category-label"><span><i style={{ background: chartColors[index % chartColors.length] }} />{entry.code}<small>{entry.name}</small></span><strong>{countryNumber(entry.population, true)}</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: `${100 * entry.population / maxCurrency}%`, background: chartColors[index % chartColors.length] }} /></div><span className="category-order-count">{entry.countries} countries and territories</span></button>)}</div>{!currencies.length && <div className="chart-empty"><CircleDollarSign size={25} /><span>No currency data</span></div>}<p className="country-aggregation-note">Countries using multiple currencies appear in each currency total.</p></section>
  </div>;
}
