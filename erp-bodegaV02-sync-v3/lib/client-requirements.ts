import type { ProgramRecord } from "./program-data.ts";
import {
  buildEffectiveBoms,
  calculateRequirements,
  type BomDefinition,
  type MaterialRequirement,
} from "./requirements.ts";

export type ClientBomProduct = {
  code: string;
  items: BomDefinition["items"];
};

export type ClientStockItem = {
  materialCode: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
  depots: Record<string, number>;
};

export type LineTransferMap = Record<string, number>;

export type ClientGroupedRequirement = MaterialRequirement & {
  groupKey: string;
  stockCodes: string[];
};

export type ClientShortageRequirement = ClientGroupedRequirement & {
  originalTotal: number;
  pendingNeed: number;
  available: number;
  transferred: number;
  effectiveAvailable: number;
  depots: Record<string, number>;
  stockBreakdown: Array<{
    materialCode: string;
    materialName: string;
    quantity: number;
    depots: Record<string, number>;
  }>;
  weeklyShortages: Array<{
    weekId: string;
    weekLabel: string;
    quantity: number;
    transferred: number;
    pendingQuantity: number;
    covered: number;
    shortage: number;
    remainingAvailable: number;
  }>;
  shortage: number;
};

function stockKey(value: string) {
  return value.trim().toLocaleUpperCase("es");
}

function uniqueByKey(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = stockKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitCompositeCode(
  value: string,
  stockByCode: Map<string, ClientStockItem>,
) {
  const raw = value.trim();
  if (!raw) return [];
  const exact = stockByCode.get(stockKey(raw));
  if (exact) return [exact.materialCode];

  const pieces = raw
    .split(/[-+/,|]/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  if (pieces.length < 2) return [raw];
  const matches = pieces.map((piece) => stockByCode.get(stockKey(piece)));
  if (matches.every(Boolean)) {
    return matches.map((match) => match!.materialCode);
  }
  return [raw];
}

export function compatibleStockCodes(
  item: Pick<MaterialRequirement, "materialCode" | "substitutes">,
  stockItems: ClientStockItem[],
) {
  const stockByCode = new Map(
    stockItems.map((stockItem) => [stockKey(stockItem.materialCode), stockItem]),
  );
  return uniqueByKey([
    ...splitCompositeCode(item.materialCode, stockByCode),
    ...item.substitutes.flatMap((code) => splitCompositeCode(code, stockByCode)),
  ]);
}

function intersects(left: Set<string>, right: Set<string>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function mergeWeeks(
  target: MaterialRequirement["weeks"],
  source: MaterialRequirement["weeks"],
) {
  for (const week of source) {
    const current = target.find((candidate) => candidate.weekId === week.weekId);
    if (current) current.quantity += week.quantity;
    else target.push({ ...week });
  }
}

function mergeProducts(
  target: MaterialRequirement["products"],
  source: MaterialRequirement["products"],
) {
  for (const product of source) {
    const current = target.find(
      (candidate) => candidate.productCode === product.productCode,
    );
    if (current) current.quantity += product.quantity;
    else target.push({ ...product });
  }
}

function groupRequirements(
  requirements: MaterialRequirement[],
  stockItems: ClientStockItem[],
): ClientGroupedRequirement[] {
  type WorkingGroup = {
    codes: Set<string>;
    codeLabels: Map<string, string>;
    requirements: MaterialRequirement[];
  };
  const groups: WorkingGroup[] = [];

  for (const requirement of requirements) {
    const codes = compatibleStockCodes(requirement, stockItems);
    const normalized = new Set(codes.map(stockKey));
    const matchingIndexes = groups
      .map((group, index) => (intersects(group.codes, normalized) ? index : -1))
      .filter((index) => index >= 0);

    if (!matchingIndexes.length) {
      groups.push({
        codes: normalized,
        codeLabels: new Map(codes.map((code) => [stockKey(code), code])),
        requirements: [requirement],
      });
      continue;
    }

    const firstIndex = matchingIndexes[0];
    const target = groups[firstIndex];
    for (const code of codes) {
      const key = stockKey(code);
      target.codes.add(key);
      if (!target.codeLabels.has(key)) target.codeLabels.set(key, code);
    }
    target.requirements.push(requirement);

    for (const index of matchingIndexes.slice(1).sort((a, b) => b - a)) {
      const merged = groups[index];
      for (const code of merged.codes) target.codes.add(code);
      for (const [key, label] of merged.codeLabels) {
        if (!target.codeLabels.has(key)) target.codeLabels.set(key, label);
      }
      target.requirements.push(...merged.requirements);
      groups.splice(index, 1);
    }
  }

  return groups
    .map((group) => {
      const first = group.requirements[0];
      const weeks: MaterialRequirement["weeks"] = [];
      const products: MaterialRequirement["products"] = [];
      const names = uniqueByKey(
        group.requirements.map((requirement) => requirement.materialName),
      );
      const substitutes = uniqueByKey(
        group.requirements.flatMap((requirement) => requirement.substitutes),
      );
      for (const requirement of group.requirements) {
        mergeWeeks(weeks, requirement.weeks);
        mergeProducts(products, requirement.products);
      }
      weeks.sort((left, right) => left.weekId.localeCompare(right.weekId));
      products.sort((left, right) =>
        left.productCode.localeCompare(right.productCode),
      );
      const stockCodes = [...group.codes]
        .sort((left, right) => left.localeCompare(right))
        .map((key) => group.codeLabels.get(key) ?? key);
      const groupKey = `${stockCodes.map(stockKey).sort().join("::")}|${stockKey(first.unit)}`;
      return {
        materialCode: stockCodes.join("-"),
        materialName: names.join(" / ") || first.materialName,
        category: first.category,
        unit: first.unit,
        total: group.requirements.reduce(
          (sum, requirement) => sum + requirement.total,
          0,
        ),
        substitutes,
        weeks,
        products,
        groupKey,
        stockCodes,
      } satisfies ClientGroupedRequirement;
    })
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.materialCode.localeCompare(right.materialCode),
    );
}

function weeklyShortages(
  weeks: MaterialRequirement["weeks"],
  transferred: number,
  available: number,
) {
  let remainingTransfer = Math.max(0, transferred);
  let remainingAvailable = Math.max(0, available);
  return [...weeks]
    .sort((left, right) => left.weekId.localeCompare(right.weekId))
    .map((week) => {
      const transferredToWeek = Math.min(week.quantity, remainingTransfer);
      const pendingQuantity = Math.max(0, week.quantity - transferredToWeek);
      remainingTransfer = Math.max(0, remainingTransfer - transferredToWeek);
      const covered = Math.min(pendingQuantity, remainingAvailable);
      const shortage = Math.max(0, pendingQuantity - covered);
      remainingAvailable = Math.max(0, remainingAvailable - covered);
      return {
        ...week,
        transferred: transferredToWeek,
        pendingQuantity,
        covered,
        shortage,
        remainingAvailable,
      };
    });
}

/**
 * Calcula consumos y faltantes con los datos que la interfaz ya descargó.
 * Los códigos sustitutos o compuestos comparten stock y se muestran como un
 * único grupo. El material ya trasladado a línea se resta una sola vez de la
 * necesidad y luego el saldo pendiente se compara contra el stock.
 */
export function calculateClientRequirements(
  records: ProgramRecord[],
  bomProducts: ClientBomProduct[],
  stockItems: ClientStockItem[],
  lineTransfers: LineTransferMap = {},
) {
  const approvedBoms: BomDefinition[] = bomProducts.map((product) => ({
    productCode: product.code,
    items: product.items,
  }));
  const effective = buildEffectiveBoms(records, approvedBoms);
  const calculated = calculateRequirements(records, effective.boms);
  const groupedRequirements = groupRequirements(
    calculated.requirements,
    stockItems,
  );
  const stockByCode = new Map(
    stockItems.map((item) => [stockKey(item.materialCode), item]),
  );

  const allCompared: ClientShortageRequirement[] = groupedRequirements.map(
    (item) => {
      const stockBreakdown = item.stockCodes.map((code) => {
        const stockItem = stockByCode.get(stockKey(code));
        return {
          materialCode: stockItem?.materialCode ?? code,
          materialName: stockItem?.materialName ?? item.materialName,
          quantity: Number(stockItem?.quantity) || 0,
          depots: stockItem?.depots ?? {},
        };
      });
      const depots: Record<string, number> = {};
      for (const stockItem of stockBreakdown) {
        for (const [depot, quantity] of Object.entries(stockItem.depots)) {
          depots[depot] = (depots[depot] ?? 0) + Number(quantity || 0);
        }
      }
      const available = stockBreakdown.reduce(
        (sum, stockItem) => sum + stockItem.quantity,
        0,
      );
      const transferred = Math.min(
        item.total,
        Math.max(0, Number(lineTransfers[item.groupKey]) || 0),
      );
      const pendingNeed = Math.max(0, item.total - transferred);
      const effectiveAvailable = available;
      return {
        ...item,
        // Desde este punto `total` representa la necesidad que todavía falta
        // atender. La necesidad original queda guardada por separado para
        // auditoría y para mostrar cómo se obtuvo el valor ajustado.
        total: pendingNeed,
        originalTotal: item.total,
        pendingNeed,
        available,
        transferred,
        effectiveAvailable,
        depots,
        stockBreakdown,
        weeklyShortages: weeklyShortages(item.weeks, transferred, available),
        shortage: Math.max(0, pendingNeed - available),
      };
    },
  );
  const shortages = allCompared.filter((item) => item.shortage > 0);

  return {
    ...calculated,
    ...effective,
    requirements: groupedRequirements,
    comparedRequirements: allCompared,
    stockItems: stockItems.length,
    shortages,
    purchases: shortages,
  };
}
