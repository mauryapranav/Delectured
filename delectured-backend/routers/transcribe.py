"""
POST /api/transcribe
Receives an MP3 audio chunk from the frontend and proxies it to Groq Whisper.
Does NOT count toward usage — usage is only counted on successful Stage 2.
"""
import os
import httpx
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Request
from middleware.auth import get_current_user
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

# Rate limiter for transcribe endpoint (per-user, per-minute)
limiter = Limiter(key_func=lambda request: request.headers.get("Authorization", get_remote_address(request)))

# Validation constants
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB per chunk (Groq limit)
ALLOWED_MIME_TYPES = {
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
    'audio/ogg', 'audio/flac', 'audio/webm', 'audio/amr', 'audio/aac',
    'video/mp4'
}
MAX_DURATION_SECONDS = 600  # 10 minutes per chunk (matches frontend CHUNK_DURATION)


def validate_audio_file(file: UploadFile, chunk_index: int) -> None:
    """Validate uploaded audio chunk before proxying to Groq."""
    # Check MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
        )
    
    # Check file size (read to check, then seek back)
    file.file.seek(0, 2)  # Seek to end
    size = file.file.tell()
    file.file.seek(0)  # Seek back to start
    
    if size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Chunk {chunk_index + 1} exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit (got {size // (1024*1024)}MB)"
        )
    
    if size == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Chunk {chunk_index + 1} is empty"
        )


@router.post("/transcribe")
@limiter.limit("20/minute")
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form(None),
    chunk_index: int = Form(0),
    total_chunks: int = Form(1),
    user_id: str = Depends(get_current_user)
):
    """
    Proxy an audio chunk to Groq Whisper large-v3-turbo.
    Returns: { "text": "transcribed text..." }
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")

    # Validate file before processing
    validate_audio_file(file, chunk_index)

    file_content = await file.read()

    # Build multipart form for Groq
    form_fields = {"model": (None, "whisper-large-v3-turbo"), "response_format": (None, "json")}
    if language and language not in ("auto", "null", ""):
        form_fields["language"] = (None, language)

    files_payload = {"file": ("lecture_segment.mp3", file_content, "audio/mpeg")}

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                GROQ_TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                data={k: v[1] for k, v in form_fields.items()},
                files=files_payload
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Groq transcription request timed out")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Groq API: {str(e)}")

    if not resp.is_success:
        # Pass Groq's error through
        try:
            error_detail = resp.json()
        except Exception:
            error_detail = {"error": resp.text}
        raise HTTPException(status_code=resp.status_code, detail=error_detail)

    return resp.json()
