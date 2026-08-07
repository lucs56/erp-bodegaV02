import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/program/route.ts", import.meta.url), "utf8");

test("la sincronizacion automatica no muestra spinner global", () => {
  assert.match(page, /const showActivity=force\|\|mode==="standard"/);
});

test("el primer ingreso espera una lectura util si D1 esta vacio", () => {
  assert.match(page, /synchronizeProgram\(false,false,"standard"\)/);
});

test("el ciclo automatico no depende de tareas post-respuesta", () => {
  assert.match(route, /const automatic = mode\.get\("background"\) === "1"/);
  assert.match(route, /refreshProgramFromGoogle\(force, force \|\| !automatic\)/);
  assert.doesNotMatch(route, /scheduleBackgroundRefresh/);
  assert.doesNotMatch(route, /waitUntil/);
});
