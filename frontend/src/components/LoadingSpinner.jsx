import { LoaderCircle } from 'lucide-react';

export default function LoadingSpinner({ label = 'Loading', small = false }) {
  return <span className={`loading-indicator ${small ? 'small' : ''}`} role="status">
    <LoaderCircle className="spin" size={small ? 16 : 22} /><span>{label}</span>
  </span>;
}
