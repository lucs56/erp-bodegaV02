import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantInstructions,
  assistantModelCandidates,
  buildAssistantInput,
  sanitizeAssistantHistory,
} from "../lib/assistant-ai.ts";

test("el asistente no queda restringido al ERP", () => {
  const instructions = assistantInstructions();
  assert.match(instructions, /preguntas que no tengan relación con el ERP/i);
  assert.match(instructions, /búsqueda web/i);
});

test("conserva historial corto para conversaciones generales", () => {
  const history = sanitizeAssistantHistory([
    { role: "user", content: "Me llamo Lucas" },
    { role: "assistant", content: "Mucho gusto" },
    { role: "user", content: "¿Cómo me llamo?" },
  ]);
  assert.deepEqual(history.map((item) => item.role), ["user", "assistant", "user"]);
  assert.equal(history[0]?.content, "Me llamo Lucas");
});

test("usa modelos compatibles como respaldo", () => {
  assert.deepEqual(
    assistantModelCandidates("gpt-5.6-sol"),
    ["gpt-5.6-sol", "gpt-5.2", "gpt-5.1", "gpt-5"],
  );
});

test("agrega contexto ERP sin reemplazar la pregunta general", () => {
  const input = buildAssistantInput(
    "¿Quién pintó La noche estrellada?",
    undefined,
    [{ role: "assistant", content: "Preguntame lo que quieras" }],
  );
  assert.equal(input.at(-1)?.role, "user");
  assert.match(input.at(-1)?.content ?? "", /La noche estrellada/);
});
