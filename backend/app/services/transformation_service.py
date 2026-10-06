from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from math import ceil
import os

from app.database.db import Database
from app.services.currency_service import CurrencyService


CENT = Decimal("0.01")
STATUSES = ("on_time", "delayed", "pending", "unknown")


def as_number(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


class AnalyticsService:
    def __init__(self, database: Database, currencies: CurrencyService):
        self.database = database
        self.currencies = currencies
        raw_sla = os.getenv("DELIVERY_SLA_DAYS", "").strip()
        try:
            self.delivery_sla_days = int(raw_sla) if raw_sla else None
            if self.delivery_sla_days is not None and not 0 <= self.delivery_sla_days <= 1000000:
                raise ValueError
        except ValueError:
            raise ValueError("DELIVERY_SLA_DAYS must be a nonnegative integer or empty for status-only classification") from None

    def _query(self, filters: dict) -> tuple[str, list]:
        conditions, values = [], [date.today().isoformat(), self.delivery_sla_days, self.delivery_sla_days]
        for key, operator in (("start_date", ">="), ("end_date", "<=")):
            if filters.get(key):
                conditions.append(f"o.order_date {operator} ?")
                values.append(str(filters[key]))
        if filters.get("category"):
            conditions.append("COALESCE(p.category, 'Uncategorized') = ?")
            values.append(filters["category"])
        if filters.get("delivery_status"):
            conditions.append("o.delivery_status = ?")
            values.append(filters["delivery_status"])
        if filters.get("search"):
            conditions.append("(instr(lower(o.order_id), lower(?)) > 0 OR instr(lower(o.customer_name), lower(?)) > 0)")
            values.extend([filters["search"], filters["search"]])
        if filters.get("order_id"):
            conditions.append("o.order_id = ?")
            values.append(filters["order_id"])
        where = " AND ".join(conditions) or "1=1"
        query = f"""
        WITH classified_orders AS (
            SELECT orders.*, s.expected_delivery, s.actual_delivery, s.carrier, s.tracking_number,
                s.shipment_id, s.delivery_days, s.reported_status,
                CASE
                    WHEN s.expected_delivery IS NOT NULL THEN CASE
                        WHEN COALESCE(s.actual_delivery, ?) > s.expected_delivery THEN 'delayed'
                        WHEN s.actual_delivery IS NOT NULL THEN 'on_time'
                        ELSE 'pending' END
                    WHEN lower(trim(s.reported_status)) IN ('delayed','late') THEN 'delayed'
                    WHEN s.delivery_days > ? THEN 'delayed'
                    WHEN lower(trim(s.reported_status)) IN ('on_time','on time','ontime') THEN 'on_time'
                    WHEN lower(trim(s.reported_status)) IN ('delivered','completed') AND s.delivery_days <= ? THEN 'on_time'
                    WHEN lower(trim(s.reported_status)) IN ('pending','in transit','in_transit','processing') THEN 'pending'
                    ELSE 'unknown'
                END AS delivery_status
            FROM orders LEFT JOIN shipments s ON orders.order_id = s.order_id
        )
        SELECT o.*, i.id AS item_id, i.product_id, i.quantity, i.unit_price AS item_price,
               p.name AS product_name, COALESCE(p.category, 'Uncategorized') AS category,
               p.unit_price AS product_price, p.currency AS product_currency, p.image_url
        FROM classified_orders o JOIN order_items i ON o.order_id = i.order_id
        LEFT JOIN products p ON p.product_id = i.product_id
        WHERE {where}
        """
        return query, values

    def _transform(self, rows: list, target: str) -> tuple[list[dict], list[dict], dict]:
        orders, rates = {}, {}
        quality = {"unmatched_products": 0, "unpriced_items": 0, "unknown_delivery_orders": 0}

        def convert(amount: Decimal, source: str):
            if source not in rates:
                rates[source] = self.currencies.rate(source, target)
            return (amount * rates[source][0]).quantize(CENT, rounding=ROUND_HALF_UP)

        for row in rows:
            order_id = row["order_id"]
            if order_id not in orders:
                orders[order_id] = {"order_id": order_id, "order_date": row["order_date"],
                    "customer_name": row["customer_name"], "customer_email": row["customer_email"],
                    "customer_id": row["customer_id"],
                    "original_currency": row["currency"], "currency": target,
                    "delivery_status": row["delivery_status"],
                    "delayed": row["delivery_status"] == "delayed",
                    "expected_delivery": row["expected_delivery"], "actual_delivery": row["actual_delivery"],
                    "carrier": row["carrier"], "tracking_number": row["tracking_number"],
                    "shipment_id": row["shipment_id"], "delivery_days": row["delivery_days"],
                    "reported_delivery_status": row["reported_status"] or "",
                    "total_value": Decimal("0"), "items": [], "revenue_complete": True}
                if row["delivery_status"] == "unknown":
                    quality["unknown_delivery_orders"] += 1
            order = orders[order_id]
            price = row["item_price"] if row["item_price"] is not None else row["product_price"]
            source = row["currency"] if row["item_price"] is not None else row["product_currency"]
            line_total = None if price is None else convert(Decimal(price) * row["quantity"], source)
            if row["product_name"] is None:
                quality["unmatched_products"] += 1
            if line_total is None:
                quality["unpriced_items"] += 1
                order["revenue_complete"] = False
            else:
                order["total_value"] += line_total
            order["items"].append({"product_id": row["product_id"],
                "name": row["product_name"] or f"Unknown product ({row['product_id']})",
                "category": row["category"], "quantity": row["quantity"],
                "unit_price": None if price is None else float(Decimal(price)),
                "original_currency": source or row["currency"],
                "line_total": line_total, "image_url": row["image_url"] or ""})
        return list(orders.values()), [info for _, info in rates.values()], quality

    @staticmethod
    def _serialize_order(order: dict) -> dict:
        return {**order, "total_value": as_number(order["total_value"]),
                "items": [{**item, "line_total": None if item["line_total"] is None else as_number(item["line_total"])}
                          for item in order["items"]]}

    def summary(self, filters: dict, target: str) -> dict:
        query, parameters = self._query(filters)
        with self.database.connect() as connection:
            rows = connection.execute(query + " ORDER BY o.order_date, o.order_id, i.id", parameters).fetchall()
        orders, rates, quality = self._transform(rows, target)
        total = sum((order["total_value"] for order in orders), Decimal("0"))
        delivery = {status: 0 for status in STATUSES}
        trends = defaultdict(lambda: {"revenue": Decimal("0"), "orders": 0})
        categories = defaultdict(lambda: {"revenue": Decimal("0"), "order_ids": set()})
        for order in orders:
            delivery[order["delivery_status"]] += 1
            trends[order["order_date"]]["revenue"] += order["total_value"]
            trends[order["order_date"]]["orders"] += 1
            for item in order["items"]:
                group = categories[item["category"]]
                group["revenue"] += item["line_total"] or Decimal("0")
                group["order_ids"].add(order["order_id"])
        start = str(filters.get("start_date") or (min(trends) if trends else ""))
        end = str(filters.get("end_date") or (max(trends) if trends else ""))
        if start and end and (date.fromisoformat(end) - date.fromisoformat(start)).days <= 366:
            current, last = date.fromisoformat(start), date.fromisoformat(end)
            for offset in range((last - current).days + 1):
                trends[(current + timedelta(days=offset)).isoformat()]
        eligible_deliveries = [order for order in orders if order["delivery_status"] in ("on_time", "delayed")
                               and (order["actual_delivery"] or order["delivery_days"] is not None)]
        on_time_deliveries = sum(1 for order in eligible_deliveries if order["delivery_status"] == "on_time")
        count = len(orders)
        return {"data": {
            "metrics": {"total_orders": count, "total_revenue": as_number(total),
                "delayed_orders": delivery["delayed"], "on_time_orders": delivery["on_time"],
                "pending_orders": delivery["pending"], "unknown_orders": delivery["unknown"],
                "average_order_value": as_number(total / count) if count else 0,
                "on_time_rate": round(100 * on_time_deliveries / len(eligible_deliveries), 1) if eligible_deliveries else None,
                "currency": target},
            "revenue_trend": [{"date": day, "revenue": as_number(value["revenue"]), "orders": value["orders"]}
                              for day, value in sorted(trends.items())],
            "category_revenue": [{"category": name, "revenue": as_number(value["revenue"]), "orders": len(value["order_ids"])}
                                 for name, value in sorted(categories.items(), key=lambda pair: pair[1]["revenue"], reverse=True)],
            "delivery_performance": [{"status": status, "count": value, "percentage": round(value / count * 100, 1) if count else 0}
                                     for status, value in delivery.items()],
            "period": {"start_date": start or None, "end_date": end or None}},
            "meta": {"currency": target, "exchange_rates": rates, "data_quality": quality, "filters": filters,
                     "delivery_sla_days": self.delivery_sla_days}}

    def orders(self, filters: dict, target: str, page: int, page_size: int) -> dict:
        query, parameters = self._query(filters)
        with self.database.connect() as connection:
            total = connection.execute(f"SELECT COUNT(DISTINCT order_id) FROM ({query})", parameters).fetchone()[0]
            offset = (page - 1) * page_size
            selected = connection.execute(
                f"SELECT order_id, order_date FROM ({query}) GROUP BY order_id ORDER BY order_date DESC, order_id DESC LIMIT ? OFFSET ?",
                [*parameters, page_size, offset]).fetchall() if offset < total else []
            ids = [row["order_id"] for row in selected]
            rows = connection.execute(query + f" AND o.order_id IN ({','.join('?' for _ in ids)}) ORDER BY o.order_date DESC, o.order_id DESC, i.id",
                                      [*parameters, *ids]).fetchall() if ids else []
        orders, rates, quality = self._transform(rows, target)
        return {"data": [self._serialize_order(order) for order in orders],
                "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": ceil(total / page_size)},
                "meta": {"currency": target, "exchange_rates": rates, "data_quality": quality,
                         "delivery_sla_days": self.delivery_sla_days}}

    def detail(self, order_id: str, target: str) -> dict | None:
        result = self.orders({"order_id": order_id}, target, 1, 1)
        return {"data": result["data"][0], "meta": result["meta"]} if result["data"] else None

    def options(self) -> dict:
        with self.database.connect() as connection:
            categories = [row[0] for row in connection.execute("SELECT DISTINCT COALESCE(p.category, 'Uncategorized') FROM order_items i LEFT JOIN products p ON i.product_id = p.product_id ORDER BY 1")]
            period = connection.execute("SELECT MIN(order_date), MAX(order_date), COUNT(*) FROM orders").fetchone()
            counts = {name: connection.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] for name in ("orders", "products", "shipments")}
        return {"data": {"categories": categories, "delivery_statuses": list(STATUSES),
                "currencies": ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "JPY"],
                "date_range": {"start_date": period[0], "end_date": period[1]},
                "dataset_counts": counts, "imports": self.database.import_status()}}
