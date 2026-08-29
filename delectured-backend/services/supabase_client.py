"""
Singleton Supabase admin client using the service role key.
This client bypasses Row Level Security — only used server-side.
NEVER expose the service role key to the frontend.
"""
import os
from supabase import create_client, Client

_client: Client | None = None


def get_supabase() -> Client:
    """Returns the singleton Supabase admin client."""
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables."
            )
        _client = create_client(url, key)
    return _client
