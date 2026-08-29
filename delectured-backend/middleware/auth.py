"""
Auth middleware — verifies Supabase JWT tokens on every protected route.
Extracts user_id and attaches it via FastAPI Depends.
"""
import os
from fastapi import Header, HTTPException
from services.supabase_client import get_supabase


async def get_current_user(authorization: str = Header(None)) -> str:
    """
    Dependency: validates Bearer JWT from Supabase and returns the user's UUID.
    Raises HTTP 401 if token is missing, malformed, or invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Expected: Bearer <token>"
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")

    try:
        supabase = get_supabase()
        # supabase-py v2: get_user verifies the JWT against Supabase's auth server
        response = supabase.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return response.user.id
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")
