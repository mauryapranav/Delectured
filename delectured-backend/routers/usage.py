"""
GET /api/usage
Returns current usage count with monthly reset logic.
Called on login to display usage badge in the frontend.
"""
import os
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from middleware.auth import get_current_user
from services.supabase_client import get_supabase

router = APIRouter()

MONTHLY_LIMIT = int(os.getenv("MONTHLY_LIMIT", "4"))


@router.get("/usage")
def get_usage(user_id: str = Depends(get_current_user)):
    """
    Returns { used, limit, resets_on }.
    Applies monthly reset atomically: if usage_reset_date is from a prior month,
    resets usage_count to 0 before returning.
    """
    supabase = get_supabase()
    today = date.today()

    resp = supabase.table("profiles") \
        .select("usage_count, usage_reset_date") \
        .eq("id", user_id) \
        .single() \
        .execute()

    if not resp.data:
        raise HTTPException(status_code=404, detail="User profile not found")

    profile = resp.data
    reset_date = date.fromisoformat(profile["usage_reset_date"])

    # Monthly reset: if last reset was in a different month, zero out
    if reset_date.year != today.year or reset_date.month != today.month:
        supabase.table("profiles").update({
            "usage_count": 0,
            "usage_reset_date": today.isoformat()
        }).eq("id", user_id).execute()
        current_count = 0
    else:
        current_count = profile["usage_count"]

    # First day of next month
    if today.month == 12:
        resets_on = f"{today.year + 1}-01-01"
    else:
        resets_on = f"{today.year}-{today.month + 1:02d}-01"

    return {
        "used": current_count,
        "limit": MONTHLY_LIMIT,
        "resets_on": resets_on
    }
