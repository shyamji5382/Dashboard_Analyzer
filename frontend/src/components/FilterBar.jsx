import { CalendarDays, FilterX, SlidersHorizontal, X } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { formatDate, statusLabels } from '../services/format';

export default function FilterBar() {
  const { filters, options, setFilters, resetFilters } = useDashboard();
  const active = filters.start_date || filters.end_date || filters.category || filters.delivery_status || filters.search;
  const invalidRange = filters.start_date && filters.end_date && filters.start_date > filters.end_date;
  return <section className="filter-section" aria-label="Dashboard filters">
    <div className="filter-bar">
      <span className="filter-title"><SlidersHorizontal size={16} />Filters</span>
      <div className="date-range">
        <CalendarDays size={16} />
        <label className="sr-only" htmlFor="start-date">Start date</label>
        <input id="start-date" aria-label="Start date" type="date" value={filters.start_date}
          onChange={(event) => setFilters({ start_date: event.target.value })} />
        <span className="date-separator">to</span>
        <label className="sr-only" htmlFor="end-date">End date</label>
        <input id="end-date" aria-label="End date" type="date" value={filters.end_date}
          onChange={(event) => setFilters({ end_date: event.target.value })} />
      </div>
      <label className="sr-only" htmlFor="category">Category</label>
      <select id="category" value={filters.category} onChange={(event) => setFilters({ category: event.target.value })}>
        <option value="">All categories</option>
        {(options?.categories || []).map((category) => <option key={category}>{category}</option>)}
      </select>
      <label className="sr-only" htmlFor="delivery-status">Delivery status</label>
      <select id="delivery-status" value={filters.delivery_status} onChange={(event) => setFilters({ delivery_status: event.target.value })}>
        <option value="">All delivery statuses</option>
        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button className="icon-button clear-filters" title="Clear filters" aria-label="Clear filters" disabled={!active} onClick={resetFilters}><FilterX size={17} /></button>
    </div>
    {invalidRange && <p className="field-error" role="alert">Start date must be on or before end date.</p>}
    {active && <div className="active-filters">
      {filters.category && <button className="filter-chip" onClick={() => setFilters({ category: '' })}>{filters.category}<X size={12} /></button>}
      {filters.delivery_status && <button className="filter-chip" onClick={() => setFilters({ delivery_status: '' })}>{statusLabels[filters.delivery_status]}<X size={12} /></button>}
      {(filters.start_date || filters.end_date) && <button className="filter-chip" onClick={() => setFilters({ start_date: '', end_date: '' })}>
        {filters.start_date ? formatDate(filters.start_date) : 'Beginning'} to {filters.end_date ? formatDate(filters.end_date) : 'Latest'}<X size={12} /></button>}
    </div>}
  </section>;
}
