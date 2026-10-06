import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, X } from 'lucide-react';
import { api } from '../services/api';
import { countryNumber } from '../services/countryFormat';
import CountryFlag from './CountryFlag';
import LoadingSpinner from './LoadingSpinner';

export default function CountryDetail({ code, onClose, onSelectCountry }) {
  const dialog = useRef(null);
  const [country, setCountry] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dialog.current.showModal();
    const controller = new AbortController();
    api.countryDetail(code, controller.signal).then((result) => { if (!controller.signal.aborted) setCountry(result.data); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [code]);
  return <dialog ref={dialog} className="detail-dialog country-dialog" aria-labelledby="country-detail-title" onCancel={onClose} onClick={(event) => { if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <div className="dialog-heading"><div><span className="eyebrow">COUNTRY DETAILS</span><h2 id="country-detail-title">{country?.name || code}</h2></div><button className="icon-button" title="Close country details" aria-label="Close country details" onClick={onClose}><X size={20} /></button></div>
    {loading ? <div className="dialog-loading"><LoadingSpinner label="Loading country" /></div> : error ? <div className="error-banner" role="alert"><AlertCircle size={17} />{error}</div> : country && <>
      <div className="country-detail-identity"><CountryFlag url={country.flag_url} name={country.name} /><div><strong>{country.official_name}</strong><span>{country.code} / {country.region}{country.subregion ? ` / ${country.subregion}` : ''}</span></div></div>
      <dl className="country-detail-metrics"><div><dt>Population</dt><dd>{countryNumber(country.population)}</dd></div><div><dt>Area (km2)</dt><dd>{countryNumber(country.area_km2)}</dd></div><div><dt>Density (people/km2)</dt><dd>{countryNumber(country.density)}</dd></div><div><dt>Capital</dt><dd>{country.capitals.join(', ') || '--'}</dd></div></dl>
      <h3>Currencies</h3><div className="table-scroll"><table><thead><tr><th>Code</th><th>Currency</th><th>Symbol</th></tr></thead><tbody>{country.currencies.map((entry) => <tr key={entry.code}><td>{entry.code}</td><td>{entry.name}</td><td>{entry.symbol || '--'}</td></tr>)}</tbody></table>{!country.currencies.length && <p className="country-detail-empty">No currency data</p>}</div>
      <h3>Languages</h3><div className="country-languages">{country.languages.map((entry) => <span key={entry.code}>{entry.name}<small>{entry.code}</small></span>)}{!country.languages.length && <span>No language data</span>}</div>
      <h3>Bordering countries</h3><div className="country-borders">{country.borders.map((entry) => <button className="button" disabled={!entry.name} key={entry.code} onClick={() => onSelectCountry(entry.code)}>{entry.name || entry.code}</button>)}{!country.borders.length && <span>No land borders</span>}</div>
      {country.map_url && <a className="country-map-link" href={country.map_url} target="_blank" rel="noopener noreferrer">Open map<ExternalLink size={13} /></a>}
    </>}
  </dialog>;
}
