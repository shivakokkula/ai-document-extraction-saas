import asyncio
import time
from typing import Optional
import structlog

from app.services.ocr.paddleocr_service import PaddleOCRService
from app.services.llm.claude_service import ClaudeExtractionService
from app.services.classifier import DocumentClassifier
from app.models.extraction import ExtractionResult
from app.utils.pdf_utils import pdf_to_images
from app.utils.s3_utils import download_from_s3

logger = structlog.get_logger()


class DocumentExtractionPipeline:
    """
    Full async pipeline:
    1. Download PDF from S3
    2. Convert pages to images
    3. Run OCR on all pages (parallel)
    4. Classify document type
    5. LLM structured extraction
    6. Return typed result
    """

    def __init__(self):
        self.ocr = PaddleOCRService()
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

        # Step 1: Download
        pdf_bytes = await download_from_s3(s3_bucket, s3_key)
        log.info("pipeline.downloaded", bytes=len(pdf_bytes))

        # Step 2: PDF → images
        images = await pdf_to_images(pdf_bytes, dpi=200)
        log.info("pipeline.converted", pages=len(images))

        # Step 3: OCR pages in parallel
        ocr_tasks = [self.ocr.extract_page(img, i + 1) for i, img in enumerate(images)]
        page_results = await asyncio.gather(*ocr_tasks)

        raw_text = "\n\n--- PAGE BREAK ---\n\n".join(r.text for r in page_results)
        avg_confidence = sum(r.confidence for r in page_results) / max(len(page_results), 1)
        log.info("pipeline.ocr_done", confidence=round(avg_confidence, 3), chars=len(raw_text))

        # Step 4: Classify
        doc_type = hint_type or await self.classifier.classify(raw_text[:2000])
        log.info("pipeline.classified", doc_type=doc_type)

        # Step 5: LLM extraction
        fields, token_count = await self.llm.extract(
            raw_text=raw_text,
            document_type=doc_type,
            images=images[:3],
        )
        log.info("pipeline.llm_done", tokens=token_count, field_count=len(fields))

        duration_ms = int((time.time() - start) * 1000)
        log.info("pipeline.complete", duration_ms=duration_ms)

        return ExtractionResult(
            document_id=document_id,
            document_type=doc_type,
            raw_text=raw_text,
            ocr_confidence=avg_confidence,
            ocr_engine="paddleocr",
            extracted_fields=fields,
            extraction_model="claude-opus-4-6",
            page_count=len(images),
            processing_duration_ms=duration_ms,
            token_count=token_count,
        )
