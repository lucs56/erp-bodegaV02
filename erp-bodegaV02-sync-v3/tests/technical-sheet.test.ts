import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeTechnicalSheetAnalysis } from "../lib/technical-sheet.ts";

test("normaliza un borrador de ficha técnica sin inventar códigos", () => {
  const result = sanitizeTechnicalSheetAnalysis({
    productCode: "302E",
    productName: "ALAMOS MALBEC",
    confidence: 1.4,
    warnings: [],
    items: [
      {
        materialCode: "10318C",
        materialName: "Botella",
        category: "botellas",
        quantity: 1,
        unit: "unidad",
        action: "fraccionar",
        substitutes: ["10318B", "10318B"],
        sourcePage: 2,
      },
      {
        materialCode: "",
        materialName: "Etiqueta frente",
        category: "etiquetas",
        quantity: 0,
        action: "vestido",
      },
    ],
  });
  assert.equal(result.confidence, 1);
  assert.equal(result.items[0].category, "Botellas");
  assert.equal(result.items[0].action, "FRACCIONAR");
  assert.deepEqual(result.items[0].substitutes, ["10318B"]);
  assert.equal(result.items[1].action, "VESTIR");
  assert.ok(result.warnings.some((warning) => warning.includes("no informa un código")));
});
