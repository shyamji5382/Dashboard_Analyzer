import { ArrowUpRight, PackageOpen } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { chartColors, formatMoney, formatNumber } from '../services/format';

export default function CategoryChart() {
  const { summary, filters, setFilters, metric } = useDashboard();
  const data = summary?.data.category_revenue || [];
  const maximum = Math.max(1, ...data.map((entry) => entry[metric]));
  return <section className="chart-panel category-panel" aria-label="Category revenue">
    <div className="panel-heading"><div><h2>{metric === 'revenue' ? 'Revenue' : 'Orders'} by category</h2><p>{data.length} categories</p></div><span className="subtle-icon"><ArrowUpRight size={18} /></span></div>
    <div className="category-bars">
      {data.map((entry, index) => <button className="category-row" key={entry.category} onClick={() => setFilters({ category: entry.category })} aria-label={`Filter ${entry.category}`}>
        <div className="category-label"><span><i style={{ background: chartColors[index % chartColors.length] }} />{entry.category}</span>
          <strong>{metric === 'revenue' ? formatMoney(entry.revenue, filters.currency, true) : formatNumber(entry.orders)}</strong></div>
        <div className="bar-track"><div className="bar-fill" style={{ width: `${100 * entry[metric] / maximum}%`, background: chartColors[index % chartColors.length] }} /></div>
        <span className="category-order-count">{formatNumber(entry.orders)} orders</span>
      </button>)}
      {!data.length && <div className="chart-empty"><PackageOpen size={26} /><span>No category data</span></div>}
    </div>
  </section>;
}
