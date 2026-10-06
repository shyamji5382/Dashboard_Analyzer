import csv
import json

from app.models.schemas import ParsedData
from app.services.validation import DataError, currency, identifier, iso_date, money, quantity, text_value


def parse_orders(content: bytes) -> ParsedData:
    export_warning = None
    try:
        text = content.decode("utf-8-sig")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as original_error:
            # Some spreadsheet exports encode individual JSON lines as CSV fields.
            lines, decoded = [], False
            for line in text.splitlines():
                if line.lstrip().startswith('"'):
                    cells = next(csv.reader([line], strict=True))
                    if len(cells) != 1:
                        raise original_error
                    decoded = decoded or cells[0] != line
                    line = cells[0]
                lines.append(line)
            if not decoded:
                raise original_error
            payload = json.loads("\n".join(lines))
            export_warning = "Decoded CSV-quoted JSON lines from the spreadsheet export"
    except (ValueError, UnicodeError, csv.Error) as exc:
        raise DataError(f"Invalid JSON: {exc}") from None
    rows = payload.get("orders") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise DataError('JSON must be an array of orders or an object with an "orders" array')
    result = ParsedData()
    if export_warning:
        result.warnings.append(export_warning)
    seen = set()
    for index, row in enumerate(rows, 1):
        try:
            if not isinstance(row, dict):
                raise DataError("order must be an object")
            order_id = identifier(row.get("order_id", row.get("id")), "order_id")
            if order_id in seen:
                raise DataError(f"duplicate order_id {order_id}")
            order_date = iso_date(row.get("order_date", row.get("date")), "order_date")
            order_currency = currency(row.get("currency"))
            customer = row.get("customer") or {}
            if not isinstance(customer, dict):
                raise DataError("customer must be an object")
            items = row.get("items")
            if not isinstance(items, list) or not items:
                raise DataError("items must be a nonempty array")
            normalized_items = []
            for item_index, item in enumerate(items, 1):
                try:
                    if not isinstance(item, dict):
                        raise DataError("item must be an object")
                    normalized_items.append({
                        "order_id": order_id,
                        "product_id": identifier(item.get("product_id"), "product_id"),
                        "quantity": quantity(item.get("quantity", item.get("qty", 1))),
                        "unit_price": money(item.get("unit_price", item.get("price")), "unit_price"),
                    })
                    if "quantity" not in item and "qty" not in item:
                        result.warnings.append(f"Order {order_id}, item {item_index}: missing quantity; used 1")
                except DataError as exc:
                    result.warnings.append(f"Order {order_id}, item {item_index}: {exc}; skipped item")
            if not normalized_items:
                raise DataError("order has no valid items")
            name = text_value(customer.get("name", row.get("customer_name")), "Unknown customer")
            if name == "Unknown customer":
                result.warnings.append(f"Order {order_id}: missing customer name")
            if not row.get("currency"):
                result.warnings.append(f"Order {order_id}: missing currency; used USD")
            result.records.append({"order_id": order_id, "order_date": order_date,
                                   "customer_name": name, "customer_email": text_value(customer.get("email")),
                                   "customer_id": text_value(customer.get("id", row.get("customer_id"))),
                                   "currency": order_currency})
            result.items.extend(normalized_items)
            seen.add(order_id)
        except DataError as exc:
            result.skipped += 1
            result.warnings.append(f"Order row {index}: {exc}; skipped order")
    if rows and not result.records:
        raise DataError("No valid orders found: " + "; ".join(result.warnings[:5]))
    return result
