## Getting Started

### 1. Environment Setup
Create a `.env` file in the **root** directory (this repo) and add your OpenAI API key:
```env
OPENAI_API_KEY=your_sk_key_here
```
*Note: All AI services (STT, TTS, and LLM) now securely use this single key via the backend.*

### 2. One-Command Build + Restart (Backend + Frontend)
```bash
bash restart.sh
```
This will:
- stop old listeners on ports `8000`/`5173` (and `3000` if present)
- ensure backend venv + deps are installed
- build the frontend
- restart backend + frontend

Logs are written to `.run/backend.log` and `.run/frontend.log`.

### 3. One-Command Dev Startup (Backend + Frontend)
```bash
bash dev.sh
```
This starts the backend on `http://localhost:8000` and frontend on `http://localhost:5173` together.
It works with either **Bun** or **npm** (uses Bun if both are installed).  
Press `Ctrl+C` to stop both.

### 4. Backend (Manual)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

### 5. Frontend (Manual)
```bash
cd frontend
# Bun
bun install && bun run dev

# or npm
npm install && npm run dev
```
Open [http://localhost:5173](http://localhost:5173). The frontend is configured to communicate with the backend at [http://localhost:8000](http://localhost:8000).
