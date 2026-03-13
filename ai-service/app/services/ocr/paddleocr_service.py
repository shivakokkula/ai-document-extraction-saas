from paddleocr import PaddleOCR
from app.models.extraction import OCRPageResult
import numpy as np
from PIL import Image
import io

_ocr_instance = None

def get_ocr():
    global _ocr_instance
    if _ocr_instance is None:
        _ocr_instance = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            show_log=False,
            use_gpu=False,
        )
    return _ocr_instance

class PaddleOCRService:
    def __init__(self):
        self.ocr = get_ocr()

    async def extract_page(self, image_bytes: bytes, page_number: int = 1) -> OCRPageResult:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_array = np.array(img)

        result = self.ocr.ocr(img_array, cls=True)
        lines, confidences = [], []

        if result and result[0]:
            for line in result[0]:
                if line and len(line) >= 2:
                    text_info = line[1]
                    if isinstance(text_info, (list, tuple)) and len(text_info) >= 2:
                        lines.append(str(text_info[0]))
                        confidences.append(float(text_info[1]))

        text = "\n".join(lines)
        confidence = sum(confidences) / len(confidences) if confidences else 0.0

        return OCRPageResult(page_number=page_number, text=text, confidence=confidence)
