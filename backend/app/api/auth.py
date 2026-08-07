import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import verify_admin_token
from app.db.session import get_db
from app.models.orm import AuditLog, FeatureFlag, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class GoogleSignInRequest(BaseModel):
    email: str
    name: str
    avatar_url: Optional[str] = None


class AdminVerifyRequest(BaseModel):
    passcode: str


class AuditLogOut(BaseModel):
    id: str
    user_email: str
    action: str
    details: Optional[str] = None
    ip_address: Optional[str] = None
    timestamp: datetime


class FeatureFlagOut(BaseModel):
    name: str
    enabled: bool
    description: Optional[str] = None


class FeatureFlagUpdate(BaseModel):
    enabled: bool


@router.post("/google-signin")
def google_signin(payload: GoogleSignInRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=payload.email).first()
    client_ip = request.client.host if request.client else "127.0.0.1"

    if not user:
        user = User(
            id=f"user-{uuid4().hex[:8]}",
            email=payload.email,
            name=payload.name,
            avatar_url=payload.avatar_url,
            role="user",
        )
        db.add(user)
    else:
        user.name = payload.name
        if payload.avatar_url:
            user.avatar_url = payload.avatar_url
        user.last_login_at = datetime.now(timezone.utc)

    # Audit log login event
    log_entry = AuditLog(
        id=f"log-{uuid4().hex[:8]}",
        user_email=payload.email,
        action="LOGIN",
        details=f"User signed in via Google OAuth ({payload.name})",
        ip_address=client_ip,
    )
    db.add(log_entry)
    db.commit()

    return {
        "token": f"bearer-token-{user.id}",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "role": user.role,
        },
    }


@router.post("/admin-verify")
def admin_verify(payload: AdminVerifyRequest, request: Request, db: Session = Depends(get_db)):
    expected_key = getattr(settings, "admin_secret_key", "DocMind#Admin2026!Secure")
    if payload.passcode.strip() != expected_key:
        client_ip = request.client.host if request.client else "127.0.0.1"
        log_entry = AuditLog(
            id=f"log-{uuid4().hex[:8]}",
            user_email="system@security",
            action="SECURITY_ALERT",
            details="Failed admin passcode verification attempt",
            ip_address=client_ip,
        )
        db.add(log_entry)
        db.commit()
        raise HTTPException(status_code=403, detail="Invalid Admin Key")

    return {"verified": True, "admin_token": expected_key}


@router.get("/audit-logs", response_model=List[AuditLogOut])
def get_audit_logs(
    db: Session = Depends(get_db),
    is_admin: bool = Depends(verify_admin_token),
):
    return db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(100).all()


@router.get("/flags", response_model=List[FeatureFlagOut])
def get_feature_flags(db: Session = Depends(get_db)):
    flags = db.query(FeatureFlag).all()
    return [
        FeatureFlagOut(name=f.name, enabled=bool(f.enabled), description=f.description)
        for f in flags
    ]


@router.patch("/flags/{name}", response_model=FeatureFlagOut)
def toggle_feature_flag(
    name: str,
    payload: FeatureFlagUpdate,
    db: Session = Depends(get_db),
    is_admin: bool = Depends(verify_admin_token),
):
    flag = db.query(FeatureFlag).filter_by(name=name).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Feature flag not found")

    flag.enabled = 1 if payload.enabled else 0
    flag.updated_at = datetime.now(timezone.utc)
    db.commit()

    return FeatureFlagOut(name=flag.name, enabled=bool(flag.enabled), description=flag.description)
