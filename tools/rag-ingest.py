#!/usr/bin/env python3
"""
rag-ingest.py — LightRAG ingest + query для 4 проектов
Backend: Google gemini-embedding-2 (embed) + Gemini Flash (LLM extraction)

Usage:
    python tools/rag-ingest.py                               # все проекты
    python tools/rag-ingest.py --project <registry-key>     # один проект
    python tools/rag-ingest.py --query "вопрос" --project <registry-key>
    python tools/rag-ingest.py --query "вопрос" --mode hybrid
    python tools/rag-ingest.py --project <registry-key> --llm ollama  # локальный LLM

Required env: GOOGLE_API_KEY=<your-key>
"""

import asyncio
import fnmatch
import glob as glob_module
import json
import numpy as np
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from google import genai as google_genai
from lightrag import LightRAG, QueryParam
from lightrag.llm.ollama import ollama_model_complete
from lightrag.utils import EmbeddingFunc
from rag_queue import (
    document_from_item,
    discover_registered_projects,
    enqueue_file,
    invalidate_rag_cache,
    load_queue,
    mark_items,
    pending_items,
    quarantine_index_backlog,
    queue_stats,
    write_queue,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OLLAMA_HOST = "http://localhost:11434"
OLLAMA_MODEL = "qwen3:1.7b"             # 1GB — 100% GPU, fast; gemma4:e4b (9.6GB) was 79% CPU
GOOGLE_EMBED_MODEL = "models/gemini-embedding-2"
GOOGLE_EMBED_DIM = 3072
GOOGLE_LLM_MODEL = "gemini-2.5-flash"   # used with --llm flash; 2.5-flash has free tier
GOOGLE_EMBED_MAX_TOKENS = 2048
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")

# ---------------------------------------------------------------------------
# Google embedding function
# ---------------------------------------------------------------------------


def _google_client() -> google_genai.Client:
    if not GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY env var is not set")
    return google_genai.Client(api_key=GOOGLE_API_KEY)


async def google_embed(texts: list[str]) -> np.ndarray:
    import re as _re
    client = _google_client()
    for attempt in range(6):
        try:
            result = await client.aio.models.embed_content(
                model=GOOGLE_EMBED_MODEL,
                contents=texts,
            )
            return np.array([e.values for e in result.embeddings], dtype=np.float32)
        except Exception as exc:
            if "429" in str(exc) and attempt < 5:
                m = _re.search(r'"retryDelay":\s*"(\d+)s"', str(exc))
                wait = int(m.group(1)) + 5 if m else 60
                print(f"  [embed 429] waiting {wait}s (attempt {attempt+1}/6)...", flush=True)
                await asyncio.sleep(wait)
                continue
            raise


async def gemini_llm_complete(
    prompt: str,
    system_prompt: str | None = None,
    history_messages: list | None = None,
    **kwargs,
) -> str:
    """LightRAG-compatible LLM function backed by Gemini Flash (API, no local GPU)."""
    import re as _re
    client = _google_client()
    parts: list[str] = []
    if system_prompt:
        parts.append(system_prompt)
    for msg in (history_messages or []):
        role = msg.get("role", "user")
        parts.append(f"{role}: {msg.get('content', '')}")
    parts.append(prompt)
    full_prompt = "\n\n".join(parts)
    for attempt in range(6):
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=GOOGLE_LLM_MODEL,
                    contents=full_prompt,
                ),
                timeout=90,
            )
            return response.text or ""
        except asyncio.TimeoutError:
            if attempt == 5:
                raise RuntimeError("Gemini LLM timeout after 6 attempts")
            await asyncio.sleep(5)
        except Exception as exc:
            err = str(exc)
            if attempt < 5 and ("429" in err or "503" in err or "UNAVAILABLE" in err):
                m = (_re.search(r'"retryDelay":\s*"(\d+)s"', err)
                     or _re.search(r'retry in (\d+(?:\.\d+)?)s', err))
                if "503" in err or "UNAVAILABLE" in err:
                    wait = 30
                elif m:
                    wait = int(float(m.group(1))) + 5
                else:
                    wait = 60
                print(f"  [llm {attempt+1}/6] retry in {wait}s: {err[:60]}", flush=True)
                await asyncio.sleep(wait)
                continue
            raise
    return ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_rag(working_dir: str, llm_backend: str = "flash") -> LightRAG:
    if llm_backend == "ollama":
        llm_func = ollama_model_complete
        llm_name = OLLAMA_MODEL
        llm_kwargs = {
            "host": OLLAMA_HOST,
            "options": {"num_ctx": 2048},
            "timeout": 300,
        }
        llm_max_async = 1       # local model: sequential to avoid timeout
    else:
        llm_func = gemini_llm_complete
        llm_name = GOOGLE_LLM_MODEL
        llm_kwargs = {}
        llm_max_async = 1       # API: sequential to avoid 429 quota flood

    return LightRAG(
        working_dir=working_dir,
        llm_model_func=llm_func,
        llm_model_name=llm_name,
        llm_model_kwargs=llm_kwargs,
        embedding_func=EmbeddingFunc(
            embedding_dim=GOOGLE_EMBED_DIM,
            max_token_size=GOOGLE_EMBED_MAX_TOKENS,
            func=google_embed,
        ),
        chunk_token_size=300,
        chunk_overlap_token_size=30,
        llm_model_max_async=llm_max_async,
        embedding_func_max_async=2,
    )


def collect_documents(project_path: str, manifest: dict) -> list[str]:
    """Return list of formatted document strings from manifest include globs."""
    docs = []
    exclude_patterns = manifest.get("exclude", [])

    for entry in manifest.get("include", []):
        pattern = entry["glob"]
        is_optional = entry.get("optional", False)
        label = entry.get("label", "doc")

        matches = glob_module.glob(
            str(Path(project_path) / pattern), recursive=True
        )

        def is_excluded(fp: str) -> bool:
            rel = os.path.relpath(fp, project_path).replace("\\", "/")
            for excl in exclude_patterns:
                if fnmatch.fnmatch(rel, excl):
                    return True
            return False

        matches = [m for m in matches if not is_excluded(m)]

        if not matches and not is_optional:
            print(f"  [WARN] required glob matched nothing: {pattern}")

        for filepath in sorted(matches):
            try:
                with open(filepath, encoding="utf-8") as f:
                    content = f.read().strip()
                if not content:
                    continue
                rel = os.path.relpath(filepath, project_path).replace("\\", "/")
                # Limit content to avoid LLM token overflow on complex technical docs
                if len(content) > 1200:
                    content = content[:1200] + "\n[...truncated for RAG ingest]"
                doc = f"# [{label}] {rel}\n\n{content}"
                docs.append(doc)
                print(f"  [+] {rel} ({len(content)} chars)")
            except Exception as exc:
                print(f"  [ERR] {filepath}: {exc}")

    return docs


def load_manifest(project_path: str) -> dict:
    manifest_path = Path(project_path) / ".rag" / "manifest.json"
    with open(manifest_path, encoding="utf-8") as f:
        return json.load(f)


def load_projects() -> dict[str, str]:
    return discover_registered_projects()


def describe_project_choices(projects: dict[str, str]) -> str:
    return ", ".join(sorted(projects)) or "<none>"


def resolve_project(project_key: str | None, projects: dict[str, str]) -> tuple[str, str]:
    if not projects:
        print("No registered RAG projects found. Run doctor --register and init-project v2 first.")
        sys.exit(1)
    if project_key:
        project_path = projects.get(project_key)
        if not project_path:
            print(f"Unknown project: {project_key}. Choose: {describe_project_choices(projects)}")
            sys.exit(1)
        return project_key, project_path
    cwd = Path.cwd().resolve()
    for alias, candidate in projects.items():
        if Path(candidate).resolve() == cwd:
            return alias, candidate
    alias = sorted(projects)[0]
    return alias, projects[alias]


def unique_project_targets(projects: dict[str, str]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    targets: list[tuple[str, str]] = []
    for alias in sorted(projects):
        normalized = str(Path(projects[alias]).resolve())
        if normalized in seen:
            continue
        seen.add(normalized)
        targets.append((alias, projects[alias]))
    return targets


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------


async def ingest_project(name: str, project_path: str, llm_backend: str = "flash") -> bool:
    manifest_path = Path(project_path) / ".rag" / "manifest.json"
    if not manifest_path.exists():
        print(f"[SKIP] {name} — manifest not found: {manifest_path}")
        return False

    manifest = load_manifest(project_path)

    index_dir = Path(project_path) / manifest.get("index_dir", ".rag/index/")
    index_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 60}")
    print(f"[INGEST] {name} → {index_dir}")
    docs = collect_documents(project_path, manifest)

    if not docs:
        print(f"[SKIP] {name} — no documents found")
        return False

    rag = make_rag(str(index_dir), llm_backend=llm_backend)
    await rag.initialize_storages()
    print(f"  LLM backend: {llm_backend.upper()} | chunks ~300 tok | async={4 if llm_backend == 'flash' else 1}")
    status = "ok"
    try:
        for i, doc in enumerate(docs, 1):
            print(f"  [insert {i}/{len(docs)}] {len(doc)} chars ...")
            try:
                await rag.ainsert(doc)
            except Exception as exc:
                print(f"  [ERR] insert failed: {exc}")
                status = "partial"
    except Exception as exc:
        print(f"[ERR] ingest failed: {exc}")
        status = "failed"
    finally:
        await rag.finalize_storages()

    manifest["last_built"] = datetime.now(timezone.utc).isoformat()
    manifest["last_built_status"] = status
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"[{status.upper()}] {name} — index at {index_dir}")
    return status != "failed"


async def process_queue_project(name: str, project_path: str, llm_backend: str = "flash") -> bool:
    manifest = load_manifest(project_path)
    index_dir = Path(project_path) / manifest.get("index_dir", ".rag/index/")
    index_dir.mkdir(parents=True, exist_ok=True)
    queue = load_queue(project_path)
    items = pending_items(queue)
    if not items:
        print(f"[QUEUE] {name}: no pending items")
        return True

    documents = [document_from_item(project_path, item, manifest=manifest) for item in items]
    ready = [doc for doc in documents if doc]
    skipped = [item["path"] for item, doc in zip(items, documents) if not doc]
    if not ready:
        write_queue(project_path, mark_items(queue, {path: "skipped" for path in skipped}))
        print(f"[QUEUE] {name}: no readable pending docs")
        return False

    rag = make_rag(str(index_dir), llm_backend=llm_backend)
    await rag.initialize_storages()
    try:
        ids = [f"{name}:{doc['path']}" for doc in ready]
        paths = [doc["path"] for doc in ready]
        await rag.ainsert([doc["doc"] for doc in ready], ids=ids, file_paths=paths)
    finally:
        await rag.finalize_storages()

    indexed = {doc["path"]: "indexed" for doc in ready}
    skipped_statuses = {path: "skipped" for path in skipped}
    write_queue(project_path, mark_items(queue, {**indexed, **skipped_statuses}))
    cache_removed = invalidate_rag_cache(name)
    cache_status = "cache-invalidated" if cache_removed else "cache-not-found"
    print(f"[QUEUE] {name}: indexed={len(ready)} skipped={len(skipped)} {cache_status}")
    return True


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------


async def query_project(
    project_path: str,
    query_text: str,
    mode: str = "mix",
    llm_backend: str = "flash",
) -> str:
    manifest_path = Path(project_path) / ".rag" / "manifest.json"
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    index_dir = Path(project_path) / manifest.get("index_dir", ".rag/index/")
    if not index_dir.exists():
        return f"[ERROR] index not found: {index_dir} — run ingest first"

    rag = make_rag(str(index_dir), llm_backend=llm_backend)
    await rag.initialize_storages()
    try:
        response = await rag.aquery(query_text, param=QueryParam(mode=mode))
        return str(response)
    finally:
        await rag.finalize_storages()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

USAGE = """Usage:
  python tools/rag-ingest.py
  python tools/rag-ingest.py --project <registry-key-or-alias>
  python tools/rag-ingest.py --query "question" --project <registry-key-or-alias>
  python tools/rag-ingest.py --query "question" --mode hybrid
  python tools/rag-ingest.py --project <registry-key-or-alias> --llm ollama
  python tools/rag-ingest.py --project <registry-key-or-alias> --queue AGENTS.md
  python tools/rag-ingest.py --project <registry-key-or-alias> --queue-stats
  python tools/rag-ingest.py --project <registry-key-or-alias> --quarantine-index-backlog
  python tools/rag-ingest.py --project <registry-key-or-alias> --process-queue

Options:
  --project <name>   Registry key or alias from ~/.claude/projects-registry.json
  --query <text>     Query an existing index instead of ingesting documents
  --mode <mode>      LightRAG query mode; default: mix
  --llm <backend>    flash or ollama; default: flash
  --queue <file>     Add one changed file to .rag/queue.json without LLM work
  --queue-stats      Print .rag/queue.json status counts
  --quarantine-index-backlog
                    Back up and remove stale pending/failed/processing LightRAG docs
  --process-queue    Ingest pending queue entries through LightRAG
  -h, --help         Show this help without touching indexes
"""


def parse_args() -> dict:
    args = sys.argv[1:]
    result = {
        "mode": "ingest",
        "project": None,
        "query": None,
        "qmode": "mix",
        "llm": "flash",   # flash=gemini-2.5-flash (default, free tier, fast) | ollama=qwen3:1.7b
        "queue_file": None,
    }

    if "-h" in args or "--help" in args:
        result["mode"] = "help"
        return result

    i = 0
    while i < len(args):
        if args[i] == "--query" and i + 1 < len(args):
            result["mode"] = "query"
            result["query"] = args[i + 1]
            i += 2
        elif args[i] == "--project" and i + 1 < len(args):
            result["project"] = args[i + 1]
            i += 2
        elif args[i] == "--mode" and i + 1 < len(args):
            result["qmode"] = args[i + 1]
            i += 2
        elif args[i] == "--llm" and i + 1 < len(args):
            result["llm"] = args[i + 1]
            i += 2
        elif args[i] == "--queue" and i + 1 < len(args):
            result["mode"] = "queue"
            result["queue_file"] = args[i + 1]
            i += 2
        elif args[i] == "--queue-stats":
            result["mode"] = "queue_stats"
            i += 1
        elif args[i] == "--quarantine-index-backlog":
            result["mode"] = "quarantine_index_backlog"
            i += 1
        elif args[i] == "--process-queue":
            result["mode"] = "process_queue"
            i += 1
        else:
            i += 1

    return result


async def main():
    opts = parse_args()
    llm = opts["llm"]
    projects = load_projects()

    if opts["mode"] == "help":
        print(USAGE)
        return

    if opts["mode"] == "query":
        project_key, project_path = resolve_project(opts["project"], projects)
        print(f"\nQuery [{opts['qmode']}]: {opts['query']}")
        print(f"Project: {project_key} | LLM: {llm}\n")
        answer = await query_project(project_path, opts["query"], opts["qmode"], llm_backend=llm)
        print(f"Answer:\n{answer}")
        return

    if opts["mode"] in {"queue", "queue_stats", "quarantine_index_backlog", "process_queue"}:
        project_key, project_path = resolve_project(opts["project"], projects)
        if opts["mode"] == "queue":
            manifest = load_manifest(project_path)
            entry = enqueue_file(project_path, manifest, opts["queue_file"], reason="manual")
            queued = "queued " + entry["path"] if entry else "ignored"
            print(f"[QUEUE] {project_key}: {queued}")
            return
        if opts["mode"] == "queue_stats":
            print(json.dumps(queue_stats(load_queue(project_path)), ensure_ascii=False))
            return
        if opts["mode"] == "quarantine_index_backlog":
            manifest = load_manifest(project_path)
            index_dir = Path(project_path) / manifest.get("index_dir", ".rag/index/")
            result = quarantine_index_backlog(project_path, index_dir)
            print(json.dumps(result, ensure_ascii=False))
            return
        ok = await process_queue_project(project_key, project_path, llm_backend=llm)
        sys.exit(0 if ok else 1)

    # Ingest mode
    targets = unique_project_targets(projects)
    if opts["project"]:
        targets = [resolve_project(opts["project"], projects)]
    if not targets:
        print("No registered RAG projects found. Run doctor --register and init-project v2 first.")
        sys.exit(1)

    print(f"LLM backend: {llm.upper()} ({'Gemini Flash API' if llm == 'flash' else 'local Ollama'})")
    results = {}
    for name, path in targets:
        ok = await ingest_project(name, path, llm_backend=llm)
        results[name] = "ok" if ok else "failed"

    print(f"\n{'=' * 60}")
    print("SUMMARY:")
    for name, status in results.items():
        icon = "OK" if status == "ok" else "FAIL"
        print(f"  [{icon}] {name}: {status}")


if __name__ == "__main__":
    asyncio.run(main())
