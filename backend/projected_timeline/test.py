"""
Standalone test for the timeline generator using unsloth + local GPU.

Run from the backend/ directory:
    python -m projected_timeline.test

A mock async client wraps unsloth inference so the generator code is untouched.
"""

import asyncio
import json
import pathlib
import sys
from types import SimpleNamespace

# Ensure `backend/` is on sys.path so package-relative imports work when
# the script is executed directly (python test.py) or as a module.
_backend = pathlib.Path(__file__).parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

# ---------------------------------------------------------------------------
# Model — swap to any unsloth 7-14B checkpoint you prefer
# ---------------------------------------------------------------------------
MODEL_NAME = "unsloth/Qwen2.5-7B-Instruct"   # or "unsloth/gemma-3-12b-it", "unsloth/Qwen2.5-14B-Instruct"

# ---------------------------------------------------------------------------
# Load unsloth model once (module-level so it only happens once)
# ---------------------------------------------------------------------------
print(f"Loading {MODEL_NAME} with unsloth …")
from unsloth import FastLanguageModel  # noqa: E402

_model, _tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=4096,
    load_in_4bit=True,
)
FastLanguageModel.for_inference(_model)
print("Model ready.\n")


# ---------------------------------------------------------------------------
# Mock async OpenAI-compatible client backed by unsloth
# ---------------------------------------------------------------------------
class _Completions:
    async def create(self, *, model=None, messages, temperature=0.7, max_tokens=512, **_):  # noqa: ARG002
        import torch
        inputs = _tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(_model.device)
        attention_mask = torch.ones_like(inputs)

        outputs = _model.generate(
            inputs,
            attention_mask=attention_mask,
            max_new_tokens=max_tokens,
            temperature=max(temperature, 1e-2),
            do_sample=temperature > 0,
            pad_token_id=_tokenizer.eos_token_id,
        )
        text = _tokenizer.decode(
            outputs[0][inputs.shape[1]:],
            skip_special_tokens=True,
        )
        choice = SimpleNamespace(message=SimpleNamespace(content=text))
        return SimpleNamespace(choices=[choice])


class _UnslothClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_Completions())


# ---------------------------------------------------------------------------
# Patch the generator to use our client before importing generate_topic_sets
# ---------------------------------------------------------------------------
import projected_timeline.timeline_generator as tg  # noqa: E402

tg._openai_client = _UnslothClient()   # skip _get_client() entirely

from projected_timeline.models import TopicPredictionRequest  # noqa: E402
from projected_timeline.timeline_generator import generate_topic_sets  # noqa: E402


# ---------------------------------------------------------------------------
# Sample briefs
# ---------------------------------------------------------------------------
APPELLANT_BRIEF = """
Coastal Energy LLC v. Pacific Environmental Alliance, No. 24-1234

ARGUMENT

I. NWP 12 COVERS COASTAL'S DREDGING ACTIVITIES

Nationwide Permit 12 authorises discharges of dredged or fill material into
waters of the United States that are incidental to the construction,
maintenance, repair, and removal of utility lines. Coastal's LNG terminal
connects to the interstate natural gas grid; the dredging at issue is
incidental to that utility infrastructure. The Corps of Engineers properly
verified that NWP 12 applied after project-specific review.

The district court erred by reading an implied acreage cap into NWP 12 that
Congress and the Corps never enacted. Borden Ranch Partnership v. U.S. Army
Corps of Eng'rs, 261 F.3d 810 (9th Cir. 2001), confirms that mechanised
land-clearing that redeposits soil can qualify for NWP coverage.

II. FERC'S EIS SATISFIES NEPA

FERC conducted a thorough multi-year environmental review producing a
2,400-page EIS. The 2024 IPCC regional study cited by PEA was published after
the record closed. NEPA does not require agencies to chase every post-hoc
study; supplementation is required only when new information presents a
seriously different picture. FERC found the new data was consistent with its
prior analysis and adequately explained that conclusion.
"""

APPELLEE_BRIEF = """
Pacific Environmental Alliance v. Coastal Energy LLC, No. 24-1234

ARGUMENT

I. NWP 12 DOES NOT COVER COASTAL'S LARGE-SCALE DREDGING

Nationwide Permit 12 was designed for routine, de minimis discharges. Coastal
destroyed over 40 acres of jurisdictional wetlands without obtaining an
individual §404 permit. The Corps' project-specific verification cannot expand
a nationwide permit beyond its regulatory scope.

The plain text of NWP 12 limits coverage to activities "incidental" to utility
line construction. Coastal's dredging is the primary activity enabling the LNG
terminal to operate. Borden Ranch is distinguishable because the dredging
volume and wetlands impact here are categorically greater.

II. FERC'S EIS IS INADEQUATE UNDER NEPA

The 2024 IPCC Pacific Northwest Coastal Flooding Study — published before
FERC's Record of Decision — projects flood-stage increases of 0.8–1.4 m at
the terminal site by 2060, exceeding FERC's risk assumptions. FERC was aware;
internal emails show staff reviewed the study. Under 40 C.F.R. § 1502.9(d),
FERC was required to supplement the EIS.
"""


async def main():
    print(f"Model : {MODEL_NAME}")
    print(f"Lenses: 3 (quick test)\n")

    request = TopicPredictionRequest(
        appellant_brief=APPELLANT_BRIEF,
        appellee_brief=APPELLEE_BRIEF,
        proceeding_type="Federal Appellate Oral Argument",
        num_predictions=3,
    )

    result = await generate_topic_sets(request)

    print(f"Case summary : {result.case_summary}")
    print(f"Key issues   : {result.key_legal_issues}\n")

    for pred in result.predictions:
        print(f"--- [{pred.prediction_id}] {pred.lens} ---")
        print(f"Rationale: {pred.rationale}")
        for t in pred.topics:
            print(f"  {t.order}. {t.title}  ({t.target})")
            print(f"     {t.description}")
        print()

    out = pathlib.Path(__file__).parent / "test_output.json"
    payload = {
        "model": MODEL_NAME,
        "case_summary": result.case_summary,
        "key_legal_issues": result.key_legal_issues,
        "predictions": [
            {
                "prediction_id": p.prediction_id,
                "lens": p.lens,
                "rationale": p.rationale,
                "topics": [
                    {"order": t.order, "title": t.title,
                     "description": t.description, "target": t.target}
                    for t in p.topics
                ],
            }
            for p in result.predictions
        ],
    }
    out.write_text(json.dumps(payload, indent=2))
    print(f"Output written to {out}")


if __name__ == "__main__":
    asyncio.run(main())
