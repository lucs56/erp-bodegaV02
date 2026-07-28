import { NextResponse } from "next/server";
import { readLastStoredProgram,readLiveProgram,type LiveProgram } from "../../../lib/google-sheets";
import { readLatestProgramChange, type StoredProgramChange } from "../../../lib/program-changes";

export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const force = parameters.get("fresh") === "1";
    if (parameters.get("cached") === "1" && !force) {
      const stored = await readLastStoredProgram();
      if (stored)
        return liveResponse(
          stored,
          false,
          "Se muestra la última lectura real guardada; la sincronización continuará en segundo plano.",
          await readLatestProgramChange(),
        );
    }

    const live = await readLiveProgram(force);
    if (live) {
      const records = live.weeks.flatMap((week) => week.records);
      const recentChange = await readLatestProgramChange();
      return NextResponse.json(
        {
          source: { mode: "live", live: true, title: live.title, fetchedAt: live.fetchedAt },
          records,
          recentChange,
          diagnostics: live.weeks.flatMap((week) => week.diagnostics.map((item) => ({ ...item, weekId: week.weekId, weekLabel: week.weekLabel }))),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return snapshotResponse("La conexión productiva de solo lectura todavía no está configurada.");
  } catch {
    const stored=await readLastStoredProgram();
    if(stored)return liveResponse(stored,false,"Google no respondió; se muestra la última lectura real guardada en D1.",await readLatestProgramChange());
    return snapshotResponse("No se pudo leer Google Sheets y todavía no existe una lectura real guardada.");
  }
}

function liveResponse(live:LiveProgram,isLive:boolean,notice?:string,recentChange:StoredProgramChange|null=null){return NextResponse.json({source:{mode:isLive?"live":"stored",live:isLive,title:live.title,fetchedAt:live.fetchedAt,notice},records:live.weeks.flatMap(week=>week.records),recentChange,diagnostics:live.weeks.flatMap(week=>week.diagnostics.map(item=>({...item,weekId:week.weekId,weekLabel:week.weekLabel})))},{headers:{"cache-control":"no-store"}});}

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
