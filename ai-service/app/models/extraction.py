from pydantic import BaseModel
from typing import Any, Optional

class ExtractionResult(BaseModel):
    document_id: str
    document_type: str
    raw_text: str
    ocr_confidence: float
    ocr_engine: str = "paddleocr"
    extracted_fields: dict[str, Any]
    extraction_model: str
    page_count: int
    processing_duration_ms: int
    token_count: Optional[int] = None
    confidence: Optional[float] = None

class OCRPageResult(BaseModel):
    page_number: int
    text: str
    confidence: float
