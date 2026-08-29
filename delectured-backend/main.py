"""
DeLectured API — FastAPI Backend v2.0
Proxies Groq API calls server-side; handles auth, rate-limiting, and session persistence.
"""
import os
import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from routers import transcribe, analyze, chat, sessions, usage, recordings

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

load_dotenv()

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="DeLectured API",
    version="2.0.0",
    description="Backend for DeLectured — lecture-to-study-material AI pipeline"
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: origins from env var, comma-separated
allowed_origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5500").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info("request_started", method=request.method, url=str(request.url), client=request.client.host)
    response = await call_next(request)
    logger.info("request_completed", method=request.method, url=str(request.url), status_code=response.status_code)
    return response

app.include_router(transcribe.router, prefix="/api", tags=["Transcribe"])
app.include_router(analyze.router, prefix="/api", tags=["Analyze"])
app.include_router(chat.router, prefix="/api", tags=["Chat"])
app.include_router(sessions.router, prefix="/api", tags=["Sessions"])
app.include_router(usage.router, prefix="/api", tags=["Usage"])
app.include_router(recordings.router, prefix="/api", tags=["Recordings"])


@app.get("/")
def health_check():
    return {"status": "DeLectured API is running", "version": "2.0.0"}


@app.get("/health")
async def health_check_detailed():
    """Detailed health check with dependency verification."""
    import httpx
    
    checks = {
        "api": "ok",
        "groq": "unknown",
        "supabase": "unknown"
    }
    
    # Check Groq connectivity
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {groq_key}"}
                )
            checks["groq"] = "ok" if resp.is_success else f"error: {resp.status_code}"
        except Exception as e:
            checks["groq"] = f"error: {str(e)}"
    else:
        checks["groq"] = "not_configured"
    
    # Check Supabase connectivity
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if supabase_url and supabase_key:
        try:
            from supabase import create_client
            sb = create_client(supabase_url, supabase_key)
            sb.table("profiles").select("id").limit(1).execute()
            checks["supabase"] = "ok"
        except Exception as e:
            checks["supabase"] = f"error: {str(e)}"
    else:
        checks["supabase"] = "not_configured"
    
    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if all_ok else 503
    
    return JSONResponse(
        status_code=status_code,
        content={"status": "healthy" if all_ok else "degraded", "checks": checks}
    )
