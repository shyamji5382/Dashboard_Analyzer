import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileCode2, FileJson, FileSpreadsheet, RotateCcw, Upload } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { api } from '../services/api';
import LoadingSpinner from './LoadingSpinner';

const sources = [
  { type: 'json', name: 'Orders', file: 'Orders.json', icon: FileJson, count: 'orders', color: 'green', accept: '.json,application/json' },
  { type: 'csv', name: 'Products', file: 'Products.csv', icon: FileSpreadsheet, count: 'products', color: 'blue', accept: '.csv,text/csv' },
  { type: 'xml', name: 'Shipments', file: 'Shipments.xml', icon: FileCode2, count: 'shipments', color: 'amber', accept: '.xml,text/xml,application/xml' },
];

function SourceCard({ source, busy, onImport }) {
  const { options } = useDashboard();
  const input = useRef(null);
  const Icon = source.icon;
  const imported = options?.imports?.find((entry) => entry.dataset === source.type);
  return <article className="source-card">
    <div className="source-heading"><span className={`source-icon ${source.color}`}><Icon size={23} /></span><span className="file-format">{source.type.toUpperCase()}</span></div>
    <h2>{source.name}</h2><p>{source.file}</p>
    <div className="source-count"><strong>{options?.dataset_counts?.[source.count] ?? 0}</strong><span>records</span></div>
    <dl className="source-info"><div><dt>Last import</dt><dd>{imported ? new Date(imported.imported_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'}</dd></div>
      <div><dt>Skipped records</dt><dd>{imported?.skipped || 0}</dd></div>
      <div><dt>Import warnings</dt><dd>{imported?.warnings?.length || 0}</dd></div></dl>
    <input ref={input} className="sr-only" type="file" accept={source.accept} aria-label={`Upload ${source.name}`} onChange={(event) => {
      if (event.target.files[0]) onImport(source.type, event.target.files[0]);
      event.target.value = '';
    }} />
    <div className="source-actions"><button className="button" disabled={!!busy} onClick={() => input.current.click()}><Upload size={15} />Import file</button>
      <button className="icon-button" disabled={!!busy} title={`Load bundled ${source.name.toLowerCase()}`} aria-label={`Load bundled ${source.name.toLowerCase()}`} onClick={() => onImport(source.type)}><RotateCcw size={16} /></button></div>
    <span className="source-replace-note">Imports replace this dataset &middot; 5 MB max</span>
  </article>;
}

export default function DataSources() {
  const { refresh, options } = useDashboard();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);
  async function handleImport(type, file) {
    setError(''); setReport(null);
    if (file && file.size > 5 * 1024 * 1024) { setError('Maximum file size is 5 MB.'); return; }
    setBusy(type);
    try {
      const result = await api.ingest(type, file);
      setReport(result.data);
      refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }
  return <div className="sources-view">
    <div className="section-heading"><div><h2>Connected sources</h2><p>{options?.imports?.length || 0} datasets</p></div>{busy && <LoadingSpinner small label="Importing" />}</div>
    {error && <div className="error-banner" role="alert"><AlertCircle size={18} />{error}</div>}
    {report && <div className="import-result" role="status"><CheckCircle2 size={18} /><div><strong>{report.imported} records imported</strong><span>{report.skipped} skipped{report.item_count ? `, ${report.item_count} line items` : ''}</span>
      {report.warnings.length > 0 && <details><summary>{report.warnings.length} warnings</summary><ul>{report.warnings.slice(0, 30).map((warning, index) => <li key={index}>{warning}</li>)}</ul>{report.warnings.length > 30 && <span>{report.warnings.length - 30} more warnings</span>}</details>}</div></div>}
    <div className="source-grid">{sources.map((source) => <SourceCard key={source.type} source={source} busy={busy} onImport={handleImport} />)}</div>
    <div className="import-history"><h2>Import activity</h2><div className="table-scroll"><table><thead><tr><th>Dataset</th><th>Imported</th><th>Skipped</th><th>Warnings</th><th>Last import</th></tr></thead><tbody>
      {(options?.imports || []).map((entry) => <tr key={entry.dataset}><td>{sources.find((source) => source.type === entry.dataset)?.name}</td><td>{entry.imported}</td><td>{entry.skipped}</td><td>{entry.warnings.length}</td><td className="muted-cell">{new Date(entry.imported_at).toLocaleString()}</td></tr>)}
    </tbody></table></div></div>
  </div>;
}
