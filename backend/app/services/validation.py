from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


class DataError(ValueError):
    pass


def identifier(value: Any, field: str) -> str:
    if value is None or isinstance(value, (dict, list, bool)):
        raise DataError(f"{field} is required")
    result = str(value).strip()
    if not result or len(result) > 120:
        raise DataError(f"{field} must contain 1-120 characters")
    return result


def money(value: Any, field: str) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        amount = Decimal(str(value).strip())
    except InvalidOperation:
        raise DataError(f"{field} must be a number") from None
    if not amount.is_finite() or amount < 0 or amount > Decimal("1000000000000"):
        raise DataError(f"{field} must be finite and between 0 and 1000000000000")
    return str(amount)


def quantity(value: Any) -> int:
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise DataError("quantity must be a positive integer") from None
    if not number.is_finite() or number != number.to_integral_value() or not 0 < number <= 1000000:
        raise DataError("quantity must be a positive integer up to 1000000")
    return int(number)


def iso_date(value: Any, field: str, optional: bool = False) -> str | None:
    if value is None or str(value).strip() == "":
        if optional:
            return None
        raise DataError(f"{field} is required")
    try:
        raw = str(value).strip()
        return (datetime.fromisoformat(raw.replace("Z", "+00:00")).date() if "T" in raw else date.fromisoformat(raw)).isoformat()
    except (ValueError, TypeError):
        raise DataError(f"{field} must be an ISO date (YYYY-MM-DD)") from None


def currency(value: Any) -> str:
    result = str(value or "USD").strip().upper()
    if len(result) != 3 or not result.isascii() or not result.isalpha():
        raise DataError("currency must be a three-letter code")
    return result


def text_value(value: Any, default: str = "") -> str:
    return str(value).strip() if value is not None and str(value).strip() else default
