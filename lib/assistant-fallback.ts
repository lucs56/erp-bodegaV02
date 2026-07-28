export type AssistantSnapshot = {
  today: string;
  currentView?: string;
  program: {
    title: string;
    fetchedAt: string | null;
    weeks: Array<{
      id: string;
      label: string;
      operations: number;
      bottles: number;
    }>;
    operations: number;
  };
  changes: Array<{
    detectedAt: string;
    added: number;
    modified: number;
    removed: number;
    examples: string[];
  }>;
  stock: {
    items: number;
    updatedAt: string | null;
    ageMinutes: number | null;
    depots: string[];
    source: string | null;
  };
  bom: {
    products: number;
    items: number;
    mappedOperations: number;
    blockedOperations: number;
  };
  purchases: {
    itemCount: number;
    totalUnits: number;
    topCategories: Array<{ category: string; items: number; units: number }>;
  };
  sync: {
    programSeconds: number;
    cacheSeconds: number;
    erpStockConfigured: boolean;
    erpStockMinutes: number;
  };
};

export function generalAssistantAnswer(
  question: string,
  snapshot: AssistantSnapshot,
) {
  const term = normalize(question);
  const weekText = snapshot.program.weeks.length
    ? snapshot.program.weeks
        .map(
          (week) =>
            `${week.label}: ${week.operations} operaciones y ${formatNumber(week.bottles)} botellas`,
        )
        .join("; ")
    : "todavía no hay semanas cargadas";
  const lastChange = snapshot.changes[0];

  if (/^(hola|buen dia|buenas|buenos dias|hello)\b/.test(term))
    return `¡Hola! Puedo explicarte el estado general, qué cambió en la programación, cómo funciona cada módulo y si existe algún punto que requiera atención. Hoy es ${snapshot.today}.`;

  if (term.includes("fecha") || term.includes("dia es hoy") || term === "hoy")
    return `Hoy es ${snapshot.today}. La última lectura de programación es ${dateText(snapshot.program.fetchedAt)} y el stock fue actualizado ${dateText(snapshot.stock.updatedAt)}.`;

  if (
    term.includes("cambio") ||
    term.includes("agrego") ||
    term.includes("elimino") ||
    term.includes("modifico")
  ) {
    if (!lastChange)
      return "No hay cambios recientes guardados en la programación. Esto significa que la última comparación compartida no detectó altas, modificaciones ni eliminaciones.";
    const examples = lastChange.examples.length
      ? ` Ejemplos: ${lastChange.examples.slice(0, 5).join("; ")}.`
      : "";
    return `El ${dateText(lastChange.detectedAt)} se detectaron ${lastChange.added} altas, ${lastChange.modified} modificaciones y ${lastChange.removed} eliminaciones.${examples} Abrí Programación y usá el aviso de cambios para revisar las filas afectadas.`;
  }

  if (
    term.includes("error") ||
    term.includes("estado") ||
    term.includes("anda") ||
    term.includes("diagnost")
  )
    return `Estado general: ${snapshot.program.operations} operaciones en ${snapshot.program.weeks.length} semanas; ${snapshot.stock.items} insumos con stock; ${snapshot.bom.products} fichas técnicas; ${snapshot.bom.mappedOperations} operaciones calculadas y ${snapshot.bom.blockedOperations} sin BOM completa. ${snapshot.purchases.itemCount} insumos requieren compra. ${
      snapshot.stock.updatedAt
        ? `El stock tiene ${ageText(snapshot.stock.ageMinutes)}.`
        : "Todavía no se cargó una fotografía de stock."
    } Si una pantalla falla, Administración > Diagnóstico muestra qué fuente necesita atención.`;

  if (
    term.includes("como funciona") ||
    term.includes("para que sirve") ||
    term.includes("aplicacion") ||
    term.includes("programa")
  )
    return "La aplicación lee la programación de Google Sheets, relaciona cada producto con su ficha técnica BOM, calcula el consumo por operación, descuenta el stock disponible por depósito y arma Faltantes y Compras. Programación muestra el origen; Productos y BOM valida materiales; Consumos explica la demanda; Stock conserva la fotografía disponible; Faltantes y Compras muestran lo que no alcanza; Administración controla usuarios, configuración y diagnóstico.";

  if (term.includes("stock") || term.includes("existencia"))
    return `Hay ${snapshot.stock.items} insumos cargados y se identifican los depósitos ${snapshot.stock.depots.join(", ") || "sin detalle"}. La última actualización fue ${dateText(snapshot.stock.updatedAt)} (${ageText(snapshot.stock.ageMinutes)}). ${
      snapshot.sync.erpStockConfigured
        ? `La conexión con el ERP está preparada para actualizar como máximo cada ${snapshot.sync.erpStockMinutes} minutos y también puede forzarse desde Stock.`
        : "La actualización automática del ERP todavía no está configurada; seguí usando el reporte Excel desde Stock."
    }`;

  if (
    term.includes("compra") ||
    term.includes("faltante") ||
    term.includes("neces")
  ) {
    if (!snapshot.purchases.itemCount)
      return "Con la programación, las BOM y el stock actualmente cargados no aparecen faltantes. Conviene confirmar que la fotografía de stock esté actualizada antes de cerrar la revisión.";
    const categories = snapshot.purchases.topCategories
      .map(
        (item) =>
          `${item.category}: ${item.items} insumos (${formatNumber(item.units)} unidades)`,
      )
      .join("; ");
    return `Se calculan ${snapshot.purchases.itemCount} insumos con faltante por ${formatNumber(snapshot.purchases.totalUnits)} unidades. Principales grupos: ${categories || "sin categoría"}. Revisá Compras para ver los productos consumidores y la distribución por depósito.`;
  }

  if (term.includes("semana") || term.includes("produccion"))
    return `La programación vigente contiene ${snapshot.program.operations} operaciones. ${weekText}. La lectura se actualiza cada ${snapshot.sync.programSeconds} segundos cuando la pestaña está visible y existe un botón para forzarla.`;

  if (term.includes("ficha") || term.includes("bom") || term.includes("pdf"))
    return `Hay ${snapshot.bom.products} fichas técnicas aprobadas con ${snapshot.bom.items} insumos. Podés cargar un PDF en Productos y BOM; el asistente extrae un borrador, pero nada se guarda hasta que una persona revise códigos, cantidades, operación y sustitutos y presione “Guardar ficha técnica”.`;

  return `Resumen general de hoy: ${snapshot.program.operations} operaciones en ${snapshot.program.weeks.length} semanas, ${snapshot.stock.items} insumos con stock, ${snapshot.bom.products} fichas técnicas y ${snapshot.purchases.itemCount} faltantes de compra. Podés preguntarme “qué cambió”, “estado del sistema”, “cómo funciona la aplicación” o “resumen de hoy”.`;
}

function normalize(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function dateText(value: string | null) {
  if (!value) return "sin fecha registrada";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "sin fecha registrada";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Mendoza",
  }).format(parsed);
}

function ageText(minutes: number | null) {
  if (minutes === null) return "sin antigüedad registrada";
  if (minutes < 60) return `${minutes} minutos de antigüedad`;
  if (minutes < 24 * 60)
    return `${Math.round(minutes / 60)} horas de antigüedad`;
  return `${Math.round(minutes / (24 * 60))} días de antigüedad`;
}
