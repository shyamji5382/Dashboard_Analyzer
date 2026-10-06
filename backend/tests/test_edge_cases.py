from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient

from app.database.db import Database
from app.main import create_app
from app.routes import ingest
from app.services import currency_service
from app.services.country_service import CountryService, CountrySourceError
from app.services.country_transform import normalize_countries
from app.services.currency_service import CurrencyService


DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("DELIVERY_SLA_DAYS", raising=False)
    with TestClient(create_app(tmp_path / "edge.db", seed=False)) as instance:
        for kind, filename in (("json", "Orders.json"), ("csv", "Products.csv"), ("xml", "Shipments.xml")):
            assert instance.post(f"/ingest/{kind}", content=(DATA_DIR / filename).read_bytes()).status_code == 200
        instance.app.state.countries.replace(normalize_countries([
            {"cca3": "AAA", "name": {"common": "Alpha"}, "population": 0, "area": 0},
            {"cca3": "BBB", "name": {"common": "Beta"}, "population": None, "area": 20},
        ]), "test", "https://example.com")
        yield instance


def order(order_id="EDGE", **changes):
    return {"order_id": order_id, "order_date": "2024-01-01", "currency": "USD",
            "customer": {"name": "Edge customer"},
            "items": [{"product_id": "P101", "quantity": 1, "price": "10"}], **changes}


def snapshot(client):
    return {path: client.get(path).json() for path in
            ("/analytics/summary", "/analytics/orders", "/analytics/filters")}


@pytest.mark.parametrize("path", ["/analytics/orders", "/analytics/countries"])
@pytest.mark.parametrize("page_size", [1, 100])
def test_huge_out_of_range_page_is_empty_not_server_error(client, path, page_size):
    page = 10 ** 30
    for search in ("", "not-a-record"):
        response = client.get(path, params={"page": page, "page_size": page_size, "search": search})
        assert response.status_code == 200
        result = response.json()
        assert result["data"] == []
        assert result["pagination"] == {"page": page, "page_size": page_size,
                                        "total": 0 if search else 2, "total_pages": 0 if search else (2 if page_size == 1 else 1)}


@pytest.mark.parametrize("start", ["9999-12-31", "9999-12-29"])
def test_maximum_date_range_does_not_overflow(client, start):
    response = client.get("/analytics/summary", params={"start_date": start, "end_date": "9999-12-31"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["metrics"]["total_orders"] == 0
    assert data["revenue_trend"][-1] == {"date": "9999-12-31", "revenue": 0, "orders": 0}
    assert len(data["revenue_trend"]) == (1 if start.endswith("31") else 3)


def test_maximum_order_date_and_leap_day_gap_filling(client):
    assert client.post("/ingest/json", json=[order(order_date="9999-12-31")]).status_code == 200
    response = client.get("/analytics/summary")
    assert response.status_code == 200
    assert response.json()["data"]["revenue_trend"] == [{"date": "9999-12-31", "revenue": 10, "orders": 1}]
    response = client.get("/analytics/summary?start_date=2024-02-28&end_date=2024-03-01")
    assert [row["date"] for row in response.json()["data"]["revenue_trend"]] == ["2024-02-28", "2024-02-29", "2024-03-01"]


@pytest.mark.parametrize("kind,content", [
    ("json", b"\xff"), ("json", b"null"), ("json", b'{"orders": {}}'),
    ("csv", b'product_id,name\nP1,"unterminated'),
    ("csv", b"product_id,name\nP1,One,unexpected\n"),
    ("xml", b"<orders />"),
    ("xml", b"<shipment><order_id>1001</order_id><actual_delivery>2024-02-30</actual_delivery></shipment>"),
])
def test_new_invalid_import_forms_preserve_all_commerce_data(client, kind, content):
    before = snapshot(client)
    response = client.post(f"/ingest/{kind}", content=content)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_dataset"
    assert snapshot(client) == before


@pytest.mark.parametrize("changes", [
    {"order_id": True}, {"order_id": "x" * 121}, {"customer": ["not-an-object"]},
    {"items": [{"product_id": "P101", "quantity": True, "price": 1}]},
    {"items": [{"product_id": "P101", "quantity": 1000001, "price": 1}]},
    {"items": [{"product_id": "P101", "quantity": 1, "price": "Infinity"}]},
    {"order_date": "2023-02-29"},
])
def test_invalid_order_boundaries_reject_without_replacing_dataset(client, changes):
    before = snapshot(client)
    assert client.post("/ingest/json", json=[order(**changes)]).status_code == 422
    assert snapshot(client) == before


def test_multipart_missing_field_and_oversized_file_preserve_data(client):
    before = snapshot(client)
    assert client.post("/ingest/json", files={"wrong": ("orders.json", b"[]")}).status_code == 422
    response = client.post("/ingest/csv", files={"file": ("large.csv", b"x" * (ingest.MAX_BYTES + 1))})
    assert response.status_code == 413
    assert snapshot(client) == before


def test_partial_items_and_numeric_ids_keep_only_valid_values(client):
    payload = [order(7, customer={"name": "Ren\u00e9e"}, items=[
        {"product_id": "P101", "quantity": "2e0", "price": "0.005"},
        {"product_id": "P102", "quantity": 0, "price": 100},
    ]), order("007", items=[{"product_id": "P103", "quantity": 1, "price": 0}]), False]
    response = client.post("/ingest/json", json=payload)
    assert response.status_code == 200
    report = response.json()["data"]
    assert (report["imported"], report["item_count"], report["skipped"]) == (2, 2, 1)
    assert any("skipped item" in warning for warning in report["warnings"])
    detail = client.get("/analytics/orders/7").json()["data"]
    assert detail["customer_name"] == "Ren\u00e9e"
    assert detail["total_value"] == 0.01 and detail["items"][0]["quantity"] == 2
    assert client.get("/analytics/orders/007").json()["data"]["total_value"] == 0
    assert client.get("/analytics/summary").json()["data"]["metrics"]["total_orders"] == 2


def test_csv_bom_multiline_field_and_zero_catalog_price(client):
    content = b'\xef\xbb\xbfproduct_id,name,category,price\r\nP101,"Laptop,\r\nPro",Electronics,0\r\nP102,Phone\r\n'
    report = client.post("/ingest/csv", content=content).json()["data"]
    assert report["imported"] == 2 and report["skipped"] == 0
    assert client.post("/ingest/json", json=[order(items=[{"product_id": "P101", "quantity": 2}])]).status_code == 200
    detail = client.get("/analytics/orders/EDGE").json()["data"]
    assert detail["items"][0]["name"] == "Laptop,\r\nPro"
    assert detail["items"][0]["unit_price"] == detail["total_value"] == 0
    assert detail["revenue_complete"] is True


def test_products_loaded_after_orders_resolve_missing_prices(client):
    assert client.post("/ingest/json", json=[order(items=[{"product_id": "LATER", "quantity": 2}])]).status_code == 200
    before = client.get("/analytics/summary").json()
    assert before["meta"]["data_quality"]["unmatched_products"] == before["meta"]["data_quality"]["unpriced_items"] == 1
    assert client.get("/analytics/orders/EDGE").json()["data"]["revenue_complete"] is False
    assert client.post("/ingest/csv", content="product_id,name,category,price\nLATER,Later product,Home,0.1").status_code == 200
    after = client.get("/analytics/summary").json()
    assert after["data"]["metrics"]["total_revenue"] == 0.2
    assert after["meta"]["data_quality"]["unmatched_products"] == after["meta"]["data_quality"]["unpriced_items"] == 0
    assert client.get("/analytics/orders/EDGE").json()["data"]["revenue_complete"] is True


def test_zero_duration_counts_as_completed_and_orphan_shipment_is_not_an_order(client):
    xml = """<shipments>
    <shipment><order_id>1001</order_id><status>On time</status><delivery_days>0</delivery_days></shipment>
    <shipment><order_id>1002</order_id><status>Delayed</status><delivery_days>7</delivery_days></shipment>
    <shipment><order_id>ORPHAN</order_id><status>Delayed</status><delivery_days>99</delivery_days></shipment>
    </shipments>"""
    assert client.post("/ingest/xml", content=xml).status_code == 200
    metrics = client.get("/analytics/summary").json()["data"]["metrics"]
    assert metrics["total_orders"] == 2 and metrics["on_time_rate"] == 50
    assert metrics["delayed_orders"] == metrics["on_time_orders"] == 1
    assert client.get("/analytics/summary?delivery_status=on_time").json()["data"]["metrics"]["on_time_rate"] == 100


def test_promised_dates_override_conflicting_status_and_duplicate_does_not_multiply(client):
    xml = """<shipments>
    <shipment><order_id>1001</order_id><expected_delivery_date>2024-01-04</expected_delivery_date><actual_delivery_date>2024-01-04</actual_delivery_date><status>Delayed</status></shipment>
    <shipment><order_id>1001</order_id><status>Delayed</status></shipment>
    <shipment><order_id>1002</order_id><expected_delivery>2024-01-04</expected_delivery><actual_delivery>2024-01-05</actual_delivery><status>On time</status></shipment>
    </shipments>"""
    response = client.post("/ingest/xml", content=xml)
    assert response.status_code == 200 and response.json()["data"]["skipped"] == 1
    assert client.get("/analytics/orders/1001").json()["data"]["delivery_status"] == "on_time"
    assert client.get("/analytics/orders/1002").json()["data"]["delayed"] is True
    metrics = client.get("/analytics/summary").json()["data"]["metrics"]
    assert metrics["total_revenue"] == 2800 and metrics["on_time_rate"] == 50


@pytest.mark.parametrize("search", ["' OR 1=1 --", "%_\\", 'quoted "customer"'])
def test_search_treats_special_characters_as_literal_text(client, search):
    assert client.get("/analytics/orders", params={"search": search}).json()["pagination"]["total"] == 0
    assert client.post("/ingest/json", json=[order(customer={"name": search})]).status_code == 200
    result = client.get("/analytics/orders", params={"search": search}).json()
    assert result["pagination"]["total"] == 1
    assert result["data"][0]["customer_name"] == search


@pytest.mark.parametrize("dataset,table", [("csv", "products"), ("json", "order_items")])
def test_storage_failure_rolls_back_deleted_records_and_import_metadata(client, dataset, table):
    before = snapshot(client)
    with client.app.state.database.connect() as connection:
        connection.execute(f"""CREATE TRIGGER fail_insert BEFORE INSERT ON {table}
            WHEN NEW.product_id='FAIL' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END""")
    response = (client.post("/ingest/csv", content="product_id,name\nFAIL,Fail") if dataset == "csv" else
                client.post("/ingest/json", json=[order(items=[{"product_id": "FAIL", "quantity": 1, "price": 10}])]))
    assert response.status_code == 503 and response.json()["error"]["code"] == "database_unavailable"
    assert snapshot(client) == before


def test_health_remains_responsive_during_worker_thread_import(client, monkeypatch):
    entered, release = Event(), Event()
    parser, filename = ingest.PARSERS["json"]

    def slow_parser(content):
        entered.set()
        if not release.wait(15):
            raise TimeoutError("test did not release parser")
        return parser(content)

    monkeypatch.setitem(ingest.PARSERS, "json", (slow_parser, filename))
    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(client.post, "/ingest/json", json=[order()])
        try:
            assert entered.wait(5)
            health = pool.submit(client.get, "/health").result(timeout=5)
            assert health.status_code == 200 and health.json()["status"] == "ok"
            assert not future.done()
        finally:
            release.set()
        assert future.result(timeout=5).status_code == 200


@pytest.mark.parametrize("age,expected_requests", [(timedelta(hours=24) - timedelta(microseconds=1), 0), (timedelta(hours=24), 1)])
def test_currency_cache_exact_expiry_boundary(tmp_path, monkeypatch, age, expected_requests):
    now = datetime(2026, 10, 7, tzinfo=timezone.utc)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    monkeypatch.setattr(currency_service, "datetime", FrozenDatetime)
    database = Database(tmp_path / "cache.db")
    database.initialize()
    with database.connect() as connection:
        connection.execute("INSERT INTO exchange_rates VALUES (?,?,?,?,?)", ("USD", "EUR", "0.8", "2026-10-06", (now - age).isoformat()))
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"base": "USD", "quote": "EUR", "rate": 0.9, "date": "2026-10-07"})

    service = CurrencyService(database, httpx.Client(transport=httpx.MockTransport(handler)))
    try:
        rate, meta = service.rate("USD", "EUR")
        assert float(rate) == (0.9 if expected_requests else 0.8)
        assert meta["stale"] is False and len(requests) == expected_requests
    finally:
        service.close()


def test_currency_timeout_uses_stale_cache_without_overwriting_it(tmp_path):
    database = Database(tmp_path / "timeout.db")
    database.initialize()
    with database.connect() as connection:
        connection.execute("INSERT INTO exchange_rates VALUES (?,?,?,?,?)", ("USD", "EUR", "0.8", "2026-10-01", (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()))

    def handler(request):
        raise httpx.ReadTimeout("simulated timeout", request=request)

    service = CurrencyService(database, httpx.Client(transport=httpx.MockTransport(handler)))
    try:
        rate, meta = service.rate("USD", "EUR")
        assert float(rate) == 0.8 and meta["stale"] is True
        with database.connect() as connection:
            assert connection.execute("SELECT rate FROM exchange_rates").fetchone()[0] == "0.8"
    finally:
        service.close()


@pytest.mark.parametrize("total", [True, 1.5, "1.5", 0])
def test_invalid_country_source_count_cannot_replace_existing_dataset(client, total):
    before = client.app.state.countries.list({})

    def handler(request):
        return httpx.Response(200, json={"success": True, "data": {
            "objects": [{"cca3": "AAA", "name": {"common": "Changed"}, "population": 99}],
            "meta": {"total": total},
        }})

    service = CountryService(client.app.state.database, httpx.Client(transport=httpx.MockTransport(handler)), api_key="test-secret")
    try:
        with pytest.raises(CountrySourceError):
            service.sync_api()
        assert client.app.state.countries.list({}) == before
    finally:
        service.close()
