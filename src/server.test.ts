import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tools } from "./index.js";

describe("MCP Server Tools Definition", () => {
  it("should have all expected tools defined", () => {
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("bacon_check");
    expect(toolNames).toContain("bacon_clippy");
    expect(toolNames).toContain("bacon_test");
    expect(toolNames).toContain("bacon_build");
    expect(toolNames).toContain("bacon_doc");
    expect(toolNames).toContain("bacon_fmt");
    expect(toolNames).toContain("bacon_fmt_check");
    expect(toolNames).toContain("bacon_audit");
    expect(toolNames).toContain("rust_project_info");
  });

  it("should have 9 tools total", () => {
    expect(tools).toHaveLength(9);
  });

  describe("bacon_check tool", () => {
    const tool = tools.find((t) => t.name === "bacon_check")!;

    it("should have correct description", () => {
      expect(tool.description).toContain("cargo check");
      expect(tool.description).toContain("compiler errors");
    });

    it("should require path parameter", () => {
      expect(tool.inputSchema.required).toContain("path");
    });

    it("should have all_targets and all_features options", () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("path");
      expect(properties).toHaveProperty("all_targets");
      expect(properties).toHaveProperty("all_features");
    });
  });

  describe("bacon_clippy tool", () => {
    const tool = tools.find((t) => t.name === "bacon_clippy")!;

    it("should have correct description", () => {
      expect(tool.description).toContain("clippy");
      expect(tool.description).toContain("linting");
    });

    it("should have pedantic and fix options", () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("pedantic");
      expect(properties).toHaveProperty("fix");
    });
  });

  describe("bacon_test tool", () => {
    const tool = tools.find((t) => t.name === "bacon_test")!;

    it("should have filter option", () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("filter");
    });

    it("should have no_capture option", () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("no_capture");
    });
  });

  describe("bacon_build tool", () => {
    const tool = tools.find((t) => t.name === "bacon_build")!;

    it("should have release option", () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("release");
    });
  });

  describe("bacon_doc tool", () => {
    const tool = tools.find((t) => t.name === "bacon_doc")!;

    it("should have no_deps and open options", () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty("no_deps");
      expect(properties).toHaveProperty("open");
    });
  });

  describe("All tools", () => {
    it("should all have descriptions", () => {
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.description!.length).toBeGreaterThan(10);
      }
    });

    it("should all require path parameter", () => {
      for (const tool of tools) {
        expect(tool.inputSchema.required).toContain("path");
      }
    });

    it("should all have object input schema", () => {
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("should all have path property with description", () => {
      for (const tool of tools) {
        const properties = tool.inputSchema.properties as Record<
          string,
          { type: string; description: string }
        >;
        expect(properties.path).toBeDefined();
        expect(properties.path.type).toBe("string");
        expect(properties.path.description).toContain("Cargo.toml");
      }
    });
  });
});

describe("Integration Tests with Real Rust Project", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bacon-mcp-integration-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should validate a minimal Rust project structure", async () => {
    // Create minimal Rust project
    const cargoToml = `
[package]
name = "test-project"
version = "0.1.0"
edition = "2021"
`;
    const mainRs = `
fn main() {
    println!("Hello, world!");
}
`;
    writeFileSync(join(tempDir, "Cargo.toml"), cargoToml);
    writeFileSync(join(tempDir, "src", "main.rs"), mainRs);

    // Import and test validateRustProject
    const { validateRustProject } = await import("./utils.js");
    const isValid = await validateRustProject(tempDir);

    expect(isValid).toBe(true);
  });

  it("should get project info from a Rust project", async () => {
    const cargoToml = `
[package]
name = "integration-test"
version = "2.0.0"
edition = "2021"
`;
    writeFileSync(join(tempDir, "Cargo.toml"), cargoToml);

    const { getProjectInfo } = await import("./utils.js");
    const info = await getProjectInfo(tempDir);

    expect(info).toEqual({
      name: "integration-test",
      version: "2.0.0",
    });
  });
});

describe("Tool Input Validation", () => {
  it("should validate bacon_check has correct boolean options", () => {
    const tool = tools.find((t) => t.name === "bacon_check")!;
    const properties = tool.inputSchema.properties as Record<
      string,
      { type: string }
    >;

    expect(properties.all_targets.type).toBe("boolean");
    expect(properties.all_features.type).toBe("boolean");
  });

  it("should validate bacon_clippy has correct option types", () => {
    const tool = tools.find((t) => t.name === "bacon_clippy")!;
    const properties = tool.inputSchema.properties as Record<
      string,
      { type: string }
    >;

    expect(properties.all_targets.type).toBe("boolean");
    expect(properties.pedantic.type).toBe("boolean");
    expect(properties.fix.type).toBe("boolean");
  });

  it("should validate bacon_test has correct option types", () => {
    const tool = tools.find((t) => t.name === "bacon_test")!;
    const properties = tool.inputSchema.properties as Record<
      string,
      { type: string }
    >;

    expect(properties.filter.type).toBe("string");
    expect(properties.no_capture.type).toBe("boolean");
  });

  it("should validate bacon_build has correct option types", () => {
    const tool = tools.find((t) => t.name === "bacon_build")!;
    const properties = tool.inputSchema.properties as Record<
      string,
      { type: string }
    >;

    expect(properties.release.type).toBe("boolean");
    expect(properties.all_targets.type).toBe("boolean");
  });

  it("should validate bacon_doc has correct option types", () => {
    const tool = tools.find((t) => t.name === "bacon_doc")!;
    const properties = tool.inputSchema.properties as Record<
      string,
      { type: string }
    >;

    expect(properties.no_deps.type).toBe("boolean");
    expect(properties.open.type).toBe("boolean");
  });
});
