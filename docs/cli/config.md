---
summary: "CLI reference for `octenclaw config` (get/set/unset/file/validate)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `octenclaw config`

Config helpers: get/set/unset/validate values by path and print the active
config file. Run without a subcommand to open
the configure wizard (same as `octenclaw configure`).

## Examples

```bash
octenclaw config file
octenclaw config get browser.executablePath
octenclaw config set browser.executablePath "/usr/bin/google-chrome"
octenclaw config set agents.defaults.heartbeat.every "2h"
octenclaw config set agents.list[0].tools.exec.node "node-id-or-name"
octenclaw config unset tools.web.search.apiKey
octenclaw config validate
octenclaw config validate --json
```

## Paths

Paths use dot or bracket notation:

```bash
octenclaw config get agents.defaults.workspace
octenclaw config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
octenclaw config get agents.list
octenclaw config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--strict-json` to require JSON5 parsing. `--json` remains supported as a legacy alias.

```bash
octenclaw config set agents.defaults.heartbeat.every "0m"
octenclaw config set gateway.port 19001 --strict-json
octenclaw config set channels.whatsapp.groups '["*"]' --strict-json
```

## Subcommands

- `config file`: Print the active config file path (resolved from `OPENCLAW_CONFIG_PATH` or default location).

Restart the gateway after edits.

## Validate

Validate the current config against the active schema without starting the
gateway.

```bash
octenclaw config validate
octenclaw config validate --json
```
