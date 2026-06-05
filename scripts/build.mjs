import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const sourceDir = join(projectRoot, "src");
const samplesDir = join(projectRoot, "samples");
const distDir = join(projectRoot, "dist");

const checkOnly = process.argv.includes("--check-only");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requirePath(path, label) {
  if (!existsSync(path)) {
    fail(`${label} does not exist: ${path}`);
  }
}

function nodeCheck(path) {
  const result = spawnSync(process.execPath, ["--check", path], {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    fail(`syntax check failed for ${path}`);
  }
}

function validateSample(path) {
  let ast;
  try {
    ast = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`sample JSON is invalid: ${path}\n${error.message}`);
  }

  if (!ast || typeof ast !== "object" || Array.isArray(ast)) {
    fail(`sample root must be a JSON object: ${path}`);
  }

  if (typeof ast.NodeType !== "string" || ast.NodeType.length === 0) {
    fail(`sample root must include NodeType: ${path}`);
  }

  if (!Array.isArray(ast.Children)) {
    fail(`sample root must include Children array: ${path}`);
  }
}

requirePath(join(sourceDir, "index.html"), "index.html");
requirePath(join(sourceDir, "app.js"), "app.js");
requirePath(join(sourceDir, "styles.css"), "styles.css");
requirePath(join(samplesDir, "example-ast.json"), "example AST sample");

nodeCheck(join(sourceDir, "app.js"));
nodeCheck(join(scriptDir, "server.mjs"));
nodeCheck(join(scriptDir, "build.mjs"));
validateSample(join(samplesDir, "example-ast.json"));

if (!checkOnly) {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  cpSync(sourceDir, distDir, { recursive: true });
  cpSync(samplesDir, join(distDir, "samples"), { recursive: true });
}

console.log(checkOnly ? "LINVisualizerJS checks passed." : `LINVisualizerJS built at ${distDir}`);
