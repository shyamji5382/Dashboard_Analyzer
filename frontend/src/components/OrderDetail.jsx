import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Package, Truck, X } from 'lucide-react';
import { api } from '../services/api';
import { formatDate, formatMoney, statusLabels } from '../services/format';
import LoadingSpinner from './LoadingSpinner';

function ProductThumbnail({ imageUrl, name }) {
  const [failed, setFailed] = useState(false);
  return imageUrl && !failed ? <img src={imageUrl} alt={name} onError={() => setFailed(true)} /> :
    <span className="product-placeholder"><Package size={20} /></span>;
}

export default function OrderDetail({ orderId, currency, onClose }) {
  const dialogRef = useRef(null);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dialogRef.current.showModal();
    const controller = new AbortController();
    api.detail(orderId, currency, controller.signal).then((result) => { if (!controller.signal.aborted) setOrder(result.data); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [orderId, currency]);
  return <dialog className="detail-dialog" ref={dialogRef} onCancel={onClose} onClick={(event) => { if (event.target === dialogRef.current) onClose(); }} aria-labelledby="detail-title">
    <div className="dialog-heading"><div><span className="eyebrow">ORDER DETAILS</span><h2 id="detail-title">{orderId}</h2></div>
      <button className="icon-button" onClick={onClose} aria-label="Close order details" title="Close"><X size={20} /></button></div>
    {loading ? <div className="dialog-loading"><LoadingSpinner label="Loading order" /></div> : error ? <div className="error-banner" role="alert"><AlertCircle size={18} />{error}</div> : order && <>
      <div className="order-detail-summary"><div><strong>{order.customer_name}</strong><span>{order.customer_id ? `Customer ${order.customer_id}` : order.customer_email || 'No email provided'}</span></div>
        <span className={`status-badge status-${order.delivery_status}`}><i />{statusLabels[order.delivery_status]}</span></div>
      <div className="detail-dates"><span>Placed <strong>{formatDate(order.order_date, { year: 'numeric' })}</strong></span>
        <span>Order currency <strong>{order.original_currency}</strong></span></div>
      <h3>Line items</h3>
      <div className="detail-items">{order.items.map((item, index) => <div key={`${item.product_id}-${index}`} className="detail-item">
        <ProductThumbnail imageUrl={item.image_url} name={item.name} />
        <div><strong>{item.name}</strong><span>{item.category} &middot; Qty {item.quantity}</span>
          <small>{item.unit_price !== null ? `${formatMoney(item.unit_price, item.original_currency)} each` : 'Price unavailable'}</small></div>
        <strong>{item.line_total !== null ? formatMoney(item.line_total, currency) : '--'}</strong>
      </div>)}</div>
      <div className="detail-total"><span>Total order value</span><strong>{formatMoney(order.total_value, currency)}</strong></div>
      {!order.revenue_complete && <p className="quality-note">Items without a known price are excluded from revenue.</p>}
      <h3><Truck size={16} />Shipment</h3>
      {(order.reported_delivery_status || order.delivery_days !== null) && <>
        <div className="shipment-detail"><div><span>Reported status</span><strong>{order.reported_delivery_status || 'Not provided'}</strong></div><div><span>Delivery duration</span><strong>{order.delivery_days !== null ? `${order.delivery_days} days` : 'Not provided'}</strong></div></div>
        <div className="detail-dates"><span>Shipment ID <strong>{order.shipment_id || 'Not provided'}</strong></span><span>Delivery timing <strong>{statusLabels[order.delivery_status]}</strong></span></div>
      </>}
      <div className="shipment-detail shipment-dates"><div><span>Expected date</span><strong>{formatDate(order.expected_delivery, { year: 'numeric' })}</strong></div><ArrowRight size={17} />
        <div><span>Actual date</span><strong>{order.actual_delivery ? formatDate(order.actual_delivery, { year: 'numeric' }) : order.reported_delivery_status || order.delivery_status === 'unknown' ? 'Not provided' : 'Awaiting delivery'}</strong></div></div>
      {order.reported_delivery_status.toLowerCase() === 'delivered' && order.delivery_status === 'unknown' && <p className="quality-note">No promised delivery date; on-time arrival is unknown.</p>}
      <div className="detail-dates"><span>Carrier <strong>{order.carrier || 'Not available'}</strong></span><span>Tracking <strong>{order.tracking_number || 'Not available'}</strong></span></div>
    </>}
  </dialog>;
}
