from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field


DeliveryStatus = Literal["on_time", "delayed", "pending", "unknown"]


@dataclass
class ParsedData:
    records: list[dict[str, Any]] = field(default_factory=list)
    items: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    skipped: int = 0


class ImportReport(BaseModel):
    dataset: str
    imported: int
    skipped: int
    item_count: int = 0
    warnings: list[str]
    imported_at: str


class ErrorResponse(BaseModel):
    error: dict[str, Any]


class SummaryResponse(BaseModel):
    data: dict[str, Any]
    meta: dict[str, Any]


class OrdersResponse(BaseModel):
    data: list[dict[str, Any]]
    pagination: dict[str, int]
    meta: dict[str, Any]


class ImportResponse(BaseModel):
    data: ImportReport
    message: str = Field(default="Dataset imported successfully")
