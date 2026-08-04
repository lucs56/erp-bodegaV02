import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("faltantes permite descargar un libro Excel detallado", () => {
  assert.match(source, /async function exportShortagesToExcel/);
  assert.match(source, /reporte-faltantes-detallado-\$\{new Date\(\)\.toISOString\(\)\.slice\(0,10\)\}\.xlsx/);
  assert.match(source, /book_append_sheet\(workbook,complete,"Reporte completo"\)/);
  assert.match(source, /book_append_sheet\(workbook,summary,"Resumen"\)/);
  assert.match(source, /book_append_sheet\(workbook,consolidated,"Faltantes"\)/);
  assert.match(source, /book_append_sheet\(workbook,weekly,"Detalle semanal"\)/);
  assert.match(source, /book_append_sheet\(workbook,stockDetail,"Stock por código"\)/);
  assert.match(source, /> Descargar Excel<\/button>/);
});

test("la primera hoja contiene código, cantidades, stock, semanas y productos", () => {
  assert.match(source, /"Código \/ grupo"/);
  assert.match(source, /"Necesidad semana"/);
  assert.match(source, /"Stock total del grupo"/);
  assert.match(source, /"Stock detallado por código"/);
  assert.match(source, /"Stock detallado por depósito"/);
  assert.match(source, /"Productos programados"/);
  assert.match(source, /"Trasladado a línea"/);
  assert.match(source, /item\.stockCodes\.join\(" \+ "\)/);
  assert.match(source, /activeTab:0/);
});
