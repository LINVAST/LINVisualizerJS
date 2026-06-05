import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);

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
