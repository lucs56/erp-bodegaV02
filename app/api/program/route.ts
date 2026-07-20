import { NextResponse } from "next/server";
import { readLiveProgram } from "../../../lib/google-sheets";
import { PROGRAM_SOURCE, programRecords } from "../../../lib/program-data";

export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  try {
    const live = await readLiveProgram(new URL(request.url).searchParams.get("fresh")==="1");
    if (live) {
      const records = live.weeks.flatMap((week) => week.records);
      return NextResponse.json(
        {
          source: { mode: "live", live: true, title: live.title, fetchedAt: live.fetchedAt },
          records,
          diagnostics: live.weeks.flatMap((week) => week.diagnostics.map((item) => ({ ...item, weekId: week.weekId, weekLabel: week.weekLabel }))),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return snapshotResponse("La conexión productiva de solo lectura todavía no está configurada.");
  } catch {
    return snapshotResponse("No se pudo actualizar Google Sheets; se conserva la última lectura validada.");
  }
}

function snapshotResponse(notice: string) {
  return NextResponse.json(
    {
      source: { mode: "snapshot", live: false, title: PROGRAM_SOURCE.title, fetchedAt: PROGRAM_SOURCE.capturedAt, notice },
      records: programRecords,
      diagnostics: programRecords.filter((record) => !record.productCode).map((record) => ({
        code: "MISSING_PRODUCT_CODE",
        message: `${record.brand || "Producto"} no tiene código.`,
        sourceRow: record.sourceRow,
        weekId: record.weekId,
        weekLabel: record.weekLabel,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
