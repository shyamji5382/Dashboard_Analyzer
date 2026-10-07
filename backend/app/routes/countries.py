from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request


router = APIRouter(tags=["Country Analytics"])


def country_filters(region: Annotated[str | None, Query(max_length=120)] = None,
    population_min: Annotated[int | None, Query(ge=0, le=10000000000000)] = None,
    population_max: Annotated[int | None, Query(ge=0, le=10000000000000)] = None,
    currency: Annotated[str | None, Query(pattern="^[A-Z]{3}$")] = None,
    language: Annotated[str | None, Query(max_length=120)] = None,
    search: Annotated[str | None, Query(max_length=120)] = None):
    if population_min is not None and population_max is not None and population_min > population_max:
        raise HTTPException(422, "Minimum population must not exceed maximum population")
    return {key: value for key, value in {"region": region, "population_min": population_min,
            "population_max": population_max, "currency": currency, "language": language, "search": search}.items() if value is not None and value != ""}


@router.post("/ingest/countries", summary="Import the repository snapshot, sync REST Countries v3.1, or test a live API preview")
def ingest_countries(request: Request, source: Literal["api", "snapshot"] = "api", preview: bool = False):
    service = request.app.state.countries
    return {"data": service.load_snapshot() if source == "snapshot" else service.sync_api(preview)}


@router.get("/analytics/countries/summary")
def summary(request: Request, filters: Annotated[dict, Depends(country_filters)]):
    return request.app.state.countries.summary(filters)


@router.get("/analytics/countries/filters")
def options(request: Request):
    return request.app.state.countries.options()


@router.get("/analytics/countries")
def countries(request: Request, filters: Annotated[dict, Depends(country_filters)],
    page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 10,
    sort: Literal["population_desc", "name_asc", "density_desc", "area_desc"] = "population_desc"):
    return request.app.state.countries.list(filters, page, page_size, sort)


@router.get("/analytics/countries/{code}")
def detail(code: str, request: Request):
    result = request.app.state.countries.detail(code)
    if result is None:
        raise HTTPException(404, "Country not found")
    return result
