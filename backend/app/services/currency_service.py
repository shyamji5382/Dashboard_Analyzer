from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import httpx

from app.database.db import Database


class CurrencyError(Exception):
    pass


class CurrencyService:
    def __init__(self, database: Database, client=None):
        self.database = database
        self.client = client or httpx.Client(timeout=8.0)

    def close(self):
        self.client.close()

    def rate(self, base: str, quote: str) -> tuple[Decimal, dict]:
        if base == quote:
            return Decimal("1"), {"base": base, "quote": quote, "rate": 1.0, "source": "identity", "stale": False}
        with self.database.connect() as connection:
            cached = connection.execute("SELECT * FROM exchange_rates WHERE base=? AND quote=?", (base, quote)).fetchone()
        now = datetime.now(timezone.utc)
        if cached and now - datetime.fromisoformat(cached["fetched_at"]) < timedelta(hours=24):
            return self._cached(cached, False)
        try:
            response = self.client.get(f"https://api.frankfurter.dev/v2/rate/{base.lower()}/{quote.lower()}")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("invalid rate response")
            rate = Decimal(str(payload["rate"]))
            if not rate.is_finite() or rate <= 0 or payload.get("base", "").upper() != base or payload.get("quote", "").upper() != quote:
                raise ValueError("invalid rate response")
            rate_date = date.fromisoformat(payload["date"]).isoformat()
            with self.database.connect() as connection:
                connection.execute("INSERT OR REPLACE INTO exchange_rates VALUES (?,?,?,?,?)",
                                   (base, quote, str(rate), rate_date, now.isoformat()))
            return rate, {"base": base, "quote": quote, "rate": float(rate), "date": rate_date,
                          "source": "Frankfurter", "stale": False}
        except (httpx.HTTPError, ValueError, KeyError, TypeError, InvalidOperation):
            if cached:
                return self._cached(cached, True)
            raise CurrencyError(f"Exchange rate {base}/{quote} is unavailable. Retry or select the order currency.") from None

    @staticmethod
    def _cached(row, stale: bool):
        return Decimal(row["rate"]), {"base": row["base"], "quote": row["quote"],
            "rate": float(row["rate"]), "date": row["rate_date"], "source": "Frankfurter cache", "stale": stale}
