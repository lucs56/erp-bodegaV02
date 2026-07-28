import assert from "node:assert/strict";
import test from "node:test";
import { generalAssistantFallback } from "../lib/assistant.ts";

const context = {
  now: "martes, 28 de julio de 2026, 10:00",
  synchronized: true,
  fetchedAt: "28/7/26, 10:00",
  operations: 120,
  weeks: 3,
  completedOperations: 8,
  mappedOperations: 100,
  blockedOperations: 12,
  shortages: 20,
  stockItems: 1600,
  shortageItems: [
    {
      materialCode: "20393",
      materialName: "Tapón screw negro",
      category: "Tapones",
      unit: "unidad",
      required: 150000,
      available: 100000,
      shortage: 50000,
      weeks: ["27–31 Jul"],
    },
    {
      materialCode: "10222A",
      materialName: "Botella 750 cc",
      category: "Botellas",
      unit: "unidad",
      required: 80000,
      available: 60000,
      shortage: 20000,
      weeks: ["03–07 Ago"],
    },
  ],
  calculation: {
    running: false,
    phase: "Necesidad comparada con stock",
    lastCalculatedAt: "28/7/26, 10:01",
    sourceMessage: "programación actualizada · fichas técnicas actualizadas · stock actualizado",
  },
  changes: { added: 2, modified: 1, removed: 0, detectedAt: "" },
};

test("responde la fecha como consulta general", () => {
  assert.match(generalAssistantFallback("¿Qué día es hoy?", context), /28 de julio/);
});

test("explica los cambios sin buscar códigos puntuales", () => {
  const answer = generalAssistantFallback("¿Qué cambió?", context);
  assert.match(answer, /2 operaciones agregadas/);
  assert.match(answer, /1 modificadas/);
});

test("reconoce sincronización con y sin tilde", () => {
  assert.match(
    generalAssistantFallback("esta andando la sincronizacion?", context),
    /sincronización está funcionando/i,
  );
  assert.match(
    generalAssistantFallback("sincronización", context),
    /cada 30 segundos/i,
  );
});

test("resume los faltantes actuales", () => {
  const answer = generalAssistantFallback("que faltantes tengo", context);
  assert.match(answer, /20 insumos con faltante/i);
  assert.match(answer, /Tapón screw negro/);
});

test("filtra faltantes por tipo de insumo", () => {
  const answer = generalAssistantFallback("que tapon me va a faltar", context);
  assert.match(answer, /tapones o cierres/i);
  assert.match(answer, /20393/);
  assert.doesNotMatch(answer, /10222A/);
});

test("responde una consulta puntual por código con datos del ERP", () => {
  const answer = generalAssistantFallback("20383", {
    ...context,
    materialQuery: "20383",
    materialMatches: [
      {
        materialCode: "20383",
        materialName: "Tapón screw",
        category: "Tapones",
        unit: "unidad",
        required: 150000,
        available: 100000,
        shortage: 50000,
        depots: { "13": 30000, "2": 50000, C18: 20000 },
        weeks: ["27–31 Jul", "03–07 Ago"],
        products: ["3392-NV - ALAMOS WOTM"],
        inCurrentProgram: true,
        inStock: true,
        inTechnicalSheet: true,
      },
    ],
  });
  assert.match(answer, /20383 corresponde a Tapón screw/i);
  assert.match(answer, /necesita 150\.000/i);
  assert.match(answer, /13 \(Producción\): 30\.000/);
  assert.match(answer, /Faltan 50\.000/i);
  assert.match(answer, /ALAMOS WOTM/);
});

test("informa claramente cuando un código no existe", () => {
  const answer = generalAssistantFallback("99999", {
    ...context,
    materialQuery: "99999",
    materialMatches: [],
  });
  assert.match(answer, /No encontré el código 99999/i);
});
