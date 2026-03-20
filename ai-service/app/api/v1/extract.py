from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import time
import structlog
import traceback

from app.services.extractor import DocumentExtractionPipeline

logger = structlog.get_logger()
router = APIRouter()
pipeline = DocumentExtractionPipeline()

class ExtractRequest(BaseModel):
    document_id: str
    s3_bucket: str
    s3_key: str
    hint_type: Optional[str] = None

@router.post("")
async def extract_document(req: ExtractRequest):
    start_ms = time.time()
    logger.info(
        "extraction_request_received",
        document_id=req.document_id,
        s3_bucket=req.s3_bucket,
        s3_key=req.s3_key,
        hint_type=req.hint_type,
    )
    try:
        result = await pipeline.process(
            s3_bucket=req.s3_bucket,
            s3_key=req.s3_key,
            document_id=req.document_id,
            hint_type=req.hint_type,
        )
        logger.info(
            "extraction_request_completed",
            document_id=req.document_id,
            document_type=result.document_type,
            pages=result.page_count,
            tokens=result.token_count,
            elapsed_ms=int((time.time() - start_ms) * 1000),
        )
        return result.model_dump()
    except Exception as e:
        logger.error(
            "extraction_failed",
            document_id=req.document_id,
            error=str(e),
            traceback=traceback.format_exc(),
            elapsed_ms=int((time.time() - start_ms) * 1000),
        )
        raise HTTPException(status_code=500, detail=str(e))
