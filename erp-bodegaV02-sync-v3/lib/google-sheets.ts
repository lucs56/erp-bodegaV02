import "server-only";
import * as XLSX from "xlsx";
import { parseProgramSheet, type ParsedWeek } from "./program-parser";
import { readSettings } from "./app-settings";
import { getD1Database } from "../db";
import { struckRowsBySheet } from "./xlsx-strikethrough";
import { fetchWithRetry } from "./resilient-fetch";

const DEFAULT_SHEET_ID = "1XL44rx3sNKpxowAQzY1iSjy7s8lYOsPTMngD6xeBDPQ";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;
const PROGRAM_CACHE_KEY = "live";
const SYNC_LOCK_KEY = "google-sheets";
const SYNC_LOCK_LEASE_MS = 45_000;
const WAIT_FOR_LEADER_MS = 25_000;
const WAIT_POLL_MS = 1_000;

let cachedToken: { value: string; expiresAt: number } | null = null;

export type LiveProgram = {
  spreadsheetId: string;
  title: string;
  fetchedAt: string;
  weeks: ParsedWeek[];
};

type StoredProgramRow = {
  value: string;
  fetched_at: string;
};

export type ProgramSyncState = {
  syncing: boolean;
  leaseUntil: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

/**
 * Compatibilidad con llamadas existentes. Para una actualización explícita se
 * espera al líder; para una lectura normal se permite devolver el último D1.
 */
export async function readLiveProgram(force = false): Promise<LiveProgram | null> {
  return refreshProgramFromGoogle(force, true);
}

/**
 * Motor multiusuario de sincronización.
 *
 * - D1 es la copia compartida para todos los dispositivos.
 * - Un lease distribuido decide qué request es el único que consulta Google.
 * - El request líder ESPERA a Google y guarda el resultado antes de finalizar.
 *   No depende de tareas en background/waitUntil.
 * - Los seguidores devuelven D1 inmediatamente o, si waitForLeader=true,
 *   esperan a que el líder publique la lectura nueva.
 */
export async function refreshProgramFromGoogle(
  force = false,
  waitForLeader = false,
): Promise<LiveProgram | null> {
  const settings = await readSettings();
  const stored = await readStoredProgram();
  const freshnessSeconds = Math.max(
    10,
    Number(settings.syncIntervalSeconds) || 30,
    Number(settings.cacheSeconds) || 0,
  );

  if (!force && stored && isFresh(stored.fetchedAt, freshnessSeconds)) {
    return stored.value;
  }

  const owner = createLockOwner();
  const acquired = await acquireSyncLock(owner);
  if (!acquired) {
    if (waitForLeader) {
      const leaderResult = await waitForLeaderResult(stored?.fetchedAt ?? null);
      if (leaderResult) return leaderResult;
    }
    return stored?.value ?? null;
  }

  let successAt: string | null = null;
  let failure: unknown = null;
  try {
    // Otro request pudo haber completado la lectura justo antes de obtener el
    // lease. En el ciclo automático evitamos volver a consultar Google.
    if (!force) {
      const latest = await readStoredProgram();
      if (latest && isFresh(latest.fetchedAt, freshnessSeconds)) {
        successAt = latest.fetchedAt;
        return latest.value;
      }
    }

    const fresh = await fetchLiveProgram(settings.spreadsheetId);
    if (fresh) {
      await writeSharedCache(fresh);
      successAt = fresh.fetchedAt;
      return fresh;
    }
    return stored?.value ?? null;
  } catch (error) {
    failure = error;
    if (stored) return stored.value;
    throw error;
  } finally {
    await releaseSyncLock(owner, successAt, failure);
  }
}

/** Lee siempre la última lectura válida guardada en D1, aunque sea antigua. */
export async function readLastStoredProgram(): Promise<LiveProgram | null> {
  return (await readStoredProgram())?.value ?? null;
}

export async function readProgramSyncState(): Promise<ProgramSyncState> {
  try {
    const db = await getD1Database();
    const [stateRow, lockRow] = await Promise.all([
      db
        .prepare(
          "SELECT last_attempt_at,last_success_at,last_error FROM program_sync_state WHERE key = ?",
        )
        .bind(SYNC_LOCK_KEY)
        .first<{
          last_attempt_at: string | null;
          last_success_at: string | null;
          last_error: string | null;
        }>(),
      db
        .prepare("SELECT lease_until FROM program_sync_lock WHERE key = ?")
        .bind(SYNC_LOCK_KEY)
        .first<{ lease_until: number | string | null }>(),
    ]);
    const leaseUntil = Number(lockRow?.lease_until ?? 0);
    return {
      syncing: leaseUntil > Date.now(),
      leaseUntil,
      lastAttemptAt: stateRow?.last_attempt_at ?? null,
      lastSuccessAt: stateRow?.last_success_at ?? null,
      lastError: stateRow?.last_error ?? null,
    };
  } catch {
    return {
      syncing: false,
      leaseUntil: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
    };
  }
}

async function readStoredProgram(): Promise<{ value: LiveProgram; fetchedAt: string } | null> {
  try {
    const db = await getD1Database();
    const row = await db
      .prepare("SELECT value,fetched_at FROM program_cache WHERE key = ?")
      .bind(PROGRAM_CACHE_KEY)
      .first<StoredProgramRow>();
    if (!row?.value) return null;
    const value = JSON.parse(row.value) as LiveProgram;
    return { value, fetchedAt: row.fetched_at || value.fetchedAt };
  } catch {
    return null;
  }
}

async function writeSharedCache(value: LiveProgram) {
  const db = await getD1Database();
  await db
    .prepare(
      `INSERT INTO program_cache (key,value,fetched_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET
         value=excluded.value,
         fetched_at=excluded.fetched_at
       WHERE excluded.fetched_at >= program_cache.fetched_at`,
    )
    .bind(PROGRAM_CACHE_KEY, JSON.stringify(value), value.fetchedAt)
    .run();
}

async function acquireSyncLock(owner: string): Promise<boolean> {
  const db = await getD1Database();
  const now = Date.now();
  const leaseUntil = now + SYNC_LOCK_LEASE_MS;
  const attemptAt = new Date(now).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO program_sync_lock (key,lease_until,owner)
       VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET
         lease_until=excluded.lease_until,
         owner=excluded.owner
       WHERE program_sync_lock.lease_until <= ?`,
    )
    .bind(SYNC_LOCK_KEY, leaseUntil, owner, now)
    .run();
  const meta = (result as { meta?: { changes?: number } } | null)?.meta;
  const acquired = Number(meta?.changes ?? 0) > 0;
  if (!acquired) return false;

  await db
    .prepare(
      `INSERT INTO program_sync_state (key,lease_until,last_attempt_at,last_success_at,last_error)
       VALUES (?,0,?,NULL,NULL)
       ON CONFLICT(key) DO UPDATE SET
         last_attempt_at=excluded.last_attempt_at,
         last_error=NULL`,
    )
    .bind(SYNC_LOCK_KEY, attemptAt)
    .run();
  return true;
}

async function releaseSyncLock(owner: string, successAt: string | null, failure: unknown) {
  try {
    const db = await getD1Database();
    const errorText = failure ? errorMessage(failure) : null;
    await db
      .prepare(
        `UPDATE program_sync_state
         SET last_success_at=COALESCE(?,last_success_at),
             last_error=?
         WHERE key=?`,
      )
      .bind(successAt, errorText, SYNC_LOCK_KEY)
      .run();

    // El owner impide que un request viejo libere el lease que pertenece a
    // otro Worker después de una expiración.
    await db
      .prepare("DELETE FROM program_sync_lock WHERE key=? AND owner=?")
      .bind(SYNC_LOCK_KEY, owner)
      .run();
  } catch {
    // Si D1 falla al liberar, el lease vence solo en 45 segundos.
  }
}

async function waitForLeaderResult(previousFetchedAt: string | null): Promise<LiveProgram | null> {
  const deadline = Date.now() + WAIT_FOR_LEADER_MS;
  while (Date.now() < deadline) {
    await delay(WAIT_POLL_MS);
    const stored = await readStoredProgram();
    if (stored && (!previousFetchedAt || stored.fetchedAt !== previousFetchedAt)) {
      return stored.value;
    }
    const state = await readProgramSyncState();
    if (!state.syncing) return stored?.value ?? null;
  }
  return (await readStoredProgram())?.value ?? null;
}

function createLockOwner() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

function isFresh(fetchedAt: string, maxAgeSeconds: number) {
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < maxAgeSeconds * 1000;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "Error de sincronización");
  return message.slice(0, 500);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function fetchLiveProgram(configuredSpreadsheetId:string): Promise<LiveProgram | null> {
  const runtimeEnv = await runtimeVariables();
  const serviceAccountEmail = runtimeEnv.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
  const privateKey = runtimeEnv.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const spreadsheetId = configuredSpreadsheetId || runtimeEnv.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
  if (!serviceAccountEmail || !privateKey) return readPublicWorkbook(spreadsheetId);
  const token = await accessToken(serviceAccountEmail, privateKey);
  const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  metadataUrl.searchParams.set("fields", "properties(title),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount)))");
  const metadata = await googleJson<{
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number; hidden?: boolean; gridProperties?: { rowCount?: number } } }>;
  }>(metadataUrl, token);

  const tabs = (metadata.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((properties): properties is NonNullable<typeof properties> => Boolean(properties?.title) && !properties?.hidden)
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  if (tabs.length === 0) throw new Error("La planilla no contiene pestañas visibles.");

  const ranges: string[] = [];
  for (const tab of tabs) {
    const escapedTitle = String(tab.title).replace(/'/g, "''");
    const rowLimit = Math.min(tab.gridProperties?.rowCount ?? 1500, 5000);
    ranges.push(`'${escapedTitle}'!A1:Z${rowLimit}`);
  }

  let weeks: ParsedWeek[];
  try {
    const formattedUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    formattedUrl.searchParams.set("includeGridData", "true");
    formattedUrl.searchParams.set(
      "fields",
      "sheets(properties(sheetId,title),data(startRow,rowData(values(formattedValue,effectiveFormat(textFormat(strikethrough))))))",
    );
    for (const range of ranges) formattedUrl.searchParams.append("ranges", range);
    const formatted = await googleJson<{
      sheets?: Array<{
        properties?: { sheetId?: number; title?: string };
        data?: Array<{
          startRow?: number;
          rowData?: Array<{
            values?: Array<{
              formattedValue?: string;
              effectiveFormat?: {
                textFormat?: { strikethrough?: boolean };
              };
            }>;
          }>;
        }>;
      }>;
    }>(formattedUrl, token);
    const formattedByTitle = new Map(
      (formatted.sheets ?? []).map((sheet) => [
        String(sheet.properties?.title ?? ""),
        sheet,
      ]),
    );
    weeks = tabs
      .map((tab) => {
        const sheet = formattedByTitle.get(String(tab.title));
        const values: unknown[][] = [];
        const struckRows = new Set<number>();
        for (const grid of sheet?.data ?? []) {
          const startRow = grid.startRow ?? 0;
          for (const [rowIndex, row] of (grid.rowData ?? []).entries()) {
            const cells = row.values ?? [];
            values[startRow + rowIndex] = cells.map(
              (cell) => cell.formattedValue ?? "",
            );
            if (
              cells
                .slice(0, 26)
                .some(
                  (cell) =>
                    cell.effectiveFormat?.textFormat?.strikethrough === true,
                )
            )
              struckRows.add(startRow + rowIndex + 1);
          }
        }
        return parseProgramSheet({
          sheetId: Number(tab.sheetId ?? 0),
          title: String(tab.title),
          values,
          struckRows,
        });
      })
      .filter((week) => week.weekId !== "unknown");
  } catch {
    // Si Google no permite leer formatos, se conserva la lectura de valores.
    // La sincronización nunca debe quedar bloqueada por el estilo de las celdas.
    const batchUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`);
    batchUrl.searchParams.set("majorDimension", "ROWS");
    batchUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
    for (const range of ranges) batchUrl.searchParams.append("ranges", range);
    const values = await googleJson<{ valueRanges?: Array<{ values?: unknown[][] }> }>(batchUrl, token);
    weeks = tabs
      .map((tab, index) => parseProgramSheet({
        sheetId: Number(tab.sheetId ?? 0),
        title: String(tab.title),
        values: values.valueRanges?.[index]?.values ?? [],
      }))
      .filter((week) => week.weekId !== "unknown");
  }

  return {
    spreadsheetId,
    title: metadata.properties?.title ?? "Programación",
    fetchedAt: new Date().toISOString(),
    weeks,
  };
}

async function readPublicWorkbook(spreadsheetId:string):Promise<LiveProgram>{
  const url=new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`);
  url.searchParams.set("format","xlsx");url.searchParams.set("_",Date.now().toString());
  const response=await googleFetch(url,{cache:"no-store",headers:{"cache-control":"no-cache, no-store",pragma:"no-cache"}});
  if(!response.ok)throw new Error(response.status===401||response.status===403?"Google Sheets no permite leer la programación. Compartila como lector mediante enlace.":`Google Sheets respondió ${response.status}.`);
  const workbook=XLSX.read(await response.arrayBuffer(),{type:"array",cellDates:true,cellStyles:true,bookFiles:true});
  const struckRows=struckRowsBySheet(workbook);
  const weeks=workbook.SheetNames.map((title,index)=>parseProgramSheet({sheetId:index+1,title,values:XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[title],{header:1,defval:"",raw:false}),struckRows:struckRows.get(title)})).filter(week=>week.weekId!=="unknown");
  return{spreadsheetId,title:"Programación Junín",fetchedAt:new Date().toISOString(),weeks};
}

async function accessToken(email: string, privateKey: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now - 30,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await googleFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google rechazó la autenticación de solo lectura (${response.status}).`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google no devolvió un token de acceso.");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function googleJson<T>(url: URL, token: string): Promise<T> {
  const response = await googleFetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo leer Google Sheets (${response.status}).`);
  return response.json() as Promise<T>;
}

async function runtimeVariables() {
  const values: Record<string, string | undefined> = {
    GOOGLE_SHEET_ID: typeof process !== "undefined" ? process.env.GOOGLE_SHEET_ID : undefined,
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: typeof process !== "undefined" ? process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL : undefined,
    GOOGLE_SHEETS_PRIVATE_KEY: typeof process !== "undefined" ? process.env.GOOGLE_SHEETS_PRIVATE_KEY : undefined,
  };
  try {
    const workers = await import("cloudflare:workers");
    const workerEnv = workers.env as unknown as Record<string, unknown>;
    for (const name of Object.keys(values)) {
      if (!values[name] && typeof workerEnv[name] === "string") values[name] = workerEnv[name] as string;
    }
  } catch {
    // Node-based build validation does not expose the Cloudflare runtime module.
  }
  return values;
}

function googleFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetchWithRetry(input, init, {
    timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    retryDelayMs: 600,
  });
}

function pemBytes(pem: string) {
  const encoded = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
