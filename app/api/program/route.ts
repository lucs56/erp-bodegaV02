import { NextResponse } from "next/server";
import { readLastStoredProgram,readLiveProgram,type LiveProgram } from "../../../lib/google-sheets";

export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  const mode = new URL(request.url).searchParams;
  if (mode.get("stored") === "1") {
    const stored = await readLastStoredProgram();
    return stored
      ? liveResponse(
          stored,
          true,
          "Sincronización automática activa. Se muestra la última lectura completada.",
        )
      : snapshotResponse("La primera lectura de Google Sheets todavía está en curso.");
  }
  if (mode.get("background") === "1") {
    const stored = await readLastStoredProgram();
    
    return stored
      ? liveResponse(
          stored,
          true,
          "Sincronización automática en curso. Los cambios se incorporan al terminar la lectura.",
        )
      : snapshotResponse("La primera lectura de Google Sheets se inició en segundo plano.");
  }
  try {
    const force = mode.get("fresh") === "1";
    const live = await readLiveProgram(force);
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
    const stored=await readLastStoredProgram();
    if(stored)return liveResponse(stored,false,"Google no respondió; se muestra la última lectura real guardada en D1.");
    return snapshotResponse("No se pudo leer Google Sheets y todavía no existe una lectura real guardada.");
  }
}

async function scheduleBackgroundRefresh() {
  const refresh = readLiveProgram().catch(() => null);
  try {
    const workers = await import("cloudflare:workers");
    workers.waitUntil(refresh);
  } catch {
    // En la validación local no existe el contexto de Cloudflare. La promesa
    // ya quedó iniciada; en producción waitUntil garantiza su finalización.
    void refresh;
  }
}

function liveResponse(live:LiveProgram,isLive:boolean,notice?:string){return NextResponse.json({source:{mode:isLive?"live":"stored",live:isLive,title:live.title,fetchedAt:live.fetchedAt,notice},records:live.weeks.flatMap(week=>week.records),diagnostics:live.weeks.flatMap(week=>week.diagnostics.map(item=>({...item,weekId:week.weekId,weekLabel:week.weekLabel})))},{headers:{"cache-control":"no-store"}});}

function snapshotResponse(notice: string) {
  return NextResponse.json(
    {
      source: { mode: "unavailable", live: false, title: "Programación", fetchedAt: new Date().toISOString(), notice },
      records: [],
      diagnostics: [],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
