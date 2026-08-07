import { NextResponse } from "next/server";
import {
  readLastStoredProgram,
  readProgramSyncState,
  refreshProgramFromGoogle,
  type LiveProgram,
} from "../../../lib/google-sheets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const mode = new URL(request.url).searchParams;

  if (mode.get("stored") === "1") {
    const [stored, state] = await Promise.all([
      readLastStoredProgram(),
      readProgramSyncState(),
    ]);
    return stored
      ? liveResponse(
          stored,
          !state.lastError,
          state.lastError
            ? `Última lectura válida en D1. Error de Google: ${state.lastError}`
            : state.syncing
              ? "Sincronización central en curso. Se muestra la última lectura válida mientras termina."
              : "Programación compartida desde Cloudflare D1.",
          state.syncing,
        )
      : snapshotResponse(
          state.syncing
            ? "Sincronización inicial en curso."
            : state.lastError
              ? `No existe una lectura válida todavía. Error de Google: ${state.lastError}`
              : "La primera lectura de Google Sheets todavía no fue completada.",
          state.syncing,
        );
  }

  try {
    const force = mode.get("fresh") === "1";
    const automatic = mode.get("background") === "1";

    // IMPORTANTE: no se usan tareas posteriores a la respuesta. El request líder
    // único que consulta Google y espera hasta guardar la lectura en D1.
    // Los demás requests devuelven el D1 existente inmediatamente.
    const live = await refreshProgramFromGoogle(force, force || !automatic);
    const state = await readProgramSyncState();

    if (!live) {
      return snapshotResponse(
        state.lastError
          ? `No se pudo leer Google Sheets: ${state.lastError}`
          : state.syncing
            ? "Otro dispositivo está realizando la sincronización inicial."
            : "Todavía no existe una lectura válida de Google Sheets.",
        state.syncing,
      );
    }

    return liveResponse(
      live,
      !state.lastError,
      state.lastError
        ? `Se conserva la última lectura válida. Error de Google: ${state.lastError}`
        : state.syncing
          ? "Otro dispositivo está sincronizando Google; se muestra D1 hasta que termine."
          : force
            ? "Programación actualizada desde Google Sheets y guardada en D1."
            : "Programación compartida desde D1. Sincronización multiusuario activa.",
      state.syncing,
    );
  } catch (error) {
    const [stored, state] = await Promise.all([
      readLastStoredProgram(),
      readProgramSyncState(),
    ]);
    const message = error instanceof Error ? error.message : "Error de sincronización";
    if (stored) {
      return liveResponse(
        stored,
        false,
        `Google no respondió; el ERP conserva D1. ${message}`,
        state.syncing,
      );
    }
    return snapshotResponse(`No se pudo leer Google Sheets. ${message}`, state.syncing);
  }
}

function liveResponse(
  live: LiveProgram,
  isLive: boolean,
  notice?: string,
  syncing = false,
) {
  return NextResponse.json(
    {
      source: {
        mode: isLive ? "live" : "stored",
        live: isLive,
        title: live.title,
        fetchedAt: live.fetchedAt,
        notice,
        syncing,
      },
      records: live.weeks.flatMap((week) => week.records),
      diagnostics: live.weeks.flatMap((week) =>
        week.diagnostics.map((item) => ({
          ...item,
          weekId: week.weekId,
          weekLabel: week.weekLabel,
        })),
      ),
    },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}

function snapshotResponse(notice: string, syncing = false) {
  return NextResponse.json(
    {
      source: {
        mode: "unavailable",
        live: false,
        title: "Programación",
        fetchedAt: new Date().toISOString(),
        notice,
        syncing,
      },
      records: [],
      diagnostics: [],
    },
    { headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
