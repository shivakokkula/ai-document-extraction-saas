import fitz  # PyMuPDF
import io
from PIL import Image

async def pdf_to_images(pdf_bytes: bytes, dpi: int = 200) -> list[bytes]:
    """Convert each PDF page to a JPEG image."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    for page in doc:
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        images.append(buf.getvalue())
    doc.close()
    return images


async def pdf_extract_text_pages(pdf_bytes: bytes) -> list[str]:
    """Extract selectable text from each PDF page (fast path for digital PDFs)."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    texts: list[str] = []
    for page in doc:
        texts.append((page.get_text("text") or "").strip())
    doc.close()
    return texts
