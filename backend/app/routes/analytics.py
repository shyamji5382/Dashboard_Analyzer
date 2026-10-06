from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.models.schemas import DeliveryStatus, OrdersResponse, SummaryResponse


router = APIRouter(prefix="/analytics", tags=["Analytics"])


def filters(
    start_date: date | None = None, end_date: date | None = None,
    category: Annotated[str | None, Query(max_length=120)] = None,
    delivery_status: DeliveryStatus | None = None,
    search: Annotated[str | None, Query(max_length=120)] = None,
) -> dict:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(422, "start_date must be on or before end_date")
    return {key: str(value) for key, value in {"start_date": start_date, "end_date": end_date,
            "category": category, "delivery_status": delivery_status, "search": search}.items() if value}


Currency = Annotated[str, Query(pattern="^[A-Z]{3}$")]


@router.get("/summary", response_model=SummaryResponse)
def summary(request: Request, selected: Annotated[dict, Depends(filters)], currency: Currency = "USD"):
    return request.app.state.analytics.summary(selected, currency)


@router.get("/orders", response_model=OrdersResponse)
def orders(request: Request, selected: Annotated[dict, Depends(filters)], currency: Currency = "USD",
           page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 10):
    return request.app.state.analytics.orders(selected, currency, page, page_size)


@router.get("/orders/{order_id}")
def order_detail(order_id: str, request: Request, currency: Currency = "USD"):
    result = request.app.state.analytics.detail(order_id, currency)
    if result is None:
        raise HTTPException(404, "Order not found")
    return result


@router.get("/filters")
def filter_options(request: Request):
    return request.app.state.analytics.options()
