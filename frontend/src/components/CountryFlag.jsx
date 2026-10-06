import { useState } from 'react';
import { Globe2 } from 'lucide-react';

export default function CountryFlag({ url, name }) {
  const [failed, setFailed] = useState(false);
  return <span className="country-flag">{url && !failed ? <img src={url} alt={`${name} flag`} onError={() => setFailed(true)} loading="lazy" /> : <Globe2 size={17} />}</span>;
}
