import anthropic
import json
import base64
from app.config import settings
from app.models.document_types import EXTRACTION_SCHEMAS

SYSTEM_PROMPT = """You are a document data extraction specialist.
Extract structured data from the provided document text and images.
Return ONLY valid JSON matching the provided schema. No explanations, no markdown fences.
Be precise: dates must be ISO 8601, currencies must be 3-letter codes, amounts must be numbers.
If a field cannot be determined with confidence, use null."""

class ClaudeExtractionService:
    def __init__(self):
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.llm_model

    async def extract(self, raw_text: str, document_type: str, images: list[bytes]):
        schema = EXTRACTION_SCHEMAS.get(document_type, EXTRACTION_SCHEMAS["generic"])
        content = []

        # Add first 3 page images for visual context
        for img_bytes in images[:3]:
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": base64.b64encode(img_bytes).decode(),
                },
            })

        content.append({
            "type": "text",
            "text": (
                f"Document Type: {document_type}\n\n"
                f"OCR Extracted Text:\n{raw_text[:8000]}\n\n"
                f"Required JSON Schema:\n{json.dumps(schema, indent=2)}\n\n"
                "Extract all fields and return only the JSON object."
            ),
        })

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )

        raw = response.content[0].text.strip()
        # Strip accidental markdown fences
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        fields = json.loads(raw)
        token_count = response.usage.input_tokens + response.usage.output_tokens

        return fields, token_count
