---
summary: "CLI reference for `octenclaw uninstall` (remove gateway service + local data)"
read_when:
  - You want to remove the gateway service and/or local state
  - You want a dry-run first
title: "uninstall"
---

# `octenclaw uninstall`

Uninstall the gateway service + local data (CLI remains).

```bash
octenclaw backup create
octenclaw uninstall
octenclaw uninstall --all --yes
octenclaw uninstall --dry-run
```

Run `octenclaw backup create` first if you want a restorable snapshot before removing state or workspaces.
