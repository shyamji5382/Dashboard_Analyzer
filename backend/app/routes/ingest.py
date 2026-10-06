from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.models.schemas import ImportResponse
from app.services.csv_service import parse_products
from app.services.json_service import parse_orders
from app.services.xml_service import parse_shipments


router = APIRouter(prefix="/ingest", tags=["Ingestion"])
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
MAX_BYTES = 5 * 1024 * 1024
PARSERS = {"json": (parse_orders, "Orders.json"), "csv": (parse_products, "Products.csv"), "xml": (parse_shipments, "Shipments.xml")}


async def ingest(request: Request, dataset: str):
    if "multipart/form-data" in request.headers.get("content-type", ""):
        async with request.form(max_files=1, max_fields=1, max_part_size=MAX_BYTES) as form:
            file = form.get("file")
            if file is None or not hasattr(file, "read"):
                raise HTTPException(422, 'Upload a file using the multipart "file" field')
            content = await file.read(MAX_BYTES + 1)
    else:
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > MAX_BYTES:
                raise HTTPException(413, "Maximum import size is 5 MB")
        content = bytes(chunks)
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "Maximum import size is 5 MB")
    parser, filename = PARSERS[dataset]
    if not content:
        content = await run_in_threadpool((DATA_DIR / filename).read_bytes)
    parsed = await run_in_threadpool(parser, content)
    report = await run_in_threadpool(request.app.state.database.replace, dataset, parsed)
    return {"data": report, "message": "Dataset imported successfully"}


@router.post("/json", response_model=ImportResponse, summary="Import nested orders JSON")
async def ingest_json(request: Request):
    return await ingest(request, "json")


@router.post("/csv", response_model=ImportResponse, summary="Import products CSV")
async def ingest_csv(request: Request):
    return await ingest(request, "csv")


@router.post("/xml", response_model=ImportResponse, summary="Import shipments XML")
async def ingest_xml(request: Request):
    return await ingest(request, "xml")
