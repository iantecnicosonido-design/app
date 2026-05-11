"""Authentication module: User model, JWT, bcrypt, role-based access."""
import os
import uuid
import bcrypt
import jwt
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from pydantic import BaseModel, Field, EmailStr
from fastapi import HTTPException, Request, Depends


JWT_ALGORITHM = "HS256"
ACCESS_MINUTES = 60 * 24 * 7  # 7 días para uso interno
REFRESH_DAYS = 30


# ---------- Models ----------
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    password_hash: str = ""
    name: str = ""
    phone: str = ""
    role: str = "tecnico"  # productor | almacen | tecnico | taller
    active: bool = True
    protected: bool = False  # cuentas internas (taller, almacen) que no se pueden borrar/desactivar
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    phone: str = ""
    role: str
    active: bool


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""
    phone: str = ""
    role: str = "tecnico"


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


ROLES = ("productor", "almacen", "tecnico", "taller")


# ---------- Hashing ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ---------- JWT ----------
def _secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id, "email": email, "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_MINUTES),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id, "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_DAYS),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])


def set_auth_cookies(response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False,
                        samesite="lax", max_age=ACCESS_MINUTES * 60, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False,
                        samesite="lax", max_age=REFRESH_DAYS * 86400, path="/")


def clear_auth_cookies(response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


# ---------- Dependencies (factory pattern with db) ----------
def make_auth_dependencies(db):
    async def get_current_user(request: Request) -> dict:
        token = request.cookies.get("access_token")
        if not token:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if not token:
            raise HTTPException(401, "No autenticado")
        try:
            payload = decode_token(token)
            if payload.get("type") != "access":
                raise HTTPException(401, "Token inválido")
        except jwt.ExpiredSignatureError:
            raise HTTPException(401, "Token expirado")
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Token inválido")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        if not user or not user.get("active", True):
            raise HTTPException(401, "Usuario no encontrado o desactivado")
        user.pop("password_hash", None)
        return user

    def require_role(*roles: str):
        async def checker(user: dict = Depends(get_current_user)):
            if user.get("role") not in roles:
                raise HTTPException(403, "Permisos insuficientes")
            return user
        return checker

    return get_current_user, require_role


def gen_reset_token() -> str:
    return secrets.token_urlsafe(32)
