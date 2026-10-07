# Commerce Analytics Dashboard

A data analytics dashboard built with **FastAPI, SQLite, React, and Vite**.
It combines JSON orders, CSV products, and XML shipments to show revenue and delivery performance.
Commerce is the main dashboard. Countries analytics is an additional feature in the sidebar.

## Quick Start

Requirements: **Python 3.11+** and **Node.js 20.19+ or 22.12+**.
Run these commands in PowerShell from `data-analytics-dashboard/`.

### 1. Install Dependencies Once

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\frontend
npm install
cd ..
```

### 2. Start Both Servers

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start.ps1 -BackendPort 8001 -FrontendPort 5173
```

- Dashboard: http://127.0.0.1:5173/
- API documentation: http://127.0.0.1:8001/docs
- Health check: http://127.0.0.1:8001/health

The script starts both servers in the background. If a port is unavailable, it chooses another one; use the URLs it prints. Logs are saved in `.tools/`.

Stop both servers with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop.ps1
```

For backend code changes, stop and start again, or use the manual commands below with `--reload`.
This workspace also has `.tools/python/python.exe`; the script uses it if there is no backend virtual environment. This portable runtime is not included in Git.

### Run in Separate Terminals

Stop script-managed servers first, then run:

```powershell
# Terminal 1: backend folder
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
# In this workspace, you can use ..\.tools\python\python.exe instead.

# Terminal 2: frontend folder
$env:API_PROXY_TARGET = 'http://127.0.0.1:8001'
npm run dev -- --port 5173
```

Examples in this README use backend port **8001**. If you use another port, update the URLs and `API_PROXY_TARGET`.

## Assignment Data

The main dashboard uses the supplied files in `backend/data/`:

- `Orders.json`: 2 orders with 3 line items.
- `Products.csv`: Laptop, Phone, and Chair.
- `Shipments.xml`: 2 shipment records.

| Order | Customer | Calculation | Revenue (USD) | Reported shipment | Delivery timing |
| --- | --- | --- | --- | --- | --- |
| 1001 | Rahul / C001 | 2 x 500 + 1 x 1200 | 2,200 | S001: Delivered, 3 days | Unknown |
| 1002 | Anita / C002 | 3 x 200 | 600 | S002: Delayed, 7 days | Delayed |

Expected totals: **2 orders, USD 2,800 revenue, USD 1,400 average order value, and 1 delayed order**.
Electronics revenue is USD 2,200; Furniture revenue is USD 600. Order dates are January 1-2, 2024.

The original spreadsheet exports are preserved in `backend/data/originals/`. Active files contain the same records with only the outer spreadsheet quote wrappers removed. The API accepts both versions and reports wrapper decoding in warnings. Older examples in `backend/data/demo/` are not the active assignment data.

The supplied data has no currency, catalog prices, product images, promised dates, or actual delivery dates. Currency defaults to **USD**; other missing values are not invented.

**Important:** `Delivered` does not prove on-time delivery. Order 1001 therefore remains `Unknown`. There is no assumed five-day delivery deadline.

On the first startup, the app imports the assignment files and the country snapshot. Later startups keep stored data, including datasets you intentionally emptied. The initial USD dashboard works without external API calls.

## REST APIs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/ingest/json` | Load orders and flatten their items |
| POST | `/ingest/csv` | Load products |
| POST | `/ingest/xml` | Load shipments |
| GET | `/analytics/summary` | Return KPIs and chart data |
| GET | `/analytics/orders` | Return filtered, paginated orders |
| GET | `/analytics/orders/{order_id}` | Return full order and shipment details |
| GET | `/analytics/filters` | Return filter options and import reports |
| GET | `/health` | Check the app and database connection |

### Import Rules

- Upload raw data or a multipart file named `file`. Maximum size: **5 MB**.
- An empty POST loads the bundled file for that format.
- Imports replace only the selected dataset, in one database transaction. Files can arrive in any order.
- Explicitly empty JSON arrays, XML roots, or header-only product CSVs clear that dataset.
- Malformed documents and nonempty uploads with no valid records leave existing data unchanged.
- Partially valid uploads keep valid records and report skipped records and warnings. Duplicate IDs keep the first valid record; invalid order items are skipped with warnings.

From the project folder:

```powershell
curl.exe -X POST http://127.0.0.1:8001/ingest/json -H "Content-Type: application/json" --data-binary "@backend/data/Orders.json"
curl.exe -X POST http://127.0.0.1:8001/ingest/csv -F "file=@backend/data/Products.csv"
curl.exe -X POST http://127.0.0.1:8001/ingest/xml -F "file=@backend/data/Shipments.xml"
curl.exe "http://127.0.0.1:8001/analytics/summary?start_date=2024-01-01&end_date=2024-01-02&currency=USD"
curl.exe "http://127.0.0.1:8001/analytics/orders?page=1&page_size=10&delivery_status=delayed"
```

### Filters and Responses

Summary and orders support `start_date`, `end_date`, `category`, `delivery_status`, `search`, and `currency`. Date boundaries are inclusive. Search matches order IDs or customer names as literal text.

Orders also support `page` (starting at 1) and `page_size` (1-100). Results are sorted by newest date, then order ID descending. An out-of-range page returns an empty list.

Category filters include only matching line items in revenue and order values. Orders are counted once within each category, but one order can belong to multiple categories. Order details always show the full order.

Analytics responses use `{ "data": ..., "meta": ... }`; lists also include `pagination`. Import responses contain counts, warnings, and the import timestamp. Errors use `{ "error": { "code": ..., "message": ..., "details": ... } }`.

Common error statuses: **404** not found, **413** upload too large, **422** invalid data/parameters, and **503** unavailable storage or external API. Invalid dates, reversed date ranges, delivery statuses, and pagination values are validated.

## Data Processing Rules

### Accepted Formats

- **JSON:** an array of orders or `{ "orders": [...] }`. Each order needs `order_id`, `order_date`, and a nonempty `items` array. Customer details are optional. Aliases include `id`, `date`, `customer_name`, `customer_id`, `qty`, and `price`. Explicit `quantity` takes priority over `qty`.
- **CSV:** only `product_id` is required. Optional columns are `name`, `category`, `unit_price`, `currency`, and `image_url`. Aliases include `ProductID`, `ProductName`, `Category`, `product_name`, and `price`. Known headers are normalized; duplicate mapped headers are rejected. Quoted fields, multiline fields, UTF-8 BOMs, and recognized spreadsheet wrappers are supported.
- **XML:** `<shipments>` containing `<shipment>` records, or a single `<shipment>`. Supports namespaces, shipment IDs, reported status, `delivery_days`, and optional expected/actual dates. Date aliases are `expected_delivery_date` and `actual_delivery_date`. Unsafe XML, unexpected container tags, and non-whitespace container text are rejected with `defusedxml`.

Numeric strings are converted to numbers, and ISO datetimes are reduced to dates. Quantities must be positive whole numbers; prices must be finite and nonnegative. Missing quantity defaults to 1 with a warning. Missing customer names become `Unknown customer`; missing product names use the ID; missing categories become `Uncategorized`. Empty optional delivery dates become null. Delivery duration must be a whole number from 0 to 1,000,000 days. Each order has at most one shipment record.

See the actual input examples: [Orders.json](backend/data/Orders.json), [Products.csv](backend/data/Products.csv), and [Shipments.xml](backend/data/Shipments.xml).

### Joins and Revenue

- Orders join shipments by `order_id`; line items join products by `product_id`.
- Item prices take priority over catalog prices. Item prices use the order currency; catalog prices use the product currency.
- Unknown products remain visible. Unpriced items are excluded from revenue and reported in `meta.data_quality`; affected orders are marked incomplete.
- Money calculations use `Decimal`. Converted line totals are rounded to two decimal places with `ROUND_HALF_UP`; summaries, categories, trends, and tables sum those same values.
- Currency conversion uses the [Frankfurter API](https://frankfurter.dev/), with a **24-hour SQLite cache**. Provider failure can use a cached rate marked `stale: true`; without a cached rate, the API returns 503. Rates are current reporting rates, not historical order-date rates. Dashboard totals are analytical reports, not an accounting ledger.

### Delivery Timing

- With promised dates: delivery on/before the promised date is `on_time`; late or overdue delivery is `delayed`; an undelivered shipment not yet overdue is `pending`.
- Without promised dates: explicit Delayed/Late and On time statuses are respected. Delivered alone remains `unknown`, even when a duration is supplied.
- Date-based results take priority over reported status. Optional `DELIVERY_SLA_DAYS` enables duration-based timing for other datasets; it is unset by default.
- `on_time_rate` uses the same eligible orders in both numerator and denominator: known on-time/delayed orders with an actual delivery date or duration, including zero days. Unknown, Pending, and status-only records are excluded. No eligible orders means `null` in the API and `N/A` in the UI; a valid zero rate displays `0%`.

## Design Choices

**Storage:** SQLite keeps data between restarts without a separate database server. Orders, items, products, and shipments have separate tables; import reports and exchange rates are stored too. Indexes, transactions, foreign keys, and WAL mode support joins, pagination, and safe imports. Product/shipment references allow files to arrive before orders. Schema updates preserve existing records.

**Backend:** routes handle HTTP requests, services parse and transform data, and the database layer handles storage. Blocking imports run in worker threads and finish before the response is sent; there is no background job queue. Orders use SQL pagination. Summaries scan matching items, so large production workloads would need further optimization or PostgreSQL.

**Frontend:** React Context + reducer manages filters and pagination. API calls use `AbortController` to cancel old requests, search is debounced, and summary/table errors are handled independently.

## Dashboard Features

- KPI cards: Total Orders, Total Revenue, Average Order Value, and Delayed Orders.
- Charts: revenue trend, category revenue, and delivery performance; Revenue/Orders toggle.
- Filters: date range, category, delivery status, search, and reporting currency. Filters stay in the URL.
- Drill-down: select chart data to filter orders, or open an order for customer, item, price, and shipment details. Trend points support keyboard selection.
- Paginated orders, CSV export of all matching pages, and a Data sources page for imports.
- Reusable components, responsive layouts, mobile navigation, loading/error/empty/retry states, keyboard-dismissible dialogs, and reduced-motion support.

The pastel cards and compact sidebar blend the supplied reference designs. Charts use actual records, not invented growth figures. Product images appear only when provided; failed images do not block the dashboard. Reported shipment status is shown separately from assessed delivery timing. Commerce opens at `/`; older `?view=overview` links still work.

## Countries: Additional Feature

Open **Countries** in the sidebar or visit http://127.0.0.1:5173/?view=countries.
It includes country/population/density KPIs, regional charts, currency groups, filters, pagination, CSV export, and details with capitals, languages, borders, and maps. Commerce and country filters stay independent.

The app uses the no-key REST Countries endpoint requested in the external API requirement: `https://restcountries.com/v3.1/all`.

- Default data: **250 countries and territories**, labeled `Repository snapshot`, not a live feed.
- **Sync API:** calls REST Countries through the backend and replaces stored countries only after the full response validates.
- `preview=true` checks the live endpoint and returns a normalized sample without replacing stored countries.
- Provider errors, malformed responses, and empty responses preserve existing data. The restore icon reloads the bundled snapshot; restarts preserve stored countries.

- Country, currency, language, capital, and border data use separate tables. The normalizer accepts v3 nested JSON and v5 `data.objects`, validates numbers, removes duplicate relations, and reports skipped records.
- Missing population stays null, not zero. A genuine zero stays zero; missing/zero area gives null density.
- Density is population per square kilometer. Regional/global density uses population and area sums from the same usable countries, not an average of country densities. Density charts use comparisons, not pie shares.
- Currency-group populations may overlap. SQL filters avoid duplicate country counts; global totals count each country once.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/ingest/countries?source=snapshot` | Restore bundled countries |
| POST | `/ingest/countries?source=api&preview=true` | Preview the API without replacing data |
| POST | `/ingest/countries?source=api` | Full sync from REST Countries v3.1 |
| GET | `/analytics/countries/summary` | Return country KPIs and chart data |
| GET | `/analytics/countries` | Return filtered, sorted, paginated countries |
| GET | `/analytics/countries/{code}` | Return details and borders |
| GET | `/analytics/countries/filters` | Return filter options and source information |

Filters: `region`, inclusive `population_min`/`population_max`, uppercase currency code, `language`, and `search`. Lists also accept `page`, `page_size` (1-100), and `sort`: `population_desc`, `density_desc`, `area_desc`, or `name_asc`. Details use three-letter country codes.

Snapshot source: [pinned official repository](https://github.com/restcountries/restcountries/blob/bfadee4f951682c29970e53677707bc558e80b74/src/main/resources/countriesV3.1.json). The unmodified `Countries.json`, provenance in `Countries.meta.json`, and MPL-2.0 license in `REST_COUNTRIES_LICENSE.txt` are in `backend/data/`. Snapshot population figures are not claimed to be current census data.

## Configuration

See `backend/.env.example` and `frontend/.env.example`. Set backend variables in PowerShell; the backend does **not** automatically load `.env`. Vite loads frontend `.env` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANALYTICS_DB_PATH` | `backend/analytics.db` | SQLite file |
| `SEED_DEMO_DATA` | `true` | Initial assignment/snapshot import, not `data/demo/` |
| `DELIVERY_SLA_DAYS` | unset | Optional duration deadline |
| `CORS_ORIGINS` | localhost and 127.0.0.1 on 5173 | Allowed browser origins |
| `VITE_API_BASE_URL` | `/api` | Frontend API base URL |
| `API_PROXY_TARGET` | `http://127.0.0.1:8000` | Vite proxy target; startup script sets the actual backend port |
| `DASHBOARD_URL` | `http://127.0.0.1:5173` | Browser-test target |

For production, build and serve `frontend/dist`. Reverse-proxy `/api/*` to FastAPI, removing `/api`, or set `VITE_API_BASE_URL` before building. The local app has no authentication and binds to loopback by default.

## Tests and Build

```powershell
# Backend folder: isolated test databases, no external API connection needed
.\.venv\Scripts\python.exe -m pytest -q
# This workspace can also use ..\.tools\python\python.exe -m pytest -q

# Frontend folder: build the app
npm run build

# Install the test browser once
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location).Path '..\.tools\browsers'
npx playwright install chromium

# Both servers must be running with the bundled data
# Keep the live database and import history unchanged
npm run test:e2e -- --grep-invert "source view imports"
```

To include upload browser tests, run `npm run test:e2e`. Those tests re-import the supplied files and update import history; use a test/demo instance for that run.

- Backend tests cover parsing, validation, joins, totals, timing, filters, pagination, persistence, rollback, cache expiry, provider failures, and country sync safety.
- Browser tests cover desktop/mobile layouts, navigation, toggles, drill-down, loading/errors/retry, request cancellation, rapid filters, and exports. Screenshots are saved in `frontend/test-results/`.
- Edge cases include huge pages, maximum ISO dates, leap days, zero prices/durations, malformed/oversized uploads, multiline/Unicode fields, and late-arriving products.
- Large pagination fixtures use temporary databases or browser mocks, not the assignment database. Country API sync tests mock the provider; use Sync API for a real external connection.

Browser tests expect the bundled **2 orders, 3 products, 2 shipments, and 250 countries**. Restore those datasets first if you have replaced them.

## Project Structure

```text
backend/app/       API routes, services, schemas, and database code
backend/data/      Assignment files, originals, and country snapshot
backend/tests/     Backend tests
frontend/src/      React pages, components, contexts, and API service
frontend/tests/    Browser tests
scripts/           Start/stop scripts
```
