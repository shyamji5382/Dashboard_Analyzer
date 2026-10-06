import { Area, Bar, CartesianGrid, ComposedChart, Dot, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartNoAxesCombined } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { formatDate, formatMoney, formatNumber } from '../services/format';

function TrendTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><span>{formatDate(label, { year: 'numeric' })}</span>
    {payload.map((entry) => <strong key={entry.dataKey}>{entry.dataKey === 'revenue' ? formatMoney(entry.value, currency) : `${formatNumber(entry.value)} orders`}</strong>)}
  </div>;
}

export default function RevenueChart() {
  const { summary, filters, metric, setMetric, setFilters } = useDashboard();
  const data = summary?.data.revenue_trend || [];
  const isRevenue = metric === 'revenue';
  const value = isRevenue ? formatMoney(summary?.data.metrics.total_revenue, filters.currency) : formatNumber(summary?.data.metrics.total_orders);
  const selectDate = (date) => setFilters({ start_date: date, end_date: date });
  const selectWithKeyboard = (event, date) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectDate(date); }
  };
  return <section className="chart-panel revenue-panel" aria-label="Revenue trend">
    <div className="panel-heading"><div><h2>{isRevenue ? 'Revenue' : 'Orders'} over time</h2><p>Order date</p></div>
      <div className="segmented" aria-label="Trend metric">
        <button aria-pressed={isRevenue} className={isRevenue ? 'selected' : ''} onClick={() => setMetric('revenue')}>Revenue</button>
        <button aria-pressed={!isRevenue} className={!isRevenue ? 'selected' : ''} onClick={() => setMetric('orders')}>Orders</button>
      </div>
    </div>
    <div className="chart-stat"><div><strong>{value}</strong><span>Total in selected period</span></div>
      <div className="chart-legend">{isRevenue && <span><i className="revenue-key" />Revenue ({filters.currency})</span>}<span><i className={isRevenue ? 'orders-key' : 'revenue-key'} />Orders</span></div>
    </div>
    {data.length ? <div className="trend-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={data} margin={{ top: 12, right: 0, left: -12, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="#edf0f3" strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={(day) => formatDate(day)} axisLine={false} tickLine={false} minTickGap={42} tick={{ fill: '#7d8589', fontSize: 11 }} dy={8} />
          {isRevenue && <YAxis yAxisId="revenue" tickFormatter={(n) => formatMoney(n, filters.currency, true)} axisLine={false} tickLine={false} tick={{ fill: '#7d8589', fontSize: 11 }} width={70} />}
          <YAxis yAxisId="orders" orientation={isRevenue ? 'right' : 'left'} tickFormatter={formatNumber} axisLine={false} tickLine={false} tick={{ fill: '#7d8589', fontSize: 11 }} width={isRevenue ? 30 : 50} allowDecimals={false} domain={[0, (maximum) => Math.max(2, maximum)]} />
          <Tooltip content={<TrendTooltip currency={filters.currency} />} />
          <Bar yAxisId="orders" dataKey="orders" fill={isRevenue ? '#eab52c' : '#2878e2'} maxBarSize={26} radius={[4, 4, 0, 0]} isAnimationActive={false}
            onClick={(entry) => selectDate(entry.payload.date)}
            shape={({ payload, ...props }) => <Rectangle {...props} role="button" tabIndex={0} aria-label={`Filter orders on ${formatDate(payload.date, { year: 'numeric' })}`} onKeyDown={(event) => selectWithKeyboard(event, payload.date)} />} />
          {isRevenue && <Area yAxisId="revenue" type="linear" dataKey="revenue" stroke="#2878e2" strokeWidth={2.5} fill="#2878e2" fillOpacity={0.06} activeDot={false} isAnimationActive={false}
            dot={({ payload, ...props }) => <Dot {...props} r={5} fill="#2878e2" fillOpacity={1} stroke="white" strokeWidth={2} role="button" tabIndex={0} aria-label={`Filter revenue on ${formatDate(payload.date, { year: 'numeric' })}`} onClick={() => selectDate(payload.date)} onKeyDown={(_, event) => selectWithKeyboard(event, payload.date)} />} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div> : <div className="chart-empty"><ChartNoAxesCombined size={26} /><span>No orders in this period</span></div>}
  </section>;
}
