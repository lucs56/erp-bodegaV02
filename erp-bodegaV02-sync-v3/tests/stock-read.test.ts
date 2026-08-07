import assert from "node:assert/strict";
import test from "node:test";
import { aggregateStockRows } from "../lib/stock-rows.ts";

test("agrupa depósitos en una sola pasada sin duplicar insumos", () => {
  const rows = [
    {
      id: 1,
      material_code: "10248",
      material_name: "BOTELLA",
      category: "Botellas",
      quantity: 290276,
      unit: "unidad",
      updated_at: "2026-07-30T00:00:00.000Z",
      depot: "2",
      depot_quantity: 200000,
    },
    {
      id: 1,
      material_code: "10248",
      material_name: "BOTELLA",
      category: "Botellas",
      quantity: 290276,
      unit: "unidad",
      updated_at: "2026-07-30T00:00:00.000Z",
      depot: "C18",
      depot_quantity: 90276,
    },
    {
      id: 2,
      material_code: "20376",
      material_name: "TAPÓN",
      category: "Tapones",
      quantity: 527700,
      unit: "unidad",
      updated_at: "2026-07-30T00:00:00.000Z",
      depot: null,
      depot_quantity: null,
    },
  ];

  const items = aggregateStockRows(rows);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].depots, { "2": 200000, C18: 90276 });
  assert.deepEqual(items[1].depots, {});
});
