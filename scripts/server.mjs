import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);

// linvast CLI resolution (PATH linvast -> $LINVAST_PATH -> native executable
// fallback below). The fallback is relative to the project root so the path
// stays portable across machines; the PATH/$LINVAST_PATH lookups let callers
// softcode the binary location per-environment instead of relying on the
// fallback alone.
const CLI_PATH = resolve(projectRoot, "../CLI/CLI/bin/Debug/net10.0/CLI");
const CLI_NAME = process.platform === "win32" ? "linvast.exe" : "linvast";
const SUPPORTED_LANGUAGES = new Set(["c", "go", "java", "lua", "kotlin", "python"]);
const MAX_SOURCE_BYTES = 1048576;
const AST_ENDPOINT = "/api/ast";

const options = {
  root: join(projectRoot, "dist"),
  host: "127.0.0.1",
  port: 5174,
  open: false
};

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  switch (arg) {
    case "--root":
      options.root = resolve(requireValue(arg, process.argv[++i]));
      break;
    case "--host":
      options.host = requireValue(arg, process.argv[++i]);
      break;
    case "--port":
      options.port = Number.parseInt(requireValue(arg, process.argv[++i]), 10);
      break;
    case "--open":
      options.open = true;
      break;
    default:
      fail(`unknown option ${arg}`);
  }
}

if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  fail("--port must be an integer from 1 to 65535");
}

if (!existsSync(options.root)) {
  fail(`static root does not exist: ${options.root}. Run ./build first.`);
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"]
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === AST_ENDPOINT) {
    if (request.method !== "POST") {
      sendText(response, 405, "Method not allowed. Send a POST request with source code as the body.");
      return;
    }
    handleAstRequest(request, response).catch(() => {});
    return;
  }

  let requestPath = decodeURIComponent(url.pathname);
  if (requestPath === "/") {
    requestPath = "/index.html";
  }

  const filePath = resolve(options.root, normalize(requestPath).replace(/^[/\\]+/, ""));
  if (!isInsideRoot(filePath, options.root)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
});

server.on("error", error => {
  fail(error.code === "EADDRINUSE"
    ? `port ${options.port} is already in use`
    : error.message);
});

server.listen(options.port, options.host, () => {
  const url = `http://${options.host}:${options.port}/`;
  console.log(`LINVisualizerJS running at ${url}`);
  if (options.open) {
    openBrowser(url);
  }
});

function requireValue(option, value) {
  if (!value) {
    fail(`${option} requires a value`);
  }
  return value;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function isInsideRoot(filePath, rootPath) {
  const normalizedRoot = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;
  return filePath === rootPath || filePath.startsWith(normalizedRoot);
}

function openBrowser(url) {
  const commands = process.platform === "win32"
    ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin"
      ? ["open", url]
      : ["xdg-open", url];

  spawn(commands[0], commands.slice(1), {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function parseLanguage(value) {
  const lang = String(value ?? "c").toLowerCase();
  return SUPPORTED_LANGUAGES.has(lang) ? lang : null;
}

function resolveCliFromPath() {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, CLI_NAME);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch { /* skip inaccessible directories */ }
  }
  return null;
}

function resolveCliCommand() {
  const fromPath = resolveCliFromPath();
  if (fromPath) {
    return fromPath;
  }
  const envPath = process.env.LINVAST_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }
  if (existsSync(CLI_PATH)) {
    return CLI_PATH;
  }
  return null;
}

function readRequestBody(request, maxBytes) {
  return new Promise(resolve => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on("data", chunk => {
      if (tooLarge) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    request.on("error", () => resolve(null));
  });
}

function runCli(command, args, stdin) {
  return new Promise(resolve => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", data => stdout.push(data));
    proc.stderr.on("data", data => stderr.push(data));

    proc.on("error", error => {
      resolve({
        code: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: error.message
      });
    });

    proc.on("close", code => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });

    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

function cleanCliError(stderr) {
  const text = String(stderr ?? "");
  if (!text.trim()) {
    return "";
  }

  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const diagnostic = lines.find(line => /[\w]+\s+\[\-\]/.test(line) || /FTL|ERR|FATAL/.test(line)) || lines[0];
  return diagnostic.replace(/^\[\d{2}:\d{2}:\d{2}\s+\w+\]\s+\[[^\]]*\]\s*/, "").trim();
}

async function handleAstRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const language = parseLanguage(url.searchParams.get("language"));
    if (!language) {
      return sendText(response, 400, "Unsupported or missing language. Supported: c, go, java, lua, kotlin, python");
    }

    const command = resolveCliCommand();
    if (!command) {
      return sendText(response, 503, "linvast CLI is not available on this server");
    }

    const source = await readRequestBody(request, MAX_SOURCE_BYTES);
    if (source === null) {
      return sendText(response, 413, "Submitted source code exceeds the maximum allowed size");
    }

    const completed = await runCli(command, ["ast", "-", "--language", language, "--compact", "-q"], source);
    if (completed.error) {
      return sendText(response, 500, `Failed to run linvast CLI: ${completed.error}`);
    }

    if (completed.code === 0) {
      const payload = completed.stdout;
      try {
        JSON.parse(payload);
      } catch {
        return sendText(response, 502, "linvast CLI returned non-JSON output");
      }
      return sendRaw(response, 200, payload, "application/json; charset=utf-8");
    }

    return sendText(response, 422, cleanCliError(completed.stderr) || "linvast CLI failed");
  } catch (error) {
    return sendText(response, 500, `internal server error: ${error.message}`);
  }
}

function sendRaw(response, status, body, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendJson(response, status, body) {
  return sendRaw(response, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function sendText(response, status, message) {
  return sendRaw(response, status, message, "text/plain; charset=utf-8");
}
