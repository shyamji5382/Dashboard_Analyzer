from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app.database.db import Database
from app.main import create_app
from app.services.country_service import CountryService, CountrySourceError
from app.services.country_transform import normalize_countries
from app.services.validation import DataError


def country(code, name, population, area, region="Europe"):
    return {"cca3": code, "name": {"common": name, "official": f"Republic of {name}"},
            "population": population, "area": area, "region": region,
            "currencies": {"EUR": {"name": "Euro", "symbol": "E"}},
            "languages": {"eng": "English"}, "capital": [f"{name} City"],
            "flags": {"png": "https://example.com/flag.png"},
            "maps": {"googleMaps": "https://example.com/map"}}


COUNTRIES = [country("AAA", "Alpha", "100", "10"), country("BBB", "Beta", 300, 100),
             country("CCC", "Gamma", None, 20, "Asia"), country("DDD", "Delta", 0, 0, "Asia")]
COUNTRIES[0]["currencies"]["USD"] = {"name": "US Dollar", "symbol": "$"}
COUNTRIES[0]["languages"]["fra"] = "French"
COUNTRIES[0]["borders"] = ["BBB", "ZZZ", "BBB"]


def v5(record):
    return {"codes": {"alpha_3": record["cca3"]}, "names": record["name"],
            "population": record["population"], "area": {"kilometers": record["area"]},
            "region": record["region"],
            "currencies": [{"code": code, **value} for code, value in record["currencies"].items()],
            "languages": [{"iso639_3": code, "name": name} for code, name in record["languages"].items()],
            "capitals": [{"name": name} for name in record["capital"]],
            "flag": {"url_png": record["flags"]["png"]},
            "links": {"google_maps": record["maps"]["googleMaps"]}, "borders": record.get("borders", [])}


def envelope(records, **extra):
    return {"success": True, "data": {"objects": records, **extra}}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "countries.db", seed=False)) as instance:
        instance.app.state.countries.replace(normalize_countries(COUNTRIES), "test", "https://example.com")
        yield instance


def test_v3_v5_normalize_equally():
    assert normalize_countries(COUNTRIES).records == normalize_countries(envelope([v5(row) for row in COUNTRIES])).records
    assert normalize_countries(COUNTRIES).records[0]["population"] == 100
    assert normalize_countries(COUNTRIES).records[0]["borders"] == ["BBB", "ZZZ"]


def test_v3_legacy_flag_string_does_not_hide_png_flags():
    record = deepcopy(COUNTRIES[0])
    record["flag"] = "legacy flag string"
    assert normalize_countries([record]).records[0]["flag_url"] == "https://example.com/flag.png"


@pytest.mark.parametrize("value", ["NaN", "Infinity", -1, 1.5, True, 10000000000001])
def test_bad_population_skips_only_invalid_country(value):
    bad = deepcopy(COUNTRIES[0]); bad["population"] = value
    result = normalize_countries([bad, COUNTRIES[1]])
    assert result.skipped == 1 and len(result.records) == 1
    assert result.warnings


def test_missing_nested_values_duplicates_and_safe_urls():
    row = {"cca3": "AAA", "name": {"common": "Alpha"}, "flags": {"png": "javascript:bad"}}
    parsed = normalize_countries([row, row, 42, {"cca3": "BAD"}])
    assert parsed.skipped == 3
    assert parsed.records[0]["population"] is None
    assert parsed.records[0]["currencies"] == parsed.records[0]["languages"] == []
    assert parsed.records[0]["flag_url"] == ""
    assert parsed.warnings
    for payload in ([], {}, b"{broken", envelope([])):
        with pytest.raises(DataError):
            normalize_countries(payload)


def test_normalized_aggregates_do_not_multiply_country_population(client):
    result = client.get("/analytics/countries/summary").json()
    metrics = result["data"]["metrics"]
    assert metrics == {"total_countries": 4, "total_population": 400, "total_area_km2": 130,
                       "population_density": pytest.approx(400 / 110), "missing_population": 1,
                       "missing_density": 2, "distinct_currencies": 2, "distinct_languages": 2}
    currencies = {row["code"]: row for row in result["data"]["currencies"]}
    assert currencies["EUR"]["countries"] == 4 and currencies["EUR"]["population"] == 400
    assert currencies["USD"]["countries"] == 1 and currencies["USD"]["population"] == 100
    assert result["meta"]["currency_population_totals_overlap"] is True
    assert [row["code"] for row in result["data"]["density_ranking"]] == ["AAA", "BBB"]
    # Shared catalog entries must preserve every country's relationships.
    assert all(row["currencies"] and row["languages"] for row in client.get("/analytics/countries").json()["data"])


@pytest.mark.parametrize("query,count,population", [
    ("region=europe", 2, 400), ("population_min=100&population_max=300", 2, 400),
    ("population_min=0&population_max=0", 1, 0), ("currency=USD", 1, 100),
    ("language=fra", 1, 100), ("region=Europe&currency=EUR&language=eng", 2, 400),
    ("search=Republic", 4, 400), ("search=bbb", 1, 300), ("search=%25", 0, 0),
])
def test_summary_table_filters_agree(client, query, count, population):
    summary = client.get(f"/analytics/countries/summary?{query}").json()["data"]["metrics"]
    table = client.get(f"/analytics/countries?{query}").json()
    assert summary["total_countries"] == table["pagination"]["total"] == count
    assert summary["total_population"] == population


def test_pagination_sort_options_and_country_drilldown(client):
    first = client.get("/analytics/countries?page_size=2").json()
    second = client.get("/analytics/countries?page_size=2&page=2").json()
    assert [row["code"] for row in first["data"]] == ["BBB", "AAA"]
    assert [row["code"] for row in second["data"]] == ["DDD", "CCC"]
    assert first["pagination"] == {"page": 1, "page_size": 2, "total": 4, "total_pages": 2}
    assert client.get("/analytics/countries?page=99").json()["data"] == []
    assert client.get("/analytics/countries?sort=density_desc").json()["data"][0]["code"] == "AAA"
    assert client.get("/analytics/countries?sort=name_asc").json()["data"][0]["name"] == "Alpha"
    detail = client.get("/analytics/countries/aaa").json()["data"]
    assert detail["density"] == 10
    assert detail["capitals"] == ["Alpha City"]
    assert detail["borders"][0]["name"] == "Beta"
    assert detail["borders"][1]["name"] is None
    assert client.get("/analytics/countries/XYZ").status_code == 404
    options = client.get("/analytics/countries/filters").json()["data"]
    assert options["regions"] == ["Asia", "Europe"]
    assert options["population_range"] == {"min": 0, "max": 300}


@pytest.mark.parametrize("query", ["page=0", "page_size=101", "sort=bad", "population_min=-1", "population_min=1.5", "population_min=100&population_max=10", "currency=eur"])
def test_invalid_country_parameters(client, query):
    response = client.get(f"/analytics/countries?{query}")
    assert response.status_code == 422 and "error" in response.json()


def test_key_requirement_is_structured_and_preserves_data(client):
    response = client.post("/ingest/countries")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "country_api_key_required"
    assert client.get("/analytics/countries").json()["pagination"]["total"] == 4


def test_snapshot_seed_is_complete_and_persistent(tmp_path):
    path = tmp_path / "seed.db"
    for _ in range(2):
        with TestClient(create_app(path)) as instance:
            summary = instance.get("/analytics/countries/summary").json()
            assert summary["data"]["metrics"]["total_countries"] == 250
            assert summary["meta"]["source"]["source"] == "repository_snapshot"
            assert "bfadee4f951682c29970e53677707bc558e80b74" in summary["meta"]["source"]["source_url"]
            assert instance.get("/analytics/countries/CAN").json()["data"]["currencies"][0]["code"] == "CAD"


def service_with_transport(tmp_path, handler, key="test-secret"):
    database = Database(tmp_path / "external.db"); database.initialize()
    service = CountryService(database, httpx.Client(transport=httpx.MockTransport(handler)), api_key=key)
    service.replace(normalize_countries(COUNTRIES), "test", "https://example.com")
    return service


def test_public_demo_preview_never_replaces_dataset(tmp_path):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=envelope([v5(COUNTRIES[0])], _demo="sample", meta={"total": 1}))
    service = service_with_transport(tmp_path, handler, key="")
    try:
        result = service.sync_api(preview=True)
        assert result["persisted"] is False and len(result["preview"]) == 1
        assert requests[0].headers["Authorization"] == "Bearer rc_live_demo"
        assert service.list({})["pagination"]["total"] == 4
        assert service.source()["source"] == "test"
        assert "api_key" not in service.source()
    finally:
        service.close()


def test_live_sync_collects_all_pages_before_atomic_replacement(tmp_path):
    offsets = []
    def handler(request):
        offset = int(request.url.params["offset"]); offsets.append(offset)
        assert request.headers["Authorization"] == "Bearer test-secret"
        assert "codes.alpha_3" in request.url.params["response_fields"]
        return httpx.Response(200, json=envelope([v5(row) for row in COUNTRIES[offset:offset + 2]], meta={"total": 4}))
    service = service_with_transport(tmp_path, handler)
    try:
        result = service.sync_api()
        assert result["imported"] == 4 and result["persisted"] is True
        assert offsets == [0, 2]
        assert service.source()["source"] == "live_api"
    finally:
        service.close()


@pytest.mark.parametrize("failure", ["http", "incomplete", "repeated", "demo", "malformed", "empty"])
def test_bad_live_source_preserves_previous_dataset(tmp_path, failure):
    def handler(request):
        if failure == "http": return httpx.Response(401)
        if failure == "demo": return httpx.Response(200, json=envelope([v5(COUNTRIES[0])], _demo=True))
        if failure == "malformed": return httpx.Response(200, json={"success": False, "data": None})
        if failure == "empty": return httpx.Response(200, json=envelope([], meta={"total": 0}))
        records = [] if failure == "incomplete" and request.url.params["offset"] != "0" else [v5(COUNTRIES[0])]
        return httpx.Response(200, json=envelope(records, meta={"total": 250}))
    service = service_with_transport(tmp_path, handler)
    try:
        with pytest.raises(CountrySourceError): service.sync_api()
        assert service.list({})["pagination"]["total"] == 4
        assert service.source()["source"] == "test"
    finally:
        service.close()
