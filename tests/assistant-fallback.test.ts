import test from "node:test";
import assert from "node:assert/strict";
import {
  generalAssistantAnswer,
  type AssistantSnapshot,
} from "../lib/assistant-fallback.ts";

const snapshot: AssistantSnapshot = {
  today: "martes, 28 de julio de 2026",
  program: {
    title: "Programación",
    fetchedAt: "2026-07-28T12:00:00.000Z",
    operations: 12,
    weeks: [
      { id: "2026-07-27", label: "27–31 Jul", operations: 12, bottles: 9000 },
    ],
  },
  changes: [
    {
      detectedAt: "2026-07-28T12:00:00.000Z",
      added: 1,
      modified: 2,
      removed: 0,
      examples: ["Agregado 302E"],
    },
  ],
  stock: {
    items: 1600,
    updatedAt: "2026-07-28T11:00:00.000Z",
    ageMinutes: 60,
    depots: ["2", "13", "C18"],
    source: "excel",
  },
  bom: {
    products: 40,
    items: 180,
    mappedOperations: 10,
    blockedOperations: 2,
  },
  purchases: {
    itemCount: 3,
    totalUnits: 70000,
    topCategories: [{ category: "Botellas", items: 2, units: 50000 }],
  },
  sync: {
    programSeconds: 60,
    cacheSeconds: 60,
    erpStockConfigured: false,
    erpStockMinutes: 15,
  },
};

test("responde cambios generales con la comparación compartida", () => {
  const answer = generalAssistantAnswer(
    "¿Qué cambió en la programación?",
    snapshot,
  );
  assert.match(answer, /1 altas/);
  assert.match(answer, /2 modificaciones/);
  assert.match(answer, /302E/);
});

test("explica el estado completo y no exige un código puntual", () => {
  const answer = generalAssistantAnswer("estado del sistema", snapshot);
  assert.match(answer, /12 operaciones/);
  assert.match(answer, /1600 insumos/);
  assert.match(answer, /2 sin BOM/);
});
