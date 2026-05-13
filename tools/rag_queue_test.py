import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from rag_queue import (
    build_queue_entry,
    discover_registered_projects,
    document_from_item,
    enqueue_file,
    invalidate_rag_cache,
    load_queue,
    quarantine_index_backlog,
    queue_stats,
)


class RagQueueTests(unittest.TestCase):
    def test_enqueue_manifest_doc_deduplicates_by_relative_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            manifest = {
                "include": [{"glob": "docs/*.md", "label": "docs"}],
                "exclude": [],
            }
            doc_path = project / "docs" / "guide.md"
            doc_path.parent.mkdir()
            doc_path.write_text("first", encoding="utf-8")

            first = enqueue_file(project, manifest, doc_path, reason="edit")
            doc_path.write_text("second", encoding="utf-8")
            second = enqueue_file(project, manifest, doc_path, reason="edit")

            queue = load_queue(project)
            self.assertEqual(first["path"], "docs/guide.md")
            self.assertEqual(second["path"], "docs/guide.md")
            self.assertEqual(queue_stats(queue)["pending"], 1)
            self.assertEqual(queue_stats(queue)["total"], 1)
            self.assertEqual(queue["items"][0]["sha256"], second["sha256"])

    def test_excluded_file_is_not_queued(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            manifest = {
                "include": [{"glob": "**/*.md", "label": "docs"}],
                "exclude": ["private/**"],
            }
            secret_doc = project / "private" / "note.md"
            secret_doc.parent.mkdir()
            secret_doc.write_text("do not index", encoding="utf-8")

            entry = build_queue_entry(project, manifest, secret_doc, reason="edit")

            self.assertIsNone(entry)
            self.assertEqual(load_queue(project)["items"], [])

    def test_queue_file_is_json_object_with_versioned_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            manifest = {
                "include": [{"glob": "README.md", "label": "docs"}],
                "exclude": [],
            }
            readme = project / "README.md"
            readme.write_text("hello", encoding="utf-8")

            enqueue_file(project, manifest, readme, reason="manual")
            payload = json.loads((project / ".rag" / "queue.json").read_text("utf-8"))

            self.assertEqual(payload["schema"], 1)
            self.assertEqual(payload["items"][0]["status"], "pending")

    def test_discover_registered_projects_uses_registry_and_manifest_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            project = Path(tmp) / "project-a"
            (project / ".rag").mkdir(parents=True)
            (project / ".rag" / "manifest.json").write_text(
                json.dumps({"project": "project-a-manifest"}),
                encoding="utf-8",
            )
            registry = {
                "version": 1,
                "projects": {
                    "project-a-12345678": {
                        "key": "project-a-12345678",
                        "name": "Project A",
                        "path": str(project),
                    }
                },
            }
            registry_path = home / ".claude" / "projects-registry.json"
            registry_path.parent.mkdir(parents=True)
            registry_path.write_text(json.dumps(registry), encoding="utf-8")

            projects = discover_registered_projects(home=home)

            self.assertEqual(projects["project-a-12345678"], str(project))
            self.assertEqual(projects["project-a"], str(project))
            self.assertEqual(projects["project-a-manifest"], str(project))

    def test_queue_stats_reports_stale_and_known_statuses(self):
        queue = {
            "items": [
                {"status": "pending", "queued_at": "2026-05-07T00:00:00+00:00"},
                {"status": "indexed", "queued_at": "2026-05-08T00:00:00+00:00"},
                {"status": "failed", "queued_at": "bad-date"},
                {"status": "skipped", "queued_at": "2026-05-08T00:00:00+00:00"},
            ]
        }

        stats = queue_stats(queue, now=datetime(2026, 5, 8, 12, tzinfo=timezone.utc))

        self.assertEqual(stats["total"], 4)
        self.assertEqual(stats["pending"], 1)
        self.assertEqual(stats["indexed"], 1)
        self.assertEqual(stats["failed"], 1)
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(stats["stale"], 2)

    def test_document_from_item_revalidates_current_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            readme = project / "README.md"
            readme.write_text("hello", encoding="utf-8")
            item = {"path": "README.md", "label": "docs"}
            manifest = {"include": [], "exclude": []}

            self.assertIsNone(document_from_item(project, item, manifest=manifest))

    def test_invalidate_rag_cache_only_removes_target_project_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            target = cache_dir / "pipeline.json"
            other = cache_dir / "law-assistant.json"
            target.write_text("stale", encoding="utf-8")
            other.write_text("keep", encoding="utf-8")

            removed = invalidate_rag_cache("pipeline", cache_dir=cache_dir)

            self.assertTrue(removed)
            self.assertFalse(target.exists())
            self.assertTrue(other.exists())

    def test_quarantine_index_backlog_backs_up_and_removes_stale_statuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            index = project / ".rag" / "index"
            index.mkdir(parents=True)
            statuses = {
                "ok": {"status": "processed"},
                "old": {"status": "failed"},
                "live": {"status": "processing"},
            }
            full_docs = {
                "ok": {"content": "keep"},
                "old": {"content": "backup"},
                "live": {"content": "backup too"},
            }
            (index / "kv_store_doc_status.json").write_text(json.dumps(statuses), encoding="utf-8")
            (index / "kv_store_full_docs.json").write_text(json.dumps(full_docs), encoding="utf-8")

            result = quarantine_index_backlog(project, index, backup_name="test")

            active_statuses = json.loads((index / "kv_store_doc_status.json").read_text("utf-8"))
            active_docs = json.loads((index / "kv_store_full_docs.json").read_text("utf-8"))
            backup_dir = project / ".rag" / "backups" / "doc-status-quarantine-test"
            backup = json.loads((backup_dir / "kv_store_doc_status.quarantined.json").read_text("utf-8"))

            self.assertEqual(result["quarantined"], 2)
            self.assertEqual(active_statuses, {"ok": {"status": "processed"}})
            self.assertEqual(active_docs, {"ok": {"content": "keep"}})
            self.assertEqual(set(backup), {"old", "live"})


if __name__ == "__main__":
    unittest.main()
