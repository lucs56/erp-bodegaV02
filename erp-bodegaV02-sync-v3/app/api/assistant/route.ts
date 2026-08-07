import {
  generalAssistantFallback,
  type GeneralAssistantContext,
} from "../../../lib/assistant";
import {
  assistantInstructions,
  assistantModelCandidates,
  buildAssistantInput,
  sanitizeAssistantHistory,
} from "../../../lib/assistant-ai";

export const dynamic = "force-dynamic";

type OpenAIResponsePayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string; code?: string };
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      question?: string;
      context?: GeneralAssistantContext;
      history?: unknown;
    };
    const question = String(body.question ?? "").trim().slice(0, 2000);
    if (!question)
      return Response.json({ error: "La consulta está incompleta." }, { status: 400 });

    const fallback = body.context
      ? generalAssistantFallback(question, body.context)
      : "La consulta no pudo procesarse con el contexto local.";

    // Una consulta puntual por código de insumo se responde siempre con los
    // datos determinísticos del ERP para no inventar cantidades ni depósitos.
    if (body.context?.materialQuery)
      return Response.json({ answer: fallback, mode: "erp-data" });

    const runtime = await runtimeVariables();
    if (!runtime.OPENAI_API_KEY) {
      return Response.json({
        answer: isClearlyErpFallback(fallback)
          ? fallback
          : "La IA general todavía no está conectada en Cloudflare. Configurá el secreto OPENAI_API_KEY para que pueda responder preguntas de cualquier tema. Las consultas operativas del ERP siguen funcionando localmente.",
        mode: "local-no-ai",
      });
    }

    const history = sanitizeAssistantHistory(body.history);
    const input = buildAssistantInput(question, body.context, history);
    const models = assistantModelCandidates(runtime.OPENAI_MODEL);

    for (const model of models) {
      try {
        const result = await requestOpenAI({
          apiKey: runtime.OPENAI_API_KEY,
          model,
          input,
        });
        if (result.answer) {
          return Response.json({
            answer: result.answer,
            mode: "ai-general",
            model,
          });
        }
        if (result.stopTrying) break;
      } catch {
        // Si una variante de modelo no está disponible, probamos la siguiente.
      }
    }

    return Response.json({
      answer: isClearlyErpFallback(fallback)
        ? fallback
        : "No pude obtener respuesta de la IA general en este momento. Probá nuevamente en unos segundos. Las consultas del ERP continúan disponibles.",
      mode: "local-ai-error",
    });
  } catch {
    return Response.json({ error: "No se pudo procesar la consulta." }, { status: 400 });
  }
}

async function requestOpenAI({
  apiKey,
  model,
  input,
}: {
  apiKey: string;
  model: string;
  input: Array<{ role: "developer" | "user" | "assistant"; content: string }>;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: assistantInstructions(),
      input,
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      max_output_tokens: 900,
    }),
  });

  const payload = await response.json().catch(() => ({})) as OpenAIResponsePayload;
  if (!response.ok) {
    // 401/403 indican clave/permisos: cambiar de modelo no lo arregla.
    const stopTrying = response.status === 401 || response.status === 403;
    return { answer: "", stopTrying, status: response.status };
  }

  const answer =
    payload.output_text?.trim() ||
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text" && item.text)
      ?.text?.trim() ||
    "";
  return { answer, stopTrying: false, status: response.status };
}

function isClearlyErpFallback(answer: string) {
  return !/IA general|cualquier tema/i.test(answer);
}

async function runtimeVariables() {
  const values: Record<string, string | undefined> = {
    OPENAI_API_KEY:
      typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined,
    OPENAI_MODEL:
      typeof process !== "undefined" ? process.env.OPENAI_MODEL : undefined,
  };
  try {
    const workers = await import("cloudflare:workers");
    const workerEnv = workers.env as unknown as Record<string, unknown>;
    for (const name of Object.keys(values))
      if (!values[name] && typeof workerEnv[name] === "string")
        values[name] = workerEnv[name] as string;
  } catch {
    // La validación local no expone el entorno de Cloudflare.
  }
  return values;
}
