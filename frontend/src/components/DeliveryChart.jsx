import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Truck } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { formatNumber, statusLabels } from '../services/format';
import PiePercentageLabel from './PiePercentageLabel';

const colors = { on_time: '#138673', delayed: '#c74b5a', pending: '#2878e2', unknown: '#718797' };

export default function DeliveryChart() {
  const { summary, setFilters } = useDashboard();
  const data = summary?.data.delivery_performance || [];
  const total = summary?.data.metrics.total_orders || 0;
  return <section className="chart-panel delivery-panel" aria-label="Delivery performance">
    <div className="panel-heading"><div><h2>Delivery performance</h2><p>{formatNumber(total)} orders / delivery timing</p></div><Truck size={18} className="subtle-icon" /></div>
    <div className="delivery-content">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart><Pie data={total ? data.filter((entry) => entry.count > 0) : [{ status: 'unknown', count: 1 }]} dataKey="count" nameKey="status" cx="50%" cy="50%"
            innerRadius={0} outerRadius="85%" paddingAngle={0} stroke="white" strokeWidth={2} isAnimationActive={false}
            label={total ? PiePercentageLabel : false} labelLine={false}
            onClick={(entry) => { if (total) setFilters({ delivery_status: entry.status }); }}>
            {(total ? data.filter((entry) => entry.count > 0) : [{ status: 'unknown' }]).map((entry) => <Cell key={entry.status} fill={colors[entry.status]} />)}
          </Pie><Tooltip formatter={(value, status) => [`${value} orders`, statusLabels[status] || status]} /></PieChart>
        </ResponsiveContainer>
      </div>
      <div className="delivery-legend">{data.map((entry) => <button key={entry.status} className="legend-row" onClick={() => setFilters({ delivery_status: entry.status })} aria-label={`Filter ${statusLabels[entry.status]} deliveries`}>
        <span><i style={{ background: colors[entry.status] }} />{statusLabels[entry.status]}</span><strong>{entry.count}</strong><small>{entry.percentage}%</small>
      </button>)}</div>
    </div>
  </section>;
}
