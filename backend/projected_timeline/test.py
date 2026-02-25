#!/usr/bin/env python3
"""
Projected Topic Agendas — local GPU test (RTX 5090 / high-VRAM).

Given two legal briefs, generates N distinct predicted lists of topics the
judge will raise during the hearing.  Each list is produced through a
different judicial lens (statutory text, precedent, policy, etc.), giving
N independent forecasts of how the argument might be structured.

Two-phase approach (mirrors SCOPE's dual-model architecture):
  Phase 1 — Issue Extractor  (≈ SCOPE reward model R̃)
             One inference call → case summary + shared key legal issues.

  Phase 2 — Agenda Generator  (≈ SCOPE transition model T̃)
             One inference call per lens → independent topic list.
             Each call receives the same case context but a different
             judicial angle, producing naturally varied predictions
             without any random seeding.

Usage
-----
    python3 test.py                          # built-in sample briefs
    python3 test.py brief_a.txt brief_b.txt  # plain-text files
    python3 test.py brief_a.pdf brief_b.pdf  # PDF files (requires pypdf)

Environment variables
---------------------
    HF_MODEL      — Model repo ID (default: mistralai/Mistral-7B-Instruct-v0.2)
                    Recommended for 32 GB VRAM (RTX 5090):
                      meta-llama/Meta-Llama-3.1-8B-Instruct   (~16 GB)
                      mistralai/Mistral-Nemo-Instruct-2407     (~24 GB, 12B)
                      meta-llama/Meta-Llama-3-13B-Instruct     (~26 GB)
    HF_TOKEN      — HuggingFace token (required for gated models like Llama-3)
    NUM_PREDICTIONS — Number of distinct agendas to generate (default: 5)
    CUDA_DEVICE   — CUDA device index (default: 0)

Install
-------
    pip install transformers torch accelerate
    pip install pypdf          # only needed for PDF brief input
    pip install flash-attn     # optional — faster attention on Blackwell
"""

from __future__ import annotations

import json
import os
import re
import sys
import textwrap
import time


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_MODEL   = "mistralai/Mistral-7B-Instruct-v0.2"
HF_MODEL        = os.getenv("HF_MODEL", DEFAULT_MODEL)
HF_TOKEN        = os.getenv("HF_TOKEN") or True
NUM_PREDICTIONS = int(os.getenv("NUM_PREDICTIONS", "5"))
CUDA_DEVICE     = int(os.getenv("CUDA_DEVICE", "0"))
DEBUG           = os.getenv("DEBUG", "0") == "1"   # DEBUG=1 to print raw model output

# ---------------------------------------------------------------------------
# Judicial lenses — each produces an independent agenda prediction
# ---------------------------------------------------------------------------

JUDICIAL_LENSES = [
    {
        "lens": "Statutory Text & Plain Meaning",
        "guidance": (
            "Focus on what the statutes and regulations say on their face. "
            "Prioritise textual ambiguities, definitions, and plain-meaning arguments."
        ),
    },
    {
        "lens": "Precedent & Stare Decisis",
        "guidance": (
            "Focus on controlling case law. Which prior decisions bind this court? "
            "Does either party's argument require overruling or distinguishing key cases?"
        ),
    },
    {
        "lens": "Agency Deference & Administrative Law",
        "guidance": (
            "Focus on the agency's role, its delegated authority, and whether "
            "its reasoning and record are adequate. Probe Chevron / Loper Bright implications."
        ),
    },
    {
        "lens": "Weakest Links in Each Party's Argument",
        "guidance": (
            "Identify the single most vulnerable point for the appellant and for the appellee. "
            "Build the agenda around stress-testing those weak spots."
        ),
    },
    {
        "lens": "Policy Consequences & Practical Impact",
        "guidance": (
            "Focus on what a ruling for each side would mean in practice — regulatory, "
            "commercial, and institutional consequences. Ask how the holding will apply to future cases."
        ),
    },
    {
        "lens": "Procedural & Remedial Questions",
        "guidance": (
            "Focus on threshold issues: standing, ripeness, standard of review, and "
            "what the appropriate remedy would be if the court rules for either party."
        ),
    },
    {
        "lens": "Constitutional Boundaries",
        "guidance": (
            "Focus on whether the statutes or agency actions raise constitutional concerns — "
            "separation of powers, non-delegation, due process, or federalism."
        ),
    },
    {
        "lens": "Factual Record & Evidentiary Gaps",
        "guidance": (
            "Focus on what the factual record does and does not establish. Probe whether "
            "disputed facts should have precluded summary judgment."
        ),
    },
    {
        "lens": "Equitable Considerations",
        "guidance": (
            "Focus on fairness, reliance interests, and equitable doctrines such as "
            "laches, estoppel, and unclean hands when the law is ambiguous."
        ),
    },
    {
        "lens": "Narrowest Grounds for Decision",
        "guidance": (
            "Focus on the smallest possible holding that resolves the case — grounds "
            "that avoid broad pronouncements and preserve flexibility for future panels."
        ),
    },
]

# ---------------------------------------------------------------------------
# Pipeline singleton
# ---------------------------------------------------------------------------

_pipe = None


def get_pipeline():
    """Load the transformers pipeline once; cache for all subsequent calls."""
    global _pipe
    if _pipe is not None:
        return _pipe

    try:
        import torch
        from transformers import pipeline as hf_pipeline
    except ImportError:
        sys.exit("Run: pip install transformers torch accelerate")

    if not torch.cuda.is_available():
        sys.exit("No CUDA GPU detected. This script requires a local GPU.")

    device_str = f"cuda:{CUDA_DEVICE}"
    gpu_name   = torch.cuda.get_device_name(CUDA_DEVICE)
    vram_gb    = torch.cuda.get_device_properties(CUDA_DEVICE).total_memory / 1e9

    print(f"  GPU     : {gpu_name}")
    print(f"  VRAM    : {vram_gb:.1f} GB")
    print(f"  dtype   : bfloat16")
    print(f"  Model   : {HF_MODEL}")
    print("  Loading weights … (first run downloads from HuggingFace Hub)\n")

    model_kwargs: dict = {}
    try:
        import flash_attn  # noqa: F401
        model_kwargs["attn_implementation"] = "flash_attention_2"
        print("  flash-attn 2 enabled")
    except ImportError:
        pass

    _pipe = hf_pipeline(
        "text-generation",
        model=HF_MODEL,
        token=HF_TOKEN,
        torch_dtype=torch.bfloat16,
        device=device_str,
        model_kwargs=model_kwargs,
    )
    return _pipe


def infer(messages: list[dict], max_new_tokens: int = 512) -> str:
    """Run one inference call through the loaded pipeline."""
    pipe = get_pipeline()
    outputs = pipe(
        messages,
        max_new_tokens=max_new_tokens,
        temperature=0.4,
        do_sample=True,
        return_full_text=False,
    )
    # Pipeline output shape varies by transformers version and input type.
    # When messages (list[dict]) are passed, output is one of:
    #   A) [{"generated_text": "str"}]
    #   B) [{"generated_text": [{"role": "assistant", "content": "str"}, ...]}]
    raw = outputs[0]
    if isinstance(raw, list):
        raw = raw[0]
    if isinstance(raw, dict):
        content = raw.get("generated_text", "")
        if isinstance(content, list):
            # Take the last message — the assistant reply
            content = content[-1].get("content", "") if content else ""
    else:
        content = str(raw)

    if DEBUG:
        print(f"\n{ANSI['dim']}── RAW MODEL OUTPUT ──────────────────────────────────────{ANSI['reset']}")
        print(content)
        print(f"{ANSI['dim']}──────────────────────────────────────────────────────────{ANSI['reset']}\n")

    return content.strip()


# ---------------------------------------------------------------------------
# Text loading
# ---------------------------------------------------------------------------

def load_brief(path: str) -> str:
    if path.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            sys.exit("pypdf required for PDF input. Run: pip install pypdf")
        reader = PdfReader(path)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------------------
# Phase 1 — Issue extraction
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = (
    "You are a senior federal appellate court analyst. "
    "Respond ONLY with valid JSON — no prose, no markdown fences."
)

_EXTRACT_USER = """\
Read these two legal briefs and return a single JSON object:

{{
  "case_summary": "<two neutral sentences describing the core dispute>",
  "key_legal_issues": ["<issue 1>", "<issue 2>", "<issue 3>", "<issue 4>", "<issue 5>"]
}}

=== APPELLANT BRIEF ===
{appellant}

=== APPELLEE BRIEF ===
{appellee}"""


def extract_issues(appellant: str, appellee: str) -> dict:
    print("[Phase 1] Extracting key legal issues …")
    messages = [
        {"role": "system", "content": _EXTRACT_SYSTEM},
        {
            "role": "user",
            "content": _EXTRACT_USER.format(
                appellant=appellant[:2500],
                appellee=appellee[:2500],
            ),
        },
    ]
    raw = infer(messages, max_new_tokens=350)
    return _parse_json(raw, fallback={
        "case_summary": "Unable to parse summary.",
        "key_legal_issues": [],
    })


# ---------------------------------------------------------------------------
# Phase 2 — Per-lens agenda generation
# ---------------------------------------------------------------------------

_AGENDA_SYSTEM = (
    "You are a federal appellate judge preparing your question agenda for oral argument. "
    "Respond ONLY with valid JSON — no prose, no markdown fences."
)

_AGENDA_USER = """\
CASE SUMMARY    : {case_summary}
KEY LEGAL ISSUES: {key_issues}

JUDICIAL LENS   : {lens}
LENS GUIDANCE   : {guidance}

Using this lens, generate a predicted topic agenda — an ordered list of the topics
you would raise during oral argument.  Return a single JSON object:

{{
  "rationale": "<one sentence: why a judge with this lens approaches the case this way>",
  "topics": [
    {{
      "order": 1,
      "title": "<short topic label, 3-8 words>",
      "description": "<1-2 sentences: what the judge would probe>",
      "target": "appellant | appellee | both"
    }}
  ]
}}

Rules:
- Include 5 to 7 topics ordered from most to least important for this lens.
- Ground every topic in the actual arguments from the briefs below.
- Vary targets; do not assign every topic to the same party.

=== APPELLANT BRIEF ===
{appellant}

=== APPELLEE BRIEF ===
{appellee}"""


def generate_agenda(
    prediction_id: int,
    lens_def: dict,
    case_summary: str,
    key_issues: list[str],
    appellant: str,
    appellee: str,
) -> dict:
    messages = [
        {"role": "system", "content": _AGENDA_SYSTEM},
        {
            "role": "user",
            "content": _AGENDA_USER.format(
                case_summary=case_summary,
                key_issues=", ".join(key_issues),
                lens=lens_def["lens"],
                guidance=lens_def["guidance"],
                appellant=appellant[:2000],
                appellee=appellee[:2000],
            ),
        },
    ]
    raw = infer(messages, max_new_tokens=900)
    data = _parse_json(raw, fallback={"rationale": "Parse error.", "topics": []})
    return {
        "prediction_id": prediction_id,
        "lens":          lens_def["lens"],
        "rationale":     data.get("rationale", ""),
        "topics":        data.get("topics", []),
    }


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------

def _escape_string_literals(text: str) -> str:
    """
    Walk the text character-by-character and escape any control characters
    (newlines, carriage returns, tabs) that appear *inside* a JSON string
    but are unescaped — the most common reason small LLMs produce invalid JSON.
    """
    result  = []
    in_str  = False
    i       = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and in_str:          # already-escaped sequence → copy both chars
            result.append(ch)
            i += 1
            if i < len(text):
                result.append(text[i])
            i += 1
            continue
        if ch == '"':
            in_str = not in_str
            result.append(ch)
        elif in_str and ch == "\n":
            result.append("\\n")
        elif in_str and ch == "\r":
            result.append("\\r")
        elif in_str and ch == "\t":
            result.append("\\t")
        else:
            result.append(ch)
        i += 1
    return "".join(result)


def _extract_blob(text: str) -> str | None:
    """
    Find the outermost {...} in *text* using a string-aware brace counter
    so that braces inside quoted values don't throw off the depth count.
    Returns the blob, or None if not found.
    """
    start = text.find("{")
    if start == -1:
        return None

    depth    = 0
    in_str   = False
    esc_next = False
    end      = -1

    for i, ch in enumerate(text[start:], start):
        if esc_next:
            esc_next = False
            continue
        if ch == "\\" and in_str:
            esc_next = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break

    if end == -1:
        end = text.rfind("}")
    if end == -1:
        return None
    return text[start : end + 1]


def _parse_json(text: str, fallback: dict) -> dict:
    # 1. Strip markdown fences
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)

    # 2. Try json_repair if available (best-effort LLM JSON fixer)
    try:
        from json_repair import repair_json
        repaired = repair_json(text, return_objects=True)
        if isinstance(repaired, dict) and repaired:
            return repaired
    except ImportError:
        pass

    # 3. Extract the outermost {...}
    blob = _extract_blob(text)
    if blob is None:
        if DEBUG:
            print(f"{ANSI['dim']}[parse] no JSON object found in output{ANSI['reset']}")
        return fallback

    # 4. Try direct parse
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        pass

    # 5. Escape unescaped control characters inside string values
    blob = _escape_string_literals(blob)
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        pass

    # 6. Remove trailing commas
    blob = re.sub(r",\s*([}\]])", r"\1", blob)
    try:
        return json.loads(blob)
    except json.JSONDecodeError as exc:
        if DEBUG:
            print(f"{ANSI['dim']}[parse] all attempts failed: {exc}{ANSI['reset']}")
            print(f"{ANSI['dim']}[parse] blob was: {blob[:300]}{ANSI['reset']}")
        return fallback


# ---------------------------------------------------------------------------
# Pretty-printing
# ---------------------------------------------------------------------------

ANSI = {
    "reset":    "\033[0m",
    "bold":     "\033[1m",
    "dim":      "\033[2m",
    "cyan":     "\033[36m",
    "yellow":   "\033[33m",
    "green":    "\033[32m",
    "blue":     "\033[34m",
    "magenta":  "\033[35m",
}

TARGET_COLOR = {
    "appellant": "\033[34m",   # blue
    "appellee":  "\033[32m",   # green
    "both":      "\033[35m",   # magenta
}

# Cycle through colors for each prediction header
PREDICTION_COLORS = [
    "\033[36m",   # cyan
    "\033[33m",   # yellow
    "\033[35m",   # magenta
    "\033[34m",   # blue
    "\033[32m",   # green
    "\033[31m",   # red
    "\033[37m",   # white
]


def print_header(meta: dict, num_predictions: int) -> None:
    c = ANSI
    print()
    print(c["cyan"] + "=" * 70 + c["reset"])
    print(c["bold"] + "  PROJECTED JUDGE TOPIC AGENDAS" + c["reset"])
    print(c["cyan"] + "=" * 70 + c["reset"])
    print()
    print(c["bold"] + "Case Summary:" + c["reset"])
    for line in textwrap.wrap(meta.get("case_summary", ""), 68):
        print(f"  {line}")
    print()
    print(c["bold"] + "Key Legal Issues (shared across all predictions):" + c["reset"])
    for issue in meta.get("key_legal_issues", []):
        print(f"  • {issue}")
    print()
    print(c["cyan"] + f"  Generating {num_predictions} independent topic agendas …" + c["reset"])
    print(c["cyan"] + "=" * 70 + c["reset"])


def print_prediction(pred: dict, color: str) -> None:
    c = ANSI
    pid    = pred["prediction_id"]
    lens   = pred["lens"]
    rat    = pred.get("rationale", "")
    topics = pred.get("topics", [])

    print()
    print(color + "─" * 70 + c["reset"])
    print(color + c["bold"] + f"  Prediction {pid}  |  {lens}" + c["reset"])
    print(c["dim"] + f"  {rat}" + c["reset"])
    print(color + "─" * 70 + c["reset"])
    print()

    for t in topics:
        order       = t.get("order", "?")
        title       = t.get("title", "")
        description = t.get("description", "")
        target      = t.get("target", "both")
        tcolor      = TARGET_COLOR.get(target, c["dim"])

        print(
            f"  {c['bold']}{order}.{c['reset']} {title}"
            + f"  {tcolor}[→ {target}]{c['reset']}"
        )
        for line in textwrap.wrap(description, 64):
            print(f"     {c['dim']}{line}{c['reset']}")
        print()


def print_footer(predictions: list[dict], elapsed: float) -> None:
    c = ANSI
    print(c["cyan"] + "=" * 70 + c["reset"])
    print(c["bold"] + "  DONE" + c["reset"])
    n = len(predictions)
    print(f"  {n} agenda{'s' if n != 1 else ''}  |  {elapsed:.1f}s total  |  {elapsed/n:.1f}s per agenda")
    print(c["cyan"] + "=" * 70 + c["reset"])


# ---------------------------------------------------------------------------
# Sample briefs
# ---------------------------------------------------------------------------

SAMPLE_APPELLANT_BRIEF = """
IN THE UNITED STATES COURT OF APPEALS FOR THE NINTH CIRCUIT
COASTAL ENERGY LLC, Appellant, v. PACIFIC ENVIRONMENTAL ALLIANCE, Appellee.
No. 24-1234 — BRIEF OF APPELLANT

STATEMENT OF THE CASE
Coastal Energy LLC operates an LNG terminal in Oregon permitted by FERC and the
Army Corps of Engineers (2018). PEA filed suit asserting Coastal's dredging violates
CWA §404 and NEPA. The district court granted summary judgment to PEA, holding Coastal
lacked a required individual §404 permit and FERC's EIS was inadequate.

ARGUMENT
I. NWP 12 EXEMPTION COVERS COASTAL'S ACTIVITIES
Nationwide Permit 12 authorises utility line activities including dredging for existing
energy infrastructure. Coastal registered under NWP 12 before each dredging event.
The district court's individual-permit requirement contradicts 33 C.F.R. § 330.6 and
Borden Ranch Partnership v. Army Corps, 261 F.3d 810 (9th Cir. 2001).

II. FERC'S 847-PAGE EIS SATISFIES NEPA
PEA's objection is that FERC ignored a speculative climate study published after the
EIS was finalised. NEPA does not require supplementation for every post-hoc study.
Marsh v. Oregon Natural Resources Council, 490 U.S. 360 (1989).

CONCLUSION: Reverse and remand with instructions to enter judgment for Coastal.
"""

SAMPLE_APPELLEE_BRIEF = """
IN THE UNITED STATES COURT OF APPEALS FOR THE NINTH CIRCUIT
PACIFIC ENVIRONMENTAL ALLIANCE, Appellee, v. COASTAL ENERGY LLC, Appellant.
No. 24-1234 — BRIEF OF APPELLEE

STATEMENT OF THE CASE
Coastal's repeated dredging in protected wetlands requires, but lacks, an individual
§404 permit. NWP 12 does not cover operations of this scale. Coastal destroyed over
40 acres of jurisdictional wetlands without adequate mitigation.

ARGUMENT
I. NWP 12 DOES NOT COVER COASTAL'S DREDGING
NWP 12 explicitly excepts "mechanized land clearing, grading, and dredging" beyond de
minimis thresholds. Coastal removed 150,000 cubic yards in a single season — activity
the Corps' own 2022 regional supplement places outside NWP 12. Borden Ranch addressed
pipeline installation, not sustained industrial dredging, and is inapposite.

II. FERC'S EIS IS LEGALLY INADEQUATE
The 2024 IPCC regional study, published six weeks before EIS certification, showed a
340% increase in projected flood risk. FERC knew of it and chose not to incorporate it.
40 C.F.R. § 1502.9(d) required a supplemental EIS. This meets Marsh's "seriously
different picture" standard.

CONCLUSION: Affirm the district court in all respects.
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = sys.argv[1:]
    if len(args) >= 2:
        print(f"Loading briefs from: {args[0]}  and  {args[1]}")
        appellant_brief = load_brief(args[0])
        appellee_brief  = load_brief(args[1])
    else:
        print("No brief files provided — using built-in sample LNG briefs.")
        print("Usage: python3 test.py appellant.pdf appellee.pdf\n")
        appellant_brief = SAMPLE_APPELLANT_BRIEF
        appellee_brief  = SAMPLE_APPELLEE_BRIEF

    num = min(NUM_PREDICTIONS, len(JUDICIAL_LENSES))
    lenses = JUDICIAL_LENSES[:num]

    print(f"\nModel       : {HF_MODEL}")
    print(f"Predictions : {num}")

    # Load the pipeline once before the clock starts
    get_pipeline()

    t0 = time.time()

    # Phase 1
    meta        = extract_issues(appellant_brief, appellee_brief)
    case_summary= meta.get("case_summary", "")
    key_issues  = meta.get("key_legal_issues", [])

    print_header(meta, num)

    # Phase 2 — one call per lens
    predictions = []
    for i, lens_def in enumerate(lenses, start=1):
        print(f"  [{i}/{num}] {lens_def['lens']} …", flush=True)
        pred = generate_agenda(
            prediction_id=i,
            lens_def=lens_def,
            case_summary=case_summary,
            key_issues=key_issues,
            appellant=appellant_brief,
            appellee=appellee_brief,
        )
        predictions.append(pred)
        color = PREDICTION_COLORS[(i - 1) % len(PREDICTION_COLORS)]
        print_prediction(pred, color)

    elapsed = time.time() - t0
    print_footer(predictions, elapsed)

    # Save full JSON
    dump_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_output.json")
    with open(dump_path, "w") as f:
        json.dump({
            "model": HF_MODEL,
            "case_summary": case_summary,
            "key_legal_issues": key_issues,
            "predictions": predictions,
        }, f, indent=2)
    print(f"\n  Full JSON → {dump_path}")


if __name__ == "__main__":
    main()
