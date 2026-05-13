# OpenCode IPython Plugin

Execute Python code in a persistent IPython kernel with rich output support, session-scoped kernel reuse, and a comprehensive prelude library of helper functions.

## Installation

### One-Time Setup (Recommended)

```bash
# Install the plugin globally and run setup
npm install -g opencode-ipython-plugin
opencode-ipython-plugin setup

# Or run directly without installing
npx opencode-ipython-plugin setup
```

The setup command will:
1. Check and install Python dependencies (`jupyter_kernel_gateway`, `ipykernel`)
2. Register the plugin in OpenCode's global config
3. Add agent prompts that prefer `python` over `bash`
4. Create an auto-discovery symlink for resilience

### Setup Options

```bash
opencode-ipython-plugin setup --global        # Global config only (default)
opencode-ipython-plugin setup --local         # Project-level config only
opencode-ipython-plugin setup --both          # Both global + project
opencode-ipython-plugin setup --force         # Overwrite existing entries
opencode-ipython-plugin setup --skip-python-check  # Skip Python validation
```

### Manual Installation

If you prefer manual setup, add to `~/.opencode/config.json`:

```json
{
  "plugin": ["opencode-ipython-plugin@latest"]
}
```

## Local Development (Clone & Build)

Use the plugin directly from a local clone without publishing to npm.

### Quick Start (One-Liner)

```bash
git clone https://github.com/your-org/opencode-ipython-plugin.git && \
cd opencode-ipython-plugin && \
bun install && \
bun run build && \
pip install jupyter_kernel_gateway ipykernel && \
mkdir -p ~/.opencode/plugins && \
ln -s "$(pwd)/dist/index.js" ~/.opencode/plugins/opencode-ipython-plugin.js && \
echo '{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ipython-plugin@latest"],
  "agent": {
    "build": {
      "prompt": "When executing code, calculations, data processing, or scripting tasks, ALWAYS prefer the `python` tool over `bash`/`shell`. Only use `bash` for system-level operations (git, npm, docker) that genuinely require shell commands. The `python` tool provides a persistent IPython kernel with rich output support (plots, JSON, markdown) and a comprehensive prelude library of helper functions."
    }
  },
  "instructions": [
    "When executing code, calculations, data processing, or scripting tasks, ALWAYS prefer the `python` tool over `bash`/`shell`. Only use `bash` for system-level operations (git, npm, docker). The `python` tool provides a persistent IPython kernel with rich output support."
  ]
}' > ~/.opencode/config.json
```

### Manual Setup (Step by Step)

**Step 1: Clone & Build**

```bash
git clone https://github.com/your-org/opencode-ipython-plugin.git
cd opencode-ipython-plugin
bun install
bun run build
```

**Step 2: Install Python Dependencies**

```bash
pip install jupyter_kernel_gateway ipykernel
```

If you encounter a PEP 668 error (externally-managed environment):

```bash
python3 -m venv ~/.opencode-ipython-plugin/python-env
source ~/.opencode-ipython-plugin/python-env/bin/activate
pip install jupyter_kernel_gateway ipykernel
```

**Step 3: Choose an Integration Method**

| Method | Description | Config Required |
|--------|-------------|-----------------|
| **A: File URL** | Reference the built JS directly | Yes |
| **B: Plugins Dir** | Symlink into `~/.opencode/plugins/` | No (auto-discovered) |
| **C: npm Link** | Register with npm link | Yes |
| **D: Direct Source** | Point at source directory | Yes |

#### Method A: File URL Plugin Spec

Add to `~/.opencode/config.json`:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-ipython-plugin/dist/index.js"]
}
```

#### Method B: Auto-Discovery Plugins Directory

```bash
mkdir -p ~/.opencode/plugins
ln -s "$(pwd)/dist/index.js" ~/.opencode/plugins/opencode-ipython-plugin.js
```

No config changes needed — OpenCode automatically scans `~/.opencode/plugins/*.js` on startup.

#### Method C: npm Link

```bash
cd opencode-ipython-plugin
npm link
```

Then in your OpenCode config:

```json
{
  "plugin": ["opencode-ipython-plugin"]
}
```

#### Method D: Direct Source Import

Point at the source directory (OpenCode resolves the package):

```json
{
  "plugin": ["file:///absolute/path/to/opencode-ipython-plugin"]
}
```

**Step 4: Add Agent Prompt & Instructions**

Add to `~/.opencode/config.json`:

```json
{
  "agent": {
    "build": {
      "prompt": "When executing code, calculations, data processing, or scripting tasks, ALWAYS prefer the `python` tool over `bash`/`shell`. Only use `bash` for system-level operations (git, npm, docker) that genuinely require shell commands. The `python` tool provides a persistent IPython kernel with rich output support (plots, JSON, markdown) and a comprehensive prelude library of helper functions."
    }
  },
  "instructions": [
    "When executing code, calculations, data processing, or scripting tasks, ALWAYS prefer the `python` tool over `bash`/`shell`. Only use `bash` for system-level operations (git, npm, docker). The `python` tool provides a persistent IPython kernel with rich output support."
  ]
}
```

### Project-Level Setup

For team sharing without npm publishing:

```bash
cd your-project
mkdir -p .opencode/plugins
ln -s /absolute/path/to/opencode-ipython-plugin/dist/index.js .opencode/plugins/opencode-ipython-plugin.js
```

Commit `.opencode/config.json` with the plugin spec so team members get it automatically.

### Updating Your Local Clone

```bash
cd opencode-ipython-plugin
git pull
bun run build
```

The symlink in `~/.opencode/plugins/` remains valid since it points to `dist/index.js`, which is regenerated on build.

### Troubleshooting: Local Integration

| Issue | Cause | Fix |
|-------|-------|-----|
| Symlink broken after `git pull` | `dist/` was deleted or moved | Run `bun run build` to regenerate |
| Plugin not loading from plugins dir | File not in `~/.opencode/plugins/*.js` | Check symlink exists: `ls -la ~/.opencode/plugins/` |
| File URL not resolving | Relative path or missing `file://` prefix | Use absolute path: `file:///home/user/...` |
| `pip install` fails (PEP 668) | System Python is externally managed | Use virtual environment (see Step 2) |
| Changes not reflected | Old build cached | Run `bun run build` again |
| Permission denied on plugin | File not executable | `chmod +x dist/index.js` |

## Requirements

- **Bun** >= 1.0.0 (runtime)
- **Python** >= 3.8 with `jupyter_kernel_gateway` and `ipykernel`

The plugin will attempt to auto-install required Python packages if they are missing:

```bash
pip install jupyter_kernel_gateway ipykernel
```

If your system uses PEP 668 (externally-managed environments), create a virtual environment first:

```bash
python3 -m venv ~/.opencode-ipython-plugin/python-env
source ~/.opencode-ipython-plugin/python-env/bin/activate
pip install jupyter_kernel_gateway ipykernel
```

## Features

### Persistent IPython Kernels

Unlike one-off Python execution, this plugin maintains persistent IPython kernels that survive across tool calls. This means:

- **Variables persist** — Define `x = 42` in one call, use it in the next
- **Imports survive** — `import pandas as pd` stays loaded
- **Functions remain defined** — Reuse helper functions across multiple calls
- **Stateful workflows** — Load data, process it, visualize it — all in the same kernel

### Session-Scoped Kernel Reuse

Kernels are managed with intelligent lifecycle policies:

| Feature | Behavior |
|---------|----------|
| **Session key** | `sessionId + cwd` |
| **Idle timeout** | 5 minutes of inactivity |
| **Max sessions** | 4 kernels (LRU eviction) |
| **Heartbeat** | Every 30 seconds |
| **Auto-restart** | 1 attempt on crash, hard failure on 2nd |
| **Queue** | Serial execution per session |

### Multi-Cell Execution

Execute multiple code cells sequentially in a single tool call:

```json
{
  "cells": [
    { "code": "import pandas as pd", "title": "imports" },
    { "code": "df = pd.DataFrame({'x': [1,2,3]})", "title": "load" },
    { "code": "print(df.shape)", "title": "inspect" }
  ],
  "timeout": 30,
  "cwd": "/path/to/project"
}
```

Cell execution stops on first error — later cells are skipped but earlier state persists.

### Rich Output Support

The plugin captures and renders rich Jupyter outputs:

- **`text/plain`** — Standard text output
- **`text/markdown`** — Formatted markdown
- **`text/html`** — Rendered HTML (converted to markdown for LLM)
- **`image/png`** — Base64 inline images (visible to LLM + TUI attachments)
- **`application/json`** — Structured JSON metadata

### Full Prelude Library

A ~850-line Python helper library is automatically injected into every kernel, providing:

#### File I/O
- `read(path, offset=1, limit=None)` — Read file contents
- `write(path, content)` — Write file (creates parents)
- `append(path, content)` — Append to file

#### File Operations
- `rm(path, recursive=False)` — Delete file/directory
- `mv(src, dst)` — Move/rename
- `cp(src, dst)` — Copy file/directory

#### Search
- `find(pattern, path=".", type="file", limit=1000)` — Recursive glob with .gitignore respect
- `grep(pattern, path, ignore_case=False, literal=False)` — Grep single file
- `rgrep(pattern, path=".", glob_pattern="*")` — Recursive grep
- `glob_files(pattern, path=".")` — Non-recursive glob

#### Find/Replace
- `replace(path, pattern, repl, regex=False)` — Replace in file
- `sed(path, pattern, repl, flags=0)` — Regex replace (like `sed -i`)
- `rsed(pattern, repl, path=".", glob_pattern="*")` — Recursive sed

#### Line Operations
- `lines(path, start, end=None)` — Extract line range
- `delete_lines(path, start, end=None)` — Delete line range
- `delete_matching(path, pattern, regex=True)` — Delete matching lines
- `insert_at(path, line_num, text, after=True)` — Insert text at line

#### Shell
- `run(cmd, cwd=None, timeout=None)` — Run shell command with proper interrupt handling
- `env(key=None, value=None)` — Get/set environment variables

#### Navigation
- `tree(path=".", max_depth=3)` — Directory tree
- `stat(path)` — File/directory info

#### Text Processing
- `sort_lines(text, reverse=False, unique=False)` — Sort lines
- `uniq(text, count=False)` — Remove duplicate adjacent lines
- `counter(items, limit=None, reverse=True)` — Count occurrences
- `cols(text, *indices, sep=None)` — Extract columns

#### Batch
- `diff(a, b)` — Unified diff between files

#### Agent
- `output(*ids, format="raw", query=None)` — Read other agent outputs by ID

### Extension Modules

Custom Python modules are auto-loaded into every kernel from:

- `~/.opencode-ipython-plugin/modules/*.py` (user-level)
- `<cwd>/.opencode-ipython-plugin/modules/*.py` (project-level, overrides user)

## Architecture

```
Plugin
├── Tool Surface (python.ts)
│   ├── Zod schema validation
│   ├── Multi-cell execution
│   └── Image attachment generation
├── Execution Engine (executor.ts)
│   ├── Cell sequencing
│   ├── Timeout/cancellation
│   └── Output collection
├── Session Manager (session.ts)
│   ├── LRU kernel pool
│   ├── Heartbeat monitoring
│   └── Auto-restart on crash
├── Kernel Client (kernel.ts)
│   ├── WebSocket connection
│   ├── Jupyter messaging protocol
│   └── Binary message framing
├── Gateway Coordinator (gateway.ts)
│   ├── Shared process spawn
│   ├── File-lock coordination
│   └── Health checks
├── Runtime (runtime.ts)
│   ├── Python/venv resolution
│   └── Environment filtering
├── Prelude (prelude.ts + prelude.py)
│   └── Helper library injection
└── Module Loader (modules.ts)
    └── Extension module discovery
```

## Usage Examples

### Basic Python Execution

```json
{
  "tool": "python",
  "args": {
    "cells": [
      { "code": "print('Hello, World!')" }
    ]
  }
}
```

### Multi-Cell Workflow

```json
{
  "tool": "python",
  "args": {
    "cells": [
      { "code": "import pandas as pd", "title": "imports" },
      { "code": "df = pd.DataFrame({'a': [1, 2, 3], 'b': [4, 5, 6]})", "title": "create" },
      { "code": "print(df.describe())", "title": "summary" }
    ],
    "timeout": 60
  }
}
```

### Using Prelude Helpers

```json
{
  "tool": "python",
  "args": {
    "cells": [
      { "code": "files = find('*.ts', 'src')", "title": "find" },
      { "code": "for f in files[:5]: print(f)", "title": "list" }
    ]
  }
}
```

### Visualization

```json
{
  "tool": "python",
  "args": {
    "cells": [
      {
        "code": "
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()
        ",
        "title": "plot"
      }
    ]
  }
}
```

### Reset Kernel State

```json
{
  "tool": "python",
  "args": {
    "cells": [
      { "code": "print('fresh kernel')" }
    ],
    "reset": true
  }
}
```

## Configuration

No explicit configuration is required. The plugin auto-detects:

1. **Python executable** — Checks `VIRTUAL_ENV`, `.venv/`, `venv/`, then `PATH`
2. **Working directory** — Uses OpenCode session directory by default
3. **Environment** — Filters out API keys, preserves safe variables

## Environment Filtering

The plugin automatically strips dangerous environment variables before passing them to the Python kernel:

**Stripped:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, etc.

**Preserved:** `PATH`, `HOME`, `VIRTUAL_ENV`, `PYTHONPATH`, `LANG`, `LC_*`, `XDG_*`

## Troubleshooting

### "Python kernel unavailable"

Install required packages:
```bash
pip install jupyter_kernel_gateway ipykernel
```

### "externally-managed-environment" (PEP 668)

Use a virtual environment:
```bash
python3 -m venv ~/.opencode-ipython-plugin/python-env
source ~/.opencode-ipython-plugin/python-env/bin/activate
pip install jupyter_kernel_gateway ipykernel
```

### Gateway process won't start

Check the gateway logs:
```bash
cat ~/.opencode-ipython-plugin/gateway/gateway.json
```

Clear stale locks:
```bash
rm ~/.opencode-ipython-plugin/gateway/gateway.lock
```

### Kernel crashes on start

The session manager will auto-restart once. If it crashes again, the session is marked dead. Try:

```json
{ "cells": [...], "reset": true }
```

## Project-Level Modules

When using `--local` or `--both`, the setup command creates a project directory for custom Python extensions:

```
.opencode-ipython-plugin/
└── modules/
    └── README.md
```

Place `.py` files in `modules/` to auto-load them into every kernel for this project. These are executed silently after the prelude on kernel startup.

## Development

```bash
# Clone and install dependencies
bun install

# Build
bun run build

# Run setup locally
bun run setup

# Run tests (requires Python + jupyter_kernel_gateway + ipykernel)
bun test

# Run tests with Python skip (unit tests only)
OC_PYTHON_SKIP_CHECK=1 bun test
```

## License

MIT
