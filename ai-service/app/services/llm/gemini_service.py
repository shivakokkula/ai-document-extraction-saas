import base64
import json
import os

import httpx
import asyncio
from typing import Optional

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
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self, timeout: float) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=timeout)
        return self._client

    async def aclose(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def extract(self, raw_text: str, document_type: str, images: list[bytes]):
        if not self.api_key:
            raise RuntimeError("Missing GEMINI_API_KEY for AI extraction")

        schema = EXTRACTION_SCHEMAS.get(document_type, EXTRACTION_SCHEMAS["generic"])
        # For long documents, keep both the beginning and ending context.
        if len(raw_text) > 8000:
            raw_text = f"{raw_text[:4000]}\n\n...snip...\n\n{raw_text[-3000:]}"

        parts = [
            {
                "text": (
                    f"{SYSTEM_PROMPT}\n\n"
                    f"Document Type: {document_type}\n\n"
                    f"OCR Extracted Text:\n{raw_text[:7000]}\n\n"
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

        timeout = float(os.getenv("LLM_HTTP_TIMEOUT", "30"))
        max_retries = int(os.getenv("LLM_HTTP_RETRIES", "0"))
        client = self._get_client(timeout)
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                response = await client.post(
                    self.url,
                    headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                    json=payload,
                )
                response.raise_for_status()
                break
            except (httpx.ReadTimeout, httpx.ConnectTimeout) as e:
                last_error = e
            except httpx.HTTPStatusError as e:
                last_error = e
                status = e.response.status_code
                if status not in (408, 429, 500, 502, 503, 504):
                    raise

            if attempt >= max_retries:
                raise last_error
            await asyncio.sleep(2 * (attempt + 1))

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

        def _try_parse_json(text: str):
            return json.loads(text)

        def _extract_json_block(text: str) -> str:
            start = text.find("{")
            end = text.rfind("}")
            if start != -1 and end != -1 and end > start:
                return text[start:end + 1]
            return text

        try:
            fields = _try_parse_json(raw)
        except json.JSONDecodeError:
            # Attempt to parse the first full JSON object in the response.
            candidate = _extract_json_block(raw)
            try:
                fields = _try_parse_json(candidate)
            except json.JSONDecodeError:
                # Last resort: ask the model to fix JSON formatting.
                fix_parts = [
                    {
                        "text": (
                            "Fix the following to valid JSON only. "
                            "Return ONLY the corrected JSON object, no extra text.\n\n"
                            f"{raw}"
                        )
                    }
                ]
                fix_payload = {
                    "contents": [{"role": "user", "parts": fix_parts}],
                    "generationConfig": {
                        "temperature": 0.0,
                        "responseMimeType": "application/json",
                    },
                }
                fix_response = await client.post(
                    self.url,
                    headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                    json=fix_payload,
                )
                fix_response.raise_for_status()
                fix_data = fix_response.json()
                fix_parts_out = (fix_data.get("candidates") or [])[0].get("content", {}).get("parts", [])
                fix_raw = "".join(part.get("text", "") for part in fix_parts_out).strip()
                fix_raw = _extract_json_block(fix_raw)
                fields = _try_parse_json(fix_raw)
        usage = data.get("usageMetadata", {})
        token_count = usage.get("totalTokenCount")

        return fields, token_count
