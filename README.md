# bacon-mcp

MCP (Model Context Protocol) server for Rust development, inspired by [bacon](https://github.com/Canop/bacon).

Provides AI assistants with tools to check, lint, test, and build Rust projects.

## Features

- **bacon_check** - Fast compilation checking via `cargo check`
- **bacon_clippy** - Comprehensive linting with suggested fixes
- **bacon_test** - Run and report test results
- **bacon_build** - Full builds with error reporting
- **bacon_doc** - Documentation generation and checking
- **bacon_fmt** / **bacon_fmt_check** - Code formatting
- **bacon_audit** - Security vulnerability scanning
- **rust_project_info** - Project metadata

## Installation

```bash
cd bacon-mcp
npm install
npm run build
```

## Usage with Claude Code

Add to your Claude Code MCP configuration (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "bacon": {
      "command": "node",
      "args": ["/path/to/bacon-mcp/dist/index.js"]
    }
  }
}
```

## Tools

### bacon_check

Run `cargo check` for fast error detection without code generation.

```
path: /path/to/rust/project
all_targets: true    # Check tests, examples, bins
all_features: true   # Enable all features
```

### bacon_clippy

Run Clippy linter for idiomatic Rust code.

```
path: /path/to/rust/project
all_targets: true   # Lint all targets
pedantic: true      # Stricter lints
fix: true           # Auto-apply fixes
```

### bacon_test

Run tests and report results.

```
path: /path/to/rust/project
filter: "test_name"  # Run matching tests only
no_capture: true     # Show test output
```

### bacon_build

Compile the project.

```
path: /path/to/rust/project
release: true       # Optimized build
all_targets: true   # Build everything
```

### bacon_doc

Generate documentation.

```
path: /path/to/rust/project
no_deps: true   # Skip dependency docs
open: true      # Open in browser
```

### bacon_fmt_check / bacon_fmt

Check or apply rustfmt formatting.

```
path: /path/to/rust/project
```

### bacon_audit

Check for security vulnerabilities (requires `cargo-audit`).

```
path: /path/to/rust/project
```

### rust_project_info

Get project name, version, targets, and dependency count.

```
path: /path/to/rust/project
```

## Requirements

- Node.js 18+
- Rust toolchain (`rustup`, `cargo`)
- Optional: `cargo-audit` for security scanning

## License

MIT
