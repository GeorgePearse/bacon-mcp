import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import {
  parseCargoDiagnostics,
  parseTestOutput,
  formatDiagnostics,
  formatTestResults,
  validateRustProject,
  getProjectInfo,
  Diagnostic,
  TestResult,
} from "./utils.js";

describe("parseCargoDiagnostics", () => {
  it("should parse a simple compiler error", () => {
    const cargoOutput = JSON.stringify({
      reason: "compiler-message",
      message: {
        code: { code: "E0425" },
        level: "error",
        message: "cannot find value `foo` in this scope",
        spans: [
          {
            file_name: "src/main.rs",
            line_start: 10,
            line_end: 10,
            column_start: 5,
            column_end: 8,
            label: "not found in this scope",
            suggested_replacement: null,
          },
        ],
        rendered: "error[E0425]: cannot find value `foo` in this scope",
      },
    });

    const diagnostics = parseCargoDiagnostics(cargoOutput);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      level: "error",
      code: "E0425",
      message: "cannot find value `foo` in this scope",
      file: "src/main.rs",
      line: 10,
      column: 5,
      rendered: "error[E0425]: cannot find value `foo` in this scope",
      suggestion: undefined,
    });
  });

  it("should parse a warning with suggestion", () => {
    const cargoOutput = JSON.stringify({
      reason: "compiler-message",
      message: {
        code: { code: "unused_variables" },
        level: "warning",
        message: "unused variable: `x`",
        spans: [
          {
            file_name: "src/lib.rs",
            line_start: 5,
            line_end: 5,
            column_start: 9,
            column_end: 10,
            label: "help: if this is intentional, prefix it with an underscore",
            suggested_replacement: "_x",
          },
        ],
        rendered: "warning: unused variable: `x`",
      },
    });

    const diagnostics = parseCargoDiagnostics(cargoOutput);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].level).toBe("warning");
    expect(diagnostics[0].code).toBe("unused_variables");
    expect(diagnostics[0].suggestion).toBe("_x");
  });

  it("should handle multiple diagnostics", () => {
    const lines = [
      JSON.stringify({
        reason: "compiler-message",
        message: {
          code: { code: "E0001" },
          level: "error",
          message: "first error",
          spans: [
            {
              file_name: "src/a.rs",
              line_start: 1,
              line_end: 1,
              column_start: 1,
              column_end: 5,
              label: "here",
            },
          ],
        },
      }),
      JSON.stringify({
        reason: "compiler-message",
        message: {
          code: { code: "W0001" },
          level: "warning",
          message: "first warning",
          spans: [
            {
              file_name: "src/b.rs",
              line_start: 2,
              line_end: 2,
              column_start: 3,
              column_end: 7,
              label: "here",
            },
          ],
        },
      }),
    ].join("\n");

    const diagnostics = parseCargoDiagnostics(lines);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].level).toBe("error");
    expect(diagnostics[1].level).toBe("warning");
  });

  it("should skip non-compiler-message lines", () => {
    const lines = [
      JSON.stringify({ reason: "build-script-executed" }),
      JSON.stringify({ reason: "compiler-artifact" }),
      JSON.stringify({
        reason: "compiler-message",
        message: {
          level: "error",
          message: "real error",
          spans: [
            {
              file_name: "src/main.rs",
              line_start: 1,
              line_end: 1,
              column_start: 1,
              column_end: 1,
              label: null,
            },
          ],
        },
      }),
    ].join("\n");

    const diagnostics = parseCargoDiagnostics(lines);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe("real error");
  });

  it("should handle empty input", () => {
    expect(parseCargoDiagnostics("")).toEqual([]);
  });

  it("should skip invalid JSON lines", () => {
    const lines = [
      "not valid json",
      JSON.stringify({
        reason: "compiler-message",
        message: {
          level: "error",
          message: "valid error",
          spans: [
            {
              file_name: "src/main.rs",
              line_start: 1,
              line_end: 1,
              column_start: 1,
              column_end: 1,
              label: "here",
            },
          ],
        },
      }),
      "{ broken json",
    ].join("\n");

    const diagnostics = parseCargoDiagnostics(lines);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toBe("valid error");
  });

  it("should handle messages without code", () => {
    const cargoOutput = JSON.stringify({
      reason: "compiler-message",
      message: {
        code: null,
        level: "note",
        message: "some note",
        spans: [
          {
            file_name: "src/main.rs",
            line_start: 1,
            line_end: 1,
            column_start: 1,
            column_end: 1,
            label: null,
          },
        ],
      },
    });

    const diagnostics = parseCargoDiagnostics(cargoOutput);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBeUndefined();
  });

  it("should handle messages without spans", () => {
    const cargoOutput = JSON.stringify({
      reason: "compiler-message",
      message: {
        code: { code: "E0001" },
        level: "error",
        message: "error without location",
        spans: [],
      },
    });

    const diagnostics = parseCargoDiagnostics(cargoOutput);

    // Should skip messages without spans since we can't locate them
    expect(diagnostics).toHaveLength(0);
  });
});

describe("parseTestOutput", () => {
  it("should parse passing tests", () => {
    const output = `
running 3 tests
test tests::test_one ... ok
test tests::test_two ... ok
test tests::test_three ... ok

test result: ok. 3 passed; 0 failed; 0 ignored
`;

    const result = parseTestOutput(output);

    expect(result.tests).toHaveLength(3);
    expect(result.tests.every((t) => t.status === "ok")).toBe(true);
    expect(result.summary).toBe("3 passed, 0 failed, 0 ignored");
  });

  it("should parse failing tests", () => {
    const output = `
running 2 tests
test tests::test_pass ... ok
test tests::test_fail ... FAILED

test result: FAILED. 1 passed; 1 failed; 0 ignored
`;

    const result = parseTestOutput(output);

    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].status).toBe("ok");
    expect(result.tests[1].status).toBe("failed");
    expect(result.summary).toBe("1 passed, 1 failed, 0 ignored");
  });

  it("should parse ignored tests", () => {
    const output = `
running 2 tests
test tests::test_active ... ok
test tests::test_skip ... ignored

test result: ok. 1 passed; 0 failed; 1 ignored
`;

    const result = parseTestOutput(output);

    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].status).toBe("ok");
    expect(result.tests[1].status).toBe("ignored");
    expect(result.summary).toBe("1 passed, 0 failed, 1 ignored");
  });

  it("should handle empty test output", () => {
    const output = "";

    const result = parseTestOutput(output);

    expect(result.tests).toHaveLength(0);
    expect(result.summary).toBe("0 tests found");
  });

  it("should parse complex test names with modules", () => {
    const output = `
test module::submodule::test_name ... ok
test another_module::deeply::nested::test ... FAILED
`;

    const result = parseTestOutput(output);

    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].name).toBe("module::submodule::test_name");
    expect(result.tests[1].name).toBe("another_module::deeply::nested::test");
  });

  it("should handle doc tests", () => {
    const output = `
running 1 test
test src/lib.rs - MyStruct::new (line 10) ... ok

test result: ok. 1 passed; 0 failed; 0 ignored
`;

    const result = parseTestOutput(output);

    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].name).toBe("src/lib.rs - MyStruct::new (line 10)");
  });
});

describe("formatDiagnostics", () => {
  it("should format empty diagnostics", () => {
    const result = formatDiagnostics([]);
    expect(result).toBe("No issues found.");
  });

  it("should format a single error", () => {
    const diagnostics: Diagnostic[] = [
      {
        level: "error",
        code: "E0425",
        message: "cannot find value `x`",
        file: "src/main.rs",
        line: 10,
        column: 5,
      },
    ];

    const result = formatDiagnostics(diagnostics);

    expect(result).toContain("Found 1 error(s) and 0 warning(s)");
    expect(result).toContain("❌");
    expect(result).toContain("[E0425]");
    expect(result).toContain("cannot find value `x`");
    expect(result).toContain("src/main.rs:10:5");
  });

  it("should format a warning with suggestion", () => {
    const diagnostics: Diagnostic[] = [
      {
        level: "warning",
        code: "unused_variables",
        message: "unused variable: `y`",
        file: "src/lib.rs",
        line: 5,
        column: 9,
        suggestion: "_y",
      },
    ];

    const result = formatDiagnostics(diagnostics);

    expect(result).toContain("Found 0 error(s) and 1 warning(s)");
    expect(result).toContain("⚠️");
    expect(result).toContain("💡 Suggestion: _y");
  });

  it("should format mixed errors and warnings", () => {
    const diagnostics: Diagnostic[] = [
      {
        level: "error",
        message: "error 1",
        file: "a.rs",
        line: 1,
        column: 1,
      },
      {
        level: "warning",
        message: "warning 1",
        file: "b.rs",
        line: 2,
        column: 2,
      },
      {
        level: "error",
        message: "error 2",
        file: "c.rs",
        line: 3,
        column: 3,
      },
    ];

    const result = formatDiagnostics(diagnostics);

    expect(result).toContain("Found 2 error(s) and 1 warning(s)");
  });

  it("should handle note level diagnostics", () => {
    const diagnostics: Diagnostic[] = [
      {
        level: "note",
        message: "some note",
        file: "src/main.rs",
        line: 1,
        column: 1,
      },
    ];

    const result = formatDiagnostics(diagnostics);

    expect(result).toContain("ℹ️");
    expect(result).toContain("some note");
  });
});

describe("formatTestResults", () => {
  it("should format all passing tests", () => {
    const tests: TestResult[] = [
      { name: "test_a", status: "ok" },
      { name: "test_b", status: "ok" },
    ];

    const result = formatTestResults(tests, "2 passed, 0 failed, 0 ignored", 0, "");

    expect(result).toContain("Test Results: 2 passed, 0 failed, 0 ignored");
    expect(result).toContain("✅ Passed: 2 tests");
    expect(result).not.toContain("❌");
  });

  it("should format failing tests", () => {
    const tests: TestResult[] = [
      { name: "test_pass", status: "ok" },
      { name: "test_fail_1", status: "failed" },
      { name: "test_fail_2", status: "failed" },
    ];

    const result = formatTestResults(tests, "1 passed, 2 failed, 0 ignored", 1, "");

    expect(result).toContain("❌ Failed tests:");
    expect(result).toContain("test_fail_1");
    expect(result).toContain("test_fail_2");
    expect(result).toContain("✅ Passed: 1 tests");
  });

  it("should format ignored tests", () => {
    const tests: TestResult[] = [
      { name: "test_active", status: "ok" },
      { name: "test_ignored", status: "ignored" },
    ];

    const result = formatTestResults(tests, "1 passed, 0 failed, 1 ignored", 0, "");

    expect(result).toContain("⏭️ Ignored: 1 tests");
  });

  it("should show compilation errors when no tests failed but exitCode is non-zero", () => {
    const tests: TestResult[] = [];
    const stderr = "error[E0425]: cannot find value `x`";

    const result = formatTestResults(tests, "0 tests found", 1, stderr);

    expect(result).toContain("Compilation or other error:");
    expect(result).toContain("error[E0425]");
  });

  it("should not show compilation errors when tests actually failed", () => {
    const tests: TestResult[] = [{ name: "test_fail", status: "failed" }];
    const stderr = "thread panicked";

    const result = formatTestResults(tests, "0 passed, 1 failed, 0 ignored", 1, stderr);

    expect(result).not.toContain("Compilation or other error:");
  });
});

describe("validateRustProject", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bacon-mcp-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return true for directory with Cargo.toml", async () => {
    writeFileSync(join(tempDir, "Cargo.toml"), '[package]\nname = "test"');

    const result = await validateRustProject(tempDir);

    expect(result).toBe(true);
  });

  it("should return false for directory without Cargo.toml", async () => {
    const result = await validateRustProject(tempDir);

    expect(result).toBe(false);
  });

  it("should return false for non-existent directory", async () => {
    const result = await validateRustProject("/non/existent/path");

    expect(result).toBe(false);
  });
});

describe("getProjectInfo", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bacon-mcp-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should parse name and version from Cargo.toml", async () => {
    const cargoToml = `
[package]
name = "my-project"
version = "1.2.3"
edition = "2021"
`;
    writeFileSync(join(tempDir, "Cargo.toml"), cargoToml);

    const result = await getProjectInfo(tempDir);

    expect(result).toEqual({
      name: "my-project",
      version: "1.2.3",
    });
  });

  it("should return null for non-existent Cargo.toml", async () => {
    const result = await getProjectInfo(tempDir);

    expect(result).toBeNull();
  });

  it("should handle Cargo.toml without name", async () => {
    const cargoToml = `
[package]
version = "1.0.0"
`;
    writeFileSync(join(tempDir, "Cargo.toml"), cargoToml);

    const result = await getProjectInfo(tempDir);

    expect(result).toEqual({
      name: "unknown",
      version: "1.0.0",
    });
  });

  it("should handle Cargo.toml without version", async () => {
    const cargoToml = `
[package]
name = "test-project"
`;
    writeFileSync(join(tempDir, "Cargo.toml"), cargoToml);

    const result = await getProjectInfo(tempDir);

    expect(result).toEqual({
      name: "test-project",
      version: "0.0.0",
    });
  });

  it("should handle workspace Cargo.toml with inline table", async () => {
    const cargoToml = `
[package]
name = "workspace-member"
version.workspace = true
`;
    writeFileSync(join(tempDir, "Cargo.toml"), cargoToml);

    const result = await getProjectInfo(tempDir);

    // The simple regex won't match version.workspace = true, so it should default
    expect(result).toEqual({
      name: "workspace-member",
      version: "0.0.0",
    });
  });
});
