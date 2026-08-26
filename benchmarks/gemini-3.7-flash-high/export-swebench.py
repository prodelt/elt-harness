#!/usr/bin/env python3
"""Export a locally cached SWE-bench Verified arrow shard to the instances.jsonl shape
that build-gate-dataset.js --kind swebench-gate expects.

This is a pure format conversion: no selection, no filtering, no ordering change. The
sample is drawn later, deterministically, by build-gate-dataset.js from the locked
preregistration seed — doing any of it here would move selection out of the hashed,
reproducible path and into an unversioned script.

Usage:
  python export-swebench.py <path-to.arrow> <out.jsonl>
"""
import json
import sys

import pyarrow as pa
import pyarrow.ipc as ipc

FIELDS = (
    "instance_id",
    "repo",
    "base_commit",
    "patch",
    "test_patch",
    "problem_statement",
    "FAIL_TO_PASS",
    "PASS_TO_PASS",
    "version",
    "difficulty",
)


def read_table(path):
    with pa.memory_map(path, "rb") as src:
        try:
            return ipc.open_stream(src).read_all()
        except pa.ArrowInvalid:
            src.seek(0)
            return ipc.open_file(src).read_all()


def main(argv):
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    table = read_table(argv[0])
    present = [f for f in FIELDS if f in table.schema.names]
    rows = table.select(present).to_pylist()
    with open(argv[1], "w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"export-swebench: {len(rows)} instances -> {argv[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
