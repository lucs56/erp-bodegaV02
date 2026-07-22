import { getD1Database } from "../../../../db";

type Item = {
  materialCode?: string;
  materialName?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  depots?: Record<string, number>;
};

type StockValue = {
  materialCode: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
  depots: Record<string, number>;
};

export const dynamic = "force-dynamic";

const MAX_ITEMS = 20_000;
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

function createJsonChunks(values: StockValue[]) {
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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { items?: Item[] };
    if (
      !Array.isArray(payload.items) ||
      !payload.items.length ||
      payload.items.length > MAX_ITEMS
    )
      return Response.json(
        { error: "El archivo debe contener entre 1 y 20.000 insumos." },
        { status: 400 },
      );

    const values: StockValue[] = payload.items.map((item) => ({
      materialCode: item.materialCode?.trim() ?? "",
      materialName: item.materialName?.trim() ?? "",
      category: item.category?.trim() || "Otros",
      quantity: Number(item.quantity),
      unit: item.unit?.trim() || "unidad",
      depots: Object.fromEntries(
        Object.entries(item.depots ?? {})
          .map(([depot, quantity]) => [
            depot.trim().toUpperCase(),
            Number(quantity),
          ])
          .filter(
            ([depot, quantity]) =>
              Boolean(depot) && Number.isFinite(quantity) && quantity >= 0,
          ),
      ),
    }));

    if (
      values.some(
        (item) =>
          !item.materialCode ||
          !item.materialName ||
          !Number.isFinite(item.quantity) ||
          item.quantity < 0,
      )
    )
      return Response.json(
        { error: "Hay filas con código, descripción o cantidad inválidos." },
        { status: 400 },
      );

    const uniqueCodes = new Set(values.map((item) => item.materialCode));
    if (uniqueCodes.size !== values.length)
      return Response.json(
        {
          error:
            "El reporte contiene códigos de insumo duplicados después de agruparlo.",
        },
        { status: 400 },
      );

    const database = await getD1Database();
    const now = new Date().toISOString();
    const chunks = createJsonChunks(values);

    // Cada lote realiza dos consultas set-based: una para el stock total y otra
    // para todo su desglose por depósito. Así miles de filas no se convierten
    // en miles de llamadas individuales a D1.
    for (const json of chunks) {
      await database.batch([
        database.prepare(UPSERT_STOCK_SQL).bind(json, now),
        database.prepare(UPSERT_DEPOTS_SQL).bind(json, now),
      ]);
    }

    // El Excel representa una fotografía completa. Solo se retiran los códigos
    // anteriores después de que todos los lotes nuevos fueron guardados.
    await database.batch([
      database
        .prepare("DELETE FROM stock_items WHERE updated_at <> ?1")
        .bind(now),
      database
        .prepare("DELETE FROM stock_depot_items WHERE updated_at <> ?1")
        .bind(now),
    ]);

    const expectedDepotRecords = values.reduce(
      (total, item) => total + Object.keys(item.depots).length,
      0,
    );
    const verification = await database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM stock_items WHERE updated_at = ?1) AS stock_total,
          (SELECT COUNT(*) FROM stock_depot_items WHERE updated_at = ?1) AS depot_total
      `)
      .bind(now)
      .first<{ stock_total: number; depot_total: number }>();
    const saved = Number(verification?.stock_total ?? 0);
    const savedDepotRecords = Number(verification?.depot_total ?? 0);

    if (saved !== values.length || savedDepotRecords !== expectedDepotRecords)
      throw new Error(
        `La base confirmó ${saved} de ${values.length} insumos y ${savedDepotRecords} de ${expectedDepotRecords} registros de depósito; la importación no se consideró completa.`,
      );

    return Response.json({
      ok: true,
      imported: values.length,
      saved,
      depotRecords: savedDepotRecords,
      chunks: chunks.length,
      updatedAt: now,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo importar el stock.",
      },
      { status: 500 },
    );
  }
}
