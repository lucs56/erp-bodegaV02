import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("la sincronizacion automatica hace una lectura directa cada 30 segundos", () => {
  assert.match(source, /mode==="automatic" \|\| force[\s\S]*?"\/api\/program\?fresh=1"/);
  assert.match(source, /setInterval\([\s\S]*?runAutomaticCycle[\s\S]*?settings\.syncIntervalSeconds\*1000/);
  assert.match(source, /mode==="automatic"[\s\S]*?timeoutMs:25_000/);
  assert.match(source, /window\.addEventListener\("focus",onFocus\)/);
  assert.match(source, /window\.addEventListener\("online",onOnline\)/);
});

test("la actividad automatica mantiene visible el indicador de actualizacion", () => {
  assert.match(source, /const showActivity=mode!=="stored"/);
  assert.match(source, /className=\{`refresh-button \${refreshing \? "busy" : ""}`\}/);
});
