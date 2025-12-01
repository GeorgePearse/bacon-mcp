import { spawn } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

export interface CargoMessage {
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

export interface Diagnostic {
  level: "error" | "warning" | "note" | "help";
  code?: string;
  message: string;
  file: string;
  line: number;
  column: number;
  rendered?: string;
  suggestion?: string;
}

export interface TestResult {
  name: string;
  status: "ok" | "failed" | "ignored";
  stdout?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Run a cargo command and collect JSON output
export async function runCargoCommand(
  args: string[],
  cwd: string
): Promise<CommandResult> {
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
export function parseCargoDiagnostics(output: string): Diagnostic[] {
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
export function parseTestOutput(output: string): {
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
export async function validateRustProject(path: string): Promise<boolean> {
  return existsSync(join(path, "Cargo.toml"));
}

// Read Cargo.toml and extract project info
export async function getProjectInfo(
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
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
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

// Format test results for display
export function formatTestResults(
  tests: TestResult[],
  summary: string,
  exitCode: number,
  stderr: string
): string {
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

  if (exitCode !== 0 && failed.length === 0) {
    output += `\nCompilation or other error:\n${stderr}`;
  }

  return output;
}
