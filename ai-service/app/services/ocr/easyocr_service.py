import os
import io
import asyncio
from typing import Optional

import easyocr
import numpy as np
from PIL import Image

from app.models.extraction import OCRPageResult


_reader: Optional[easyocr.Reader] = None
_reader_lock = asyncio.Lock()


async def _get_reader() -> easyocr.Reader:
    global _reader
    if _reader is not None:
        return _reader
    async with _reader_lock:
        if _reader is None:
            langs = os.getenv("EASYOCR_LANGS", "en").split(",")
            gpu = os.getenv("EASYOCR_GPU", "false").lower() == "true"
            _reader = easyocr.Reader(langs, gpu=gpu)
    return _reader


class EasyOCRService:
    """
    EasyOCR — all-in-one OCR without system-level Tesseract.
    Uses PyTorch under the hood.
    """

    async def extract_page(self, image_bytes: bytes, page_number: int = 1) -> OCRPageResult:
        reader = await _get_reader()

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_np = np.array(img)

        # EasyOCR is sync; run in a thread.
        results = await asyncio.to_thread(reader.readtext, img_np)

        words, confidences = [], []
        for (_bbox, text, conf) in results:
            text = text.strip()
            if text:
                words.append(text)
                confidences.append(float(conf))

        extracted = " ".join(words)
        confidence = sum(confidences) / len(confidences) if confidences else 0.0

        return OCRPageResult(page_number=page_number, text=extracted, confidence=confidence)
