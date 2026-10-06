export default function KPICard({ label, value, icon: Icon, tone = 'blue', footer, loading }) {
  return <div className={`kpi kpi-${tone}`}>
    <span className="kpi-icon" aria-hidden="true"><Icon size={21} strokeWidth={1.8} /></span>
    <div className={`kpi-value ${loading ? 'skeleton' : ''}`}>{loading ? '\u00a0' : value}</div>
    <div className="kpi-label">{label}</div>
    <div className="kpi-footer">{footer}</div>
  </div>;
}
