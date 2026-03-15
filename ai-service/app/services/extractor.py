import asyncio
import time
from typing import Optional
import structlog
import os
from PIL import Image
import io

from app.models.extraction import ExtractionResult
from app.services.classifier import DocumentClassifier
from app.services.llm.gemini_service import GeminiExtractionService
from app.utils.pdf_utils import pdf_to_images, pdf_extract_text_pages
from app.utils.s3_utils import download_from_s3

logger = structlog.get_logger()


def _is_pdf_bytes(file_bytes: bytes) -> bool:
    return file_bytes.startswith(b"%PDF")


def _convert_image_to_jpeg_bytes(file_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _is_image_key(s3_key: str) -> bool:
    key = s3_key.lower()
    return key.endswith(".jpg") or key.endswith(".jpeg") or key.endswith(".png") or key.endswith(".tif") or key.endswith(".tiff")


def _guess_type_from_key(s3_key: str) -> str:
    k = s3_key.lower()
    if "statement" in k or "acct" in k or "account" in k or "bank" in k:
        return "bank_statement"
    if "invoice" in k or "bill" in k:
        return "invoice"
    if "receipt" in k or "challan" in k:
        return "receipt"
    return "generic"


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
        self.llm = GeminiExtractionService()
        self.classifier = DocumentClassifier()

    async def process(
        self,
        s3_bucket: str,
        s3_key: str,
        document_id: str,
        hint_type: Optional[str] = None,
    ) -> ExtractionResult:
        start = time.time()
        log = logger.bind(document_id=document_id, s3_bucket=s3_bucket, s3_key=s3_key)
        log.info("pipeline.start", ocr_engine=os.getenv("OCR_ENGINE", "tesseract"))

        # Step 1: Download from S3
        file_bytes = await download_from_s3(s3_bucket, s3_key)
        log.info("pipeline.downloaded", bytes=len(file_bytes))

        # Step 2: Convert input to image pages (supports PDFs and uploaded images)
        is_pdf = False
        pdf_raw_text = ""
        dpi = int(os.getenv("PDF_DPI", "200"))
        skip_images_when_text = os.getenv("SKIP_PDF_IMAGES_WHEN_TEXT", "true").lower() == "true"
        if _is_pdf_bytes(file_bytes):
            is_pdf = True
            log.info("pipeline.input_detected", kind="pdf")
            # Fast path: for digital PDFs, extract text directly (no OCR dependency).
            text_pages = await pdf_extract_text_pages(file_bytes)
            pdf_raw_text = "\n\n--- PAGE BREAK ---\n\n".join(t for t in text_pages if t)
            log.info("pipeline.pdf_text_extracted", chars=len(pdf_raw_text), pages_with_text=sum(1 for t in text_pages if t))
            if skip_images_when_text and len(pdf_raw_text.strip()) >= 50:
                images = []
                log.info("pipeline.pdf_images_skipped", reason="text_present")
            else:
                images = await pdf_to_images(file_bytes, dpi=dpi)
        elif _is_image_key(s3_key):
            log.info("pipeline.input_detected", kind="image")
            images = [_convert_image_to_jpeg_bytes(file_bytes)]
        else:
            # Fallback: attempt PDF first, then image
            try:
                is_pdf = True
                text_pages = await pdf_extract_text_pages(file_bytes)
                pdf_raw_text = "\n\n--- PAGE BREAK ---\n\n".join(t for t in text_pages if t)
                log.info("pipeline.pdf_text_extracted", chars=len(pdf_raw_text), pages_with_text=sum(1 for t in text_pages if t))
                if skip_images_when_text and len(pdf_raw_text.strip()) >= 50:
                    images = []
                    log.info("pipeline.input_detected", kind="pdf_fallback")
                    log.info("pipeline.pdf_images_skipped", reason="text_present")
                else:
                    images = await pdf_to_images(file_bytes, dpi=dpi)
                    log.info("pipeline.input_detected", kind="pdf_fallback")
            except Exception:
                images = [_convert_image_to_jpeg_bytes(file_bytes)]
                log.info("pipeline.input_detected", kind="image_fallback")

        if not images and not (is_pdf and pdf_raw_text.strip()):
            raise RuntimeError("No pages/images were produced from input document")
        log.info("pipeline.converted", pages=len(images))

        # Step 3: OCR (or use extracted PDF text when available)
        ocr_engine_used = os.getenv("OCR_ENGINE", "tesseract")
        ocr_failed_without_text = False
        if is_pdf and len(pdf_raw_text.strip()) >= 50:
            raw_text = pdf_raw_text
            avg_confidence = 1.0
            ocr_engine_used = "pdf_text"
            log.info("pipeline.ocr_skipped_using_pdf_text", chars=len(raw_text))
        else:
            ocr_tasks = [self.ocr.extract_page(img, i + 1) for i, img in enumerate(images)]
            try:
                page_results = await asyncio.gather(*ocr_tasks)
            except Exception as ocr_error:
                # If OCR binary is missing but PDF text exists, continue with PDF text fallback.
                if is_pdf and pdf_raw_text.strip():
                    raw_text = pdf_raw_text
                    avg_confidence = 0.8
                    ocr_engine_used = "pdf_text_fallback"
                    log.warning("pipeline.ocr_failed_using_pdf_text_fallback", error=str(ocr_error), chars=len(raw_text))
                else:
                    # Final fallback: continue with image-only extraction via LLM.
                    raw_text = ""
                    avg_confidence = 0.0
                    ocr_engine_used = "llm_image_only"
                    ocr_failed_without_text = True
                    log.warning("pipeline.ocr_failed_using_image_only_fallback", error=str(ocr_error))
            else:
                raw_text = "\n\n--- PAGE BREAK ---\n\n".join(r.text for r in page_results)
                avg_confidence = sum(r.confidence for r in page_results) / max(len(page_results), 1)
                log.info("pipeline.ocr_done", confidence=round(avg_confidence, 3), chars=len(raw_text))
                if not raw_text.strip():
                    log.warning("pipeline.ocr_empty_text", pages=len(images))

        # Step 4: Classify document type
        if hint_type:
            doc_type = hint_type
        elif raw_text.strip():
            doc_type = await self.classifier.classify(raw_text[:2000])
        elif ocr_failed_without_text:
            doc_type = _guess_type_from_key(s3_key)
            log.warning("pipeline.classifier_fallback_from_key", doc_type=doc_type)
        else:
            doc_type = "generic"
        log.info("pipeline.classified", doc_type=doc_type)

        # Step 5: LLM structured extraction
        # If we have sufficient text, send text-only to reduce latency and cost.
        min_text_for_text_only = int(os.getenv("LLM_TEXT_ONLY_THRESHOLD", "2000"))
        if len(raw_text.strip()) >= min_text_for_text_only:
            images_for_llm: list[bytes] = []
        else:
            # Reduce payload size for long documents to avoid LLM timeouts.
            max_images = 1 if len(raw_text) > 10000 else 3
            images_for_llm = images[:max_images]

        fields, token_count = await self.llm.extract(
            raw_text=raw_text,
            document_type=doc_type,
            images=images_for_llm,
        )
        log.info("pipeline.llm_done", tokens=token_count)

        duration_ms = int((time.time() - start) * 1000)
        log.info("pipeline.complete", duration_ms=duration_ms)

        return ExtractionResult(
            document_id=document_id,
            document_type=doc_type,
            raw_text=raw_text,
            ocr_confidence=avg_confidence,
            ocr_engine=ocr_engine_used,
            extracted_fields=fields,
            extraction_model=self.llm.model,
            page_count=len(images),
            processing_duration_ms=duration_ms,
            token_count=token_count,
        )
