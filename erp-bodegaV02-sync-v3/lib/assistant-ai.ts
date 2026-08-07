import type { GeneralAssistantContext } from "./assistant";

export type AssistantHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export function sanitizeAssistantHistory(
  history: unknown,
  maxMessages = 12,
): AssistantHistoryMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" as const : "user" as const,
      content: String(item.content ?? "").trim().slice(0, 2000),
    }))
    .filter((item) => item.content)
    .slice(-maxMessages);
}

export function assistantModelCandidates(configured?: string) {
  const values = [configured?.trim(), "gpt-5.2", "gpt-5.1", "gpt-5"]
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

export function assistantInstructions() {
  return [
    "Sos un asistente general integrado dentro de un ERP industrial de insumos para una bodega.",
    "Respondé en español argentino salvo que el usuario pida otro idioma.",
    "IMPORTANTE: respondé también preguntas que no tengan relación con el ERP. No rechaces una consulta solamente por estar fuera de tema.",
    "Para preguntas generales podés usar tu conocimiento general. Para información actual, reciente o que pueda haber cambiado, usá búsqueda web cuando esté disponible.",
    "Cuando la pregunta sea sobre el ERP, tratá el CONTEXTO DEL ERP como fuente de verdad para cantidades, stock, faltantes, semanas, sincronización y estado del cálculo. No inventes valores que no estén en ese contexto.",
    "Las filas tachadas en Google Sheets son operaciones realizadas y están excluidas de consumos y faltantes.",
    "Si el usuario pregunta algo ambiguo, respondé con la interpretación más útil y pedí aclaración solo si es realmente necesaria.",
    "Mantené las respuestas claras y prácticas. Podés extenderte cuando la pregunta lo requiera.",
  ].join(" ");
}

export function buildAssistantInput(
  question: string,
  context: GeneralAssistantContext | undefined,
  history: AssistantHistoryMessage[],
) {
  const input: Array<{ role: "developer" | "user" | "assistant"; content: string }> = [];
  if (context) {
    input.push({
      role: "developer",
      content: `CONTEXTO DEL ERP (datos operativos actuales; usalos solo cuando sean relevantes):\n${JSON.stringify(context)}`,
    });
  }
  input.push(...history);
  input.push({ role: "user", content: question });
  return input;
}
