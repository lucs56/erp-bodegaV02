import * as XLSX from "xlsx";
import { sessionUser } from "../../../../lib/auth";
import { readSettings } from "../../../../lib/app-settings";
import { readRuntimeEnv } from "../../../../lib/runtime-env";
import {
  parseStockRows,
  type StockImportItem,
} from "../../../../lib/stock-import";
import {
  readStockSyncStatus,
  recordStockSyncRun,
  replaceStockSnapshot,
} from "../../../../lib/stock-store";

export const dynamic = "force-dynamic";

const ENV_NAMES = [
  "ERP_STOCK_URL",
  "ERP_STOCK_TOKEN",
  "ERP_STOCK_SYNC_MINUTES",
];

export async function GET(request: Request) {
  const user = await sessionUser(request);
  if (!user?.active)
    return Response.json({ error: "Sesión requerida." }, { status: 401 });
  const runtime = await readRuntimeEnv(ENV_NAMES);
  return Response.json({
    configured: Boolean(runtime.ERP_STOCK_URL),
    syncMinutes: syncMinutes(runtime.ERP_STOCK_SYNC_MINUTES),
    status: await readStockSyncStatus(),
  });
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  const user = await sessionUser(request);
  if (!user?.active)
    return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (
    user.role !== "admin" &&
    !String(user.permissions ?? "")
      .split(",")
      .includes("stock")
  )
    return Response.json(
      { error: "El usuario no tiene permiso para actualizar stock." },
      { status: 403 },
    );

  const runtime = await readRuntimeEnv(ENV_NAMES);
  const endpoint = runtime.ERP_STOCK_URL?.trim();
  if (!endpoint)
    return Response.json(
      {
        error:
          "La conexión automática todavía no está configurada. La carga por Excel continúa disponible.",
      },
      { status: 503 },
    );

  let force = false;
  try {
    const payload = (await request.json().catch(() => ({}))) as {
      force?: boolean;
    };
    force = Boolean(payload.force);
    const interval = syncMinutes(runtime.ERP_STOCK_SYNC_MINUTES);
    const currentStatus = await readStockSyncStatus();
    if (
      !force &&
      currentStatus.latestRun?.source === "erp" &&
      currentStatus.latestRun.status === "success" &&
      Date.now() -
        new Date(currentStatus.latestRun.completedAt).getTime() <
        interval * 60_000
    )
      return Response.json({
        ok: true,
        skipped: true,
        message: `El stock del ERP ya fue actualizado dentro de los últimos ${interval} minutos.`,
        status: currentStatus,
      });

    const headers: Record<string, string> = { accept: "application/json, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    if (runtime.ERP_STOCK_TOKEN)
      headers.authorization = `Bearer ${runtime.ERP_STOCK_TOKEN}`;
    const response = await fetch(endpoint, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok)
      throw new Error(`El ERP respondió ${response.status}.`);

    const settings = await readSettings();
    const items = await stockItemsFromResponse(
      response,
      new Set(settings.includedDepots),
    );
    const result = await replaceStockSnapshot(items, {
      source: "erp",
      sourceName: new URL(endpoint).hostname,
      startedAt,
    });
    return Response.json({ ok: true, skipped: false, ...result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo sincronizar el stock con el ERP.";
    await recordStockSyncRun({
      source: "erp",
      sourceName: endpoint,
      status: "error",
      startedAt,
      message,
    });
    return Response.json({ error: message, force }, { status: 502 });
  }
}

async function stockItemsFromResponse(
  response: Response,
  includedDepots: ReadonlySet<string>,
): Promise<Partial<StockImportItem>[]> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("json")) {
    const payload = (await response.json()) as unknown;
    const rows = jsonRows(payload);
    if (!rows.length) throw new Error("El ERP devolvió una lista vacía.");
    const first = rows[0] as Record<string, unknown>;
    if (
      "materialCode" in first ||
      ("materialName" in first && "quantity" in first)
    )
      return rows as Partial<StockImportItem>[];
    const parsed = parseStockRows(
      rows as Record<string, unknown>[],
      includedDepots,
    );
    if (!parsed.items.length)
      throw new Error(
        parsed.errors[0] ?? "No se reconocieron existencias en la respuesta.",
      );
    return parsed.items;
  }

  const workbook = XLSX.read(await response.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const rows = workbook.SheetNames.flatMap((name) =>
    XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], {
      defval: "",
    }),
  );
  const parsed = parseStockRows(rows, includedDepots);
  if (!parsed.items.length)
    throw new Error(
      parsed.errors[0] ?? "No se reconocieron existencias en el archivo del ERP.",
    );
  return parsed.items;
}

function jsonRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["items", "rows", "stock", "data"])
    if (Array.isArray(object[key])) return object[key] as unknown[];
  return [];
}

function syncMinutes(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(5, Math.min(24 * 60, Math.trunc(parsed)))
    : 15;
}
