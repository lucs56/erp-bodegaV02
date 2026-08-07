import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const technicalRoute = await readFile(new URL("../app/api/technical-sheets/analyze/route.ts", import.meta.url), "utf8");

test("el chat envia historial y se presenta como asistente general", () => {
  assert.match(page, /history=chatMessages\.slice\(-12\)/);
  assert.match(page, /preguntas de cualquier tema/);
  assert.match(page, /Preguntá lo que quieras/);
});

test("la API habilita respuestas generales y web search", () => {
  assert.match(route, /tools: \[\{ type: "web_search" \}\]/);
  assert.match(route, /assistantModelCandidates/);
  assert.match(route, /max_output_tokens: 900/);
});

test("el ejemplo de entorno no usa el nombre de modelo anterior", () => {
  assert.match(envExample, /OPENAI_MODEL=gpt-5\.2/);
  assert.doesNotMatch(envExample, /gpt-5\.6-sol/);
  assert.doesNotMatch(technicalRoute, /gpt-5\.6/);
  assert.match(technicalRoute, /gpt-5\.2/);
});
