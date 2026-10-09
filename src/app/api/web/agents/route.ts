import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ensureAgents } from "@/lib/agent-supervisor";

export const dynamic = "force-dynamic";

const SEED_ENDPOINTS = [
  { label: "mesh-alpha", port: 3040 },
  { label: "mesh-beta", port: 3041 },
];

const LABEL_RE = /^[\w][\w.-]{0,63}$/;

function badRequest(message: string) {
  return NextResponse.json(
    { error: { code: "BAD_REQUEST", message } },
    { status: 400 }
  );
}

/** GET — list agent endpoints; seeds the two known devices on first ever call.
 * Also opportunistically ensures the local agents are running (dev only). */
export async function GET() {
  // Fire-and-forget: never block the listing on supervision.
  void ensureAgents().catch(() => undefined);
  try {
    let agents = await db.agentEndpoint.findMany({ orderBy: { id: "asc" } });
    if (agents.length === 0) {
      await db.agentEndpoint.createMany({ data: SEED_ENDPOINTS });
      agents = await db.agentEndpoint.findMany({ orderBy: { id: "asc" } });
    }
    return NextResponse.json(agents);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "IO_ERROR",
          message: err instanceof Error ? err.message : "database error",
        },
      },
      { status: 500 }
    );
  }
}

/** POST — register a new agent endpoint { label, port }. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("body must be JSON");
  }
  const { label, port } = (body ?? {}) as { label?: unknown; port?: unknown };

  if (typeof label !== "string" || !LABEL_RE.test(label.trim())) {
    return badRequest(
      "label must be 1-64 chars of letters, digits, dot, dash or underscore"
    );
  }
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    return badRequest("port must be an integer between 1 and 65535");
  }

  const cleanLabel = label.trim();
  try {
    const existingLabel = await db.agentEndpoint.findUnique({
      where: { label: cleanLabel },
    });
    if (existingLabel) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION",
            message: `label "${cleanLabel}" already registered`,
          },
        },
        { status: 409 }
      );
    }
    const existingPort = await db.agentEndpoint.findUnique({
      where: { port },
    });
    if (existingPort) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION",
            message: `port ${port} already registered`,
          },
        },
        { status: 409 }
      );
    }
    const created = await db.agentEndpoint.create({
      data: { label: cleanLabel, port },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "IO_ERROR",
          message: err instanceof Error ? err.message : "database error",
        },
      },
      { status: 500 }
    );
  }
}

/** DELETE ?id= — unregister an agent endpoint. */
export async function DELETE(req: NextRequest) {
  const idRaw = req.nextUrl.searchParams.get("id");
  const id = Number(idRaw);
  if (idRaw === null || !Number.isInteger(id) || id < 1) {
    return badRequest("query parameter id must be a positive integer");
  }
  try {
    const existing = await db.agentEndpoint.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `agent endpoint ${id} not found`,
          },
        },
        { status: 404 }
      );
    }
    await db.agentEndpoint.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "IO_ERROR",
          message: err instanceof Error ? err.message : "database error",
        },
      },
      { status: 500 }
    );
  }
}
