#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

interface CargoMessage {
  reason: string;
  message?: {
    code?: { code: string } | null;
    level: string;
    message: string;
    spans: Array<{
      file_name: string;
      line_start: number;
      line_end: number;
      column_start: number;
      column_end: number;
      label?: string | null;
      suggested_replacement?: string | null;
    }>;
    rendered?: string;
  };
  target?: {
    name: string;
    kind: string[];
  };
}

interface Diagnostic {
  level: "error" | "warning" | "note" | "help";
  code?: string;
  message: string;
  file: string;
  line: number;
  column: number;
  rendered?: string;
  suggestion?: string;
}

interface TestResult {
  name: string;
  status: "ok" | "failed" | "ignored";
  stdout?: string;
}

// Run a cargo command and collect JSON output
async function runCargoCommand(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("cargo", args, {
      cwd,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

// Parse cargo JSON output into diagnostics
function parseCargoDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const msg: CargoMessage = JSON.parse(line);
      if (msg.reason === "compiler-message" && msg.message) {
        const m = msg.message;
        const primarySpan = m.spans.find((s) => s.label !== null) ?? m.spans[0];

        if (primarySpan) {
          diagnostics.push({
            level: m.level as Diagnostic["level"],
            code: m.code?.code,
            message: m.message,
            file: primarySpan.file_name,
            line: primarySpan.line_start,
            column: primarySpan.column_start,
            rendered: m.rendered,
            suggestion: primarySpan.suggested_replacement ?? undefined,
          });
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return diagnostics;
}

// Parse test output
function parseTestOutput(output: string): {
  tests: TestResult[];
  summary: string;
} {
  const tests: TestResult[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    // Match test result lines like "test module::test_name ... ok"
    const match = line.match(/^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)/);
    if (match) {
      tests.push({
        name: match[1],
        status: match[2].toLowerCase() as TestResult["status"],
      });
    }
  }

  // Extract summary line
  const summaryMatch = output.match(
    /test result: (.*?)\. (\d+) passed; (\d+) failed; (\d+) ignored/
  );
  const summary = summaryMatch
    ? `${summaryMatch[2]} passed, ${summaryMatch[3]} failed, ${summaryMatch[4]} ignored`
    : `${tests.length} tests found`;

  return { tests, summary };
}

// Validate that a path is a Rust project
async function validateRustProject(path: string): Promise<boolean> {
  return existsSync(join(path, "Cargo.toml"));
}

// Read Cargo.toml and extract project info
async function getProjectInfo(
  path: string
): Promise<{ name: string; version: string } | null> {
  try {
    const cargoToml = await readFile(join(path, "Cargo.toml"), "utf-8");
    const nameMatch = cargoToml.match(/name\s*=\s*"([^"]+)"/);
    const versionMatch = cargoToml.match(/version\s*=\s*"([^"]+)"/);
    return {
      name: nameMatch?.[1] ?? "unknown",
      version: versionMatch?.[1] ?? "0.0.0",
    };
  } catch {
    return null;
  }
}

// Format diagnostics for display
function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "No issues found.";
  }

  const errors = diagnostics.filter((d) => d.level === "error");
  const warnings = diagnostics.filter((d) => d.level === "warning");

  let output = `Found ${errors.length} error(s) and ${warnings.length} warning(s):\n\n`;

  for (const d of diagnostics) {
    const icon = d.level === "error" ? "❌" : d.level === "warning" ? "⚠️" : "ℹ️";
    const code = d.code ? `[${d.code}] ` : "";
    output += `${icon} ${code}${d.message}\n`;
    output += `   → ${d.file}:${d.line}:${d.column}\n`;
    if (d.suggestion) {
      output += `   💡 Suggestion: ${d.suggestion}\n`;
    }
    output += "\n";
  }

  return output;
}

// Create the MCP server
const server = new Server(
  {
    name: "bacon-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const tools: ToolSchema[] = [
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
      "Run `cargo clippy` on a Rust project for comprehensive linting. Returns warnings about common mistakes, style issues, and potential bugs with suggested fixes.",
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
            "Enable pedantic lints for stricter checking. Default: false",
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
      const { all_targets = true, pedantic, fix } = args as {
        all_targets?: boolean;
        pedantic?: boolean;
        fix?: boolean;
      };

      const cargoArgs = ["clippy", "--message-format=json"];
      if (all_targets) cargoArgs.push("--all-targets");
      if (fix) cargoArgs.push("--fix", "--allow-dirty", "--allow-staged");
      if (pedantic) cargoArgs.push("--", "-W", "clippy::pedantic");

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

      let output = `Test Results: ${summary}\n\n`;

      const failed = tests.filter((t) => t.status === "failed");
      const passed = tests.filter((t) => t.status === "ok");
      const ignored = tests.filter((t) => t.status === "ignored");

      if (failed.length > 0) {
        output += "❌ Failed tests:\n";
        for (const t of failed) {
          output += `   - ${t.name}\n`;
        }
        output += "\n";
      }

      if (passed.length > 0) {
        output += `✅ Passed: ${passed.length} tests\n`;
      }

      if (ignored.length > 0) {
        output += `⏭️ Ignored: ${ignored.length} tests\n`;
      }

      if (result.exitCode !== 0 && failed.length === 0) {
        output += `\nCompilation or other error:\n${result.stderr}`;
      }

      return {
        content: [{ type: "text", text: output }],
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
      const { no_deps = true, open } = args as {
        no_deps?: boolean;
        open?: boolean;
      };

      const cargoArgs = ["doc", "--message-format=json"];
      if (no_deps) cargoArgs.push("--no-deps");
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

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bacon-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
