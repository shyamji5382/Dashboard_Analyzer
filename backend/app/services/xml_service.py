from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from decimal import Decimal, InvalidOperation
from xml.etree.ElementTree import ParseError

from app.models.schemas import ParsedData
from app.services.validation import DataError, identifier, iso_date, text_value


def delivery_duration(value):
    if value is None or not value.strip():
        return None
    try:
        days = Decimal(value.strip())
    except InvalidOperation:
        raise DataError("delivery_days must be a whole number") from None
    if not days.is_finite() or days != days.to_integral_value() or not 0 <= days <= 1000000:
        raise DataError("delivery_days must be a nonnegative whole number up to 1000000")
    return int(days)


def parse_shipments(content: bytes) -> ParsedData:
    try:
        root = ElementTree.fromstring(content)
    except (ParseError, DefusedXmlException, ValueError) as exc:
        raise DataError(f"Invalid or unsafe XML: {exc}") from None
    # Strip namespaces through the XML parser, rather than editing raw XML text.
    for element in root.iter():
        element.tag = element.tag.rsplit("}", 1)[-1]
    if root.tag not in ("shipments", "shipment"):
        raise DataError("XML root must be <shipments> or <shipment>")
    rows = [root] if root.tag == "shipment" else root.findall("shipment")
    result = ParsedData()
    seen = set()
    for index, row in enumerate(rows, 1):
        try:
            order_id = identifier(row.findtext("order_id"), "order_id")
            if order_id in seen:
                raise DataError(f"duplicate shipment for order {order_id}")
            expected = iso_date(row.findtext("expected_delivery", row.findtext("expected_delivery_date")), "expected_delivery", True)
            actual = iso_date(row.findtext("actual_delivery", row.findtext("actual_delivery_date")), "actual_delivery", True)
            days = delivery_duration(row.findtext("delivery_days"))
            status = text_value(row.findtext("status"))
            if not expected and days is None and status.lower() not in ("delayed", "late", "on_time", "on time", "ontime"):
                result.warnings.append(f"Shipment {order_id}: missing expected delivery; delay status unknown")
            elif not expected and status.lower() in ("delivered", "completed"):
                result.warnings.append(f"Shipment {order_id}: Delivered confirms completion, not on-time arrival; no promised delivery date")
            result.records.append({"order_id": order_id, "expected_delivery": expected,
                                   "actual_delivery": actual,
                                   "carrier": text_value(row.findtext("carrier"), "Unknown carrier"),
                                   "tracking_number": text_value(row.findtext("tracking_number")),
                                   "shipment_id": text_value(row.findtext("shipment_id")),
                                   "delivery_days": days, "reported_status": status})
            seen.add(order_id)
        except DataError as exc:
            result.skipped += 1
            result.warnings.append(f"Shipment row {index}: {exc}; skipped shipment")
    if rows and not result.records:
        raise DataError("No valid shipments found: " + "; ".join(result.warnings[:5]))
    return result
