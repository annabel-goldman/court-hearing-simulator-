# Fastest, Cheapest Way to Host Court Simulator

Your app has two parts: **frontend** (React/Vite, static) and **backend** (FastAPI + **WebSockets**). The backend must run on a host that supports long-lived WebSocket connections.

## Recommended: GitHub Pages (frontend) + Render (backend)

| Part     | Service        | Cost   | Notes                                      |
|----------|-----------------|--------|--------------------------------------------|
| Frontend | **GitHub Pages**| Free   | Already in `.github/workflows/deploy.yml`  |
| Backend  | **Render**      | Free*  | Web Services support WebSockets; easy deploy |

\*Render free tier: service sleeps after ~15 min idle; first request after that has a cold start (~30–60 s).

### 1. Deploy backend on Render (free)

1. Push your repo to GitHub (if not already).
2. Go to [render.com](https://render.com) → Sign up (GitHub login).
3. **New → Web Service** → Connect your repo (`court-hearing-simulator` or whatever you named it).

4. **Configure and deploy** — fill out the form exactly like this:

   | Field | What to enter |
   |-------|----------------|
   | **Name** | Any short name, e.g. `court-simulator-api` (Render will give a URL like `https://court-simulator-api.onrender.com`). |
   | **Language** | **Python 3** |
   | **Branch** | Your branch, e.g. `court-room` or `main`. |
   | **Region** | Any (e.g. Oregon US West is fine). |
   | **Root Directory** | `backend` |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` (leave `$PORT` as-is — Render sets it automatically; do not add a PORT env var). |
   | **Instance Type** | **Free** ($0/month). |

5. **Environment Variables** — click **Add Environment Variable** and add these:

   | Key | Value (what to put) |
   |-----|---------------------|
   | `OPENAI_API_KEY` | Your OpenAI API key (starts with `sk-...`). **Required** for judge + TTS. |
   | `CORS_ORIGINS` | Your frontend URL so the browser is allowed to call this API. Use one of: |
   | | • **User/org Pages:** `https://YOUR_GITHUB_USERNAME.github.io` |
   | | • **Project Pages:** `https://YOUR_GITHUB_USERNAME.github.io/court-hearing-simulator` (use your actual repo name). |
   | `GEMINI_API_KEY` | (Optional) If you use Gemini in Judge Admin. |
   | `ELEVENLABS_API_KEY` | (Optional) If you use ElevenLabs TTS. |
   | `DEEPGRAM_API_KEY` | (Optional) If you use Deepgram STT. |

   **Tip:** If you don’t know your Pages URL yet, set `CORS_ORIGINS` to `https://YOUR_GITHUB_USERNAME.github.io` (replace with your GitHub username). You can add more origins later in Render’s Environment tab (comma-separated).

6. Click **Deploy web service**. Wait for the first deploy to finish.

7. Copy your service URL from the top of the dashboard (e.g. `https://court-simulator-api.onrender.com`). You’ll use it for **VITE_API_URL** and **VITE_WS_URL** in GitHub (see step 2 below).

### 2. Deploy frontend on GitHub Pages (already set up)

The workflow deploys when you push to the **`court-hearing`** branch.

1. In GitHub: **Settings → Pages** → Source: **GitHub Actions**.
2. In **Settings → Secrets and variables → Actions**, add:
   - `OPENAI_API_KEY` and/or `GEMINI_API_KEY` (for Judge Admin).
   - **Required for production:** `VITE_API_URL` = `https://your-app.onrender.com` (your Render URL, no trailing slash).
   - **Required for production:** `VITE_WS_URL` = `wss://your-app.onrender.com/ws`.
3. Push to **`court-hearing`**; the workflow will build and deploy the frontend.

If you use **project** GitHub Pages (e.g. `.../court-room/`), set in the workflow or in repo **Settings → Pages** the same base path and set **VITE_BASE_PATH** in the build env (your workflow already uses `VITE_BASE_PATH: /${{ github.event.repository.name }}/`). Then set **CORS_ORIGINS** on Render to that full origin, e.g. `https://YOUR_GITHUB_USERNAME.github.io` (and if needed with path, Render may need the exact origin your browser sends).

### 3. You’re good to go when…

- [ ] Backend is deployed on Render and you have its URL.
- [ ] In the repo: **Settings → Secrets and variables → Actions**, you’ve added **VITE_API_URL** and **VITE_WS_URL** (see step 2 above).
- [ ] You’ve pushed these changes to the **`court-hearing`** branch (or re-run the workflow from the Actions tab).

The frontend build bakes in the backend URL from those secrets, so after the first successful deploy from `court-hearing`, the site will use your Render API and WebSocket.

---

## Other cheap options

| Backend host   | Cost        | Pros                          | Cons                          |
|----------------|------------|-------------------------------|--------------------------------|
| **Render**     | Free tier  | Simple, WebSockets, good docs | Cold starts when idle          |
| **Railway**    | ~$5/mo**   | No cold start, easy deploy    | Free tier is limited           |
| **Fly.io**     | Free tier  | Always-on, global, WebSockets | Need Dockerfile or similar     |
| **Oracle Cloud** | Free tier | Always-free VM, no sleep      | More setup, account approval   |

\*\*Railway gives a small free credit; then paid.

**Frontend:** GitHub Pages is free and already configured. Alternatives: **Cloudflare Pages**, **Vercel** (both free for static sites).

---

## One-line summary

**Fastest and cheapest:** Use **GitHub Pages** for the frontend (already set up) and **Render** free Web Service for the backend; set `VITE_API_URL` and `VITE_WS_URL` in GitHub Actions secrets and `CORS_ORIGINS` on Render to your Pages URL.
