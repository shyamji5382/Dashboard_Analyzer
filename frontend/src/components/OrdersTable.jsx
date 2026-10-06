import { useEffect, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUpRight, ChevronLeft, ChevronRight, PackageOpen, Search } from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { formatDate, formatMoney, statusLabels } from '../services/format';
import LoadingSpinner from './LoadingSpinner';
import OrderDetail from './OrderDetail';

export default function OrdersTable({ standalone = false }) {
  const { orders, filters, page, pageSize, setPage, setPageSize, setFilters, tableLoading, tableError, refresh } = useDashboard();
  const [search, setSearch] = useState(filters.search);
  const [selected, setSelected] = useState(null);
  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (search === filters.search) return;
    const timeout = setTimeout(() => setFilters({ search }), 350);
    return () => clearTimeout(timeout);
  }, [search, filters.search, setFilters]);
  const pagination = orders?.pagination;
  const start = pagination?.total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, pagination?.total || 0);
  return <section className={`orders-section ${standalone ? 'standalone' : ''}`} aria-label="Orders">
    <div className="orders-heading"><div><h2>{standalone ? 'All orders' : 'Recent orders'}<span className="count-badge">{pagination?.total || 0}</span></h2><p>Orders and shipment activity</p></div>
      <div className="table-tools">{tableLoading && <LoadingSpinner small label="Updating" />}
        <label className="search-input"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders..." aria-label="Search orders" /></label></div>
    </div>
    {tableError ? <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{tableError}</span><button className="button" onClick={refresh}>Retry</button></div> : <>
      <div className={`table-scroll ${tableLoading ? 'is-updating' : ''}`} aria-busy={tableLoading}>
        <table><thead><tr><th>Order ID</th><th>Customer</th><th><span className="column-heading">Date <ArrowDown size={12} /></span></th><th>Category</th><th className="number-cell">Order value</th><th>Delivery timing</th><th><span className="sr-only">Details</span></th></tr></thead>
          <tbody>{(orders?.data || []).map((order) => <tr key={order.order_id}>
            <td><button className="order-id" onClick={() => setSelected(order.order_id)}>{order.order_id}</button></td>
            <td><div className="customer-cell"><span className="avatar">{order.customer_name.split(' ').slice(0, 2).map((word) => word[0]).join('')}</span><span>{order.customer_name}</span></div></td>
            <td className="muted-cell">{formatDate(order.order_date, { year: 'numeric' })}</td>
            <td className="muted-cell"><span className="category-cell">{[...new Set(order.items.map((item) => item.category))].join(', ')}</span></td>
            <td className="number-cell amount-cell">{formatMoney(order.total_value, filters.currency)}{!order.revenue_complete && <span title="Some items have no price">*</span>}</td>
            <td><span className={`status-badge status-${order.delivery_status}`}><i />{statusLabels[order.delivery_status]}</span>{order.reported_delivery_status && <span className="reported-status">Reported: {order.reported_delivery_status}</span>}</td>
            <td><button className="icon-button row-open" title={`Open ${order.order_id}`} aria-label={`Open ${order.order_id}`} onClick={() => setSelected(order.order_id)}><ArrowUpRight size={16} /></button></td>
          </tr>)}</tbody>
        </table>
        {!tableLoading && !orders?.data.length && <div className="table-empty"><PackageOpen size={28} /><h3>No orders found</h3><p>No records match these filters.</p></div>}
        {tableLoading && !orders && <div className="table-empty"><LoadingSpinner label="Loading orders" /></div>}
      </div>
      <div className="table-footer"><span>{start}-{end} of {pagination?.total || 0} orders</span>
        <div className="pagination"><label className="rows-per-page">Rows <select aria-label="Rows per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={8}>8</option><option value={15}>15</option><option value={30}>30</option></select></label>
          <span>Page {page} of {Math.max(1, pagination?.total_pages || 0)}</span>
          <button className="icon-button" aria-label="Previous page" title="Previous page" disabled={page <= 1 || tableLoading} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button>
          <button className="icon-button" aria-label="Next page" title="Next page" disabled={!pagination || page >= pagination.total_pages || tableLoading} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button>
        </div>
      </div>
    </>}
    {selected && <OrderDetail key={`${selected}-${filters.currency}`} orderId={selected} currency={filters.currency} onClose={() => setSelected(null)} />}
  </section>;
}
