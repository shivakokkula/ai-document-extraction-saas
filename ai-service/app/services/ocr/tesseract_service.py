import pytesseract
from PIL import Image, ImageFilter, ImageOps
import io
import os
from app.models.extraction import OCRPageResult


class TesseractOCRService:
    """
    Tesseract OCR — lighter than PaddleOCR, works on Render starter plan.
    For higher accuracy on complex documents, swap to Google Vision API or AWS Textract.
    """

    async def extract_page(self, image_bytes: bytes, page_number: int = 1) -> OCRPageResult:
        if os.getenv("TESSERACT_CMD"):
            pytesseract.pytesseract.tesseract_cmd = os.getenv("TESSERACT_CMD")

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Light preprocessing to improve OCR quality on scans.
        gray = img.convert("L")
        gray = ImageOps.autocontrast(gray)
        gray = gray.filter(ImageFilter.MedianFilter(size=3))
        # Simple binarization
        bw = gray.point(lambda x: 0 if x < 180 else 255, mode="1")
        img = bw.convert("RGB")

        # Get text with confidence data
        lang = os.getenv("TESSERACT_LANG", "eng")
        psm = os.getenv("TESSERACT_PSM", "6")
        oem = os.getenv("TESSERACT_OEM", "1")
        config = f"--oem {oem} --psm {psm}"
        data = pytesseract.image_to_data(
            img,
            output_type=pytesseract.Output.DICT,
            lang=lang,
            config=config,
        )

        words, confidences = [], []
        for i, word in enumerate(data["text"]):
            word = word.strip()
            try:
                conf = float(data["conf"][i])
            except (TypeError, ValueError):
                conf = -1
            if word and conf > 0:
                words.append(word)
                confidences.append(min(conf, 100.0) / 100.0)

        text = " ".join(words)
        confidence = sum(confidences) / len(confidences) if confidences else 0.0

        return OCRPageResult(page_number=page_number, text=text, confidence=confidence)
