import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
try { process.loadEnvFile(join(rootDir, '.env')) } catch {}
const checkOnly = process.argv.includes("--check");
const backendUrl = "http://127.0.0.1:8787/api/health";
const children = new Set();
let stopping = false;

function runNode(args, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`进程退出，代码 ${code ?? "unknown"}`));
    });
  });
}

async function isBackendReady() {
  try {
    const response = await fetch(backendUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isBackendReady()) return;
    if (child?.exitCode !== null) {
      throw new Error("后端启动失败，请检查上方日志");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("后端健康检查超时");
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = exitCode;
}

async function main() {
  const tscPath = join(rootDir, "node_modules", "typescript", "bin", "tsc");
  const vitePath = join(rootDir, "node_modules", "vite", "bin", "vite.js");

  console.log("正在编译后端…");
  await waitForExit(runNode([tscPath, "-p", "server/tsconfig.json"]));

  let backend;
  if (await isBackendReady()) {
    console.log("后端已在 http://127.0.0.1:8787 运行");
  } else {
    backend = runNode(["server/dist/index.js"]);
    await waitForBackend(backend);
    console.log("后端健康检查通过");
  }

  if (checkOnly) {
    console.log("前后端联合启动检查通过");
    stopAll(0);
    return;
  }

  const frontend = runNode([vitePath, "--host", "0.0.0.0"]);
  frontend.once("exit", (code) => stopAll(code ?? 0));
  backend?.once("exit", (code) => {
    if (!stopping) {
      console.error(`后端意外退出，代码 ${code ?? "unknown"}`);
      stopAll(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  stopAll(1);
});
