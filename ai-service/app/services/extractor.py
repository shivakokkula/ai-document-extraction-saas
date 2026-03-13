import asyncio
import time
from typing import Optional
import structlog
import os

from app.models.extraction import ExtractionResult
from app.services.classifier import DocumentClassifier
from app.services.llm.claude_service import ClaudeExtractionService
from app.utils.pdf_utils import pdf_to_images
from app.utils.s3_utils import download_from_s3

logger = structlog.get_logger()


def get_ocr_service():
    """
    Select OCR engine based on environment variable.
    Default: tesseract (lighter, works on Render starter)
    Set OCR_ENGINE=paddleocr for higher accuracy on larger plans.
    """
    engine = os.getenv("OCR_ENGINE", "tesseract").lower()
    if engine == "paddleocr":
        from app.services.ocr.paddleocr_service import PaddleOCRService
        return PaddleOCRService()
    from app.services.ocr.tesseract_service import TesseractOCRService
    return TesseractOCRService()


class DocumentExtractionPipeline:
    def __init__(self):
        self.ocr = get_ocr_service()
        self.llm = ClaudeExtractionService()
        self.classifier = DocumentClassifier()

    async def process(
        self,
        s3_bucket: str,
        s3_key: str,
        document_id: str,
        hint_type: Optional[str] = None,
    ) -> ExtractionResult:
        start = time.time()
        log = logger.bind(document_id=document_id)
        log.info("pipeline.start")

        # Step 1: Download from S3
        pdf_bytes = await download_from_s3(s3_bucket, s3_key)
        log.info("pipeline.downloaded", bytes=len(pdf_bytes))

        # Step 2: Convert PDF pages to images
        images = await pdf_to_images(pdf_bytes, dpi=200)
        log.info("pipeline.converted", pages=len(images))

        # Step 3: OCR all pages in parallel
        ocr_tasks = [self.ocr.extract_page(img, i + 1) for i, img in enumerate(images)]
        page_results = await asyncio.gather(*ocr_tasks)

        raw_text = "\n\n--- PAGE BREAK ---\n\n".join(r.text for r in page_results)
        avg_confidence = sum(r.confidence for r in page_results) / max(len(page_results), 1)
        log.info("pipeline.ocr_done", confidence=round(avg_confidence, 3), chars=len(raw_text))

        # Step 4: Classify document type
        doc_type = hint_type or await self.classifier.classify(raw_text[:2000])
        log.info("pipeline.classified", doc_type=doc_type)

        # Step 5: LLM structured extraction
        fields, token_count = await self.llm.extract(
            raw_text=raw_text,
            document_type=doc_type,
            images=images[:3],
        )
        log.info("pipeline.llm_done", tokens=token_count)

        duration_ms = int((time.time() - start) * 1000)
        log.info("pipeline.complete", duration_ms=duration_ms)

        return ExtractionResult(
            document_id=document_id,
            document_type=doc_type,
            raw_text=raw_text,
            ocr_confidence=avg_confidence,
            ocr_engine=os.getenv("OCR_ENGINE", "tesseract"),
            extracted_fields=fields,
            extraction_model="claude-opus-4-6",
            page_count=len(images),
            processing_duration_ms=duration_ms,
            token_count=token_count,
        )
