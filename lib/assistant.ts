export type GeneralAssistantShortage = {
  materialCode: string;
  materialName: string;
  category: string;
  unit: string;
  required: number;
  available: number;
  shortage: number;
  weeks: string[];
};

export type GeneralAssistantMaterial = {
  materialCode: string;
  materialName: string;
  category: string;
  unit: string;
  required: number;
  available: number;
  shortage: number;
  depots: Record<string, number>;
  weeks: string[];
  products: string[];
  inCurrentProgram: boolean;
  inStock: boolean;
  inTechnicalSheet: boolean;
};

export type GeneralAssistantContext = {
  now: string;
  synchronized: boolean;
  fetchedAt: string;
  operations: number;
  weeks: number;
  completedOperations: number;
  mappedOperations: number;
  blockedOperations: number;
  shortages: number;
  stockItems: number;
  shortageItems?: GeneralAssistantShortage[];
  materialQuery?: string;
  materialMatches?: GeneralAssistantMaterial[];
  calculation?: {
    running: boolean;
    phase: string;
    lastCalculatedAt: string;
    sourceMessage: string;
  };
  changes: {
    added: number;
    modified: number;
    removed: number;
    detectedAt: string;
  };
};

const CATEGORY_QUERIES = [
  {
    question: /TAPON|CIERRE|CORCHO|SCREW/,
    item: /TAPON|CIERRE|CORCHO|SCREW/,
    label: "tapones o cierres",
  },
  { question: /BOTELLA/, item: /BOTELLA/, label: "botellas" },
  { question: /CAPSULA/, item: /CAPSULA/, label: "cápsulas" },
  { question: /ETIQUETA/, item: /ETIQUETA/, label: "etiquetas" },
  { question: /CAJA|CARTON/, item: /CAJA|CARTON/, label: "cajas" },
  { question: /SEPARADOR/, item: /SEPARADOR/, label: "separadores" },
];

export function generalAssistantFallback(
  question: string,
  context: GeneralAssistantContext,
) {
  const term = normalize(question);
  if (/^(HOLA|BUEN DIA|BUENAS|BUENOS DIAS)\b/.test(term))
    return "¡Hola! Puedo explicarte el estado general, la sincronización, los cambios del programa, los faltantes por tipo y para qué sirve cada módulo.";

  if (/RESUMEN/.test(term))
    return `Hoy es ${context.now}. La programación contiene ${context.operations} operaciones en ${context.weeks} semanas; ${context.completedOperations} ya están realizadas. ${context.synchronized ? "La sincronización está activa" : "Se está usando la última lectura validada"} y el último cálculo registra ${context.shortages} faltantes.`;

  if (/\b(FECHA|DIA ES HOY|QUE DIA|HOY)\b/.test(term))
    return `Hoy es ${context.now}.`;

  if (/SINCRON|ACTUALIZ|GOOGLE|SHEET|PLANILLA/.test(term))
    return context.synchronized
      ? `Sí, la sincronización está funcionando. La última lectura válida fue ${context.fetchedAt}; mientras la aplicación está abierta, vuelve a consultar Google Sheets automáticamente cada 30 segundos. También podés usar “Actualizar ahora”.`
      : `Ahora se está usando la última lectura validada, del ${context.fetchedAt}. No se borraron los datos: el sistema vuelve a intentar automáticamente y también podés usar “Actualizar ahora”.`;

  if (/CAMBIO|AGREG|MODIFIC|ELIMIN/.test(term)) {
    const total =
      context.changes.added +
      context.changes.modified +
      context.changes.removed;
    return total
      ? `El último cambio detectado tiene ${context.changes.added} operaciones agregadas, ${context.changes.modified} modificadas y ${context.changes.removed} eliminadas. Podés abrir el aviso del Resumen para ver solamente esas filas.`
      : "No hay cambios pendientes de revisar desde la última lectura comparada.";
  }

  if (context.materialQuery) return materialAnswer(context);

  if (/FALTANT|FALTAR|COMPRA|COMPRAR/.test(term))
    return shortageAnswer(term, context);

  if (/CALCUL|COMPARANDO|RECALCUL/.test(term)) {
    if (context.calculation?.running)
      return `Sí, está trabajando: ${context.calculation.phase}`;
    if (context.calculation?.lastCalculatedAt)
      return `El último cálculo terminó ${context.calculation.lastCalculatedAt}. Comparó ${context.mappedOperations} operaciones con ficha técnica contra ${context.stockItems} registros de stock y detectó ${context.shortages} faltantes. ${context.calculation.sourceMessage}`;
    return "El cálculo todavía no terminó por primera vez. En Consumos o Faltantes podés usar “Actualizar y recalcular” para actualizar las fuentes y comparar la necesidad contra el stock.";
  }

  if (/ERROR|FALLA|PROBLEMA|ESTADO|ANDA|FUNCIONA/.test(term))
    return context.blockedOperations
      ? `El sistema conserva la última información válida. Hay ${context.blockedOperations} operaciones bloqueadas porque todavía no pueden relacionarse con una ficha técnica. Revisalas en Consumos o Ficha técnica.`
      : `Los módulos principales están operativos. La programación tiene ${context.operations} operaciones, ${context.stockItems} registros de stock y ${context.shortages} faltantes calculados.`;

  if (/STOCK|EXISTENCIA|DEPOSITO/.test(term))
    return `El último stock válido contiene ${context.stockItems} insumos. En Stock podés ver el total y su distribución por depósito; Faltantes compara ese stock contra la necesidad del programa vigente.`;

  if (/FICHA|TECNICA|MATERIAL/.test(term))
    return "Ficha técnica relaciona cada producto con sus botellas, cierres, cápsulas, cajas y etiquetas, indicando el consumo por botella o por caja. Es la base para calcular Consumos y Faltantes.";

  if (/MODULO|COMO FUNCIONA|PARA QUE SIRVE|AYUDA|QUE HACE/.test(term))
    return "El flujo general es: Programación lee Google Sheets; Ficha técnica define los insumos de cada producto; Stock carga las existencias por depósito; Consumos calcula la demanda; Faltantes compara la demanda contra el stock y avisa qué insumos no alcanzan.";

  if (/PROGRAMA|PRODUCCION|OPERACION|SEMANA/.test(term))
    return `La lectura actual contiene ${context.operations} operaciones en ${context.weeks} semanas. ${context.completedOperations} están marcadas como realizadas y se excluyen de consumos y faltantes.`;

  return "Puedo responder sobre sincronización, cambios del programa, estado del cálculo, fichas técnicas, stock y faltantes. También podés escribirme directamente un código de insumo para consultar su necesidad, stock y faltante.";
}

function materialAnswer(context: GeneralAssistantContext) {
  const matches = context.materialMatches ?? [];
  if (!matches.length)
    return context.stockItems || context.mappedOperations
      ? `No encontré el código ${context.materialQuery} en el stock, las fichas técnicas ni las necesidades del programa actual. Revisá que esté escrito exactamente como aparece en el ERP.`
      : `Todavía se están cargando los datos del ERP y no pude buscar el código ${context.materialQuery}. Esperá a que termine la sincronización o usá “Actualizar y recalcular” y volvé a consultarlo.`;

  const item = matches[0];
  const identity = `${item.materialCode} corresponde a ${item.materialName || "un insumo sin descripción"}${item.category ? ` (${item.category})` : ""}.`;
  const program = item.inCurrentProgram
    ? `El programa vigente necesita ${formatQuantity(item.required)} ${item.unit}.`
    : "No tiene consumo calculado en el programa vigente.";
  const stock = item.inStock
    ? `El stock disponible es ${formatQuantity(item.available)} ${item.unit}${depotSummary(item.depots)}.`
    : "No figura con stock disponible cargado.";
  const balance = item.shortage > 0
    ? `Faltan ${formatQuantity(item.shortage)} ${item.unit}.`
    : item.inCurrentProgram
      ? `El stock cubre la necesidad y deja un saldo estimado de ${formatQuantity(Math.max(0, item.available - item.required))} ${item.unit}.`
      : "";
  const use =
    item.products.length || item.weeks.length
      ? `${item.products.length ? `Se usa en ${summarizeNames(item.products)}.` : ""}${item.weeks.length ? ` Semanas: ${item.weeks.join(", ")}.` : ""}`
      : item.inTechnicalSheet
        ? "Está incluido en al menos una ficha técnica, aunque hoy no tenga consumo."
        : "";

  return `Según el último cálculo válido: ${identity} ${program} ${stock} ${balance} ${use}`
    .replace(/\s+/g, " ")
    .trim();
}

function depotSummary(depots: Record<string, number>) {
  const labels: Record<string, string> = {
    "13": "13 (Producción)",
    "2": "2 (Depósito 2)",
    C18: "C18 (Calidad)",
    R18: "R18",
    "2OB": "2OB",
  };
  const values = Object.entries(depots)
    .filter(([, quantity]) => Number(quantity) !== 0)
    .sort(([left], [right]) => left.localeCompare(right, "es"))
    .map(([depot, quantity]) => {
      const key = depot.trim().toUpperCase();
      return `${labels[key] ?? depot}: ${formatQuantity(quantity)}`;
    });
  return values.length ? ` (${values.join(" · ")})` : "";
}

function summarizeNames(values: string[]) {
  const unique = [...new Set(values)].filter(Boolean);
  const visible = unique.slice(0, 4);
  return unique.length > visible.length
    ? `${visible.join(", ")} y ${unique.length - visible.length} más`
    : visible.join(", ");
}

function shortageAnswer(term: string, context: GeneralAssistantContext) {
  const allItems = [...(context.shortageItems ?? [])].sort(
    (left, right) => right.shortage - left.shortage,
  );
  const category = CATEGORY_QUERIES.find((candidate) =>
    candidate.question.test(term),
  );

  if (category) {
    const matches = allItems.filter((item) =>
      category.item.test(
        normalize(`${item.category} ${item.materialName} ${item.materialCode}`),
      ),
    );
    if (matches.length)
      return `Faltan ${matches.length} ${category.label}: ${summarizeShortages(matches)} Abrí Faltantes para ver el detalle por semana y depósito.`;
    if (context.shortageItems)
      return `No hay ${category.label} con faltante en el último cálculo válido.`;
  }

  if (!context.shortages)
    return "Con el programa, las fichas técnicas y el stock cargados no hay faltantes calculados en este momento.";

  if (allItems.length)
    return `Hay ${context.shortages} insumos con faltante. Los principales son: ${summarizeShortages(allItems)} Las operaciones tachadas como realizadas no están incluidas.`;

  return `Hay ${context.shortages} insumos con faltante. Abrí Faltantes para revisar el origen, la semana y el stock disponible. Las operaciones tachadas como realizadas no están incluidas.`;
}

function summarizeShortages(items: GeneralAssistantShortage[]) {
  const visible = items.slice(0, 5);
  const summary = visible
    .map(
      (item) =>
        `${item.materialName || item.materialCode} (${item.materialCode}): faltan ${formatQuantity(item.shortage)} ${item.unit}`,
    )
    .join("; ");
  return items.length > visible.length
    ? `${summary}; y ${items.length - visible.length} más.`
    : `${summary}.`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 3,
  }).format(value);
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
