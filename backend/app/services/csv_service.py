import csv
import io

from app.models.schemas import ParsedData
from app.services.validation import DataError, currency, identifier, money, text_value


HEADER_ALIASES = {"productid": "product_id", "productname": "product_name", "name": "name",
                  "category": "category", "unitprice": "unit_price", "price": "price",
                  "currency": "currency", "imageurl": "image_url"}


def normalize_header(value):
    value = value.strip()
    return HEADER_ALIASES.get(value.lower().replace("_", "").replace(" ", ""), value)


def parse_products(content: bytes) -> ParsedData:
    try:
        text = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text), strict=True)
        warnings = []
        if reader.fieldnames and len(reader.fieldnames) == 1 and "," in reader.fieldnames[0]:
            # A single-column export can wrap every complete CSV row in quotes.
            wrapped = list(csv.reader(io.StringIO(text), strict=True))
            if any(len(row) != 1 for row in wrapped if row):
                raise DataError("Invalid single-column CSV export")
            text = "\n".join(row[0] for row in wrapped if row)
            reader = csv.DictReader(io.StringIO(text), strict=True)
            warnings.append("Decoded CSV rows wrapped as single spreadsheet cells")
        original_headers = reader.fieldnames or []
        headers = [normalize_header(header) for header in original_headers]
        if "product_id" not in headers:
            raise DataError("CSV requires a product_id column")
        if len(set(headers)) != len(headers):
            raise DataError("CSV contains duplicate or conflicting column names")
        if headers != original_headers:
            warnings.append("Normalized product CSV column names to the application schema")
        reader.fieldnames = headers
        result = ParsedData()
        result.warnings.extend(warnings)
        seen = set()
        for index, row in enumerate(reader, 2):
            try:
                if None in row:
                    raise DataError("row has more values than columns")
                product_id = identifier(row.get("product_id"), "product_id")
                if product_id in seen:
                    raise DataError(f"duplicate product_id {product_id}")
                category = text_value(row.get("category"), "Uncategorized")
                if category == "Uncategorized":
                    result.warnings.append(f"Product {product_id}: missing category; used Uncategorized")
                result.records.append({"product_id": product_id,
                    "name": text_value(row.get("name", row.get("product_name")), product_id),
                    "category": category,
                    "unit_price": money(row.get("unit_price", row.get("price")), "unit_price"),
                    "currency": currency(row.get("currency")),
                    "image_url": text_value(row.get("image_url"))})
                seen.add(product_id)
            except DataError as exc:
                result.skipped += 1
                result.warnings.append(f"CSV row {index}: {exc}; skipped product")
        if result.skipped and not result.records:
            raise DataError("No valid products found: " + "; ".join(result.warnings[:5]))
        return result
    except (UnicodeError, csv.Error) as exc:
        raise DataError(f"Invalid CSV: {exc}") from None
