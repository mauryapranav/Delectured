"""
Recordings storage routes:
  POST   /api/recordings/upload     — upload recording to Supabase Storage (returns signed URL)
  GET    /api/recordings            — list user's recordings
  GET    /api/recordings/{id}       — get recording metadata + signed download URL
  DELETE /api/recordings/{id}       — delete recording
"""
import os
import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from services.supabase_client import get_supabase
from middleware.auth import get_current_user

router = APIRouter()

# Supabase Storage bucket name
RECORDINGS_BUCKET = "recordings"


class RecordingCreateRequest(BaseModel):
    filename: str
    content_type: str
    file_size: int
    duration_seconds: Optional[float] = None
    session_id: Optional[str] = None


class RecordingResponse(BaseModel):
    id: str
    filename: str
    content_type: str
    file_size: int
    duration_seconds: Optional[float]
    session_id: Optional[str]
    created_at: str
    download_url: str


@router.post("/recordings/upload")
async def upload_recording(
    file: UploadFile = File(...),
    duration_seconds: float = Form(None),
    session_id: str = Form(None),
    user_id: str = Depends(get_current_user)
):
    """
    Upload a recording file to Supabase Storage.
    Returns signed download URL.
    """
    supabase = get_supabase()
    
    # Validate file
    if not file.content_type or not file.content_type.startswith('audio/'):
        raise HTTPException(status_code=400, detail="File must be an audio file")
    
    # Read file content
    file_content = await file.read()
    file_size = len(file_content)
    
    # Check file size (max 500MB for recordings)
    if file_size > 500 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 500MB)")
    
    # Generate unique path
    file_ext = os.path.splitext(file.filename)[1] or '.webm'
    storage_path = f"{user_id}/{uuid.uuid4()}{file_ext}"
    
    try:
        # Upload to Supabase Storage
        result = supabase.storage.from_(RECORDINGS_BUCKET).upload(
            path=storage_path,
            file=file_content,
            file_options={"content-type": file.content_type, "upsert": "false"}
        )
        
        if hasattr(result, 'error') and result.error:
            raise HTTPException(status_code=500, detail=f"Storage upload failed: {result.error.message}")
        
        # Create database record
        recording_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        
        db_result = supabase.table("recordings").insert({
            "id": recording_id,
            "user_id": user_id,
            "filename": file.filename,
            "storage_path": storage_path,
            "content_type": file.content_type,
            "file_size": file_size,
            "duration_seconds": duration_seconds,
            "session_id": session_id,
            "created_at": now
        }).execute()
        
        if not db_result.data:
            # Cleanup storage on DB failure
            supabase.storage.from_(RECORDINGS_BUCKET).remove([storage_path])
            raise HTTPException(status_code=500, detail="Failed to create recording record")
        
        # Generate signed URL (1 hour expiry)
        signed_url_result = supabase.storage.from_(RECORDINGS_BUCKET).create_signed_url(storage_path, 3600)
        download_url = signed_url_result.get('signedURL') if isinstance(signed_url_result, dict) else signed_url_result
        
        return RecordingResponse(
            id=recording_id,
            filename=file.filename,
            content_type=file.content_type,
            file_size=file_size,
            duration_seconds=duration_seconds,
            session_id=session_id,
            created_at=now,
            download_url=download_url
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.get("/recordings")
async def list_recordings(user_id: str = Depends(get_current_user)):
    """List all recordings for the current user."""
    supabase = get_supabase()
    
    result = supabase.table("recordings") \
        .select("id, filename, content_type, file_size, duration_seconds, session_id, created_at, storage_path") \
        .eq("user_id", user_id) \
        .order("created_at", desc=True) \
        .execute()
    
    recordings = result.data or []
    
    # Generate signed URLs for each
    for rec in recordings:
        signed_url_result = supabase.storage.from_(RECORDINGS_BUCKET).create_signed_url(rec["storage_path"], 3600)
        rec["download_url"] = signed_url_result.get('signedURL') if isinstance(signed_url_result, dict) else signed_url_result
    
    return recordings


@router.get("/recordings/{recording_id}")
async def get_recording(recording_id: str, user_id: str = Depends(get_current_user)):
    """Get recording metadata and signed download URL."""
    supabase = get_supabase()
    
    result = supabase.table("recordings") \
        .select("*") \
        .eq("id", recording_id) \
        .eq("user_id", user_id) \
        .single() \
        .execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    rec = result.data
    signed_url_result = supabase.storage.from_(RECORDINGS_BUCKET).create_signed_url(rec["storage_path"], 3600)
    rec["download_url"] = signed_url_result.get('signedURL') if isinstance(signed_url_result, dict) else signed_url_result
    
    return rec


@router.delete("/recordings/{recording_id}")
async def delete_recording(recording_id: str, user_id: str = Depends(get_current_user)):
    """Delete a recording (both storage and DB record)."""
    supabase = get_supabase()
    
    # Get recording first
    result = supabase.table("recordings") \
        .select("storage_path") \
        .eq("id", recording_id) \
        .eq("user_id", user_id) \
        .single() \
        .execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Recording not found")
    
    storage_path = result.data["storage_path"]
    
    # Delete from storage
    supabase.storage.from_(RECORDINGS_BUCKET).remove([storage_path])
    
    # Delete from database
    supabase.table("recordings") \
        .delete() \
        .eq("id", recording_id) \
        .eq("user_id", user_id) \
        .execute()
    
    return {"success": True}