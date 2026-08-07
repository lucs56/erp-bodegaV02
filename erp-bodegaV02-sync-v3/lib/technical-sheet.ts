export type TechnicalSheetItem = {
  materialCode: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
  action: "FRACCIONAR" | "VESTIR" | "ENCAJONAR";
  substitutes: string[];
  sourcePage: number | null;
};

export type TechnicalSheetAnalysis = {
  productCode: string;
  productName: string;
  confidence: number;
  warnings: string[];
  items: TechnicalSheetItem[];
};

const CATEGORIES = [
  "Botellas",
  "Tapones",
  "Tapas",
  "Cápsulas",
  "Etiquetas",
  "Cajas",
  "Separadores",
  "Corchos",
  "Otros",
] as const;

export function sanitizeTechnicalSheetAnalysis(
  payload: unknown,
): TechnicalSheetAnalysis {
  const object =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const warnings = stringArray(object.warnings);
  const rows = Array.isArray(object.items) ? object.items : [];
  const items = rows
    .filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object"),
    )
    .map((row, index) => {
      const quantity = Number(row.quantity);
      const materialCode = text(row.materialCode);
      const materialName = text(row.materialName);
      if (!materialCode)
        warnings.push(
          `Insumo ${index + 1}: el PDF no informa un código; completalo manualmente.`,
        );
      if (!materialName)
        warnings.push(
          `Insumo ${index + 1}: el PDF no informa una descripción.`,
        );
      if (!Number.isFinite(quantity) || quantity <= 0)
        warnings.push(
          `Insumo ${index + 1}: revisá el consumo porque no se reconoció una cantidad válida.`,
        );
      return {
        materialCode,
        materialName,
        category: category(row.category),
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit: text(row.unit) || "unidad",
        action: action(row.action),
        substitutes: [...new Set(stringArray(row.substitutes))],
        sourcePage:
          Number.isInteger(Number(row.sourcePage)) &&
          Number(row.sourcePage) > 0
            ? Number(row.sourcePage)
            : null,
      };
    })
    .filter((item) => item.materialCode || item.materialName);

  if (!items.length)
    warnings.push(
      "No se reconocieron insumos utilizables. Conservá la carga manual o probá con un PDF más nítido.",
    );
  return {
    productCode: text(object.productCode),
    productName: text(object.productName),
    confidence: Math.max(0, Math.min(1, Number(object.confidence) || 0)),
    warnings: [...new Set(warnings)],
    items,
  };
}

export function parseModelJson(textValue: string) {
  const clean = textValue
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return sanitizeTechnicalSheetAnalysis(JSON.parse(clean) as unknown);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function category(value: unknown) {
  const normalized = normalize(value);
  return (
    CATEGORIES.find((candidate) => normalize(candidate) === normalized) ??
    "Otros"
  );
}

function action(value: unknown): TechnicalSheetItem["action"] {
  const normalized = normalize(value).toUpperCase();
  if (normalized.includes("VEST")) return "VESTIR";
  if (normalized.includes("ENCAJ")) return "ENCAJONAR";
  return "FRACCIONAR";
}

function normalize(value: unknown) {
  return text(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
