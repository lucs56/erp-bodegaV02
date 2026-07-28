import { sessionUser } from "../../../../lib/auth";
import { readRuntimeEnv } from "../../../../lib/runtime-env";
import {
  parseModelJson,
  type TechnicalSheetAnalysis,
} from "../../../../lib/technical-sheet";

export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active)
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    if (
      user.role !== "admin" &&
      !String(user.permissions ?? "")
        .split(",")
        .includes("bom")
    )
      return Response.json(
        { error: "El usuario no tiene permiso para administrar BOM." },
        { status: 403 },
      );

    const payload = (await request.json()) as {
      fileName?: string;
      fileData?: string;
    };
    const fileName =
      String(payload.fileName ?? "ficha-tecnica.pdf").trim() ||
      "ficha-tecnica.pdf";
    const fileData = normalizePdfData(String(payload.fileData ?? ""));
    if (!fileData)
      return Response.json(
        { error: "Seleccioná un archivo PDF válido." },
        { status: 400 },
      );
    if (estimatedBytes(fileData) > MAX_PDF_BYTES)
      return Response.json(
        { error: "La ficha técnica no puede superar 15 MB." },
        { status: 413 },
      );

    const runtime = await readRuntimeEnv(["OPENAI_API_KEY", "OPENAI_MODEL"]);
    if (!runtime.OPENAI_API_KEY)
      return Response.json(
        {
          error:
            "El lector de PDF necesita el secreto OPENAI_API_KEY en Cloudflare. La edición manual de BOM continúa disponible.",
        },
        { status: 503 },
      );

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: runtime.OPENAI_MODEL?.trim() || "gpt-5.6",
        max_output_tokens: 2_500,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "Analizá fichas técnicas industriales de fraccionamiento y vestido de vinos.",
                  "Devolvé exclusivamente un objeto JSON válido, sin Markdown.",
                  "No inventes códigos, descripciones ni cantidades ausentes.",
                  "El consumo debe quedar expresado por botella o unidad producida; convertí únicamente cuando el documento permita hacerlo sin ambigüedad.",
                  "Clasificá la operación como FRACCIONAR, VESTIR o ENCAJONAR.",
                  "Clasificá cada insumo como Botellas, Tapones, Tapas, Cápsulas, Etiquetas, Cajas, Separadores, Corchos u Otros.",
                  "Si un dato falta o es dudoso, dejalo vacío y agregá una advertencia concreta.",
                  'Formato: {"productCode":"","productName":"","confidence":0.0,"warnings":[],"items":[{"materialCode":"","materialName":"","category":"Otros","quantity":1,"unit":"unidad","action":"FRACCIONAR","substitutes":[],"sourcePage":1}]}',
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename: fileName,
                file_data: fileData,
                detail: "high",
              },
              {
                type: "input_text",
                text: "Extraé el producto y todos los insumos de esta ficha técnica para preparar un borrador de BOM que será revisado por una persona.",
              },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok)
      throw new Error(`El servicio de lectura respondió ${response.status}.`);
    const body = (await response.json()) as unknown;
    const output = responseText(body);
    if (!output) throw new Error("No se recibió contenido reconocible.");
    const analysis = parseModelJson(output);
    return Response.json({
      analysis: analysis satisfies TechnicalSheetAnalysis,
      model: runtime.OPENAI_MODEL?.trim() || "gpt-5.6",
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo analizar la ficha técnica.",
      },
      { status: 500 },
    );
  }
}

function normalizePdfData(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:application/pdf;base64,")) return trimmed;
  if (!trimmed || !/^[a-zA-Z0-9+/=\s]+$/.test(trimmed)) return "";
  return `data:application/pdf;base64,${trimmed.replace(/\s/g, "")}`;
}

function estimatedBytes(value: string) {
  const encoded = value.slice(value.indexOf(",") + 1).replace(/\s/g, "");
  return Math.floor((encoded.length * 3) / 4);
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
