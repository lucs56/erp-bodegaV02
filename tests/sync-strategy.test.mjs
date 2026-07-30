import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("la sincronizacion automatica conserva el ciclo estable de 30 segundos", () => {
  assert.match(source, /mode==="automatic"[\s\S]*?"\/api\/program\?background=1"/);
  assert.match(source, /setInterval\(runAutomaticCycle, settings\.syncIntervalSeconds\*1000\)/);
  assert.match(source, /setTimeout\([\s\S]*?synchronizeProgram\(false,false,"stored"\)[\s\S]*?,8_000\)/);
});
