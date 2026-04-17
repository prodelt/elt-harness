# config.json diff (B03)

Full snapshot omitted because secret-scanner patterns array would trigger false-positive on this repo's quality gate. Only the B03-relevant diff is shown:

```diff
   "editEnforcer": {
     "skipExtensions": [".md", ".txt", ".json", ".yml", ...],
-    "skipPaths": ["/.claude/", "/.gsd/", "node_modules"]
+    "skipPaths": ["/.claude/", "/.gsd/", "node_modules"],
+    "fileSizeWarnLoc": 500,
+    "fileSizeBlockLoc": 1200
   },
```

Live file: `~/.claude/hooks/config.json` (in the C:\ system repo, not this project repo).
