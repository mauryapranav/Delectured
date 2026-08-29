"""
POST /api/analyze/stage1  — Fast domain detection via llama-3.1-8b-instant
POST /api/analyze/stage2  — Full study guide generation via llama-3.3-70b-versatile
                             This is the ONLY endpoint that increments usage_count.
"""
import os
import httpx
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any, Dict

from middleware.auth import get_current_user
from services.supabase_client import get_supabase

router = APIRouter()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
MONTHLY_LIMIT = int(os.getenv("MONTHLY_LIMIT", "4"))


class Stage1Request(BaseModel):
    transcript: str


class Stage2Request(BaseModel):
    transcript: str
    stage1_context: Dict[str, Any] = {}


@router.post("/analyze/stage1")
async def analyze_stage1(
    body: Stage1Request,
    user_id: str = Depends(get_current_user)
):
    """
    Fast structural analysis: detects domain and subject from first 5000 chars.
    Uses llama-3.1-8b-instant. Does NOT count toward monthly limit.
    Returns the raw Groq response (frontend parses choices[0].message.content).
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    prompt = (
        'Analyze domain and subject. Return ONLY valid JSON with exactly these fields: '
        '{ "domain": "Computer Science", "subject": "Internet of Things" }. '
        f'Transcript: {body.transcript[:5000]}'
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                GROQ_CHAT_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"}
                }
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Stage 1 analysis timed out")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Groq API: {str(e)}")

    if not resp.is_success:
        try:
            raise HTTPException(status_code=resp.status_code, detail=resp.json())
        except Exception:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

    return resp.json()


def _check_and_maybe_reset_usage(user_id: str):
    """
    Reads the user's profile, applies monthly reset if needed, and returns current count.
    Raises HTTP 429 if user is at or over their limit.
    """
    supabase = get_supabase()
    today = date.today()

    resp = supabase.table("profiles") \
        .select("usage_count, usage_reset_date") \
        .eq("id", user_id) \
        .single() \
        .execute()

    if not resp.data:
        raise HTTPException(status_code=404, detail="User profile not found. Please sign in again.")

    profile = resp.data
    reset_date_str = profile["usage_reset_date"]
    reset_date = date.fromisoformat(reset_date_str)

    # Monthly reset: if last reset was in a different month/year, zero out the counter
    if reset_date.year != today.year or reset_date.month != today.month:
        supabase.table("profiles").update({
            "usage_count": 0,
            "usage_reset_date": today.isoformat()
        }).eq("id", user_id).execute()
        current_count = 0
    else:
        current_count = profile["usage_count"]

    if current_count >= MONTHLY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "monthly_limit_reached",
                "limit": MONTHLY_LIMIT,
                "used": current_count,
                "message": f"You have used all {MONTHLY_LIMIT} free lectures this month. Your limit resets on the 1st of next month."
            }
        )

    return current_count


@router.post("/analyze/stage2")
async def analyze_stage2(
    body: Stage2Request,
    user_id: str = Depends(get_current_user)
):
    """
    Full study guide generation using llama-3.3-70b-versatile.
    CHECK: verifies and resets monthly usage count BEFORE calling Groq.
    INCREMENT: increments usage_count only AFTER a successful Groq response.
    Returns the raw Groq response (frontend parses choices[0].message.content).
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    # Rate limit check — raises 429 if over limit
    current_count = _check_and_maybe_reset_usage(user_id)

    analysis = body.stage1_context
    transcript = body.transcript
    word_count = len(transcript.split())
    domain = analysis.get("domain", "General")

    prompt = f"""You are a Subject Matter Expert in {domain}.
TASK: Transform this {word_count}-word transcript into an EXHAUSTIVE, high-density study guide.
1. SUMMARY: Minimum 500 words technical explanation of the core thesis and all key ideas.
2. CONCEPTS: Extract at least 20 concepts with deep, precise definitions.
3. CONCEPT GRAPH: JSON with \"nodes\" (id, label) and \"links\" (source, target, label).
Return ONLY valid JSON — no markdown, no extra text:
{{
  \"notes\": {{
    \"summary\": \"Full detailed analysis (500+ words)...\",
    \"topics\": [\"Topic 1\", \"...\"],
    \"concepts\": [{{ \"term\": \"...\", \"explanation\": \"Deep definition...\", \"confidence\": 3 }}],
    \"important\": [\"Insight 1\", \"...\"],
    \"structure_summary\": {{ \"intro\": \"...\", \"core\": \"...\", \"examples\": \"...\", \"conclusion\": \"...\" }}
  }},
  \"concept_graph\": {{
    \"nodes\": [{{\"id\": \"n1\", \"label\": \"Concept A\"}}, ...],
    \"links\": [{{\"source\": \"n1\", \"target\": \"n2\", \"label\": \"defines\"}}]
  }},
  \"score\": {{ \"clarity\": 85, \"density\": 95, \"pace\": 70, \"concept_count\": 20, \"revision_mins\": 60 }},
  \"flashcards\": [{{ \"q\": \"...\", \"a\": \"...\" }}],
  \"lecture_dna\": [20 integers between 1-10 representing concept density per lecture segment]
}}
Transcript: {transcript}"""

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                GROQ_CHAT_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"}
                }
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Stage 2 analysis timed out (Groq 70B can take up to 5 minutes for long lectures)")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Groq API: {str(e)}")

    if not resp.is_success:
        try:
            raise HTTPException(status_code=resp.status_code, detail=resp.json())
        except Exception:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

    # Groq succeeded — now increment usage count
    supabase = get_supabase()
    supabase.table("profiles").update({
        "usage_count": current_count + 1
    }).eq("id", user_id).execute()

    return resp.json()
