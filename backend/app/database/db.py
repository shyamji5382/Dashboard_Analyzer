import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.models.schemas import ParsedData


SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY, order_date TEXT NOT NULL,
    customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, currency TEXT NOT NULL,
    customer_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price TEXT
);
CREATE TABLE IF NOT EXISTS products (
    product_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    unit_price TEXT, currency TEXT NOT NULL, image_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shipments (
    order_id TEXT PRIMARY KEY, expected_delivery TEXT, actual_delivery TEXT,
    carrier TEXT NOT NULL, tracking_number TEXT NOT NULL,
    shipment_id TEXT NOT NULL DEFAULT '', delivery_days INTEGER CHECK(delivery_days >= 0),
    reported_status TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS imports (
    dataset TEXT PRIMARY KEY, imported INTEGER NOT NULL, skipped INTEGER NOT NULL,
    item_count INTEGER NOT NULL, warnings TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exchange_rates (
    base TEXT NOT NULL, quote TEXT NOT NULL, rate TEXT NOT NULL,
    rate_date TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY(base, quote)
);
CREATE INDEX IF NOT EXISTS idx_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE TABLE IF NOT EXISTS countries (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, official_name TEXT NOT NULL,
    region TEXT NOT NULL, subregion TEXT NOT NULL, population INTEGER,
    area_km2 REAL, flag_url TEXT NOT NULL, map_url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS country_currency_catalog (code TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS country_currencies (
    country_code TEXT REFERENCES countries(code) ON DELETE CASCADE,
    currency_code TEXT REFERENCES country_currency_catalog(code), PRIMARY KEY(country_code,currency_code)
);
CREATE TABLE IF NOT EXISTS country_language_catalog (code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS country_languages (
    country_code TEXT REFERENCES countries(code) ON DELETE CASCADE,
    language_code TEXT REFERENCES country_language_catalog(code), PRIMARY KEY(country_code,language_code)
);
CREATE TABLE IF NOT EXISTS country_capitals (
    country_code TEXT REFERENCES countries(code) ON DELETE CASCADE,
    name TEXT NOT NULL, PRIMARY KEY(country_code,name)
);
CREATE TABLE IF NOT EXISTS country_borders (
    country_code TEXT REFERENCES countries(code) ON DELETE CASCADE,
    neighbor_code TEXT NOT NULL, PRIMARY KEY(country_code,neighbor_code)
);
CREATE TABLE IF NOT EXISTS country_source (
    id INTEGER PRIMARY KEY CHECK(id=1), source TEXT NOT NULL, source_url TEXT NOT NULL,
    imported INTEGER NOT NULL, skipped INTEGER NOT NULL, warnings TEXT NOT NULL, synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_country_region ON countries(region);
CREATE INDEX IF NOT EXISTS idx_country_population ON countries(population);
CREATE INDEX IF NOT EXISTS idx_country_currency ON country_currencies(currency_code);
CREATE INDEX IF NOT EXISTS idx_country_language ON country_languages(language_code);
"""


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)
            additions = {"orders": (("customer_id", "TEXT NOT NULL DEFAULT ''"),),
                         "shipments": (("shipment_id", "TEXT NOT NULL DEFAULT ''"),
                                       ("delivery_days", "INTEGER CHECK(delivery_days >= 0)"),
                                       ("reported_status", "TEXT NOT NULL DEFAULT ''"))}
            for table, definitions in additions.items():
                columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
                for name, declaration in definitions:
                    if name not in columns:
                        connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")

    def replace(self, dataset: str, parsed: ParsedData) -> dict:
        table = {"json": "orders", "csv": "products", "xml": "shipments"}[dataset]
        report = {"dataset": dataset, "imported": len(parsed.records), "skipped": parsed.skipped,
                  "item_count": len(parsed.items), "warnings": parsed.warnings,
                  "imported_at": datetime.now(timezone.utc).isoformat()}
        with self.connect() as connection:
            connection.execute(f"DELETE FROM {table}")
            if parsed.records:
                keys = list(parsed.records[0])
                columns = ",".join(keys)
                placeholders = ",".join("?" for _ in keys)
                connection.executemany(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                                       [[record[key] for key in keys] for record in parsed.records])
            if parsed.items:
                connection.executemany("INSERT INTO order_items (order_id,product_id,quantity,unit_price) VALUES (?,?,?,?)",
                    [(item["order_id"], item["product_id"], item["quantity"], item["unit_price"]) for item in parsed.items])
            connection.execute("INSERT OR REPLACE INTO imports VALUES (?,?,?,?,?,?)",
                (dataset, report["imported"], report["skipped"], report["item_count"], json.dumps(report["warnings"]), report["imported_at"]))
        return report

    def import_status(self) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM imports ORDER BY dataset").fetchall()
        return [{**dict(row), "warnings": json.loads(row["warnings"])} for row in rows]
