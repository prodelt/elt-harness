#!/usr/bin/env python3
"""
W10-08: RAG vs no-RAG benchmark
Runs 10 questions through LightRAG hybrid mode AND plain ollama (no context).
Output: results.json + RESULTS.md comparison table.
"""

import asyncio
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from lightrag import LightRAG
from lightrag.base import QueryParam
from lightrag.llm.ollama import ollama_model_complete
from lightrag.utils import EmbeddingFunc
from google import genai as google_genai

QUESTIONS_PATH = Path(__file__).parent / "questions.json"
OUT_JSON       = Path(__file__).parent / "results.json"
OUT_MD         = Path(__file__).parent / "RESULTS.md"

OLLAMA_HOST        = "http://localhost:11434"
OLLAMA_MODEL       = "qwen3:1.7b"
GOOGLE_EMBED_MODEL = "models/gemini-embedding-2"
GOOGLE_EMBED_DIM   = 3072
GOOGLE_EMBED_MAX   = 2048
GOOGLE_API_KEY     = os.environ.get("GOOGLE_API_KEY", "")

PROJECTS = {
    "pipeline":       "C:/Claude playground/Pipiline setupper",
    "izi-tracker":    "D:/Ametrin projects/Izi tracker/izi-tracker",
    "law-assistant":  "D:/Ametrin projects/Law_assistant",
    "sudoviy-master": "D:/Ametrin projects/sudoviy master try 3",
}


# ---------------------------------------------------------------------------
# Embedding (Google gemini-embedding-2)
# ---------------------------------------------------------------------------

async def google_embed(texts: list[str]) -> np.ndarray:
    import re as _re
    client = google_genai.Client(api_key=GOOGLE_API_KEY)
    for attempt in range(6):
        try:
            result = await client.aio.models.embed_content(
                model=GOOGLE_EMBED_MODEL, contents=texts
            )
            return np.array([e.values for e in result.embeddings], dtype=np.float32)
        except Exception as exc:
            if "429" in str(exc) and attempt < 5:
                m = _re.search(r'"retryDelay":\s*"(\d+)s"', str(exc))
                wait = int(m.group(1)) + 5 if m else 60
                print(f"  [embed 429] waiting {wait}s…", flush=True)
                await asyncio.sleep(wait)
                continue
            raise


def make_rag(index_dir: str) -> LightRAG:
    return LightRAG(
        working_dir=index_dir,
        llm_model_func=ollama_model_complete,
        llm_model_name=OLLAMA_MODEL,
        llm_model_kwargs={"host": OLLAMA_HOST, "options": {"num_ctx": 2048}, "timeout": 300},
        embedding_func=EmbeddingFunc(
            embedding_dim=GOOGLE_EMBED_DIM,
            max_token_size=GOOGLE_EMBED_MAX,
            func=google_embed,
        ),
        chunk_token_size=300,
    )


# ---------------------------------------------------------------------------
# no-RAG: plain ollama call (no project context)
# ---------------------------------------------------------------------------

def ollama_query(question: str) -> tuple[str, float]:
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": (
            "Відповідай коротко і по суті (максимум 150 слів, без вступів). "
            f"Питання: {question}"
        ),
        "stream": False,
        "options": {"num_predict": 300, "temperature": 0},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    return strip_thinking(data.get("response", "")), round(time.time() - t0, 1)


# ---------------------------------------------------------------------------
# RAG: LightRAG hybrid query against project index
# ---------------------------------------------------------------------------

async def rag_query(project_key: str, question: str) -> tuple[str, float]:
    project_path = PROJECTS.get(project_key)
    if not project_path:
        return f"Unknown project: {project_key}", 0.0

    manifest_path = Path(project_path) / ".rag" / "manifest.json"
    if not manifest_path.exists():
        return "No RAG manifest found", 0.0

    manifest  = json.loads(manifest_path.read_text(encoding="utf-8"))
    index_dir = str(Path(project_path) / manifest.get("index_dir", ".rag/index/"))

    rag = make_rag(index_dir)
    await rag.initialize_storages()
    t0  = time.time()
    answer = await rag.aquery(
        question,
        param=QueryParam(mode="hybrid", response_type="Single Paragraph"),
    )
    return (answer or "").strip(), round(time.time() - t0, 1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def strip_thinking(text: str) -> str:
    """qwen3 outputs <think>...</think> before the real answer."""
    import re
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    return text.strip()


def truncate(text: str, n: int = 220) -> str:
    text = text.replace("\n", " ").replace("|", "｜").strip()
    return text[:n] + "…" if len(text) > n else text


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    if not GOOGLE_API_KEY:
        print("ERROR: GOOGLE_API_KEY env var not set")
        sys.exit(1)

    questions = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))["questions"]
    results   = []

    for q in questions:
        qid, project, question = q["id"], q["project"], q["q"]
        print(f"\n[{qid:02d}/10] {project} | {question[:55]}…", flush=True)

        print("  no-RAG → ", end="", flush=True)
        try:
            no_ans, no_t = ollama_query(question)
            print(f"OK ({no_t}s, {len(no_ans.split())} words)", flush=True)
        except Exception as exc:
            no_ans, no_t = f"ERROR: {exc}", 0.0
            print(f"FAIL: {exc}", flush=True)

        print("  RAG    → ", end="", flush=True)
        try:
            ra_ans, ra_t = await rag_query(project, question)
            print(f"OK ({ra_t}s, {len(ra_ans.split())} words)", flush=True)
        except Exception as exc:
            ra_ans, ra_t = f"ERROR: {exc}", 0.0
            print(f"FAIL: {exc}", flush=True)

        no_w   = len(no_ans.split())
        ra_w   = len(ra_ans.split())
        winner = "RAG" if ra_w > no_w * 1.3 else ("no-RAG" if no_w > ra_w * 1.3 else "tie")

        results.append({
            "id": qid, "project": project, "question": question,
            "no_rag": {"answer": no_ans, "words": no_w, "time_s": no_t},
            "rag":    {"answer": ra_ans, "words": ra_w, "time_s": ra_t},
            "winner": winner,
        })

    # Save JSON
    OUT_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✓ results.json saved")

    # Build Markdown table
    lines = [
        "# W10-08: RAG vs no-RAG Comparison\n",
        f"Model: `{OLLAMA_MODEL}` | Embed: Google gemini-embedding-2 | Mode: hybrid | {time.strftime('%Y-%m-%d')}\n",
        "| # | Project | Question | no-RAG (words/s) | RAG (words/s) | Winner |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        lines.append(
            f"| {r['id']} | `{r['project']}` | {r['question'][:55]}… "
            f"| {truncate(r['no_rag']['answer'])} ({r['no_rag']['words']}w/{r['no_rag']['time_s']}s) "
            f"| {truncate(r['rag']['answer'])} ({r['rag']['words']}w/{r['rag']['time_s']}s) "
            f"| **{r['winner']}** |"
        )

    rag_w   = sum(1 for r in results if r["winner"] == "RAG")
    norag_w = sum(1 for r in results if r["winner"] == "no-RAG")
    tie_w   = sum(1 for r in results if r["winner"] == "tie")
    avg_no  = sum(r["no_rag"]["time_s"] for r in results) / len(results)
    avg_ra  = sum(r["rag"]["time_s"]    for r in results) / len(results)

    lines += [
        "\n## Summary",
        f"| Metric | Value |",
        f"|---|---|",
        f"| RAG wins | {rag_w}/10 |",
        f"| no-RAG wins | {norag_w}/10 |",
        f"| Ties | {tie_w}/10 |",
        f"| Avg time no-RAG | {avg_no:.1f}s |",
        f"| Avg time RAG | {avg_ra:.1f}s |",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"✓ RESULTS.md saved")
    print(f"\n{'='*50}")
    print(f"RAG: {rag_w}/10 | no-RAG: {norag_w}/10 | tie: {tie_w}/10")
    print(f"Avg time — no-RAG: {avg_no:.1f}s | RAG: {avg_ra:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
