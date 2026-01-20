# Court Simulator

A court hearing simulator that analyzes and compares legal briefs using AI. Built with React + TypeScript (Bun) and Python FastAPI.

## Features

- **Brief Comparison**: Upload two legal briefs and get AI-powered semantic analysis
- **Difference Detection**: Identifies key differences in legal arguments, facts, precedents, and conclusions
- **Significance Rating**: Each difference is rated by legal significance (High/Medium/Low)
- **Common Ground**: Shows where both briefs align

## Project Structure

```
├── frontend/              # React + TypeScript (Bun + Vite)
│   ├── src/
│   │   ├── App.tsx        # Main comparison UI
│   │   ├── main.tsx       # Entry point
│   │   └── index.css      # Styles
│   ├── package.json
│   └── vite.config.ts
├── backend/               # Python FastAPI
│   ├── main.py            # API with Gemini integration
│   ├── requirements.txt
│   └── .env               # API keys (not in git)
└── README.md
```

## Prerequisites

- [Docker](https://www.docker.com/) (recommended)
- Or: [Bun](https://bun.sh/) + [Python 3.10+](https://www.python.org/)
- Gemini API key

## Quick Start (Docker)

```bash
docker compose up --build
```

That's it! Open `http://localhost:3000`

To run in background:
```bash
docker compose up -d --build
```

To stop:
```bash
docker compose down
```

## Manual Setup (without Docker)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

API runs at `http://localhost:8000`

### Frontend

```bash
cd frontend
bun install
bun run dev
```

App runs at `http://localhost:3000`

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/compare-briefs` - Compare two briefs
  - Body: `{ "brief_a": "...", "brief_b": "..." }`
  - Returns: Summary, differences, and common ground

## Future Features

- Virtual judge that asks questions about your brief
- Interactive Q&A sessions
- Case law reference checking
