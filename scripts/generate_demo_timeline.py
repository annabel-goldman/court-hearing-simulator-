"""Call the running backend to generate a PredictedTopicSets for the demo briefs."""
import json
import os
import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO_DIR = os.path.join(ROOT, "frontend", "src", "data", "harvard-demo")

appellant = open(os.path.join(DEMO_DIR, "appellant-brief.txt")).read()
respondent = open(os.path.join(DEMO_DIR, "respondent-brief.txt")).read()

print(f"Appellant brief: {len(appellant)} chars")
print(f"Respondent brief: {len(respondent)} chars")
print("Calling /api/projected-timeline/generate-stream ...")

with httpx.stream(
    "POST",
    "http://localhost:8000/api/projected-timeline/generate-stream",
    json={"appellant_brief": appellant, "appellee_brief": respondent},
    timeout=300,
) as resp:
    resp.raise_for_status()
    done_data = None
    buf = ""
    lens_count = 0
    for chunk in resp.iter_text():
        buf += chunk
        parts = buf.split("\n\n")
        buf = parts.pop()
        for part in parts:
            line = part.strip()
            if not line.startswith("data: "):
                continue
            try:
                event = json.loads(line[len("data: "):])
            except json.JSONDecodeError:
                continue
            if event.get("type") == "status":
                print(f"  status: {event.get('data', {}).get('phase')}")
            elif event.get("type") == "agenda":
                lens_count += 1
                print(f"  agenda #{lens_count}: {event.get('data', {}).get('lens')}")
            elif event.get("type") == "done":
                done_data = event.get("data")

if done_data is None:
    print("ERROR: No 'done' event received")
    raise SystemExit(1)

out_path = os.path.join(DEMO_DIR, "predicted-topic-sets.json")
with open(out_path, "w") as f:
    json.dump(done_data, f, indent=2)

n_pred = len(done_data.get("predictions", []))
n_pool = len(done_data.get("full_topic_pool", []))
print(f"\nWrote {out_path}")
print(f"  predictions: {n_pred}, full_topic_pool: {n_pool}")
print(f"  case_summary length: {len(done_data.get('case_summary', ''))}")
