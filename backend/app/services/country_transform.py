import json
from decimal import Decimal, InvalidOperation

from app.models.schemas import ParsedData
from app.services.validation import DataError, currency, identifier, text_value


def _number(value, field, integer=False):
    if value is None or value == "":
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise DataError(f"{field} must be a number") from None
    if not number.is_finite() or not 0 <= number <= 10000000000000:
        raise DataError(f"{field} must be finite and nonnegative")
    if integer and number != number.to_integral_value():
        raise DataError(f"{field} must be a whole number")
    return int(number) if integer else float(number)


def _url(value):
    return value if isinstance(value, str) and value.startswith("https://") else ""


def country_records(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        records = payload["data"].get("objects")
        if isinstance(records, list):
            return records
    raise DataError("Expected a REST Countries v3 array or v5 data.objects array")


def normalize_countries(payload) -> ParsedData:
    if isinstance(payload, bytes):
        try:
            payload = json.loads(payload.decode("utf-8-sig"))
        except (ValueError, UnicodeError) as exc:
            raise DataError(f"Invalid country JSON: {exc}") from None
    rows = country_records(payload)
    result = ParsedData()
    seen = set()
    for index, row in enumerate(rows, 1):
        try:
            if not isinstance(row, dict):
                raise DataError("country must be an object")
            codes = row.get("codes") or {}
            names = row.get("names", row.get("name")) or {}
            if not isinstance(codes, dict) or not isinstance(names, dict):
                raise DataError("names and codes must be objects")
            code = identifier(row.get("cca3", codes.get("alpha_3")), "country code").upper()
            if len(code) != 3 or not code.isascii() or not code.isalpha():
                raise DataError("country code must contain three ASCII letters")
            if code in seen:
                raise DataError(f"duplicate country code {code}")
            name = identifier(names.get("common"), "country name")
            area = row.get("area")
            if isinstance(area, dict):
                area = area.get("kilometers")
            population = _number(row.get("population"), "population", True)
            area = _number(area, "area")
            if population is None:
                result.warnings.append(f"{code}: missing population; excluded from population totals")
            if area is None or area == 0:
                result.warnings.append(f"{code}: missing or zero area; density unavailable")
            raw_currencies = row.get("currencies") or {}
            if isinstance(raw_currencies, dict):
                raw_currencies = [{**value, "code": key} for key, value in raw_currencies.items() if isinstance(value, dict)]
            if not isinstance(raw_currencies, list):
                raise DataError("currencies must be an object or array")
            currencies = {}
            for entry in raw_currencies:
                if not isinstance(entry, dict):
                    raise DataError("currency must be an object")
                currency_code = currency(identifier(entry.get("code"), "currency code"))
                currencies[currency_code] = {"code": currency_code, "name": text_value(entry.get("name"), currency_code), "symbol": text_value(entry.get("symbol"))}
            raw_languages = row.get("languages") or {}
            if isinstance(raw_languages, dict):
                raw_languages = [{"code": key, "name": value} for key, value in raw_languages.items()]
            if not isinstance(raw_languages, list):
                raise DataError("languages must be an object or array")
            languages = {}
            for entry in raw_languages:
                if not isinstance(entry, dict):
                    raise DataError("language must be an object")
                language_code = identifier(entry.get("code") or entry.get("iso639_3") or entry.get("bcp47"), "language code").lower()
                languages[language_code] = {"code": language_code, "name": text_value(entry.get("name"), language_code)}
            raw_capitals = row.get("capitals", row.get("capital")) or []
            if not isinstance(raw_capitals, list):
                raise DataError("capitals must be an array")
            capitals = sorted({text_value(entry.get("name") if isinstance(entry, dict) else entry) for entry in raw_capitals} - {""})
            flags = row.get("flags") or row.get("flag") or {}
            if isinstance(flags, str):
                flags = {}
            maps = row.get("links", row.get("maps")) or {}
            if not isinstance(flags, dict) or not isinstance(maps, dict):
                raise DataError("flags and maps must be objects")
            borders = row.get("borders") or []
            if not isinstance(borders, list):
                raise DataError("borders must be an array")
            result.records.append({"code": code, "name": name,
                "official_name": text_value(names.get("official"), name), "region": text_value(row.get("region"), "Unknown"),
                "subregion": text_value(row.get("subregion")), "population": population, "area_km2": area,
                "flag_url": _url(flags.get("url_png", flags.get("png"))),
                "map_url": _url(maps.get("google_maps", maps.get("googleMaps"))),
                "currencies": list(currencies.values()), "languages": list(languages.values()),
                "capitals": capitals, "borders": sorted({str(value).strip().upper() for value in borders if isinstance(value, str) and len(value.strip()) == 3})})
            seen.add(code)
        except (DataError, TypeError, AttributeError) as exc:
            result.skipped += 1
            result.warnings.append(f"Country row {index}: {exc}; skipped country")
    if not result.records:
        raise DataError("No valid countries found" + (": " + "; ".join(result.warnings[:5]) if result.warnings else ""))
    return result
