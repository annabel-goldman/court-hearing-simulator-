import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

app = FastAPI(title="Court Simulator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:80"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Gemini
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-1.5-flash")


class BriefComparisonRequest(BaseModel):
    brief_a: str
    brief_b: str


class SemanticDifference(BaseModel):
    category: str
    brief_a_position: str
    brief_b_position: str
    significance: str
    explanation: str


class BriefComparisonResponse(BaseModel):
    summary: str
    differences: list[SemanticDifference]
    common_ground: list[str]


@app.get("/api/health")
async def health_check():
    return {"message": "Backend connected", "status": "ok"}


@app.post("/api/compare-briefs", response_model=BriefComparisonResponse)
async def compare_briefs(request: BriefComparisonRequest):
    if not request.brief_a.strip() or not request.brief_b.strip():
        raise HTTPException(status_code=400, detail="Both briefs must contain text")

    prompt = f"""You are a legal analyst comparing two court briefs. Analyze the semantic differences between them.

BRIEF A:
{request.brief_a}

BRIEF B:
{request.brief_b}

Provide your analysis in the following JSON format (respond ONLY with valid JSON, no markdown):
{{
    "summary": "A 2-3 sentence overview of the key differences between the briefs",
    "differences": [
        {{
            "category": "Category of difference (e.g., 'Legal Argument', 'Facts Presented', 'Relief Sought', 'Precedent Cited', 'Burden of Proof')",
            "brief_a_position": "What Brief A argues or states on this point",
            "brief_b_position": "What Brief B argues or states on this point",
            "significance": "High/Medium/Low - how significant is this difference",
            "explanation": "Why this difference matters legally"
        }}
    ],
    "common_ground": ["List of points where both briefs agree or align"]
}}

Focus on substantive semantic differences in legal arguments, facts, interpretations, and conclusions. Identify at least 3 differences if they exist."""

    try:
        response = model.generate_content(prompt)
        response_text = response.text.strip()
        
        # Clean up response if it has markdown code blocks
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            response_text = "\n".join(lines[1:-1])
        
        import json
        result = json.loads(response_text)
        
        return BriefComparisonResponse(
            summary=result.get("summary", ""),
            differences=[
                SemanticDifference(**diff) for diff in result.get("differences", [])
            ],
            common_ground=result.get("common_ground", [])
        )
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
