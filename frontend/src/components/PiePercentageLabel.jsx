import { Text } from 'recharts';

export default function PiePercentageLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, fill }) {
  if (percent < 0.06) return null;
  const angle = -midAngle * Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.65;
  const color = ['#13b4cc', '#eab52c', '#f2766b'].includes(fill) ? '#26394a' : 'white';
  return <Text x={cx + radius * Math.cos(angle)} y={cy + radius * Math.sin(angle)} fill={color} textAnchor="middle" verticalAnchor="middle" fontSize={11} fontWeight={600}>{`${(percent * 100).toFixed(1)}%`}</Text>;
}
