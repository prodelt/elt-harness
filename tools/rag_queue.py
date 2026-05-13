import fnmatch
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA_VERSION = 1
QUEUE_REL_PATH = ".rag/queue.json"
MAX_DOC_CHARS = 1200
BACKLOG_STATUSES = {"pending", "failed", "processing"}


def queue_path(project_path: str | Path) -> Path:
    return Path(project_path) / QUEUE_REL_PATH


def slugify(value: str) -> str:
    chars = [ch.lower() if ch.isalnum() else "-" for ch in value]
    slug = "".join(chars).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "project"


def project_registry_path(home: str | Path | None = None) -> Path:
    root = Path(home) if home else Path.home()
    return root / ".claude" / "projects-registry.json"


def load_project_registry(home: str | Path | None = None) -> dict:
    path = project_registry_path(home)
    if not path.exists():
        return {"version": 1, "projects": {}}
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return {
        "version": payload.get("version", 1),
        "projects": dict(payload.get("projects", {})),
    }


def read_manifest_project(project_path: str | Path) -> str | None:
    manifest_path = Path(project_path) / ".rag" / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
        project = manifest.get("project")
        return str(project) if project else None
    except (OSError, json.JSONDecodeError):
        return None


def project_aliases(key: str, entry: dict) -> list[str]:
    project_path = entry.get("path", "")
    aliases = [
        key,
        entry.get("key", ""),
        slugify(str(entry.get("name", ""))),
        slugify(Path(project_path).name) if project_path else "",
        read_manifest_project(project_path) if project_path else "",
    ]
    return list(dict.fromkeys(alias for alias in aliases if alias))


def discover_registered_projects(
    home: str | Path | None = None,
    require_manifest: bool = True,
) -> dict[str, str]:
    registry = load_project_registry(home)
    discovered: dict[str, str] = {}
    for key, entry in registry.get("projects", {}).items():
        project_path = entry.get("path")
        if not project_path:
            continue
        root = Path(project_path)
        if not root.exists():
            continue
        if require_manifest and not (root / ".rag" / "manifest.json").exists():
            continue
        for alias in project_aliases(key, entry):
            discovered.setdefault(alias, str(root))
    return discovered


def load_queue(project_path: str | Path) -> dict:
    path = queue_path(project_path)
    if not path.exists():
        return {"schema": SCHEMA_VERSION, "items": []}
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return {
        "schema": payload.get("schema", SCHEMA_VERSION),
        "items": list(payload.get("items", [])),
    }


def write_queue(project_path: str | Path, queue: dict) -> None:
    path = queue_path(project_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".json.tmp")
    payload = {
        "schema": SCHEMA_VERSION,
        "items": list(queue.get("items", [])),
    }
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)


def relative_project_path(project_path: str | Path, file_path: str | Path) -> str | None:
    project = Path(project_path).resolve()
    target = Path(file_path)
    absolute = target if target.is_absolute() else project / target
    try:
        return absolute.resolve().relative_to(project).as_posix()
    except ValueError:
        return None


def matches_pattern(rel_path: str, pattern: str) -> bool:
    normalized = pattern.replace("\\", "/")
    root_pattern = normalized[3:] if normalized.startswith("**/") else normalized
    return fnmatch.fnmatch(rel_path, normalized) or fnmatch.fnmatch(rel_path, root_pattern)


def is_excluded(rel_path: str, manifest: dict) -> bool:
    return any(matches_pattern(rel_path, pattern) for pattern in manifest.get("exclude", []))


def matching_label(rel_path: str, manifest: dict) -> str | None:
    labels = [
        entry.get("label", "doc")
        for entry in manifest.get("include", [])
        if matches_pattern(rel_path, entry.get("glob", ""))
    ]
    return labels[0] if labels and not is_excluded(rel_path, manifest) else None


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_queue_entry(
    project_path: str | Path,
    manifest: dict,
    file_path: str | Path,
    reason: str,
) -> dict | None:
    rel_path = relative_project_path(project_path, file_path)
    absolute = Path(project_path) / rel_path if rel_path else None
    label = matching_label(rel_path, manifest) if rel_path else None
    if not rel_path or not label or not absolute or not absolute.exists():
        return None
    return {
        "path": rel_path,
        "label": label,
        "sha256": file_sha256(absolute),
        "reason": reason,
        "status": "pending",
        "queued_at": datetime.now(timezone.utc).isoformat(),
    }


def enqueue_file(
    project_path: str | Path,
    manifest: dict,
    file_path: str | Path,
    reason: str = "manual",
) -> dict | None:
    entry = build_queue_entry(project_path, manifest, file_path, reason)
    if not entry:
        return None
    queue = load_queue(project_path)
    kept = [item for item in queue.get("items", []) if item.get("path") != entry["path"]]
    write_queue(project_path, {"schema": SCHEMA_VERSION, "items": [*kept, entry]})
    return entry


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def queue_stats(
    queue: dict,
    now: datetime | None = None,
    stale_after: timedelta = timedelta(hours=24),
) -> dict:
    current_time = now or datetime.now(timezone.utc)
    items = list(queue.get("items", []))
    statuses = [item.get("status", "pending") for item in items]
    stale = [
        item
        for item in items
        if item.get("status", "pending") in BACKLOG_STATUSES
        and (
            not parse_iso_datetime(item.get("queued_at"))
            or current_time - parse_iso_datetime(item.get("queued_at")) > stale_after
        )
    ]
    return {
        "total": len(items),
        "pending": statuses.count("pending"),
        "indexed": statuses.count("indexed"),
        "failed": statuses.count("failed"),
        "skipped": statuses.count("skipped"),
        "processing": statuses.count("processing"),
        "stale": len(stale),
    }


def pending_items(queue: dict) -> list[dict]:
    return [dict(item) for item in queue.get("items", []) if item.get("status") == "pending"]


def document_from_item(project_path: str | Path, item: dict, manifest: dict | None = None) -> dict | None:
    rel_path = item.get("path", "")
    full_path = Path(project_path) / rel_path
    if not rel_path or not full_path.exists():
        return None
    label = matching_label(rel_path, manifest) if manifest else item.get("label", "doc")
    if not label:
        return None
    with open(full_path, encoding="utf-8") as f:
        content = f.read().strip()
    if not content:
        return None
    truncated = (
        content[:MAX_DOC_CHARS] + "\n[...truncated for RAG ingest]"
        if len(content) > MAX_DOC_CHARS
        else content
    )
    return {
        "path": rel_path,
        "doc": f"# [{label}] {rel_path}\n\n{truncated}",
    }


def mark_items(queue: dict, statuses_by_path: dict[str, str]) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    items = [
        {
            **item,
            "status": statuses_by_path.get(item.get("path"), item.get("status", "pending")),
            "processed_at": now if item.get("path") in statuses_by_path else item.get("processed_at"),
        }
        for item in queue.get("items", [])
    ]
    return {"schema": SCHEMA_VERSION, "items": items}


def rag_cache_path(project_name: str, cache_dir: str | Path | None = None) -> Path:
    root = Path(cache_dir) if cache_dir else Path.home() / ".claude" / "rag-cache"
    return root / f"{project_name}.json"


def invalidate_rag_cache(project_name: str, cache_dir: str | Path | None = None) -> bool:
    path = rag_cache_path(project_name, cache_dir=cache_dir)
    if not path.exists():
        return False
    try:
        path.unlink()
        return True
    except OSError:
        return False


def quarantine_index_backlog(
    project_path: str | Path,
    index_dir: str | Path,
    backup_name: str | None = None,
) -> dict:
    index = Path(index_dir)
    status_path = index / "kv_store_doc_status.json"
    full_docs_path = index / "kv_store_full_docs.json"
    if not status_path.exists():
        return {"quarantined": 0, "backup_dir": None}

    with open(status_path, encoding="utf-8") as f:
        statuses = json.load(f)
    full_docs = {}
    if full_docs_path.exists():
        with open(full_docs_path, encoding="utf-8") as f:
            full_docs = json.load(f)

    stale_ids = [
        doc_id
        for doc_id, record in statuses.items()
        if record.get("status", "pending") in BACKLOG_STATUSES
    ]
    if not stale_ids:
        return {"quarantined": 0, "backup_dir": None}

    stamp = backup_name or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = Path(project_path) / ".rag" / "backups" / f"doc-status-quarantine-{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=True)

    quarantined_statuses = {doc_id: statuses[doc_id] for doc_id in stale_ids}
    quarantined_docs = {doc_id: full_docs[doc_id] for doc_id in stale_ids if doc_id in full_docs}
    write_json_atomic(backup_dir / "kv_store_doc_status.quarantined.json", quarantined_statuses)
    write_json_atomic(backup_dir / "kv_store_full_docs.quarantined.json", quarantined_docs)

    active_statuses = {doc_id: record for doc_id, record in statuses.items() if doc_id not in stale_ids}
    active_docs = {doc_id: record for doc_id, record in full_docs.items() if doc_id not in stale_ids}
    write_json_atomic(status_path, active_statuses)
    if full_docs_path.exists():
        write_json_atomic(full_docs_path, active_docs)

    return {
        "quarantined": len(stale_ids),
        "backup_dir": str(backup_dir),
        "full_docs": len(quarantined_docs),
    }
