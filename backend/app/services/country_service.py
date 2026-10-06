import json
import os
from datetime import datetime, timezone
from math import ceil
from pathlib import Path

import httpx

from app.database.db import Database
from app.services.country_transform import country_records, normalize_countries
from app.services.validation import DataError


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
API_URL = "https://api.restcountries.com/countries/v5"
FIELDS = "codes.alpha_3,names.common,names.official,region,subregion,population,area.kilometers,currencies,languages,flag.url_png,capitals.name,borders,links.google_maps"
DENSITY = "CASE WHEN c.population IS NOT NULL AND c.area_km2 > 0 THEN 1.0*c.population/c.area_km2 END"


class CountrySourceError(Exception):
    def __init__(self, message, code="country_source_unavailable", status=503):
        super().__init__(message)
        self.code, self.status = code, status


class CountryService:
    def __init__(self, database: Database, client=None, api_key=None):
        self.database = database
        self.client = client or httpx.Client(timeout=15.0, follow_redirects=False)
        self.api_key = (api_key if api_key is not None else os.getenv("REST_COUNTRIES_API_KEY", "")).strip()

    @property
    def configured(self):
        return bool(self.api_key and self.api_key != "rc_live_demo")

    def close(self):
        self.client.close()

    def source(self):
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM country_source WHERE id=1").fetchone()
        return {**(dict(row) if row else {"source": "empty", "imported": 0, "synced_at": None}),
                "warnings": json.loads(row["warnings"]) if row else [],
                "api_configured": self.configured, "api_url": API_URL}

    def load_snapshot(self):
        metadata = json.loads((DATA_DIR / "Countries.meta.json").read_text(encoding="utf-8"))
        return self.replace(normalize_countries((DATA_DIR / "Countries.json").read_bytes()), "repository_snapshot", metadata["source_url"])

    def replace(self, parsed, source, source_url):
        now = datetime.now(timezone.utc).isoformat()
        with self.database.connect() as connection:
            connection.execute("DELETE FROM countries")
            connection.execute("DELETE FROM country_currency_catalog")
            connection.execute("DELETE FROM country_language_catalog")
            for country in parsed.records:
                fields = ("code", "name", "official_name", "region", "subregion", "population", "area_km2", "flag_url", "map_url")
                connection.execute("INSERT INTO countries VALUES (?,?,?,?,?,?,?,?,?)", [country[key] for key in fields])
                for currency in country["currencies"]:
                    connection.execute("INSERT INTO country_currency_catalog VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,symbol=excluded.symbol", (currency["code"], currency["name"], currency["symbol"]))
                    connection.execute("INSERT INTO country_currencies VALUES (?,?)", (country["code"], currency["code"]))
                for language in country["languages"]:
                    connection.execute("INSERT INTO country_language_catalog VALUES (?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name", (language["code"], language["name"]))
                    connection.execute("INSERT INTO country_languages VALUES (?,?)", (country["code"], language["code"]))
                connection.executemany("INSERT INTO country_capitals VALUES (?,?)", [(country["code"], capital) for capital in country["capitals"]])
                connection.executemany("INSERT INTO country_borders VALUES (?,?)", [(country["code"], border) for border in country["borders"]])
            connection.execute("INSERT OR REPLACE INTO country_source VALUES (1,?,?,?,?,?,?)",
                (source, source_url, len(parsed.records), parsed.skipped, json.dumps(parsed.warnings), now))
        return {"imported": len(parsed.records), "skipped": parsed.skipped, "warnings": parsed.warnings,
                "source": source, "synced_at": now, "persisted": True}

    def sync_api(self, preview=False):
        if not preview and not self.configured:
            raise CountrySourceError("Full synchronization requires REST_COUNTRIES_API_KEY on the backend. The public demo only returns a sample country.", "country_api_key_required")
        all_records, fingerprints = [], set()
        offset = 0
        try:
            for _ in range(50):
                response = self.client.get(API_URL, headers={"Authorization": f"Bearer {self.api_key if self.configured else 'rc_live_demo'}"},
                    params={"limit": 100, "offset": offset, "response_fields": FIELDS})
                response.raise_for_status()
                payload = response.json()
                records = country_records(payload)
                data = payload.get("data", {}) if isinstance(payload, dict) else {}
                total = data.get("meta", {}).get("total")
                if total is not None:
                    count = int(total)
                    if isinstance(total, bool) or (isinstance(total, float) and total != count) or not 0 <= count <= 5000:
                        raise ValueError("invalid country count")
                    total = count
                if data.get("_demo"):
                    if not preview:
                        raise CountrySourceError("The provider returned demo data. The existing country dataset was preserved.", "country_api_demo_response")
                    parsed = normalize_countries(records)
                    return {"persisted": False, "source": "api_preview", "imported": 0,
                            "preview": parsed.records, "warnings": parsed.warnings, "source_url": API_URL}
                if preview:
                    parsed = normalize_countries(records)
                    return {"persisted": False, "source": "api_preview", "imported": 0,
                            "preview": parsed.records[:1], "warnings": parsed.warnings, "source_url": API_URL}
                if not records:
                    if total is not None and len(all_records) < total:
                        raise CountrySourceError("The provider returned an incomplete dataset; the previous dataset was preserved.")
                    break
                fingerprint = json.dumps(records, sort_keys=True)
                if fingerprint in fingerprints:
                    raise CountrySourceError("The provider repeated a page; the previous dataset was preserved.")
                fingerprints.add(fingerprint)
                all_records.extend(records)
                offset += len(records)
                if total is not None and offset > total:
                    raise ValueError("country records exceed the reported count")
                if (total is not None and offset == total) or (total is None and len(records) < 100):
                    break
            else:
                raise CountrySourceError("The provider exceeded the pagination limit; the previous dataset was preserved.")
            return self.replace(normalize_countries(all_records), "live_api", API_URL)
        except CountrySourceError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError, DataError):
            raise CountrySourceError("REST Countries could not be read. Check the connection and API key; existing country data remains available.") from None

    @staticmethod
    def _where(filters):
        clauses, params = [], []
        if filters.get("region"):
            clauses.append("c.region = ? COLLATE NOCASE"); params.append(filters["region"])
        for key, operator in (("population_min", ">="), ("population_max", "<=")):
            if filters.get(key) is not None:
                clauses.append(f"c.population {operator} ?"); params.append(filters[key])
        for key, table, column in (("currency", "country_currencies", "currency_code"), ("language", "country_languages", "language_code")):
            if filters.get(key):
                clauses.append(f"EXISTS (SELECT 1 FROM {table} rel WHERE rel.country_code=c.code AND rel.{column}=?)")
                params.append(filters[key])
        if filters.get("search"):
            clauses.append("(instr(lower(c.name),lower(?))>0 OR instr(lower(c.official_name),lower(?))>0 OR instr(lower(c.code),lower(?))>0)")
            params.extend([filters["search"]] * 3)
        return " AND ".join(clauses) or "1=1", params

    def _enrich(self, connection, rows):
        records = {row["code"]: {**dict(row), "currencies": [], "languages": [], "capitals": []} for row in rows}
        if not records:
            return []
        placeholders = ",".join("?" for _ in records)
        for relation, table, catalog, column, ordering in (
            ("currencies", "country_currencies", "country_currency_catalog", "currency_code", "cat.code"),
            ("languages", "country_languages", "country_language_catalog", "language_code", "cat.name"),
        ):
            for row in connection.execute(f"SELECT rel.country_code,cat.* FROM {table} rel JOIN {catalog} cat ON rel.{column}=cat.code WHERE rel.country_code IN ({placeholders}) ORDER BY {ordering}", list(records)):
                entry = dict(row)
                code = entry.pop("country_code")
                records[code][relation].append(entry)
        for row in connection.execute(f"SELECT country_code,name FROM country_capitals WHERE country_code IN ({placeholders}) ORDER BY name", list(records)):
            records[row["country_code"]]["capitals"].append(row["name"])
        return list(records.values())

    def list(self, filters, page=1, page_size=10, sort="population_desc"):
        where, params = self._where(filters)
        ordering = {"population_desc": "c.population DESC,c.name", "name_asc": "c.name COLLATE NOCASE", "density_desc": "density DESC,c.name", "area_desc": "c.area_km2 DESC,c.name"}[sort]
        with self.database.connect() as connection:
            total = connection.execute(f"SELECT COUNT(*) FROM countries c WHERE {where}", params).fetchone()[0]
            offset = (page - 1) * page_size
            rows = connection.execute(f"SELECT c.*, {DENSITY} AS density FROM countries c WHERE {where} ORDER BY {ordering} LIMIT ? OFFSET ?", [*params, page_size, offset]).fetchall() if offset < total else []
            records = self._enrich(connection, rows)
        return {"data": records, "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": ceil(total/page_size)}, "meta": {"source": self.source()}}

    def detail(self, code):
        with self.database.connect() as connection:
            rows = connection.execute(f"SELECT c.*, {DENSITY} AS density FROM countries c WHERE c.code=?", (code.upper(),)).fetchall()
            records = self._enrich(connection, rows)
            if not records:
                return None
            records[0]["borders"] = [dict(row) for row in connection.execute("SELECT b.neighbor_code AS code,n.name,n.flag_url FROM country_borders b LEFT JOIN countries n ON b.neighbor_code=n.code WHERE b.country_code=? ORDER BY COALESCE(n.name,b.neighbor_code)", (code.upper(),))]
        return {"data": records[0], "meta": {"source": self.source()}}

    def summary(self, filters):
        where, params = self._where(filters)
        density_aggregate = "SUM(CASE WHEN population IS NOT NULL AND area_km2>0 THEN population END)*1.0/NULLIF(SUM(CASE WHEN population IS NOT NULL AND area_km2>0 THEN area_km2 END),0)"
        with self.database.connect() as connection:
            metrics = dict(connection.execute(f"SELECT COUNT(*) AS total_countries,COALESCE(SUM(population),0) AS total_population,COALESCE(SUM(area_km2),0) AS total_area_km2,{density_aggregate} AS population_density,SUM(population IS NULL) AS missing_population,SUM(population IS NULL OR area_km2 IS NULL OR area_km2<=0) AS missing_density FROM countries c WHERE {where}", params).fetchone())
            regions = [dict(row) for row in connection.execute(f"SELECT region,COUNT(*) AS countries,COALESCE(SUM(population),0) AS population,COALESCE(SUM(area_km2),0) AS area_km2,{density_aggregate} AS density FROM countries c WHERE {where} GROUP BY region ORDER BY population DESC,region", params)]
            currency_groups = [dict(row) for row in connection.execute(f"SELECT cat.code,cat.name,COUNT(*) AS countries,COALESCE(SUM(c.population),0) AS population FROM countries c JOIN country_currencies rel ON rel.country_code=c.code JOIN country_currency_catalog cat ON cat.code=rel.currency_code WHERE {where} GROUP BY cat.code ORDER BY population DESC,cat.code", params)]
            metrics["distinct_currencies"] = len(currency_groups)
            metrics["distinct_languages"] = connection.execute(f"SELECT COUNT(DISTINCT rel.language_code) FROM countries c JOIN country_languages rel ON rel.country_code=c.code WHERE {where}", params).fetchone()[0]
            dense = [dict(row) for row in connection.execute(f"SELECT c.code,c.name,c.flag_url,c.population,c.area_km2,{DENSITY} AS density FROM countries c WHERE {where} AND c.population IS NOT NULL AND c.area_km2>0 ORDER BY density DESC,c.name LIMIT 8", params)]
        metrics["missing_population"] = metrics["missing_population"] or 0
        metrics["missing_density"] = metrics["missing_density"] or 0
        return {"data": {"metrics": metrics, "regions": regions, "currencies": currency_groups, "density_ranking": dense},
                "meta": {"filters": filters, "source": self.source(), "currency_population_totals_overlap": True}}

    def options(self):
        with self.database.connect() as connection:
            regions = [row[0] for row in connection.execute("SELECT DISTINCT region FROM countries ORDER BY region")]
            currencies = [dict(row) for row in connection.execute("SELECT code,name FROM country_currency_catalog ORDER BY code")]
            languages = [dict(row) for row in connection.execute("SELECT * FROM country_language_catalog ORDER BY name")]
            bounds = connection.execute("SELECT MIN(population),MAX(population) FROM countries").fetchone()
        return {"data": {"regions": regions, "currencies": currencies, "languages": languages,
                "population_range": {"min": bounds[0], "max": bounds[1]}, "source": self.source()}}
