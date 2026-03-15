import base64
import json

import httpx

from app.config import settings
from app.models.document_types import EXTRACTION_SCHEMAS

SYSTEM_PROMPT = """You are a document data extraction specialist.
Extract structured data from the provided document text and images.
Return ONLY valid JSON matching the provided schema. No explanations, no markdown fences.
Be precise: dates must be ISO 8601, currencies must be 3-letter codes, amounts must be numbers.
If a field cannot be determined with confidence, use null."""


class GeminiExtractionService:
    def __init__(self):
        self.api_key = settings.gemini_api_key
        self.model = settings.llm_model
        self.url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        )

    async def extract(self, raw_text: str, document_type: str, images: list[bytes]):
        if not self.api_key:
            raise RuntimeError("Missing GEMINI_API_KEY for AI extraction")

        schema = EXTRACTION_SCHEMAS.get(document_type, EXTRACTION_SCHEMAS["generic"])
        parts = [
            {
                "text": (
                    f"{SYSTEM_PROMPT}\n\n"
                    f"Document Type: {document_type}\n\n"
                    f"OCR Extracted Text:\n{raw_text[:8000]}\n\n"
                    f"Required JSON Schema:\n{json.dumps(schema, indent=2)}\n\n"
                    "Extract all fields and return only the JSON object."
                )
            }
        ]

        # Add first 3 page images for visual context.
        for img_bytes in images[:3]:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(img_bytes).decode(),
                    }
                }
            )

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                self.url,
                headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()

        data = response.json()
        candidates = data.get("candidates") or []
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")

        parts = candidates[0].get("content", {}).get("parts", [])
        raw = "".join(part.get("text", "") for part in parts).strip()

        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        fields = json.loads(raw)
        usage = data.get("usageMetadata", {})
        token_count = usage.get("totalTokenCount")

        return fields, token_count
