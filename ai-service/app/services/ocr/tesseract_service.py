import pytesseract
from PIL import Image
import io
from app.models.extraction import OCRPageResult


class TesseractOCRService:
    """
    Tesseract OCR — lighter than PaddleOCR, works on Render starter plan.
    For higher accuracy on complex documents, swap to Google Vision API or AWS Textract.
    """

    async def extract_page(self, image_bytes: bytes, page_number: int = 1) -> OCRPageResult:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Get text with confidence data
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

        words, confidences = [], []
        for i, word in enumerate(data["text"]):
            word = word.strip()
            conf = int(data["conf"][i])
            if word and conf > 0:
                words.append(word)
                confidences.append(conf / 100.0)

        text = " ".join(words)
        confidence = sum(confidences) / len(confidences) if confidences else 0.0

        return OCRPageResult(page_number=page_number, text=text, confidence=confidence)
