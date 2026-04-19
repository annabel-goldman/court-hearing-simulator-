"""Extract text from demo PDF briefs and save as .txt files."""
import os
from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "frontend", "src", "data", "harvard-demo")
os.makedirs(OUT_DIR, exist_ok=True)

BRIEFS = [
    ("Petitioner-Brief Harvard 2024.pdf", "appellant-brief.txt"),
    ("Respondent-Brief.pdf", "respondent-brief.txt"),
]

for pdf_name, out_name in BRIEFS:
    pdf_path = os.path.join(ROOT, pdf_name)
    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    out_path = os.path.join(OUT_DIR, out_name)
    with open(out_path, "w") as f:
        f.write(text)
    print(f"{out_name}: {len(text)} chars, {len(reader.pages)} pages")
