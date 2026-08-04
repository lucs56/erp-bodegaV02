import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("faltantes permite descargar un libro Excel completo", () => {
  assert.match(source, /async function exportShortagesToExcel/);
  assert.match(source, /reporte-faltantes-\$\{new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\.xlsx/);
  assert.match(source, /book_append_sheet\(workbook,summary,"Resumen"\)/);
  assert.match(source, /book_append_sheet\(workbook,consolidated,"Faltantes"\)/);
  assert.match(source, /book_append_sheet\(workbook,weekly,"Detalle semanal"\)/);
  assert.match(source, /book_append_sheet\(workbook,stockDetail,"Stock por código"\)/);
  assert.match(source, /> Descargar Excel<\/button>/);
});

test("el Excel conserva semanas, depósitos, traslados y códigos compatibles", () => {
  assert.match(source, /"Códigos compatibles"/);
  assert.match(source, /"Trasladado a línea"/);
  assert.match(source, /"Stock por depósito"/);
  assert.match(source, /"Se ocupa"/);
  assert.match(source, /item\.stockCodes\.join\(" \+ "\)/);
});
