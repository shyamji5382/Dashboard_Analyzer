import { FilterX, SlidersHorizontal, X } from 'lucide-react';
import { useCountries } from '../context/CountryContext';

export default function CountryFilters() {
  const { filters, options, setFilters, resetFilters } = useCountries();
  const active = Object.values(filters).some((value) => value !== '');
  const invalid = filters.population_min !== '' && filters.population_max !== '' && Number(filters.population_min) > Number(filters.population_max);
  return <section className="filter-section country-filter-section" aria-label="Country filters">
    <div className="filter-bar country-filter-bar"><span className="filter-title"><SlidersHorizontal size={16} />Filters</span>
      <select aria-label="Region" value={filters.region} onChange={(event) => setFilters({ region: event.target.value })}><option value="">All regions</option>{options?.regions.map((region) => <option key={region}>{region}</option>)}</select>
      <div className="population-range"><span>Population</span><input type="number" min="0" step="1" placeholder="Min" aria-label="Minimum population" value={filters.population_min} onChange={(event) => setFilters({ population_min: event.target.value })} /><span>to</span><input type="number" min="0" step="1" placeholder="Max" aria-label="Maximum population" value={filters.population_max} onChange={(event) => setFilters({ population_max: event.target.value })} /></div>
      <select aria-label="Country currency" value={filters.currency} onChange={(event) => setFilters({ currency: event.target.value })}><option value="">All currencies</option>{options?.currencies.map((entry) => <option key={entry.code} value={entry.code}>{entry.code} - {entry.name}</option>)}</select>
      <select aria-label="Language" value={filters.language} onChange={(event) => setFilters({ language: event.target.value })}><option value="">All languages</option>{options?.languages.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select>
      <button className="icon-button clear-filters" title="Clear country filters" aria-label="Clear country filters" disabled={!active} onClick={resetFilters}><FilterX size={17} /></button>
    </div>
    {invalid && <p className="field-error" role="alert">Minimum population must not exceed maximum population.</p>}
    {(filters.region || filters.currency || filters.language) && <div className="active-filters">{['region', 'currency', 'language'].filter((key) => filters[key]).map((key) => <button className="filter-chip" key={key} onClick={() => setFilters({ [key]: '' })}>{key === 'language' ? options?.languages.find((entry) => entry.code === filters.language)?.name || filters.language : filters[key]}<X size={12} /></button>)}</div>}
  </section>;
}
