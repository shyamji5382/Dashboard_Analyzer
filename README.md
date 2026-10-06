# Meridian Data Analytics Dashboard

A FastAPI + React dashboard built around the REST Countries exercise in `Hit External API.xlsx`. Country analytics is the main view; the existing commerce dashboard, JSON/CSV/XML ingestion, joined analytics, and currency conversion remain available under **Commerce**.

## Dashboard design

The frontend blends both supplied reference layouts: four pastel KPI cards with circular icons, a compact sidebar, white chart tools, and a responsive data table. Country analytics combines density rankings with a regional population pie; the Density toggle uses comparison bars, since densities are not additive shares. Commerce combines revenue lines and order bars with separate currency/count axes, category comparisons, and a delivery timing pie. Chart selections apply filters, and trend points and ranking bars support keyboard drill-down. All visualizations use actual records, without invented growth percentages or time series.

## Assignment data

Commerce now uses the supplied `Orders.json`, `Products.csv`, and shipment XML from the conversation. Open http://127.0.0.1:5173/?view=overview to see these records directly.

| Order | Customer | Calculation | USD total | Reported shipment status | Delivery timing |
| --- | --- | --- | --- | --- | --- |
| 1001 | Rahul / C001 | 2 x 500 + 1 x 1200 | 2,200 | Delivered, 3 days / S001 | Unknown |
| 1002 | Anita / C002 | 3 x 200 | 600 | Delayed, 7 days / S002 | Delayed |

Expected results: **2 orders, 3 products, 2 shipments, USD 2,800 revenue, USD 1,400 average order value, and 1 delayed order**. Electronics contributes USD 2,200 and Furniture USD 600. The dataset covers January 1-2, 2024.

The supplied files contain spreadsheet-style quote wrappers. `backend/data/originals/` preserves those inputs unchanged; the active files in `backend/data/` contain the same records with only those outer wrappers removed and readable formatting. The API also accepts the original exports and reports the decoding in import warnings. It does not silently fix arbitrary malformed JSON/CSV. The previous generated commerce examples are retained in `backend/data/demo/`, and a backup of the previous local SQLite database was saved under `.tools/analytics-before-assignment-*.db`.

Orders use `qty` and item `price`; products use `ProductID,ProductName,Category` without catalog prices. The importers map these aliases, preserve customer and shipment IDs, and join all three datasets by IDs. Revenue uses the supplied item prices. Missing currency defaults to **USD**, as confirmed by the user, and is reported in import warnings. No product prices, images, expected dates, or actual dates have been invented.

**Delay policy is status-only when promised dates are absent.** `Delayed` explicitly sets the delay flag. `Delivered` confirms completion but does not establish on-time arrival, so order 1001 remains `delivery_status: unknown`; its original reported status and duration remain visible. There is no implicit five-day SLA. `DELIVERY_SLA_DAYS` is empty/unset by default; an optional explicit value enables duration-based assessment for other datasets. Date-based shipments continue to use their actual/expected dates, which take precedence over reported status. The boolean `delayed: false` is not proof of on-time delivery; inspect `delivery_status` to distinguish Unknown from On time.

## Country analytics

The main view includes country count, total population, area-weighted density, distinct currencies, regional population/density charts, density rankings, currency groups, and a paginated table. Region, inclusive population range, currency, language, and search filters apply consistently to the summary and table. Country details include currencies, languages, capitals, bordering countries with drill-down, and map links. CSV export retrieves all matching pages, not just the visible rows.

### External API and bundled data

The spreadsheet's `https://restcountries.com/v3.1/all` endpoint now returns a deprecation response rather than country records. [REST Countries v5](https://restcountries.com/docs/countries/api-versions) uses `https://api.restcountries.com/countries/v5` with bearer authentication. The [documented public demo](https://restcountries.com/docs/countries) returns one sample country, not the full world dataset.

- Without a personal API key, the dashboard starts with **250 real countries and territories from the official repository snapshot**. This is labeled `Repository snapshot`, never a live API feed.
- **Test API** calls the v5 provider through the backend using its public demo token, normalizes the response, and shows a preview notice. Preview data never replaces stored country records.
- To enable **Sync API**, set `$env:REST_COUNTRIES_API_KEY = 'your-key'` in the shell before starting the servers. Keep the key on the backend, never in `VITE_*` variables. The backend retrieves all pages before replacing data in one transaction. Provider errors, incomplete/repeated pages, and demo responses preserve the previous dataset.
- The restore icon beside the source label reloads the bundled snapshot. Startup never requires a country API request; restarts preserve imported country data.

`backend/data/Countries.json` is the unmodified upstream nested JSON at commit `bfadee4f951682c29970e53677707bc558e80b74`. [Pinned source](https://github.com/restcountries/restcountries/blob/bfadee4f951682c29970e53677707bc558e80b74/src/main/resources/countriesV3.1.json), provenance in `Countries.meta.json`, and the upstream MPL-2.0 license in `REST_COUNTRIES_LICENSE.txt` are included. Download date is not the observation date of population estimates; the snapshot is not a claim of current census data.

### Modeling and transformations

SQLite stores countries, currency/language catalogs, their many-to-many relationships, capitals, borders, and source metadata separately. The normalizer supports v3 nested JSON and v5 `data.objects`, converts numeric strings, validates finite nonnegative population/area, deduplicates relations, and reports skipped malformed or duplicate countries. Missing population stays null, not zero; missing or zero area yields null density. Genuine zero population remains zero.

Density is **population / area in square kilometers**, not GDP or an economic estimate. Combined and regional density divide the population sum by the area sum over countries with both usable values, rather than averaging country densities. Currency-group populations can overlap, while global totals count every country once. SQL `EXISTS` filters prevent many-to-many joins from multiplying counts. Pagination uses SQL LIMIT/OFFSET; related records are fetched in three batched queries per page.

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/ingest/countries?source=snapshot` | Restore the full bundled snapshot |
| POST | `/ingest/countries?source=api&preview=true` | Live preview without changing storage |
| POST | `/ingest/countries?source=api` | Full paginated v5 sync with a backend API key |
| GET | `/analytics/countries/summary` | KPIs, regions, currency groups, density rankings |
| GET | `/analytics/countries` | Filtered, sorted, paginated countries |
| GET | `/analytics/countries/{code}` | Country details and bordering countries |
| GET | `/analytics/countries/filters` | Available filters and source metadata |

Summary and list accept `region`, `population_min`, `population_max`, `currency` (uppercase three-letter code), `language`, and `search`. List additionally accepts `page`, `page_size` (1-100), and `sort`: `population_desc`, `density_desc`, `area_desc`, or `name_asc`. Details use three-letter country codes. API keys are never returned in metadata or error messages.

```powershell
curl.exe "http://127.0.0.1:8000/analytics/countries/summary?region=Asia&population_min=10000000"
curl.exe "http://127.0.0.1:8000/analytics/countries?currency=EUR&page=1&page_size=20"
curl.exe -X POST "http://127.0.0.1:8000/ingest/countries?preview=true"
```

## Run locally

Requires Python 3.11+ and Node.js 20.19+ (or 22.12+). From the project directory:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\frontend
npm install
cd ..
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
```

The start script launches both servers in the background, prints their URLs, and selects another port if the requested port is occupied. Logs and process information are in `.tools/`. Stop these servers with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop.ps1
```

A portable Python interpreter is also available at `.tools/python/python.exe` in the current workspace because the installed system Python does not start. The start script automatically uses it when a backend virtual environment is not present. This local runtime is ignored by Git; on another machine, use the normal setup above.

Alternatively, run each server in a terminal:

```powershell
# Terminal 1, from backend/
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2, from frontend/
npm run dev
```

Dashboard: http://127.0.0.1:5173. Interactive API documentation: http://127.0.0.1:8000/docs.

The first startup imports 250 countries plus the assignment files: 2 orders, 3 products, and 2 shipments. Subsequent startups preserve the database, including intentionally emptied commerce datasets. These orders use USD so the initial dashboard does not depend on internet access. Select another reporting currency to exercise the exchange-rate API, or import mixed-currency orders.

## REST API

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/ingest/json` | Flatten and replace orders and their items |
| POST | `/ingest/csv` | Parse and replace the product catalog |
| POST | `/ingest/xml` | Parse and replace shipments |
| GET | `/analytics/summary` | KPIs, revenue trend, category totals, delivery counts |
| GET | `/analytics/orders` | Filtered, paginated orders and joined line items |
| GET | `/analytics/orders/{order_id}` | Full order details and shipment |
| GET | `/analytics/filters` | Available categories, dates, currencies, import reports |
| GET | `/health` | Application and database health |

Ingestion accepts raw data or a multipart upload named `file`, up to 5 MB. An empty POST loads that format's bundled assignment file. Imports replace only the selected dataset in a transaction and can run in any order. An explicitly empty array/root/header clears that dataset. Malformed documents or imports with no valid records are rejected without changing existing data. Partially valid imports accept valid records and return skipped counts and warnings; duplicate IDs keep the first valid record. Invalid individual order items are skipped with warnings.

```powershell
curl.exe -X POST http://127.0.0.1:8000/ingest/json -H "Content-Type: application/json" --data-binary "@backend/data/Orders.json"
curl.exe -X POST http://127.0.0.1:8000/ingest/csv -F "file=@backend/data/Products.csv"
curl.exe -X POST http://127.0.0.1:8000/ingest/xml -F "file=@backend/data/Shipments.xml"
curl.exe "http://127.0.0.1:8000/analytics/summary?start_date=2024-01-01&end_date=2024-01-02&currency=USD"
curl.exe "http://127.0.0.1:8000/analytics/orders?page=1&page_size=10&delivery_status=delayed"
```

Both summary and orders accept `start_date`, `end_date` (inclusive), `category`, `delivery_status`, `search`, and `currency`. Search matches order ID or customer name without interpreting SQL wildcard characters. Orders additionally accept `page` (1-based) and `page_size` (1-100), sorted by date descending then ID descending. Category filtering includes matching line items only; order counts are distinct, and filtered revenue/order values sum those matching items. Detail always returns the full order. An order can belong to multiple categories, so category order counts need not add up to the total order count.

Responses use `{ "data": ..., "meta": ... }`; order lists include `pagination`. Import results contain `imported`, `skipped`, `item_count`, `warnings`, and `imported_at`. Errors use `{ "error": { "code": ..., "message": ..., "details": ... } }` with appropriate 404/413/422/503 status codes. Syntactically valid currencies whose rates are unavailable return 503. API request validation rejects inverted date ranges, unknown delivery statuses, and invalid pagination.

## Input formats

Nested orders can be an array or `{ "orders": [...] }`:

```json
{
  "orders": [{
    "order_id": "ORD-001",
    "order_date": "2026-07-01",
    "customer": { "name": "Alice", "email": "alice@example.com" },
    "currency": "USD",
    "items": [{ "product_id": "PRD-001", "quantity": "2", "unit_price": "10.50" }]
  }]
}
```

Supported aliases: `id`/`order_id`, `date`/`order_date`, `customer_name`/`customer.name`, `customer_id`/`customer.id`, and item `qty`/`quantity`, `price`/`unit_price`. Explicit `quantity` takes precedence over `qty`. ISO datetime order dates are reduced to dates. Numeric strings are converted; fractional/nonpositive quantities and negative/nonfinite prices are rejected. Missing quantity defaults to 1 with a warning; missing currency defaults to USD; missing customer names become `Unknown customer`. Recognizable CSV-quoted JSON-line exports are decoded with the CSV parser before JSON validation, with an import warning.

Product CSV uses `product_id,name,category,unit_price,currency,image_url`. Only `product_id` is required. `product_name` and `price` are accepted aliases, as are the assignment's `ProductID,ProductName,Category` headers. Known headers are matched case-insensitively with spaces/underscores normalized; duplicate mapped headers are rejected. Missing categories become `Uncategorized`, missing names use the ID, and missing currencies default to USD. UTF-8 BOMs, normally quoted fields, and single-column exports wrapping entire rows in quotes are supported. Export decoding and header normalization are reported in warnings.

```xml
<shipments>
  <shipment>
    <order_id>ORD-001</order_id>
    <expected_delivery>2026-07-05</expected_delivery>
    <actual_delivery>2026-07-06</actual_delivery>
    <carrier>DHL</carrier>
    <tracking_number>TRK001</tracking_number>
  </shipment>
</shipments>
```

Namespaces and `expected_delivery_date`/`actual_delivery_date` aliases are supported. Empty delivery elements become null. XML is parsed with `defusedxml` to reject entity expansion and unsafe documents. Each order has at most one shipment record.

The assignment format is also supported:

```xml
<shipments>
  <shipment>
    <shipment_id>S001</shipment_id>
    <order_id>1001</order_id>
    <delivery_days>3</delivery_days>
    <status>Delivered</status>
  </shipment>
</shipments>
```

`delivery_days` accepts whole nonnegative numeric strings, including zero, and rejects fractional, negative, or nonfinite values. Shipment ID, reported status, and duration are stored separately from expected/actual dates, which remain null when absent. Existing databases receive additive schema migrations that preserve earlier records.

## Transformations and storage

- Orders, line items, products, and shipments are separate tables. Indexed IDs and dates support joins and SQL pagination. SQLite WAL mode, foreign keys, transactions, and short-lived connections support concurrent local requests. Products and shipments can arrive before orders, so catalog/shipment references are intentionally joined without hard foreign keys.
- Explicit item prices take precedence over catalog prices. Item prices use the order currency; catalog fallback prices use the catalog currency. Unknown products remain visible as `Uncategorized`. Unpriced items are excluded from revenue and reported in `meta.data_quality`; incomplete orders are marked in the table and detail.
- Values are computed with `Decimal` and rounded per converted line with `ROUND_HALF_UP` to two decimal places. Summary, trends, categories, and order tables sum the same rounded lines. These are analytical reporting values, not an accounting ledger; original unit prices and currency remain in details.
- Date-based classification: `on_time` when actual delivery is on/before the expected date; `delayed` when actual delivery is late or an undelivered shipment is overdue; `pending` when an undelivered shipment is not yet overdue. Without an expected date, explicit Delayed/Late or On time statuses are respected. Delivered alone remains `unknown`, even with a duration. An explicitly configured duration SLA can assess timing; no SLA is assumed by default. Rate calculations use date-completed or duration-bearing records whose timing can be classified, excluding Unknown and Pending records.
- Currency rates come from the [Frankfurter v2 API](https://frankfurter.dev/) without an API key. The application multiplies source amounts by source/target rates, stores rates in SQLite for 24 hours, and reports rate dates and provenance. On provider failure it can reuse a stored stale rate, marked `stale: true`; without a stored rate it returns 503 rather than fabricating a conversion. Rates are current reporting rates, not historical transaction-date rates. Internet access is needed for uncached conversions.
- Blocking ingestion work runs in a worker thread; FastAPI also runs synchronous analytics handlers in its thread pool. Imports complete before the endpoint responds. SQL pagination limits the rows transformed for order lists; summaries scan matching line items, so very large datasets would benefit from preaggregations or a PostgreSQL deployment.

## Dashboard

The commerce overview has revenue, order count, average order value, and delayed-order KPIs; a revenue/orders toggle; category totals; delivery distribution; and a paginated order table. Filters and search are synchronized with the URL. Order details show joined products, quantities, customer ID, original prices, converted totals, shipment ID, reported status, duration, and available dates. CSV export includes every filtered order, fetching all pages. The data-source view supports file uploads and bundled assignment imports with reports. Reported shipment status is displayed separately from assessed delivery timing.

Context + reducer manages filters and pagination. Fetches use AbortController to cancel stale requests, search is debounced, summary and order errors are independent, and loading, empty, error, and retry states are included. Layouts adapt to mobile, with a collapsible navigation panel, native accessible controls, keyboard-dismissible modal, visible focus states, and reduced-motion support. Product thumbnails are from Unsplash and are optional; failed image loads do not block analytics.

## Configuration

`backend/.env.example` and `frontend/.env.example` list configuration options. Backend environment variables must be set in the shell (the application does not automatically load `.env`). Vite loads frontend `.env` normally.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANALYTICS_DB_PATH` | `backend/analytics.db` | SQLite file |
| `SEED_DEMO_DATA` | `true` | Initial sample-data import |
| `REST_COUNTRIES_API_KEY` | unset | Full v5 sync; without a key, Test API uses the public preview |
| `DELIVERY_SLA_DAYS` | unset | Optional duration SLA; unset preserves status-only classification |
| `CORS_ORIGINS` | localhost and 127.0.0.1 on 5173 | Comma-separated origins |
| `VITE_API_BASE_URL` | `/api` | Browser-facing API base URL |
| `API_PROXY_TARGET` | `http://127.0.0.1:8000` | Vite's backend proxy target |
| `DASHBOARD_URL` | `http://127.0.0.1:5173` | Browser-test target |

The Vite development proxy strips `/api`. For production, run `npm run build`, serve `frontend/dist`, and reverse-proxy `/api/*` to FastAPI, stripping `/api`, or configure `VITE_API_BASE_URL` before building. The local app has no authentication and binds to loopback by default.

## Verification

```powershell
# From backend, using your chosen Python environment
python -m pytest -q
# In this workspace: ..\.tools\python\python.exe -m pytest -q

# From frontend; both servers must be running with the bundled data
npm run build
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location).Path '..\.tools\browsers'
npx playwright install chromium
npm run test:e2e
```

Backend tests use isolated SQLite files and mocked external APIs, with no internet dependency. Assignment tests cover original exports, aliases, exact totals, status-only timing, invalid durations, filters, pagination, and preservation through schema migration. Country tests cover v3/v5 normalization, missing values, many-to-many aggregation, weighted density, filtering, pagination, provenance, preview safety, and failed synchronization. Browser tests exercise both views on desktop and mobile and save screenshots to `frontend/test-results/`. Tests expect the 250-country snapshot and bundled assignment data (2 orders, 3 products, 2 shipments); restore these through the UI before testing a modified database. The automated UI preview test mocks the provider response; use Test API to verify an actual external connection.
