from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import structlog

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
    try:
        result = await pipeline.process(
            s3_bucket=req.s3_bucket,
            s3_key=req.s3_key,
            document_id=req.document_id,
            hint_type=req.hint_type,
        )
        return result.model_dump()
    except Exception as e:
        logger.error("extraction_failed", document_id=req.document_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
