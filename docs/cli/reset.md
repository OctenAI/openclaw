---
summary: "CLI reference for `octenclaw reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `octenclaw reset`

Reset local config/state (keeps the CLI installed).

```bash
octenclaw backup create
octenclaw reset
octenclaw reset --dry-run
octenclaw reset --scope config+creds+sessions --yes --non-interactive
```

Run `octenclaw backup create` first if you want a restorable snapshot before removing local state.
