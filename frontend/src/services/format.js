export const statusLabels = { on_time: 'On time', delayed: 'Delayed', pending: 'Pending', unknown: 'Unknown' };
export const chartColors = ['#2878e2', '#13b4cc', '#eab52c', '#f2766b', '#768a9d', '#138673'];

export function formatMoney(value, currency = 'USD', compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: compact ? 1 : 2,
    ...(compact ? { notation: 'compact' } : {}),
  }).format(value || 0);
}

export function formatDate(value, options = {}) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...options }).format(new Date(`${value}T12:00:00`));
}

export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}
