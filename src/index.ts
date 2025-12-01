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
    version: "0.1.0",
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
