import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.database.db import Database
from app.routes import analytics, countries, ingest
from app.services.country_service import CountryService, CountrySourceError
from app.services.currency_service import CurrencyError, CurrencyService
from app.services.transformation_service import AnalyticsService
from app.services.validation import DataError


logger = logging.getLogger(__name__)
BACKEND_DIR = Path(__file__).resolve().parents[1]


def create_app(db_path=None, seed=True, currency_factory=CurrencyService, country_factory=CountryService) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        database = Database(db_path or os.getenv("ANALYTICS_DB_PATH", str(BACKEND_DIR / "analytics.db")))
        database.initialize()
        if seed and os.getenv("SEED_DEMO_DATA", "true").lower() == "true" and not database.import_status():
            for dataset in ("csv", "json", "xml"):
                parser, filename = ingest.PARSERS[dataset]
                database.replace(dataset, parser((ingest.DATA_DIR / filename).read_bytes()))
        currencies = currency_factory(database)
        country_service = country_factory(database)
        if seed and os.getenv("SEED_DEMO_DATA", "true").lower() == "true" and country_service.source()["source"] == "empty":
            country_service.load_snapshot()
        application.state.database = database
        application.state.analytics = AnalyticsService(database, currencies)
        application.state.countries = country_service
        try:
            yield
        finally:
            currencies.close()
            country_service.close()

    application = FastAPI(title="Commerce Analytics API", version="1.0.0", lifespan=lifespan,
        description="Ingest JSON orders, CSV products and XML shipments for joined commerce analytics. Includes an additional REST Countries integration.")
    origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    application.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in origins],
                               allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    application.include_router(ingest.router)
    application.include_router(analytics.router)
    application.include_router(countries.router)

    def error(status: int, code: str, message: str, details=None):
        return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})

    @application.exception_handler(DataError)
    async def data_error(request: Request, exc: DataError):
        return error(422, "invalid_dataset", str(exc))

    @application.exception_handler(CurrencyError)
    async def currency_error(request: Request, exc: CurrencyError):
        return error(503, "exchange_rate_unavailable", str(exc))

    @application.exception_handler(CountrySourceError)
    async def country_error(request: Request, exc: CountrySourceError):
        return error(exc.status, exc.code, str(exc))

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(part) for part in item["loc"]), "message": item["msg"]} for item in exc.errors()]
        return error(422, "invalid_request", "Check the request parameters", details)

    @application.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return error(exc.status_code, "request_error", str(exc.detail))

    @application.exception_handler(sqlite3.Error)
    async def database_error(request: Request, exc: sqlite3.Error):
        logger.exception("Database operation failed")
        return error(503, "database_unavailable", "Storage is temporarily unavailable. Retry the request.")

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logger.exception("Unexpected API failure")
        return error(500, "internal_error", "An unexpected error occurred")

    @application.get("/health", tags=["Health"])
    def health(request: Request):
        with request.app.state.database.connect() as connection:
            connection.execute("SELECT 1")
        return {"status": "ok", "storage": "sqlite"}

    return application


app = create_app()
