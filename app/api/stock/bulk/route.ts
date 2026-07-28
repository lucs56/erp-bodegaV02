import type { StockImportItem } from "../../../../lib/stock-import";
import {
  recordStockSyncRun,
  replaceStockSnapshot,
} from "../../../../lib/stock-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  let sourceName = "Reporte Excel";
  try {
    const payload = (await request.json()) as {
      items?: Partial<StockImportItem>[];
      sourceName?: string;
    };
    sourceName = String(payload.sourceName ?? sourceName).trim() || sourceName;
    const result = await replaceStockSnapshot(payload.items ?? [], {
      source: "excel",
      sourceName,
      startedAt,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo importar el stock.";
    await recordStockSyncRun({
      source: "excel",
      sourceName,
      status: "error",
      startedAt,
      message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
