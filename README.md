## Getting Started

### 1. Environment Setup
Create a `.env` file in the **root** directory (this repo) and add your OpenAI API key:
```env
OPENAI_API_KEY=your_sk_key_here
```
*Note: All AI services (STT, TTS, and LLM) now securely use this single key via the backend.*

### 2. Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Frontend (Powered by Bun)
```bash
cd frontend
bun install
bun run dev
```
Open [http://localhost:5173](http://localhost:5173). The frontend is configured to communicate with the backend at [http://localhost:8000](http://localhost:8000).
