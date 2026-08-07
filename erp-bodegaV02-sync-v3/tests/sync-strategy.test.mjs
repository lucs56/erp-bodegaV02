import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const sheets = await readFile(new URL("../lib/google-sheets.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/program/route.ts", import.meta.url), "utf8");
const database = await readFile(new URL("../db/index.ts", import.meta.url), "utf8");

test("la sincronizacion automatica usa un request lider y no waitUntil", () => {
  assert.match(page, /mode==="automatic"[\s\S]*?"\/api\/program\?background=1"/);
  assert.match(route, /refreshProgramFromGoogle\(force, force \|\| !automatic\)/);
  assert.doesNotMatch(route, /waitUntil/);
  assert.doesNotMatch(route, /scheduleBackgroundRefresh/);
});

test("D1 contiene un lease compartido con owner para impedir carreras", () => {
  assert.match(database, /CREATE TABLE IF NOT EXISTS program_sync_state/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS program_sync_lock/);
  assert.match(database, /owner TEXT NOT NULL/);
  assert.match(sheets, /async function acquireSyncLock\(owner: string\)/);
  assert.match(sheets, /WHERE program_sync_lock\.lease_until <= \?/);
  assert.match(sheets, /DELETE FROM program_sync_lock WHERE key=\? AND owner=\?/);
  assert.doesNotMatch(sheets, /let cachedProgram/);
  assert.doesNotMatch(sheets, /let pendingProgram/);
});

test("el cache no puede ser sobrescrito por una lectura mas vieja", () => {
  assert.match(sheets, /WHERE excluded\.fetched_at >= program_cache\.fetched_at/);
});

test("los dispositivos seguidores consultan solo D1 hasta recibir la version nueva", () => {
  assert.match(page, /if\(mode==="automatic"&&payload\.source\?\.syncing\)/);
  assert.match(page, /"\/api\/program\?stored=1"/);
  assert.match(page, /storedPayload\.source\.fetchedAt!==firstFetchedAt/);
});

test("la sincronizacion automatica tiene tiempo suficiente para que Google termine", () => {
  assert.match(page, /mode==="stored"\?5_000:35_000/);
  assert.doesNotMatch(page, /mode==="automatic"\|\|mode==="stored"\?5_000/);
});
