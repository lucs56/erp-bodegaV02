export type StockReadItem = {
  id: number;
  materialCode: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
  updatedAt: string;
  depots: Record<string, number>;
};

export type StockJoinRow = {
  id: number;
  material_code: string;
  material_name: string;
  category: string;
  quantity: number;
  unit: string;
  updated_at: string;
  depot: string | null;
  depot_quantity: number | null;
};

/**
 * Agrupa una consulta JOIN en una sola pasada. Evita el patrón anterior
 * items.map(... depots.filter(...)), que crecía como insumos x depósitos.
 */
export function aggregateStockRows(rows: StockJoinRow[]): StockReadItem[] {
  const byCode = new Map<string, StockReadItem>();

  for (const row of rows) {
    let item = byCode.get(row.material_code);
    if (!item) {
      item = {
        id: Number(row.id),
        materialCode: String(row.material_code),
        materialName: String(row.material_name),
        category: String(row.category),
        quantity: Number(row.quantity) || 0,
        unit: String(row.unit || "unidad"),
        updatedAt: String(row.updated_at),
        depots: {},
      };
      byCode.set(row.material_code, item);
    }

    if (row.depot) item.depots[String(row.depot)] = Number(row.depot_quantity) || 0;
  }

  return [...byCode.values()];
}
