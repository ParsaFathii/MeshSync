import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const LANGUAGES = new Set(["en", "fa"]);
const THEMES = new Set(["light", "dark", "system"]);

function badRequest(message: string) {
  return NextResponse.json(
    { error: { code: "BAD_REQUEST", message } },
    { status: 400 }
  );
}

/** GET ?clientId= — upsert-read of the client preference record. */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId || clientId.length < 1 || clientId.length > 128) {
    return badRequest("query parameter clientId is required (1-128 chars)");
  }
  try {
    let pref = await db.clientPref.findUnique({ where: { clientId } });
    if (!pref) {
      pref = await db.clientPref.create({ data: { clientId } });
    }
    return NextResponse.json(pref);
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

/** PUT — upsert { clientId, language?, theme? }. */
export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("body must be JSON");
  }
  const { clientId, language, theme } = (body ?? {}) as {
    clientId?: unknown;
    language?: unknown;
    theme?: unknown;
  };

  if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 128) {
    return badRequest("clientId must be a string of 1-128 chars");
  }
  if (language !== undefined && language !== null && !LANGUAGES.has(String(language))) {
    return badRequest("language must be one of: en, fa");
  }
  if (theme !== undefined && theme !== null && !THEMES.has(String(theme))) {
    return badRequest("theme must be one of: light, dark, system");
  }

  const data = {
    language: language === undefined ? undefined : language === null ? null : String(language),
    theme: theme === undefined ? undefined : theme === null ? null : String(theme),
  };

  try {
    const pref = await db.clientPref.upsert({
      where: { clientId },
      update: {
        ...(data.language !== undefined ? { language: data.language } : {}),
        ...(data.theme !== undefined ? { theme: data.theme } : {}),
      },
      create: {
        clientId,
        ...(data.language !== undefined ? { language: data.language } : {}),
        ...(data.theme !== undefined ? { theme: data.theme } : {}),
      },
    });
    return NextResponse.json(pref);
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
