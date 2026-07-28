import "server-only";
import { asc } from "drizzle-orm";
import { getDb } from "../db";
import {
  bomItems,
  bomSubstitutes,
  products,
  stockDepotItems,
  stockItems,
} from "../db/schema";
import { readSettings } from "./app-settings";
import {
  type AssistantSnapshot,
} from "./assistant-fallback";
import { readLastStoredProgram } from "./google-sheets";
import { readRecentProgramChanges } from "./program-changes";
import { readRuntimeEnv } from "./runtime-env";
import { buildEffectiveBoms, calculateRequirements } from "./requirements";
import { readStockSyncStatus } from "./stock-store";

export async function buildAssistantSnapshot(currentView?: string) {
  const [stored, db, settings, changes, stockStatus, runtime] =
    await Promise.all([
      readLastStoredProgram(),
      getDb(),
      readSettings(),
      readRecentProgramChanges(5),
      readStockSyncStatus(),
      readRuntimeEnv(["ERP_STOCK_URL", "ERP_STOCK_SYNC_MINUTES"]),
    ]);
  const [productRows, itemRows, substituteRows, stockRows, depotRows] =
    await Promise.all([
      db.select().from(products).orderBy(asc(products.code)),
      db.select().from(bomItems),
      db.select().from(bomSubstitutes),
      db.select().from(stockItems),
      db.select().from(stockDepotItems),
    ]);

  const records = stored?.weeks.flatMap((week) => week.records) ?? [];
  const substitutesByItem = new Map<number, string[]>();
  for (const substitute of substituteRows) {
    const values = substitutesByItem.get(substitute.bomItemId) ?? [];
    values.push(substitute.materialCode);
    substitutesByItem.set(substitute.bomItemId, values);
  }
  const itemsByProduct = new Map<
    number,
    Array<(typeof itemRows)[number] & { substitutes: string[] }>
  >();
  for (const item of itemRows) {
    const values = itemsByProduct.get(item.productId) ?? [];
    values.push({
      ...item,
      substitutes: substitutesByItem.get(item.id) ?? [],
    });
    itemsByProduct.set(item.productId, values);
  }
  const effective = buildEffectiveBoms(
    records,
    productRows.map((product) => ({
      productCode: product.code,
      items: itemsByProduct.get(product.id) ?? [],
    })),
  );
  const calculated = calculateRequirements(records, effective.boms);
  const stockByMaterial = new Map(
    stockRows.map((item) => [item.materialCode, item.quantity]),
  );
  const shortages = calculated.requirements
    .map((item) => ({
      ...item,
      shortage: Math.max(
        0,
        item.total - (stockByMaterial.get(item.materialCode) ?? 0),
      ),
    }))
    .filter((item) => item.shortage > 0);
  const categories = new Map<string, { items: number; units: number }>();
  for (const item of shortages) {
    const current = categories.get(item.category) ?? { items: 0, units: 0 };
    current.items += 1;
    current.units += item.shortage;
    categories.set(item.category, current);
  }

  const weekMap = new Map<
    string,
    { id: string; label: string; operations: number; bottles: number }
  >();
  for (const record of records) {
    const current = weekMap.get(record.weekId) ?? {
      id: record.weekId,
      label: record.weekLabel,
      operations: 0,
      bottles: 0,
    };
    current.operations += 1;
    current.bottles += record.bottles;
    weekMap.set(record.weekId, current);
  }

  return {
    today: new Intl.DateTimeFormat("es-AR", {
      dateStyle: "full",
      timeZone: "America/Argentina/Mendoza",
    }).format(new Date()),
    currentView,
    program: {
      title: stored?.title ?? "Programación",
      fetchedAt: stored?.fetchedAt ?? null,
      weeks: [...weekMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
      operations: records.length,
    },
    changes: changes.map((change) => ({
      detectedAt: change.detectedAt,
      added: change.added,
      modified: change.modified,
      removed: change.removed,
      examples: [
        ...change.addedRecords.map(
          (item) => `Agregado ${item.productCode || item.productName}`,
        ),
        ...change.modifiedRecords.map(
          (item) => `Modificado ${item.productCode || item.productName}`,
        ),
        ...change.removedRecords.map(
          (item) => `Eliminado ${item.productCode || item.productName}`,
        ),
      ].slice(0, 10),
    })),
    stock: {
      items: stockRows.length,
      updatedAt: stockStatus.updatedAt,
      ageMinutes: stockStatus.ageMinutes,
      depots: [...new Set(depotRows.map((row) => row.depot))].sort(),
      source: stockStatus.latestRun?.source ?? null,
    },
    bom: {
      products: productRows.length,
      items: itemRows.length,
      mappedOperations: calculated.mappedOperations,
      blockedOperations: calculated.blockedOperations,
    },
    purchases: {
      itemCount: shortages.length,
      totalUnits: shortages.reduce((sum, item) => sum + item.shortage, 0),
      topCategories: [...categories.entries()]
        .map(([category, values]) => ({ category, ...values }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 6),
    },
    sync: {
      programSeconds: settings.syncIntervalSeconds,
      cacheSeconds: settings.cacheSeconds,
      erpStockConfigured: Boolean(runtime.ERP_STOCK_URL),
      erpStockMinutes: stockSyncMinutes(runtime.ERP_STOCK_SYNC_MINUTES),
    },
  } satisfies AssistantSnapshot;
}

function stockSyncMinutes(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(5, Math.min(24 * 60, Math.trunc(parsed)))
    : 15;
}
