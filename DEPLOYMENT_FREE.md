# DeLectured v2.0 — Free Deployment Guide

## Overview
This guide covers deploying DeLectured completely for free using modern cloud platforms with generous free tiers. No laptop-as-server, no expiring student credits.

---

## Architecture for Free Deployment

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   Backend       │     │   Database      │
│   (Static)      │────▶│   (API)         │────▶│   (Postgres)    │
│                 │     │                 │     │   + Storage     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
  Cloudflare Pages        Cloudflare Workers      Supabase Free
  (or Netlify/Vercel)     (or Render/Railway)     Tier (500MB)
```

---

## Option 1: All-in-One Cloudflare (Recommended)

### Why Cloudflare?
- **Pages**: Unlimited static sites, custom domains, free SSL
- **Workers**: 100,000 requests/day free, global edge network
- **D1/KV**: Optional if you want to avoid Supabase
- **No cold starts** like Render free tier

### Frontend → Cloudflare Pages
```bash
# 1. Push to GitHub
git add . && git commit -m "deploy" && git push

# 2. Connect repo in Cloudflare Pages dashboard
# Build command: (none - static files)
# Output directory: / (root)
# Environment variables: none needed for frontend
```

**Custom domain**: Add in Pages → Custom Domains (free)

### Backend → Cloudflare Workers
```bash
# 1. Install Wrangler
npm install -g wrangler

# 2. Create worker project
mkdir delectured-worker && cd delectured-worker
wrangler init --site=../  # or use Python worker with Pyodide

# 3. For Python, use Cloudflare Workers with Python (beta)
# Or deploy to Render/Railway instead (see Option 2)
```

**Note**: Cloudflare Workers Python support is in beta. For production Python FastAPI, use Option 2.

---

## Option 2: Split Deployment (Recommended for Python Backend)

### Frontend: Netlify / Vercel / Cloudflare Pages
| Platform | Free Tier | Custom Domain | Build Minutes |
|----------|-----------|---------------|---------------|
| **Netlify** | ✅ Unlimited sites | ✅ Yes | 300/month |
| **Vercel** | ✅ Unlimited personal | ✅ Yes | 100GB-hours |
| **Cloudflare Pages** | ✅ Unlimited | ✅ Yes | Unlimited |

**Recommended: Cloudflare Pages** (no build limits, fastest global CDN)

```toml
# netlify.toml (if using Netlify)
[build]
  publish = "."
  command = "echo 'Static site - no build needed'"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
```

### Backend: Render / Railway / Fly.io

#### Render (Easiest for Python)
- **Free tier**: 750 hours/month (sleeps after 15 min inactivity)
- **Auto-deploys** from GitHub
- **Custom domain** on free tier
- **Postgres**: Not free (use Supabase instead)

```yaml
# render.yaml
services:
  - type: web
    name: delectured-api
    env: python
    buildCommand: pip install -r delectured-backend/requirements.txt
    startCommand: cd delectured-backend && uvicorn main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: GROQ_API_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: ALLOWED_ORIGINS
        value: https://your-frontend.pages.dev,https://yourdomain.com
      - key: MONTHLY_LIMIT
        value: "4"
```

#### Railway (More generous)
- **$5 free credit monthly** (usually covers small apps 24/7)
- **No sleep** - runs continuously
- **Postgres included** (but use Supabase for auth)

#### Fly.io (Best for containers)
- **Free allowance**: 3 shared-cpu-1x VMs, 160GB IPv6 bandwidth
- **No sleep** - runs 24/7
- **Docker-based** - use the existing Dockerfile

```bash
# Fly.io deploy
fly launch --dockerfile delectured-backend/Dockerfile
fly secrets set GROQ_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
```

### Database + Auth + Storage: Supabase Free Tier
- **Postgres**: 500MB database
- **Auth**: Unlimited users, OAuth providers (Google, GitHub, etc.)
- **Storage**: 1GB file storage (perfect for recordings)
- **Realtime**: Included
- **Edge functions**: 500K invocations/month

**Setup**:
1. Create project at supabase.com
2. Run `delectured-backend/supabase_schema.sql` in SQL Editor
3. Create Storage bucket `recordings` (private)
4. Add storage policies (see schema file comments)
5. Copy credentials to backend environment variables

---

## Environment Variables Checklist

### Backend (set in Render/Railway/Fly.io dashboard)
```env
GROQ_API_KEY=gsk_xxxxxxxxxxxx
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
ALLOWED_ORIGINS=https://your-frontend.pages.dev,https://yourdomain.com
MONTHLY_LIMIT=4
```

### Frontend (set in Cloudflare Pages/Netlify/Vercel dashboard)
```env
# In auth.js, update these constants:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
BACKEND_URL=https://your-backend.onrender.com
```

**Important**: The frontend `auth.js` has hardcoded placeholders. Either:
1. Replace `__SUPABASE_URL__`, `__SUPABASE_ANON_KEY__`, `__BACKEND_URL__` in `auth.js` before deploy
2. Or use build-time replacement (Netlify/Vercel/Cloudflare support this)

---

## Supabase Storage Bucket Setup

1. Go to Supabase Dashboard → Storage
2. Create bucket: `recordings` (Private)
3. Run these policies in SQL Editor:

```sql
-- Allow users to upload to their own folder
CREATE POLICY "Users can upload own recordings" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'recordings' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Allow users to view own recordings
CREATE POLICY "Users can view own recordings" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'recordings' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Allow users to delete own recordings
CREATE POLICY "Users can delete own recordings" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'recordings' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
```

---

## Cost Summary (Monthly)

| Component | Platform | Cost |
|-----------|----------|------|
| Frontend Hosting | Cloudflare Pages | **$0** |
| Backend API | Render Free / Fly.io | **$0** |
| Database + Auth | Supabase Free | **$0** |
| File Storage | Supabase Free (1GB) | **$0** |
| Custom Domain | Cloudflare/Namecheap | ~$1/yr (optional) |
| **Total** | | **$0/month** |

---

## Deployment Steps (Quick Start)

### 1. Prepare Supabase
- [ ] Create project
- [ ] Run `supabase_schema.sql`
- [ ] Create `recordings` bucket + policies
- [ ] Enable Google OAuth in Auth → Providers

### 2. Deploy Backend
- [ ] Push `delectured-backend/` to GitHub
- [ ] Connect to Render/Railway/Fly.io
- [ ] Add environment variables
- [ ] Deploy and note URL (e.g., `https://delectured-api.onrender.com`)

### 3. Deploy Frontend
- [ ] Update `auth.js` with your Supabase URL, anon key, backend URL
- [ ] Push entire repo to GitHub
- [ ] Connect to Cloudflare Pages
- [ ] Build: (none), Output: `/`
- [ ] Add custom domain (optional)

### 4. Configure CORS
- [ ] Update `ALLOWED_ORIGINS` in backend with your frontend URL
- [ ] Redeploy backend

### 5. Test
- [ ] Visit frontend URL
- [ ] Sign in with Google
- [ ] Upload/record a lecture
- [ ] Verify processing works
- [ ] Check sessions appear in sidebar
- [ ] Test recording save to cloud
- [ ] Test PDF export/print

---

## Troubleshooting

### Backend sleeps on Render (15 min inactivity)
**Fix**: Use Fly.io or Railway for 24/7 uptime, or accept cold start (~10-30s)

### CORS errors
**Fix**: Ensure `ALLOWED_ORIGINS` includes exact frontend URL (with protocol, no trailing slash)

### Supabase auth not working
**Fix**: Check Google OAuth redirect URI in Supabase matches your frontend URL

### Recording upload fails
**Fix**: Verify storage bucket policies and bucket name matches `RECORDINGS_BUCKET` in `recordings.py`

### PDF export cuts off content
**Fix**: The `exportToPDF` uses html2pdf.js with pagebreak avoidance. For very long lectures, consider splitting.

---

## Scaling Beyond Free Tier

| Growth Trigger | Upgrade Path |
|----------------|--------------|
| >500MB DB | Supabase Pro ($25/mo) |
| >1GB Storage | Supabase Pro or Cloudflare R2 |
| >100K API req/day | Cloudflare Workers Paid ($5/mo) |
| Need 24/7 backend | Fly.io (~$3-5/mo) or Railway ($5/mo) |
| Custom domain email | Cloudflare Email Routing (free) |

---

## Security Checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` only in backend (never frontend)
- [ ] `GROQ_API_KEY` only in backend
- [ ] CORS restricted to your domains
- [ ] Supabase RLS policies enabled
- [ ] Storage bucket is private
- [ ] Rate limiting on `/transcribe` (20/min/user)
- [ ] Monthly usage limit enforced (4 lectures)

---

## Monitoring (Free)

- **Uptime**: UptimeRobot (50 monitors free)
- **Errors**: Sentry free tier (5K errors/mo)
- **Logs**: Render/Railway/Fly.io built-in logs
- **Supabase**: Dashboard → Logs → API/Database/Auth

---

## Alternative: All-in-One with Docker + Coolify

If you have a **single VPS** ($4-6/mo on Hetzner/DigitalOcean), use [Coolify](https://coolify.io/) to self-host everything:
- Git push → auto deploy
- Automatic SSL
- Databases, Redis, S3 (MinIO) included
- One server runs frontend, backend, database, storage
- **Not free** but cheapest for full control

---

## Quick Reference: URLs After Deploy

| Service | URL Pattern |
|---------|-------------|
| Frontend | `https://delectured.pages.dev` or `https://yourdomain.com` |
| Backend API | `https://delectured-api.onrender.com` or `https://api.yourdomain.com` |
| Supabase Dashboard | `https://supabase.com/dashboard/project/YOUR_REF` |
| Health Check | `https://your-backend/health` |

---

*Generated for DeLectured v2.0 — Every Lecture. Every Word. Structured.*