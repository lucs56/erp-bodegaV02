import "server-only";
import { getD1Database } from "../db";
import type { StockImportItem } from "./stock-import";

export type StockSnapshotSource = "excel" | "erp" | "manual";

const MAX_ROWS_PER_JSON_CHUNK = 2_000;
const MAX_JSON_CHUNK_CHARACTERS = 1_500_000;

const UPSERT_STOCK_SQL = `
  INSERT INTO stock_items (
    material_code, material_name, category, quantity, unit, updated_at
  )
  SELECT
    json_extract(entry.value, '$.materialCode'),
    json_extract(entry.value, '$.materialName'),
    json_extract(entry.value, '$.category'),
    CAST(json_extract(entry.value, '$.quantity') AS REAL),
    json_extract(entry.value, '$.unit'),
    ?2
  FROM json_each(?1) AS entry
  WHERE json_valid(entry.value)
  ON CONFLICT(material_code) DO UPDATE SET
    material_name = excluded.material_name,
    category = excluded.category,
    quantity = excluded.quantity,
    unit = excluded.unit,
    updated_at = excluded.updated_at
`;

const UPSERT_DEPOTS_SQL = `
  INSERT INTO stock_depot_items (
    material_code, depot, quantity, updated_at
  )
  SELECT
    json_extract(entry.value, '$.materialCode'),
    UPPER(TRIM(CAST(depot.key AS TEXT))),
    CAST(depot.value AS REAL),
    ?2
  FROM json_each(?1) AS entry,
       json_each(json_extract(entry.value, '$.depots')) AS depot
  WHERE TRIM(CAST(depot.key AS TEXT)) <> ''
    AND CAST(depot.value AS REAL) >= 0
  ON CONFLICT(material_code, depot) DO UPDATE SET
    quantity = excluded.quantity,
    updated_at = excluded.updated_at
`;

export function normalizeStockItems(items: Partial<StockImportItem>[]) {
  return items.map((item) => ({
    materialCode: String(item.materialCode ?? "").trim(),
    materialName: String(item.materialName ?? "").trim(),
    category: String(item.category ?? "").trim() || "Otros",
    quantity: Number(item.quantity),
    unit: String(item.unit ?? "").trim() || "unidad",
    depots: Object.fromEntries(
      Object.entries(item.depots ?? {})
        .map(([depot, quantity]) => [
          depot.trim().toUpperCase(),
          Number(quantity),
        ] as [string, number])
        .filter(
          ([depot, quantity]) =>
            Boolean(depot) && Number.isFinite(quantity) && quantity >= 0,
        ),
    ),
  }));
}

export function validateStockSnapshot(items: StockImportItem[]) {
  if (!items.length || items.length > 20_000)
    throw new Error("El archivo debe contener entre 1 y 20.000 insumos.");
  if (
    items.some(
      (item) =>
        !item.materialCode ||
        !item.materialName ||
        !Number.isFinite(item.quantity) ||
        item.quantity < 0,
    )
  )
    throw new Error("Hay filas con código, descripción o cantidad inválidos.");
  if (new Set(items.map((item) => item.materialCode)).size !== items.length)
    throw new Error(
      "El reporte contiene códigos de insumo duplicados después de agruparlo.",
    );
}

export async function replaceStockSnapshot(
  input: Partial<StockImportItem>[],
  options: {
    source: StockSnapshotSource;
    sourceName?: string;
    startedAt?: string;
  },
) {
  const values = normalizeStockItems(input) as StockImportItem[];
  validateStockSnapshot(values);
  const database = await getD1Database();
  const now = new Date().toISOString();
  const chunks = createJsonChunks(values);

  for (const json of chunks) {
    await database.batch([
      database.prepare(UPSERT_STOCK_SQL).bind(json, now),
      database.prepare(UPSERT_DEPOTS_SQL).bind(json, now),
    ]);
  }

  await database.batch([
    database.prepare("DELETE FROM stock_items WHERE updated_at <> ?1").bind(now),
    database
      .prepare("DELETE FROM stock_depot_items WHERE updated_at <> ?1")
      .bind(now),
  ]);

  const expectedDepotRecords = values.reduce(
    (total, item) => total + Object.keys(item.depots).length,
    0,
  );
  const verification = (await database
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM stock_items WHERE updated_at = ?1) AS stock_total,
        (SELECT COUNT(*) FROM stock_depot_items WHERE updated_at = ?1) AS depot_total
    `)
    .bind(now)
    .first()) as { stock_total: number; depot_total: number } | null;
  const saved = Number(verification?.stock_total ?? 0);
  const depotRecords = Number(verification?.depot_total ?? 0);
  if (saved !== values.length || depotRecords !== expectedDepotRecords)
    throw new Error(
      `La base confirmó ${saved} de ${values.length} insumos y ${depotRecords} de ${expectedDepotRecords} registros de depósito; la importación no se consideró completa.`,
    );

  await recordStockSyncRun({
    source: options.source,
    sourceName: options.sourceName,
    status: "success",
    itemCount: saved,
    depotRecordCount: depotRecords,
    startedAt: options.startedAt ?? now,
    completedAt: now,
    message: "Fotografía completa verificada.",
  });

  return {
    imported: values.length,
    saved,
    depotRecords,
    chunks: chunks.length,
    updatedAt: now,
  };
}

export async function recordStockSyncRun(values: {
  source: StockSnapshotSource;
  sourceName?: string;
  status: "success" | "error" | "skipped";
  itemCount?: number;
  depotRecordCount?: number;
  startedAt: string;
  completedAt?: string;
  message?: string;
}) {
  try {
    const database = await getD1Database();
    await database.batch([
      database
        .prepare(
          `INSERT INTO stock_sync_runs (
            source, source_name, status, item_count, depot_record_count,
            started_at, completed_at, message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          values.source,
          values.sourceName ?? null,
          values.status,
          values.itemCount ?? 0,
          values.depotRecordCount ?? 0,
          values.startedAt,
          values.completedAt ?? new Date().toISOString(),
          values.message ?? null,
        ),
      database.prepare(
        `DELETE FROM stock_sync_runs
         WHERE id NOT IN (
           SELECT id FROM stock_sync_runs
           ORDER BY id DESC
           LIMIT 100
         )`,
      ),
    ]);
  } catch {
    // El registro de auditoría no invalida una fotografía de stock verificada.
  }
}

export async function readStockSyncStatus() {
  const database = await getD1Database();
  const [summary, latest, latestSnapshot] = await Promise.all([
    database
      .prepare(
        `SELECT
          COUNT(*) AS item_count,
          MAX(updated_at) AS updated_at
         FROM stock_items`,
      )
      .first() as Promise<{ item_count: number; updated_at: string | null } | null>,
    database
      .prepare(
        `SELECT
          source, source_name, status, item_count, depot_record_count,
          started_at, completed_at, message
         FROM stock_sync_runs
         ORDER BY id DESC
         LIMIT 1`,
      )
      .first() as Promise<{
        source: string;
        source_name: string | null;
        status: string;
        item_count: number;
        depot_record_count: number;
        started_at: string;
        completed_at: string;
        message: string | null;
      } | null>,
    database
      .prepare(
        `SELECT completed_at
         FROM stock_sync_runs
         WHERE status = 'success' AND source IN ('excel', 'erp')
         ORDER BY id DESC
         LIMIT 1`,
      )
      .first() as Promise<{ completed_at: string } | null>,
  ]);
  // Una corrección manual actualiza una fila, no toda la fotografía. Por eso
  // la antigüedad general usa la última importación completa Excel/ERP.
  const updatedAt = latestSnapshot?.completed_at ?? summary?.updated_at ?? null;
  const ageMinutes = updatedAt
    ? Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 60_000))
    : null;
  return {
    itemCount: Number(summary?.item_count ?? 0),
    updatedAt,
    ageMinutes,
    latestRun: latest
      ? {
          source: latest.source,
          sourceName: latest.source_name,
          status: latest.status,
          itemCount: Number(latest.item_count),
          depotRecordCount: Number(latest.depot_record_count),
          startedAt: latest.started_at,
          completedAt: latest.completed_at,
          message: latest.message,
        }
      : null,
  };
}

function createJsonChunks(values: StockImportItem[]) {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentCharacters = 2;
  for (const value of values) {
    const serialized = JSON.stringify(value);
    const separatorCharacters = current.length ? 1 : 0;
    if (
      current.length > 0 &&
      (current.length >= MAX_ROWS_PER_JSON_CHUNK ||
        currentCharacters + separatorCharacters + serialized.length >
          MAX_JSON_CHUNK_CHARACTERS)
    ) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      currentCharacters = 2;
    }
    current.push(serialized);
    currentCharacters += (current.length > 1 ? 1 : 0) + serialized.length;
  }
  if (current.length) chunks.push(`[${current.join(",")}]`);
  return chunks;
}
