import "server-only";
import { getD1Database } from "../db";
import {
  aggregateStockRows,
  type StockJoinRow,
  type StockReadItem,
} from "./stock-rows";

let lastSuccessfulSnapshot: {
  items: StockReadItem[];
  fetchedAt: string;
} | null = null;

export async function readStockSnapshot() {
  try {
    const database = await getD1Database();
    const result = await database
      .prepare(
        `SELECT
          s.id,
          s.material_code,
          s.material_name,
          s.category,
          s.quantity,
          s.unit,
          s.updated_at,
          d.depot,
          d.quantity AS depot_quantity
        FROM stock_items AS s
        LEFT JOIN stock_depot_items AS d
          ON d.material_code = s.material_code
        ORDER BY s.category, s.material_code, d.depot`,
      )
      .all<StockJoinRow>();

    const items = aggregateStockRows(result.results ?? []);
    const fetchedAt = new Date().toISOString();
    lastSuccessfulSnapshot = { items, fetchedAt };
    return { items, fetchedAt, degraded: false as const };
  } catch (error) {
    if (lastSuccessfulSnapshot)
      return {
        ...lastSuccessfulSnapshot,
        degraded: true as const,
        warning:
          error instanceof Error
            ? error.message
            : "No se pudo volver a leer el stock; se usa la última lectura válida del servidor.",
      };
    throw error;
  }
}
