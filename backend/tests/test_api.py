import json
import sqlite3
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.database.db import Database
from app.main import create_app
from app.services.currency_service import CurrencyError, CurrencyService


class TestCurrencies:
    __test__ = False

    def __init__(self, database):
        pass

    def rate(self, base, quote):
        values = {"USD": Decimal("1"), "EUR": Decimal("2"), "GBP": Decimal("3")}
        if base not in values or quote not in values:
            raise CurrencyError("Unsupported test currency")
        rate = values[base] / values[quote]
        return rate, {"base": base, "quote": quote, "rate": float(rate), "source": "test", "stale": False}

    def close(self):
        pass


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "test.db", seed=False, currency_factory=TestCurrencies)) as instance:
        yield instance


PRODUCTS = "product_id,name,category,price,currency\np1,Headphones,Electronics,10,USD\np2,Planter,Home,30,USD\np3,Bottle,Outdoors,5,EUR\n"
ORDERS = {"orders": [
    {"order_id": "A", "order_date": "2026-07-01", "customer": {"name": "Alice"}, "currency": "usd", "items": [
        {"product_id": "p1", "quantity": "2", "unit_price": "10.00"}, {"product_id": "p2", "quantity": 1}]},
    {"order_id": "B", "order_date": "2026-07-02T10:00:00Z", "customer": {"name": "Bob"}, "currency": "EUR", "items": [
        {"product_id": "p3", "quantity": "2.0", "price": "5"}]},
    {"order_id": "C", "order_date": "2026-07-03", "items": [{"product_id": "missing", "quantity": 1}]},
]}
SHIPMENTS = """<shipments xmlns="urn:test">
<shipment><order_id>A</order_id><expected_delivery>2026-07-04</expected_delivery><actual_delivery>2026-07-04</actual_delivery></shipment>
<shipment><order_id>B</order_id><expected_delivery>2026-07-05</expected_delivery><actual_delivery>2026-07-07</actual_delivery></shipment>
</shipments>"""


def import_all(client):
    assert client.post("/ingest/csv", content=PRODUCTS, headers={"Content-Type": "text/csv"}).status_code == 200
    assert client.post("/ingest/json", json=ORDERS).status_code == 200
    assert client.post("/ingest/xml", content=SHIPMENTS, headers={"Content-Type": "text/xml"}).status_code == 200


def test_empty_database(client):
    assert client.get("/health").json()["status"] == "ok"
    response = client.get("/analytics/summary").json()["data"]
    assert response["metrics"]["total_orders"] == 0
    assert response["metrics"]["total_revenue"] == 0
    assert client.get("/analytics/orders").json()["pagination"]["total_pages"] == 0


def test_flatten_join_convert_and_aggregate(client):
    import_all(client)
    response = client.get("/analytics/summary").json()
    metrics = response["data"]["metrics"]
    assert metrics["total_orders"] == 3
    assert metrics["total_revenue"] == 70
    assert metrics["average_order_value"] == 23.33
    assert metrics["delayed_orders"] == 1
    assert metrics["on_time_orders"] == 1
    assert metrics["unknown_orders"] == 1
    assert metrics["on_time_rate"] == 50
    assert response["meta"]["data_quality"] == {"unmatched_products": 1, "unpriced_items": 1, "unknown_delivery_orders": 1}
    categories = {row["category"]: row["revenue"] for row in response["data"]["category_revenue"]}
    assert categories == {"Home": 30, "Electronics": 20, "Outdoors": 20, "Uncategorized": 0}
    assert sum(row["revenue"] for row in response["data"]["revenue_trend"]) == 70
    assert sum(row["count"] for row in response["data"]["delivery_performance"]) == 3
    detail = client.get("/analytics/orders/A").json()["data"]
    assert detail["total_value"] == 50
    assert len(detail["items"]) == 2
    assert detail["items"][1]["line_total"] == 30
    assert client.get("/analytics/summary?currency=EUR").json()["data"]["metrics"]["total_revenue"] == 35


@pytest.mark.parametrize("query,count,revenue", [
    ("category=Electronics", 1, 20), ("delivery_status=delayed", 1, 20),
    ("start_date=2026-07-02&end_date=2026-07-02", 1, 20),
    ("category=Home&delivery_status=delayed", 0, 0), ("search=alice", 1, 50),
    ("category=Uncategorized", 1, 0), ("search=%25", 0, 0),
])
def test_consistent_filters(client, query, count, revenue):
    import_all(client)
    summary = client.get(f"/analytics/summary?{query}").json()["data"]
    orders = client.get(f"/analytics/orders?{query}").json()
    assert summary["metrics"]["total_orders"] == orders["pagination"]["total"] == count
    assert summary["metrics"]["total_revenue"] == revenue
    assert sum(order["total_value"] for order in orders["data"]) == revenue


def test_sql_pagination_and_detail(client):
    import_all(client)
    first = client.get("/analytics/orders?page=1&page_size=2").json()
    second = client.get("/analytics/orders?page=2&page_size=2").json()
    assert [row["order_id"] for row in first["data"]] == ["C", "B"]
    assert [row["order_id"] for row in second["data"]] == ["A"]
    assert first["pagination"] == {"page": 1, "page_size": 2, "total": 3, "total_pages": 2}
    assert client.get("/analytics/orders?page=100").json()["data"] == []
    assert client.get("/analytics/orders/missing").status_code == 404
    assert client.get("/analytics/filters").json()["data"]["dataset_counts"] == {"orders": 3, "products": 3, "shipments": 2}


@pytest.mark.parametrize("path", ["/analytics/orders?page=0", "/analytics/orders?page_size=101", "/analytics/summary?currency=usd", "/analytics/summary?start_date=garbage", "/analytics/summary?delivery_status=bad", "/analytics/summary?start_date=2026-07-10&end_date=2026-07-01"])
def test_invalid_parameters(client, path):
    response = client.get(path)
    assert response.status_code == 422
    assert "error" in response.json()


def test_import_is_idempotent_and_atomic(client):
    import_all(client)
    import_all(client)
    assert client.get("/analytics/orders/A").json()["data"]["total_value"] == 50
    response = client.post("/ingest/json", content=b"{broken")
    assert response.status_code == 422
    assert client.get("/analytics/summary").json()["data"]["metrics"]["total_orders"] == 3
    assert client.post("/ingest/json", json={"orders": [{"order_id": "X", "order_date": "invalid", "items": []}]}).status_code == 422
    assert client.get("/analytics/summary").json()["data"]["metrics"]["total_orders"] == 3


def test_bad_rows_duplicates_and_type_conversions(client):
    payload = {"orders": [ORDERS["orders"][0], ORDERS["orders"][0],
        {"order_id": "bad", "order_date": "2026-07-01", "items": [{"product_id": "p1", "quantity": 1.5}]},
        {"order_id": "D", "order_date": "2026-07-01", "items": [{"product_id": "p1", "unit_price": "NaN"}, {"product_id": "p2", "unit_price": "0.1", "quantity": 3}]}]}
    report = client.post("/ingest/json", json=payload).json()["data"]
    assert report["imported"] == 2
    assert report["skipped"] == 2
    assert report["item_count"] == 3
    assert report["warnings"]
    assert client.get("/analytics/orders/D").json()["data"]["total_value"] == 0.3


def test_multipart_and_empty_dataset(client):
    import_all(client)
    response = client.post("/ingest/json", files={"file": ("orders.json", json.dumps(ORDERS).encode(), "application/json")})
    assert response.status_code == 200
    assert client.post("/ingest/json", json=[]).status_code == 200
    assert client.get("/analytics/summary").json()["data"]["metrics"]["total_orders"] == 0


def test_shipment_pending_overdue_and_missing_expected(client):
    import_all(client)
    xml = """<shipments>
    <shipment><order_id>A</order_id><expected_delivery>2099-01-01</expected_delivery></shipment>
    <shipment><order_id>B</order_id><expected_delivery>2000-01-01</expected_delivery></shipment>
    <shipment><order_id>C</order_id><actual_delivery>2026-07-03</actual_delivery></shipment>
    </shipments>"""
    assert client.post("/ingest/xml", content=xml).status_code == 200
    metrics = client.get("/analytics/summary").json()["data"]["metrics"]
    assert metrics["pending_orders"] == 1
    assert metrics["delayed_orders"] == 1
    assert metrics["unknown_orders"] == 1


def test_xml_entities_rejected_and_previous_data_preserved(client):
    import_all(client)
    xml = '<!DOCTYPE shipments [<!ENTITY x "EXPLOIT">]><shipments><shipment><order_id>&x;</order_id></shipment></shipments>'
    assert client.post("/ingest/xml", content=xml).status_code == 422
    assert client.post("/ingest/xml", content="<shipments>").status_code == 422
    assert client.get("/analytics/summary").json()["data"]["metrics"]["on_time_orders"] == 1


def test_csv_missing_values_duplicate_and_invalid_price(client):
    csv = "product_id,name,category,price\np1,One,,10\np1,Duplicate,Home,20\np2,Two,Home,-1\n"
    report = client.post("/ingest/csv", content=csv).json()["data"]
    assert report["imported"] == 1
    assert report["skipped"] == 2
    assert len(report["warnings"]) == 3
    assert client.post("/ingest/csv", content="name,price\nBad,10").status_code == 422


def test_cross_currency_catalog_fallback(client):
    client.post("/ingest/csv", content=PRODUCTS)
    client.post("/ingest/json", json=[{"order_id": "X", "date": "2026-07-01", "currency": "USD", "items": [{"product_id": "p3", "quantity": 2}]}])
    result = client.get("/analytics/orders/X").json()["data"]
    assert result["total_value"] == 20
    assert result["items"][0]["original_currency"] == "EUR"


def test_import_size_limit(client):
    assert client.post("/ingest/csv", content=b"x" * (5 * 1024 * 1024 + 1)).status_code == 413


def test_assignment_seed_once_and_persistence(tmp_path):
    path = tmp_path / "persistent.db"
    with TestClient(create_app(path, currency_factory=TestCurrencies)) as client:
        assert client.get("/analytics/summary").json()["data"]["metrics"]["total_orders"] == 2
        client.post("/ingest/json", json=[])
    with TestClient(create_app(path, currency_factory=TestCurrencies)) as client:
        assert client.get("/analytics/summary").json()["data"]["metrics"]["total_orders"] == 0


def test_rate_api_cache_and_stale_fallback(tmp_path):
    database = Database(tmp_path / "fx.db")
    database.initialize()
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"base": "EUR", "quote": "USD", "rate": 1.25, "date": "2026-07-01"})
    service = CurrencyService(database, httpx.Client(transport=httpx.MockTransport(handler)))
    assert service.rate("EUR", "USD")[0] == Decimal("1.25")
    assert service.rate("EUR", "USD")[0] == Decimal("1.25")
    assert len(requests) == 1
    assert service.rate("USD", "USD")[0] == 1
    with database.connect() as connection:
        connection.execute("UPDATE exchange_rates SET fetched_at=?", ((datetime.now(timezone.utc) - timedelta(days=2)).isoformat(),))
    service.close()
    offline = CurrencyService(database, httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))))
    value, metadata = offline.rate("EUR", "USD")
    assert value == Decimal("1.25") and metadata["stale"] is True
    with pytest.raises(CurrencyError):
        offline.rate("GBP", "USD")
    offline.close()


def test_currency_failure_is_structured(client):
    import_all(client)
    result = client.get("/analytics/summary?currency=ZZZ")
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "exchange_rate_unavailable"


@pytest.mark.parametrize("payload", [[], {"rate": "NaN", "base": "EUR", "quote": "USD", "date": "2026-07-01"},
    {"rate": 1.2, "base": "EUR", "quote": "USD", "date": "invalid"},
    {"rate": 1.2, "base": "GBP", "quote": "USD", "date": "2026-07-01"}])
def test_malformed_exchange_rate_response(tmp_path, payload):
    database = Database(tmp_path / "malformed-fx.db")
    database.initialize()
    service = CurrencyService(database, httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))))
    with pytest.raises(CurrencyError):
        service.rate("EUR", "USD")
    service.close()


def test_unknown_api_route_uses_error_envelope(client):
    response = client.get("/missing-route")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "request_error"


ASSIGNMENT_DATA = Path(__file__).resolve().parents[1] / "data"


def import_assignment(client, originals=True):
    directory = ASSIGNMENT_DATA / "originals" if originals else ASSIGNMENT_DATA
    for kind, filename in (("json", "Orders.json"), ("csv", "Products.csv"), ("xml", "Shipments.xml")):
        response = client.post(f"/ingest/{kind}", files={"file": (filename, (directory / filename).read_bytes())})
        assert response.status_code == 200, response.json()
        assert response.json()["data"]["skipped"] == 0


def test_original_assignment_uploads_join_without_losing_quantities_or_identifiers(client):
    import_assignment(client)
    metrics = client.get("/analytics/summary").json()["data"]["metrics"]
    assert metrics["total_orders"] == 2 and metrics["total_revenue"] == 2800
    assert metrics["average_order_value"] == 1400
    first = client.get("/analytics/orders/1001").json()["data"]
    second = client.get("/analytics/orders/1002").json()["data"]
    assert first["customer_name"] == "Rahul" and first["customer_id"] == "C001"
    assert first["total_value"] == 2200 and second["total_value"] == 600
    assert [(item["name"], item["quantity"], item["line_total"]) for item in first["items"]] == [("Laptop", 2, 1000), ("Phone", 1, 1200)]
    assert second["items"][0]["name"] == "Chair" and second["items"][0]["quantity"] == 3
    assert first["shipment_id"] == "S001" and first["delivery_days"] == 3
    assert first["reported_delivery_status"] == "Delivered"
    assert second["shipment_id"] == "S002" and second["reported_delivery_status"] == "Delayed"
    assert first["expected_delivery"] is None and first["actual_delivery"] is None
    reports = client.get("/analytics/filters").json()["data"]
    assert reports["dataset_counts"] == {"orders": 2, "products": 3, "shipments": 2}
    warnings = [warning for report in reports["imports"] for warning in report["warnings"]]
    assert any("CSV-quoted JSON" in warning for warning in warnings)
    assert any("single spreadsheet cells" in warning for warning in warnings)
    assert not any("missing quantity" in warning for warning in warnings)


def test_assignment_status_only_rule_keeps_delivered_timing_unknown(client):
    client.app.state.analytics.delivery_sla_days = None
    import_assignment(client)
    response = client.get("/analytics/summary").json()
    metrics = response["data"]["metrics"]
    assert metrics["delayed_orders"] == metrics["unknown_orders"] == 1
    assert metrics["on_time_orders"] == 0
    assert response["meta"]["delivery_sla_days"] is None
    assert client.get("/analytics/orders/1001").json()["data"]["delayed"] is False
    assert client.get("/analytics/orders/1001").json()["data"]["delivery_status"] == "unknown"
    assert client.get("/analytics/orders/1002").json()["data"]["delayed"] is True
    categories = {row["category"]: row["revenue"] for row in response["data"]["category_revenue"]}
    assert categories == {"Electronics": 2200, "Furniture": 600}
    assert response["meta"]["data_quality"] == {"unmatched_products": 0, "unpriced_items": 0, "unknown_delivery_orders": 1}


@pytest.mark.parametrize("query,count,revenue", [("category=Electronics", 1, 2200), ("category=Furniture", 1, 600),
    ("delivery_status=delayed", 1, 600), ("delivery_status=unknown", 1, 2200),
    ("start_date=2024-01-01&end_date=2024-01-01", 1, 2200), ("search=anita", 1, 600)])
def test_assignment_summary_filters_and_paginated_orders_agree(client, query, count, revenue):
    client.app.state.analytics.delivery_sla_days = None
    import_assignment(client)
    result = client.get(f"/analytics/orders?{query}&page_size=1").json()
    metrics = client.get(f"/analytics/summary?{query}").json()["data"]["metrics"]
    assert result["pagination"]["total"] == metrics["total_orders"] == count
    assert metrics["total_revenue"] == revenue
    assert sum(order["total_value"] for order in result["data"]) == revenue


def test_assignment_canonical_files_match_original_exports(client):
    import_assignment(client)
    original = client.get("/analytics/summary").json()["data"]
    import_assignment(client, originals=False)
    assert client.get("/analytics/summary").json()["data"] == original
    assert client.get("/analytics/orders?page_size=1&page=2").json()["data"][0]["order_id"] == "1001"


@pytest.mark.parametrize("value", ["-1", "1.5", "NaN", "Infinity", "bad"])
def test_invalid_shipment_duration_is_rejected_atomically(client, value):
    import_assignment(client)
    response = client.post("/ingest/xml", content=f"<shipments><shipment><order_id>1001</order_id><delivery_days>{value}</delivery_days></shipment></shipments>")
    assert response.status_code == 422
    assert client.get("/analytics/orders/1001").json()["data"]["delivery_days"] == 3


def test_csv_aliases_preserve_normal_quoted_fields_and_reject_duplicate_headers(client):
    response = client.post("/ingest/csv", content='ProductID,ProductName,Category\nP101,"Laptop, Pro",Electronics\n')
    assert response.status_code == 200
    client.post("/ingest/json", json={"orders": [{"id": "A", "date": "2024-01-01", "items": [{"product_id": "P101", "qty": 2, "price": 500}]}]})
    assert client.get("/analytics/orders/A").json()["data"]["items"][0]["name"] == "Laptop, Pro"
    assert client.post("/ingest/csv", content="ProductID,product_id,ProductName\nP1,P2,One").status_code == 422


def test_quantity_alias_precedence_and_validation(client):
    client.post("/ingest/json", json=[{"id": "A", "date": "2024-01-01", "items": [{"product_id": "P101", "quantity": 2, "qty": 99, "price": 500}]}])
    assert client.get("/analytics/orders/A").json()["data"]["total_value"] == 1000
    response = client.post("/ingest/json", json=[{"id": "B", "date": "2024-01-01", "items": [{"product_id": "P101", "qty": 0, "price": 500}]}])
    assert response.status_code == 422
    assert client.get("/analytics/orders/A").json()["data"]["total_value"] == 1000


def test_additive_schema_migration_preserves_existing_records(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as connection:
        connection.executescript("""CREATE TABLE orders (order_id TEXT PRIMARY KEY, order_date TEXT NOT NULL,
            customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, currency TEXT NOT NULL);
            CREATE TABLE shipments (order_id TEXT PRIMARY KEY,expected_delivery TEXT,actual_delivery TEXT,
            carrier TEXT NOT NULL,tracking_number TEXT NOT NULL);
            INSERT INTO orders VALUES ('old','2024-01-01','Existing','','USD');
            INSERT INTO shipments VALUES ('old','2024-01-03','2024-01-04','DHL','track');""")
    database = Database(path)
    database.initialize(); database.initialize()
    with database.connect() as connection:
        assert connection.execute("SELECT customer_id FROM orders WHERE order_id='old'").fetchone()[0] == ""
        row = connection.execute("SELECT * FROM shipments WHERE order_id='old'").fetchone()
        assert row["carrier"] == "DHL" and row["actual_delivery"] == "2024-01-04"
        assert row["reported_status"] == "" and row["delivery_days"] is None


def test_duration_sla_is_disabled_by_default_and_can_be_explicitly_configured(tmp_path, monkeypatch):
    monkeypatch.delenv("DELIVERY_SLA_DAYS", raising=False)
    with TestClient(create_app(tmp_path / "status.db", currency_factory=TestCurrencies)) as instance:
        result = instance.get("/analytics/summary").json()
        assert result["meta"]["delivery_sla_days"] is None
        assert result["data"]["metrics"]["unknown_orders"] == 1
    monkeypatch.setenv("DELIVERY_SLA_DAYS", "5")
    with TestClient(create_app(tmp_path / "sla.db", currency_factory=TestCurrencies)) as instance:
        metrics = instance.get("/analytics/summary").json()["data"]["metrics"]
        assert metrics["on_time_orders"] == 1 and metrics["delayed_orders"] == 1
        assert metrics["on_time_rate"] == 50
