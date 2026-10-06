export function countryNumber(value, compact = false) {
  if (value === null || value === undefined) return '--';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: compact ? 2 : 1, ...(compact ? { notation: 'compact' } : {}) }).format(value);
}
