#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  runCargoCommand,
  parseCargoDiagnostics,
  parseTestOutput,
  validateRustProject,
  getProjectInfo,
  formatDiagnostics,
  formatTestResults,
} from "./utils.js";

// Create the MCP server
const server = new Server(
  {
    name: "bacon-mcp",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const tools: Tool[] = [
  {
    name: "bacon_check",
    description:
      "Run `cargo check` on a Rust project and return all compiler errors and warnings. This is the fastest way to find compilation issues without generating code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        all_targets: {
          type: "boolean",
          description:
            "Check all targets (lib, bins, tests, examples). Default: false",
        },
        all_features: {
          type: "boolean",
          description: "Activate all available features. Default: false",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_clippy",
    description:
      "Run `cargo clippy` on a Rust project for comprehensive linting. Returns warnings about common mistakes, style issues, and potential bugs with suggested fixes. Supports multiple lint levels for high-quality Rust code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        all_targets: {
          type: "boolean",
          description:
            "Check all targets (lib, bins, tests, examples). Default: true",
        },
        pedantic: {
          type: "boolean",
          description:
            "Enable pedantic lints - extra strict checks for code quality. Warns on missing docs, unwrap usage, etc. Default: false",
        },
        nursery: {
          type: "boolean",
          description:
            "Enable nursery lints - experimental lints that may have false positives but catch edge cases. Default: false",
        },
        cargo: {
          type: "boolean",
          description:
            "Enable cargo lints - checks for Cargo.toml issues like missing metadata, wildcard dependencies. Default: false",
        },
        restriction: {
          type: "boolean",
          description:
            "Enable restriction lints - very strict lints (panic, unwrap, expect, indexing). Usually too strict for most code. Default: false",
        },
        deny_warnings: {
          type: "boolean",
          description:
            "Treat all warnings as errors (deny instead of warn). Useful for CI. Default: false",
        },
        fix: {
          type: "boolean",
          description:
            "Automatically apply suggested fixes where possible. Default: false",
        },
        allow: {
          type: "array",
          items: { type: "string" },
          description:
            "List of specific lints to allow (ignore). E.g., ['clippy::too_many_arguments']",
        },
        warn: {
          type: "array",
          items: { type: "string" },
          description:
            "List of specific lints to warn on. E.g., ['clippy::unwrap_used']",
        },
        deny: {
          type: "array",
          items: { type: "string" },
          description:
            "List of specific lints to deny (treat as errors). E.g., ['clippy::panic']",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_clippy_strict",
    description:
      "Run clippy with strict settings for maximum code quality. Enables pedantic + nursery + cargo lints and denies warnings. Ideal for ensuring production-quality Rust code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        all_targets: {
          type: "boolean",
          description:
            "Check all targets (lib, bins, tests, examples). Default: true",
        },
        fix: {
          type: "boolean",
          description:
            "Automatically apply suggested fixes where possible. Default: false",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_test",
    description:
      "Run `cargo test` on a Rust project and return test results. Shows which tests passed, failed, or were ignored.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        filter: {
          type: "string",
          description:
            "Filter to run only tests matching this pattern (e.g., 'test_parse')",
        },
        no_capture: {
          type: "boolean",
          description:
            "Show stdout/stderr from tests (don't capture). Default: false",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_build",
    description:
      "Run `cargo build` on a Rust project. Compiles the project and returns any errors or warnings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        release: {
          type: "boolean",
          description: "Build in release mode with optimizations. Default: false",
        },
        all_targets: {
          type: "boolean",
          description: "Build all targets. Default: false",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_doc",
    description:
      "Run `cargo doc` to generate and check documentation. Returns any documentation warnings or errors.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        no_deps: {
          type: "boolean",
          description:
            "Don't build documentation for dependencies. Default: true",
        },
        document_private: {
          type: "boolean",
          description:
            "Document private items as well. Default: false",
        },
        open: {
          type: "boolean",
          description: "Open documentation in browser after building. Default: false",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_fmt_check",
    description:
      "Run `cargo fmt --check` to verify code formatting without modifying files. Returns a list of files that need formatting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_fmt",
    description:
      "Run `cargo fmt` to automatically format all Rust code in the project according to rustfmt rules.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_audit",
    description:
      "Run `cargo audit` to check for known security vulnerabilities in dependencies. Requires cargo-audit to be installed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_deny",
    description:
      "Run `cargo deny` to check dependencies for licenses, security advisories, and duplicate versions. Requires cargo-deny to be installed. More comprehensive than cargo audit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        check: {
          type: "string",
          enum: ["all", "advisories", "bans", "licenses", "sources"],
          description:
            "Which checks to run: 'all' (default), 'advisories' (security), 'bans' (denied crates/duplicates), 'licenses', or 'sources' (allowed registries)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_outdated",
    description:
      "Run `cargo outdated` to check for outdated dependencies. Shows which dependencies have newer versions available. Requires cargo-outdated to be installed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        depth: {
          type: "number",
          description:
            "How deep in the dependency tree to check. Default: 1 (direct deps only)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_udeps",
    description:
      "Run `cargo udeps` to find unused dependencies in your Cargo.toml. Requires cargo-udeps and nightly Rust. Helps keep your dependency list clean.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        all_targets: {
          type: "boolean",
          description:
            "Check all targets for unused dependencies. Default: true",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_machete",
    description:
      "Run `cargo machete` to find unused dependencies. Faster than cargo-udeps and doesn't require nightly. Requires cargo-machete to be installed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
        fix: {
          type: "boolean",
          description:
            "Automatically remove unused dependencies from Cargo.toml. Default: false",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bacon_quality",
    description:
      "Run a comprehensive code quality check: clippy (pedantic + nursery), fmt check, and doc check. Returns a combined report of all issues found.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "rust_project_info",
    description:
      "Get information about a Rust project including name, version, and basic structure.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Absolute path to the Rust project directory (containing Cargo.toml)",
        },
      },
      required: ["path"],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const path = (args as { path?: string }).path;
  if (!path) {
    return {
      content: [{ type: "text", text: "Error: path is required" }],
      isError: true,
    };
  }

  // Validate it's a Rust project
  if (!(await validateRustProject(path))) {
    return {
      content: [
        {
          type: "text",
          text: `Error: No Cargo.toml found at ${path}. Is this a Rust project?`,
        },
      ],
      isError: true,
    };
  }

  switch (name) {
    case "bacon_check": {
      const { all_targets, all_features } = args as {
        all_targets?: boolean;
        all_features?: boolean;
      };

      const cargoArgs = ["check", "--message-format=json"];
      if (all_targets) cargoArgs.push("--all-targets");
      if (all_features) cargoArgs.push("--all-features");

      const result = await runCargoCommand(cargoArgs, path);
      const diagnostics = parseCargoDiagnostics(result.stdout);

      return {
        content: [
          {
            type: "text",
            text: formatDiagnostics(diagnostics),
          },
        ],
      };
    }

    case "bacon_clippy": {
      const {
        all_targets = true,
        pedantic,
        nursery,
        cargo,
        restriction,
        deny_warnings,
        fix,
        allow,
        warn,
        deny,
      } = args as {
        all_targets?: boolean;
        pedantic?: boolean;
        nursery?: boolean;
        cargo?: boolean;
        restriction?: boolean;
        deny_warnings?: boolean;
        fix?: boolean;
        allow?: string[];
        warn?: string[];
        deny?: string[];
      };

      const cargoArgs = ["clippy", "--message-format=json"];
      if (all_targets) cargoArgs.push("--all-targets");
      if (fix) cargoArgs.push("--fix", "--allow-dirty", "--allow-staged");

      // Build lint flags
      const lintFlags: string[] = [];

      if (pedantic) lintFlags.push("-W", "clippy::pedantic");
      if (nursery) lintFlags.push("-W", "clippy::nursery");
      if (cargo) lintFlags.push("-W", "clippy::cargo");
      if (restriction) lintFlags.push("-W", "clippy::restriction");
      if (deny_warnings) lintFlags.push("-D", "warnings");

      // Custom lint configurations
      if (allow && allow.length > 0) {
        for (const lint of allow) {
          lintFlags.push("-A", lint);
        }
      }
      if (warn && warn.length > 0) {
        for (const lint of warn) {
          lintFlags.push("-W", lint);
        }
      }
      if (deny && deny.length > 0) {
        for (const lint of deny) {
          lintFlags.push("-D", lint);
        }
      }

      if (lintFlags.length > 0) {
        cargoArgs.push("--", ...lintFlags);
      }

      const result = await runCargoCommand(cargoArgs, path);
      const diagnostics = parseCargoDiagnostics(result.stdout);

      let output = "";
      const enabledLints: string[] = [];
      if (pedantic) enabledLints.push("pedantic");
      if (nursery) enabledLints.push("nursery");
      if (cargo) enabledLints.push("cargo");
      if (restriction) enabledLints.push("restriction");

      if (enabledLints.length > 0) {
        output += `🔍 Clippy with: ${enabledLints.join(", ")}\n\n`;
      }

      output += formatDiagnostics(diagnostics);

      return {
        content: [{ type: "text", text: output }],
      };
    }

    case "bacon_clippy_strict": {
      const { all_targets = true, fix } = args as {
        all_targets?: boolean;
        fix?: boolean;
      };

      const cargoArgs = ["clippy", "--message-format=json"];
      if (all_targets) cargoArgs.push("--all-targets");
      if (fix) cargoArgs.push("--fix", "--allow-dirty", "--allow-staged");

      // Strict mode: pedantic + nursery + cargo + deny warnings
      cargoArgs.push(
        "--",
        "-W",
        "clippy::pedantic",
        "-W",
        "clippy::nursery",
        "-W",
        "clippy::cargo",
        "-D",
        "warnings"
      );

      const result = await runCargoCommand(cargoArgs, path);
      const diagnostics = parseCargoDiagnostics(result.stdout);

      let output = "🔒 Strict Clippy (pedantic + nursery + cargo, warnings denied)\n\n";
      output += formatDiagnostics(diagnostics);

      return {
        content: [{ type: "text", text: output }],
      };
    }

    case "bacon_test": {
      const { filter, no_capture } = args as {
        filter?: string;
        no_capture?: boolean;
      };

      const cargoArgs = ["test"];
      if (filter) cargoArgs.push(filter);
      if (no_capture) cargoArgs.push("--", "--nocapture");

      const result = await runCargoCommand(cargoArgs, path);
      const { tests, summary } = parseTestOutput(result.stderr + result.stdout);

      return {
        content: [
          {
            type: "text",
            text: formatTestResults(tests, summary, result.exitCode, result.stderr),
          },
        ],
      };
    }

    case "bacon_build": {
      const { release, all_targets } = args as {
        release?: boolean;
        all_targets?: boolean;
      };

      const cargoArgs = ["build", "--message-format=json"];
      if (release) cargoArgs.push("--release");
      if (all_targets) cargoArgs.push("--all-targets");

      const result = await runCargoCommand(cargoArgs, path);
      const diagnostics = parseCargoDiagnostics(result.stdout);

      let output =
        result.exitCode === 0
          ? "✅ Build successful!\n\n"
          : "❌ Build failed!\n\n";

      output += formatDiagnostics(diagnostics);

      return {
        content: [{ type: "text", text: output }],
      };
    }

    case "bacon_doc": {
      const { no_deps = true, document_private, open } = args as {
        no_deps?: boolean;
        document_private?: boolean;
        open?: boolean;
      };

      const cargoArgs = ["doc", "--message-format=json"];
      if (no_deps) cargoArgs.push("--no-deps");
      if (document_private) cargoArgs.push("--document-private-items");
      if (open) cargoArgs.push("--open");

      const result = await runCargoCommand(cargoArgs, path);
      const diagnostics = parseCargoDiagnostics(result.stdout);

      let output =
        result.exitCode === 0
          ? "✅ Documentation generated successfully!\n\n"
          : "❌ Documentation generation failed!\n\n";

      output += formatDiagnostics(diagnostics);

      return {
        content: [{ type: "text", text: output }],
      };
    }

    case "bacon_fmt_check": {
      const result = await runCargoCommand(["fmt", "--check"], path);

      if (result.exitCode === 0) {
        return {
          content: [
            { type: "text", text: "✅ All files are properly formatted!" },
          ],
        };
      }

      const unformatted = result.stdout
        .split("\n")
        .filter((l) => l.startsWith("Diff in"));

      return {
        content: [
          {
            type: "text",
            text: `⚠️ ${unformatted.length} file(s) need formatting:\n${unformatted.join("\n")}\n\nRun bacon_fmt to fix.`,
          },
        ],
      };
    }

    case "bacon_fmt": {
      const result = await runCargoCommand(["fmt"], path);

      return {
        content: [
          {
            type: "text",
            text:
              result.exitCode === 0
                ? "✅ Code formatted successfully!"
                : `❌ Formatting failed:\n${result.stderr}`,
          },
        ],
      };
    }

    case "bacon_audit": {
      const result = await runCargoCommand(["audit"], path);

      if (result.exitCode === 0) {
        return {
          content: [
            {
              type: "text",
              text: "✅ No known vulnerabilities found in dependencies!",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `⚠️ Security audit results:\n\n${result.stdout}\n${result.stderr}`,
          },
        ],
      };
    }

    case "bacon_deny": {
      const { check = "all" } = args as {
        check?: "all" | "advisories" | "bans" | "licenses" | "sources";
      };

      const cargoArgs = ["deny", "check"];
      if (check !== "all") {
        cargoArgs.push(check);
      }

      const result = await runCargoCommand(cargoArgs, path);

      if (result.exitCode === 0) {
        return {
          content: [
            {
              type: "text",
              text: `✅ cargo deny (${check}): All checks passed!`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `⚠️ cargo deny (${check}) found issues:\n\n${result.stdout}\n${result.stderr}`,
          },
        ],
      };
    }

    case "bacon_outdated": {
      const { depth = 1 } = args as { depth?: number };

      const cargoArgs = ["outdated", "--depth", String(depth)];

      const result = await runCargoCommand(cargoArgs, path);

      if (result.stdout.includes("All dependencies are up to date")) {
        return {
          content: [
            {
              type: "text",
              text: "✅ All dependencies are up to date!",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `📦 Outdated dependencies:\n\n${result.stdout}${result.stderr ? "\n" + result.stderr : ""}`,
          },
        ],
      };
    }

    case "bacon_udeps": {
      const { all_targets = true } = args as { all_targets?: boolean };

      const cargoArgs = ["+nightly", "udeps"];
      if (all_targets) cargoArgs.push("--all-targets");

      const result = await runCargoCommand(cargoArgs, path);

      if (result.exitCode === 0 && !result.stdout.includes("unused")) {
        return {
          content: [
            {
              type: "text",
              text: "✅ No unused dependencies found!",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `📦 Unused dependencies:\n\n${result.stdout}\n${result.stderr}`,
          },
        ],
      };
    }

    case "bacon_machete": {
      const { fix } = args as { fix?: boolean };

      const cargoArgs = ["machete"];
      if (fix) cargoArgs.push("--fix");

      const result = await runCargoCommand(cargoArgs, path);

      if (result.exitCode === 0) {
        return {
          content: [
            {
              type: "text",
              text: fix
                ? "✅ Unused dependencies removed!"
                : "✅ No unused dependencies found!",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `📦 Unused dependencies found:\n\n${result.stdout}\n${result.stderr}\n\nRun with fix=true to remove them.`,
          },
        ],
      };
    }

    case "bacon_quality": {
      // Run comprehensive quality checks
      let output = "🔍 **Comprehensive Code Quality Report**\n\n";

      // 1. Clippy with pedantic + nursery
      output += "## Clippy (pedantic + nursery)\n";
      const clippyArgs = [
        "clippy",
        "--message-format=json",
        "--all-targets",
        "--",
        "-W",
        "clippy::pedantic",
        "-W",
        "clippy::nursery",
      ];
      const clippyResult = await runCargoCommand(clippyArgs, path);
      const clippyDiagnostics = parseCargoDiagnostics(clippyResult.stdout);
      output += formatDiagnostics(clippyDiagnostics) + "\n";

      // 2. Format check
      output += "## Formatting\n";
      const fmtResult = await runCargoCommand(["fmt", "--check"], path);
      if (fmtResult.exitCode === 0) {
        output += "✅ All files are properly formatted!\n\n";
      } else {
        const unformatted = fmtResult.stdout
          .split("\n")
          .filter((l) => l.startsWith("Diff in"));
        output += `⚠️ ${unformatted.length} file(s) need formatting\n\n`;
      }

      // 3. Doc check
      output += "## Documentation\n";
      const docArgs = ["doc", "--message-format=json", "--no-deps"];
      const docResult = await runCargoCommand(docArgs, path);
      const docDiagnostics = parseCargoDiagnostics(docResult.stdout);
      if (docDiagnostics.length === 0) {
        output += "✅ Documentation builds without warnings!\n\n";
      } else {
        output += formatDiagnostics(docDiagnostics) + "\n";
      }

      // Summary
      const totalIssues =
        clippyDiagnostics.length + docDiagnostics.length + (fmtResult.exitCode !== 0 ? 1 : 0);

      output += "## Summary\n";
      if (totalIssues === 0) {
        output += "✅ **Excellent!** No quality issues found.";
      } else {
        output += `⚠️ Found ${totalIssues} issue(s) to address.`;
      }

      return {
        content: [{ type: "text", text: output }],
      };
    }

    case "rust_project_info": {
      const info = await getProjectInfo(path);

      if (!info) {
        return {
          content: [
            { type: "text", text: "Error: Could not parse Cargo.toml" },
          ],
          isError: true,
        };
      }

      // Get basic tree structure
      const treeResult = await runCargoCommand(
        ["metadata", "--no-deps", "--format-version=1"],
        path
      );

      let output = `📦 Project: ${info.name} v${info.version}\n`;
      output += `📁 Path: ${path}\n`;

      try {
        const metadata = JSON.parse(treeResult.stdout);
        const pkg = metadata.packages?.[0];
        if (pkg) {
          output += `\n📋 Targets:\n`;
          for (const target of pkg.targets || []) {
            output += `   - ${target.name} (${target.kind.join(", ")})\n`;
          }

          if (pkg.dependencies?.length > 0) {
            output += `\n📚 Dependencies: ${pkg.dependencies.length}\n`;
          }
        }
      } catch {
        // Metadata parsing failed, just show basic info
      }

      return {
        content: [{ type: "text", text: output }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// Export for testing
export { server, tools };

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bacon-mcp server running on stdio");
}

// Only run main if this is the entry point
const isMain = process.argv[1]?.endsWith("index.js");
if (isMain) {
  main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
