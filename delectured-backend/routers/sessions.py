"""
Session CRUD routes:
  POST   /api/sessions              — save a new processed lecture session
  GET    /api/sessions              — list user's sessions (metadata only, no full JSON)
  GET    /api/sessions/{id}         — fetch full session including output_json
  PATCH  /api/sessions/{id}/title   — rename a session
  DELETE /api/sessions/{id}         — delete a session
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from middleware.auth import get_current_user
from services.supabase_client import get_supabase

router = APIRouter()


class SessionCreateRequest(BaseModel):
    output_json: Dict[str, Any]
    audio_duration_minutes: Optional[float] = None


class TitleUpdateRequest(BaseModel):
    title: str


def _auto_generate_title(output_json: dict) -> str:
    """Generate a session title from the first 8 words of the summary."""
    try:
        summary = output_json.get("notes", {}).get("summary", "").strip()
        if not summary:
            # Fall back to topics if summary is empty
            topics = output_json.get("notes", {}).get("topics", [])
            if topics:
                return topics[0][:80]
            return "Untitled Lecture"
        words = summary.split()
        title = " ".join(words[:8])
        if len(words) > 8:
            title += "..."
        return title
    except Exception:
        return "Untitled Lecture"


@router.post("/sessions")
def create_session(
    body: SessionCreateRequest,
    user_id: str = Depends(get_current_user)
):
    """Save processed lecture output. Auto-generates a title from the summary."""
    supabase = get_supabase()
    title = _auto_generate_title(body.output_json)

    result = supabase.table("sessions").insert({
        "user_id": user_id,
        "title": title,
        "output_json": body.output_json,
        "audio_duration_minutes": body.audio_duration_minutes
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save session to database")

    return {"session_id": result.data[0]["id"], "title": title}


@router.get("/sessions")
def list_sessions(user_id: str = Depends(get_current_user)):
    """Return metadata for all user sessions, ordered newest first. Does NOT include output_json."""
    supabase = get_supabase()
    result = supabase.table("sessions") \
        .select("id, title, created_at, audio_duration_minutes") \
        .eq("user_id", user_id) \
        .order("created_at", desc=True) \
        .execute()
    return result.data or []


@router.get("/sessions/{session_id}")
def get_session(
    session_id: str,
    user_id: str = Depends(get_current_user)
):
    """Fetch the full session including output_json. Verifies ownership via user_id."""
    supabase = get_supabase()
    result = supabase.table("sessions") \
        .select("*") \
        .eq("id", session_id) \
        .eq("user_id", user_id) \
        .single() \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found or access denied")

    return result.data


@router.patch("/sessions/{session_id}/title")
def update_title(
    session_id: str,
    body: TitleUpdateRequest,
    user_id: str = Depends(get_current_user)
):
    """Update the session title. Verifies ownership."""
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty")

    supabase = get_supabase()
    result = supabase.table("sessions").update({
        "title": body.title.strip()[:200],  # cap at 200 chars
        "updated_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", session_id).eq("user_id", user_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found or access denied")

    return {"success": True, "title": body.title.strip()}


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: str,
    user_id: str = Depends(get_current_user)
):
    """Delete a session. Verifies ownership."""
    supabase = get_supabase()
    supabase.table("sessions") \
        .delete() \
        .eq("id", session_id) \
        .eq("user_id", user_id) \
        .execute()
    return {"success": True}
