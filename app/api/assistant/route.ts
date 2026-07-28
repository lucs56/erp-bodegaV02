import { buildAssistantSnapshot } from "../../../lib/assistant-context";
import { generalAssistantAnswer } from "../../../lib/assistant-fallback";
import { sessionUser } from "../../../lib/auth";
import { readRuntimeEnv } from "../../../lib/runtime-env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await sessionUser(request);
  if (!user?.active)
    return Response.json({ error: "Sesión requerida." }, { status: 401 });
  const runtime = await readRuntimeEnv(["OPENAI_API_KEY", "OPENAI_MODEL"]);
  return Response.json({
    configured: Boolean(runtime.OPENAI_API_KEY),
    model: runtime.OPENAI_API_KEY
      ? runtime.OPENAI_MODEL?.trim() || "gpt-5.6"
      : null,
  });
}

export async function POST(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active)
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    const payload = (await request.json()) as {
      question?: string;
      currentView?: string;
    };
    const question = String(payload.question ?? "").trim().slice(0, 1_500);
    if (!question)
      return Response.json(
        { error: "Escribí una pregunta sobre la aplicación." },
        { status: 400 },
      );
    const snapshot = await buildAssistantSnapshot(payload.currentView);
    const guided = generalAssistantAnswer(question, snapshot);
    const runtime = await readRuntimeEnv(["OPENAI_API_KEY", "OPENAI_MODEL"]);
    if (!runtime.OPENAI_API_KEY)
      return Response.json({
        answer: guided,
        mode: "guided",
        notice:
          "Asistente guiado activo. Configurá OPENAI_API_KEY para habilitar respuestas generativas.",
      });

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: runtime.OPENAI_MODEL?.trim() || "gpt-5.6",
          max_output_tokens: 650,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: [
                    "Sos el asistente general del ERP de Insumos para Bodega.",
                    "Respondé en español argentino, con tono humano, claro y breve.",
                    "Tu alcance es explicar el funcionamiento general de la aplicación, su estado operativo, los cambios de programación, las alertas, los módulos y los próximos pasos.",
                    "No hagas búsquedas puntuales de un código o insumo: indicá qué módulo y filtro debe usar la persona para ese detalle.",
                    "No inventes datos ni afirmes que ejecutaste cambios. Usá exclusivamente la instantánea JSON suministrada.",
                    "Si falta una integración, explicá qué alternativa operativa continúa disponible.",
                    "Ante un error, diferenciá datos incompletos, configuración ausente y falla temporal.",
                  ].join("\n"),
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Pregunta: ${question}\n\nEstado actual de la aplicación:\n${JSON.stringify(snapshot)}`,
                },
              ],
            },
          ],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(`OpenAI respondió ${response.status}.`);
      const body = (await response.json()) as unknown;
      const answer = responseText(body);
      if (!answer) throw new Error("OpenAI no devolvió texto.");
      return Response.json({ answer, mode: "ai" });
    } catch {
      return Response.json({
        answer: guided,
        mode: "guided",
        notice:
          "La IA no respondió en este momento; se usó el diagnóstico local del ERP.",
      });
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo consultar el asistente.",
      },
      { status: 500 },
    );
  }
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{ type?: string; text?: unknown }>;
    }>;
  };
  if (typeof response.output_text === "string")
    return response.output_text.trim();
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => String(item.text).trim())
    .filter(Boolean)
    .join("\n");
}
