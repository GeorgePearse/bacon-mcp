# bacon-mcp

MCP (Model Context Protocol) server for Rust development, inspired by [bacon](https://github.com/Canop/bacon).

Provides AI assistants with tools to check, lint, test, and build Rust projects with comprehensive code quality analysis.

## Features

### Core Tools
- **bacon_check** - Fast compilation checking via `cargo check`
- **bacon_build** - Full builds with error reporting
- **bacon_test** - Run and report test results
- **bacon_doc** - Documentation generation and checking

### Linting & Quality
- **bacon_clippy** - Comprehensive linting with multiple lint groups:
  - `pedantic` - Extra strict checks (missing docs, unwrap usage)
  - `nursery` - Experimental lints (may have false positives)
  - `cargo` - Cargo.toml checks (wildcard deps, missing metadata)
  - `restriction` - Very strict lints (panic, unwrap, expect)
  - Custom `allow`, `warn`, `deny` lint configurations
- **bacon_clippy_strict** - Maximum strictness (pedantic + nursery + cargo, warnings denied)
- **bacon_quality** - Comprehensive quality report (clippy + fmt + doc)

### Formatting
- **bacon_fmt** - Auto-format code with rustfmt
- **bacon_fmt_check** - Check formatting without modifying

### Security & Dependencies
- **bacon_audit** - Security vulnerability scanning
- **bacon_deny** - License, security, and duplicate checking
- **bacon_outdated** - Check for outdated dependencies
- **bacon_udeps** - Find unused dependencies (requires nightly)
- **bacon_machete** - Fast unused dependency detection

### Info
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

### bacon_clippy

Run Clippy linter with configurable strictness levels.

```
path: /path/to/rust/project
pedantic: true       # Extra strict checks
nursery: true        # Experimental lints
cargo: true          # Cargo.toml lints
restriction: true    # Very strict (usually too much)
deny_warnings: true  # Treat warnings as errors (for CI)
fix: true            # Auto-apply fixes
allow: ["clippy::too_many_arguments"]  # Ignore specific lints
warn: ["clippy::unwrap_used"]          # Warn on specific lints
deny: ["clippy::panic"]                # Error on specific lints
```

### bacon_clippy_strict

Maximum code quality - runs pedantic + nursery + cargo with warnings denied.

```
path: /path/to/rust/project
fix: true   # Auto-apply fixes
```

### bacon_quality

Comprehensive quality check combining:
- Clippy (pedantic + nursery)
- Format check
- Documentation check

```
path: /path/to/rust/project
```

### bacon_deny

Check dependencies for licenses, security, and duplicates.

```
path: /path/to/rust/project
check: "all"          # all, advisories, bans, licenses, sources
```

### bacon_outdated

Check for outdated dependencies.

```
path: /path/to/rust/project
depth: 1   # How deep in dependency tree (1 = direct only)
```

### bacon_machete

Fast unused dependency detection.

```
path: /path/to/rust/project
fix: true   # Auto-remove unused deps
```

### bacon_check

Fast compilation checking.

```
path: /path/to/rust/project
all_targets: true    # Check tests, examples, bins
all_features: true   # Enable all features
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
no_deps: true           # Skip dependency docs
document_private: true  # Include private items
open: true              # Open in browser
```

## Optional Cargo Extensions

For full functionality, install these cargo extensions:

```bash
# Security auditing
cargo install cargo-audit

# Comprehensive dependency checking
cargo install cargo-deny

# Outdated dependency detection
cargo install cargo-outdated

# Unused dependency detection (fast, no nightly required)
cargo install cargo-machete

# Unused dependency detection (thorough, requires nightly)
cargo install cargo-udeps
```

## Requirements

- Node.js 18+
- Rust toolchain (`rustup`, `cargo`, `clippy`, `rustfmt`)

## License

MIT
