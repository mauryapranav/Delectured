"""
POST /api/chat
Streaming Q&A over lecture notes. Proxies Groq's SSE stream back to the client.
Does NOT count toward monthly usage limit.
"""
import os
import json
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, Dict, List

from middleware.auth import get_current_user

router = APIRouter()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"


class ChatRequest(BaseModel):
    message: str
    context: Dict[str, Any] = {}
    history: List[Dict[str, str]] = []


@router.post("/chat")
async def chat_with_notes(
    body: ChatRequest,
    user_id: str = Depends(get_current_user)
):
    """
    Streams a contextual Q&A response grounded in the lecture notes.
    Returns Server-Sent Events (same format as Groq's streaming output).
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    # Truncate context to avoid token overflow
    context_str = json.dumps(body.context)[:8000]

    system_prompt = (
        "You are a professional academic assistant for the lecture notes provided. "
        "Answer ONLY from the lecture content. If a question wasn't covered, say so explicitly. "
        "Format responses with **bold** for key terms. Break long answers into paragraphs. "
        f"Lecture Context: {context_str}"
    )

    messages = [{"role": "system", "content": system_prompt}]
    # Include any history passed from the frontend
    for h in body.history:
        if isinstance(h, dict) and h.get("role") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": body.message})

    async def stream_from_groq():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    GROQ_CHAT_URL,
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": messages,
                        "stream": True
                    }
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line:
                            yield f"{line}\n\n"
        except Exception as e:
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

    return StreamingResponse(
        stream_from_groq(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"  # Disable Nginx buffering for streaming
        }
    )
