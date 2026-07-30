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

export type ClientShortageRequirement = MaterialRequirement & {
  available: number;
  depots: Record<string, number>;
  shortage: number;
};

function stockKey(value: string) {
  return value.trim().toLocaleUpperCase("es");
}

/**
 * Calcula consumos y faltantes con los datos que la interfaz ya
 * descargó. Evita volver a consultar D1 y Google Sheets para cada pantalla,
 * que era la operación que podía superar el límite de CPU de Cloudflare.
 */
export function calculateClientRequirements(
  records: ProgramRecord[],
  bomProducts: ClientBomProduct[],
  stockItems: ClientStockItem[],
) {
  const approvedBoms: BomDefinition[] = bomProducts.map((product) => ({
    productCode: product.code,
    items: product.items,
  }));
  const effective = buildEffectiveBoms(records, approvedBoms);
  const calculated = calculateRequirements(records, effective.boms);
  const stockByCode = new Map(
    stockItems.map((item) => [stockKey(item.materialCode), item]),
  );
  const shortages: ClientShortageRequirement[] = calculated.requirements
    .map((item) => {
      const stockItem = stockByCode.get(stockKey(item.materialCode));
      const available = Number(stockItem?.quantity) || 0;
      return {
        ...item,
        available,
        depots: stockItem?.depots ?? {},
        shortage: Math.max(0, item.total - available),
      };
    })
    .filter((item) => item.shortage > 0);

  return {
    ...calculated,
    ...effective,
    stockItems: stockItems.length,
    shortages,
    purchases: shortages,
  };
}
