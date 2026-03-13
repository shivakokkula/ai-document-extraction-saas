import re

PATTERNS = {
    "invoice": [r"invoice", r"bill to", r"invoice #", r"due date", r"amount due", r"tax invoice"],
    "receipt":  [r"receipt", r"thank you for your purchase", r"total paid", r"payment received"],
    "bank_statement": [r"bank statement", r"account statement", r"opening balance", r"closing balance", r"transaction history"],
}

class DocumentClassifier:
    async def classify(self, text: str) -> str:
        text_lower = text.lower()
        scores = {doc_type: 0 for doc_type in PATTERNS}
        for doc_type, patterns in PATTERNS.items():
            for pat in patterns:
                if re.search(pat, text_lower):
                    scores[doc_type] += 1
        best = max(scores, key=scores.get)
        return best if scores[best] > 0 else "generic"
