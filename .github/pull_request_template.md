## Summary

<!-- What changes and why. One paragraph. -->

## Test plan

<!--
The commands you ran and their result. A non-trivial new branch ships with the smallest
regression that proves it — name that test here.
-->

```
node tools/elt-oracle-runner.js --full
node tools/gen-agents-md.js --check
```

- [ ] full suite exits 0
- [ ] instruction drift check exits 0
- [ ] the smallest regression for this branch exists (or the change is trivial)
