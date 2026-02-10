# Court Simulator

Upload two legal briefs (PDF), enter a 3D courtroom, and practice oral argument with an AI judge that interrupts in real time (STT → judge logic → TTS).

**Features:** Brief upload (PDF.js) · 3D courtroom with ritual phases · WebSocket judge (interrupts from your speech) · Judge Admin to tune prompts (OpenAI or Gemini).

**Layout:** `frontend/` (React + Vite), `backend/` (FastAPI + WebSocket).

## Run locally

**Backend**
```bash
cd backend && python3 -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
# Copy .env.example to .env and set OPENAI_API_KEY
uvicorn main:app --reload --port 8000
```
If `pip` or `python3` in venv says "No such file or directory", the venv was created with a different path—remove it and recreate: `rm -rf venv && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`.

**Frontend**
```bash
cd frontend && npm install && npm run dev
```
Open http://localhost:5173. Backend must be at http://localhost:8000.

## Env

- **backend:** Copy `backend/.env.example` → `backend/.env`; set `OPENAI_API_KEY` (optional: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`).
- **frontend:** Copy `frontend/.env.example` → `frontend/.env`; set `VITE_OPENAI_API_KEY` and/or `VITE_GEMINI_API_KEY` for Judge Admin.

`.env` files are gitignored; `.env.example` files are committed.
