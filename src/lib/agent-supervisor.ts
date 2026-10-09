import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import http from "node:http";
import path from "node:path";

/**
 * Dev-only supervisor that keeps the two local MeshSync agents
 * (mesh-alpha 3040/4040, mesh-beta 3041/4041) running as child processes
 * of the Next.js server. In this sandbox only platform-anchored processes
 * survive; hosting the agents under the dev server keeps them alive and
 * lets the console self-heal them after any dev-server restart.
 *
 * Everything is idempotent: a health check precedes every spawn, and an
 * in-process guard prevents double spawning. Missing binaries are tolerated
 * (fresh checkout before `scripts/build-all.sh`) — the supervisor simply
 * logs and gives up until the next call.
 */

const PROJECT_ROOT = process.cwd();

const AGENT_BIN = path.join(PROJECT_ROOT, "agent", "bin", "meshsync-agent");
const NATIVE_BIN = path.join(
  PROJECT_ROOT,
  "native",
  "cpp",
  "bin",
  "meshsync-native",
);

interface AgentSpec {
  name: string;
  apiPort: number;
  peerPort: number;
  dataDir: string;
  logFile: string;
}

const AGENTS: AgentSpec[] = [
  {
    name: "mesh-alpha",
    apiPort: 3040,
    peerPort: 4040,
    dataDir: path.join(PROJECT_ROOT, ".runtime", "agent-a"),
    logFile: path.join(PROJECT_ROOT, ".runtime", "agent-a.log"),
  },
  {
    name: "mesh-beta",
    apiPort: 3041,
    peerPort: 4041,
    dataDir: path.join(PROJECT_ROOT, ".runtime", "agent-b"),
    logFile: path.join(PROJECT_ROOT, ".runtime", "agent-b.log"),
  },
];

const children = new Map<number, ChildProcess>();
let ensuring = false;

function healthy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/api/v1/health",
        timeout: 1200,
      },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function spawnAgent(spec: AgentSpec): void {
  if (!existsSync(AGENT_BIN)) {
    console.warn(
      `[agent-supervisor] ${spec.name}: agent binary missing at ${AGENT_BIN}; run scripts/build-all.sh`,
    );
    return;
  }
  mkdirSync(spec.dataDir, { recursive: true });
  mkdirSync(path.dirname(spec.logFile), { recursive: true });
  const logFd = openSync(spec.logFile, "a");
  const args = [
    "--data-dir",
    spec.dataDir,
    "--api-bind",
    "127.0.0.1",
    "--api-port",
    String(spec.apiPort),
    "--peer-port",
    String(spec.peerPort),
    "--name",
    spec.name,
  ];
  if (existsSync(NATIVE_BIN)) {
    args.push("--native-path", NATIVE_BIN);
  }
  const child = spawn(AGENT_BIN, args, {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  children.set(spec.apiPort, child);
  child.on("exit", (code, signal) => {
    children.delete(spec.apiPort);
    console.log(
      `[agent-supervisor] ${spec.name} exited code=${code} signal=${signal}`,
    );
  });
  console.log(
    `[agent-supervisor] started ${spec.name} (pid ${child.pid}) api=127.0.0.1:${spec.apiPort} peer=${spec.peerPort}`,
  );
}

/** Ensure both agents are running; safe to call repeatedly. */
export async function ensureAgents(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.MESHSYNC_SUPERVISOR === "0") return;
  if (ensuring) return;
  ensuring = true;
  try {
    for (const spec of AGENTS) {
      if (children.has(spec.apiPort)) continue;
      if (await healthy(spec.apiPort)) continue;
      if (await healthy(spec.apiPort)) continue; // retry once to avoid races
      spawnAgent(spec);
    }
  } finally {
    ensuring = false;
  }
}

/** Current supervision state (for diagnostics). */
export function supervisorStatus() {
  return AGENTS.map((spec) => ({
    name: spec.name,
    apiPort: spec.apiPort,
    peerPort: spec.peerPort,
    supervised: children.has(spec.apiPort),
    pid: children.get(spec.apiPort)?.pid ?? null,
  }));
}
