# @mittalsuraj18/opencode-ipython-plugin

Python tool for [OpenCode](https://opencode.ai) with persistent IPython kernels, rich output support, and preloaded helper functions.

## Features

- **Persistent kernels** — Variables, imports, and functions survive across tool calls
- **Session reuse** — Kernels live 5 minutes idle, max 4 sessions (LRU eviction)
- **Multi-cell execution** — Run multiple code blocks sequentially in one call
- **Rich output** — Text, markdown, HTML, JSON, and inline images (matplotlib)
- **Preloaded helpers** — 50+ file/search/shell utilities auto-injected into every kernel
- **Isolated Python** — Auto-managed virtual environment, no system Python pollution

## Quick Start

```bash
npm install -g @mittalsuraj18/opencode-ipython-plugin
opencode-ipython-plugin setup --both
```

Or run without installing:

```bash
npx --package=@mittalsuraj18/opencode-ipython-plugin opencode-ipython-plugin setup --both
```

The setup command auto-configures:
- Isolated Python environment (uv or venv)
- OpenCode plugin registration (global + project)
- Agent prompt to prefer `python` over `bash`

## Installation

### Prerequisites

- **Bun** >= 1.0.0 or **Node** >= 18 ([bun.sh](https://bun.sh))
- **Python** >= 3.8 (for creating the isolated environment)
- **uv** (optional, recommended for faster setup)

### Setup Options

```bash
opencode-ipython-plugin setup --global        # Global config only
opencode-ipython-plugin setup --local         # Project-level config only
opencode-ipython-plugin setup --both          # Both (default if no flag)
opencode-ipython-plugin setup --force         # Overwrite existing config
opencode-ipython-plugin setup --skip-python-check  # Skip Python validation
```

Or without a global install:

```bash
npx --package=@mittalsuraj18/opencode-ipython-plugin opencode-ipython-plugin setup --both
```

### Manual Installation

Add to `~/.opencode/config.json`:

```json
{
  "plugin": ["@mittalsuraj18/opencode-ipython-plugin@latest"]
}
```

## Usage

### Basic Execution

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

### Reset Kernel

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

## Tool Schema

```typescript
{
  cells: Array<{
    code: string;        // Python code to execute
    title?: string;      // Optional cell label
  }>;
  timeout?: number;       // Seconds (default: 300, max: 600)
  cwd?: string;           // Working directory
  reset?: boolean;        // Restart kernel before first cell
}
```

## Architecture

```
┌─────────────────┐
│   Tool Surface  │  Zod schema, execute hook
├─────────────────┤
│  Execution      │  Cell sequencing, timeout,
│  Engine         │  cancellation, output collection
├─────────────────┤
│  Session        │  LRU pool (max 4), idle timeout
│  Manager        │  (5min), heartbeat, auto-restart
├─────────────────┤
│  Kernel Client  │  WebSocket, Jupyter protocol
│  (kernel.ts)    │  binary framing, MIME rendering
├─────────────────┤
│  Gateway        │  Shared jupyter_kernel_gateway
│  Coordinator    │  process, file locks, health checks
├─────────────────┤
│  Runtime        │  Isolated Python env (uv/venv),
│  (runtime.ts)   │  env filtering, auto-install
└─────────────────┘
```

## Prelude Library

An ~850-line Python helper library is auto-injected into every kernel:

| Category | Functions |
|----------|-----------|
| **File I/O** | `read()`, `write()`, `append()` |
| **File Ops** | `rm()`, `mv()`, `cp()` |
| **Search** | `find()`, `grep()`, `rgrep()`, `glob_files()` |
| **Find/Replace** | `replace()`, `sed()`, `rsed()` |
| **Line Ops** | `lines()`, `delete_lines()`, `insert_at()` |
| **Shell** | `run()`, `env()` |
| **Navigation** | `tree()`, `stat()` |
| **Text** | `sort_lines()`, `uniq()`, `counter()`, `cols()` |
| **Diff** | `diff()` |
| **Agent** | `output()` |

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENCODE_PYTHON_DEBUG` | Enable debug logging to stdout | `0` (disabled) |
| `OPENCODE_PYTHON_GATEWAY_URL` | Use external gateway (advanced) | auto-managed |

### Isolated Environment

Location: `~/.opencode-ipython-plugin/python-env/`

Auto-created on first use with:
- `jupyter_kernel_gateway`
- `ipykernel`

No manual `pip install` required.

## Development

```bash
# Clone and build
git clone https://github.com/mittalsuraj18/opencode-ipython-plugin.git
cd opencode-ipython-plugin
bun install
bun run build

# Run tests
bun test                    # Full tests (requires Python env)
OC_PYTHON_SKIP_CHECK=1 bun test  # Unit tests only

# Local setup
bun run setup --both
```

### Project-Level Modules

Custom Python modules auto-load from:
- `~/.opencode-ipython-plugin/modules/*.py` (user-level)
- `<cwd>/.opencode-ipython-plugin/modules/*.py` (project-level, overrides user)

Created automatically by `setup --local` or `setup --both`.

## Troubleshooting

### "Python kernel unavailable"

The plugin auto-creates an isolated environment. If it fails:

```bash
# Check Python is available
python3 --version

# Install uv for faster setup
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or create manually
python3 -m venv ~/.opencode-ipython-plugin/python-env
~/.opencode-ipython-plugin/python-env/bin/pip install jupyter_kernel_gateway ipykernel
```

### Gateway won't start

```bash
# Check gateway status
cat ~/.opencode-ipython-plugin/gateway/gateway.json

# Clear stale locks
rm ~/.opencode-ipython-plugin/gateway/gateway.lock
```

### Plugin not loading

Verify symlink exists:
```bash
ls -la ~/.opencode/plugins/
cat ~/.opencode/config.json | grep plugin
```

### Known Issue: TUI Output

The Python tool uses a required `description` field so OpenCode's GenericTool renderer shows a meaningful subtitle. Some TUI views may still show limited info for custom tools — this is an opencode rendering limitation, not a plugin bug.

## License

MIT

## Links

- **Repository**: https://github.com/mittalsuraj18/opencode-ipython-plugin
- **Issues**: https://github.com/mittalsuraj18/opencode-ipython-plugin/issues
- **OpenCode**: https://opencode.ai
