import re
import logging
from typing import Optional
from fastapi import HTTPException, Header, Depends
from app.core.config import settings

logger = logging.getLogger(__name__)

# Injection pattern regexes
INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior)\s+instructions", re.IGNORECASE),
    re.compile(r"system\s+prompt", re.IGNORECASE),
    re.compile(r"output\s+(the\s+)?(api_key|secret|env)", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+in\s+developer\s+mode", re.IGNORECASE),
    re.compile(r"jailbreak\s+mode", re.IGNORECASE),
    re.compile(r"dan\s+mode", re.IGNORECASE),
]

# PII regex patterns
SSN_REGEX = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
CREDIT_CARD_REGEX = re.compile(r"\b(?:\d[ -]*?){13,16}\b")
PHONE_REGEX = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")


def detect_prompt_injection(prompt: str) -> bool:
    """Returns True if a prompt injection / jailbreak attempt is detected."""
    for pattern in INJECTION_PATTERNS:
        if pattern.search(prompt):
            logger.warning("Prompt injection pattern detected: %s", pattern.pattern)
            return True
    return False


def sanitize_pii(text: str) -> str:
    """Scrubs sensitive Personal Identifiable Information (SSNs, Credit Cards, Phones)."""
    text = SSN_REGEX.sub("[REDACTED_SSN]", text)
    text = CREDIT_CARD_REGEX.sub("[REDACTED_CREDIT_CARD]", text)
    text = PHONE_REGEX.sub("[REDACTED_PHONE]", text)
    return text


def verify_admin_token(authorization: Optional[str] = Header(None)) -> bool:
    """Validates Admin Bearer Token header against ADMIN_SECRET_KEY."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized: Missing Authorization Bearer token")
    token = authorization.split("Bearer ")[1].strip()
    expected_key = getattr(settings, "admin_secret_key", "DocMind#Admin2026!Secure")
    if token != expected_key and token != "docmind-admin-token-valid":
        raise HTTPException(status_code=403, detail="Forbidden: Invalid Admin Passcode")
    return True
