import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { bomItems, bomSubstitutes, products, stockDepotItems,stockItems } from "../../../db/schema";
import { readLastStoredProgram, readLiveProgram } from "../../../lib/google-sheets";
import { programRecords } from "../../../lib/program-data";
import { buildEffectiveBoms, calculateRequirements } from "../../../lib/requirements";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stored, db] = await Promise.all([readLastStoredProgram(), getDb()]);
    const live = stored ?? (await readLiveProgram());
    const [productRows, itemRows, substituteRows, stock, depotRows] =
      await Promise.all([
        db.select().from(products).orderBy(asc(products.code)),
        db.select().from(bomItems),
        db
          .select()
          .from(bomSubstitutes)
          .orderBy(asc(bomSubstitutes.priority)),
        db.select().from(stockItems),
        db.select().from(stockDepotItems),
      ]);
    const records = live ? live.weeks.flatMap((week) => week.records) : programRecords;

    // Se crean índices una sola vez. La versión anterior volvía a recorrer
    // todas las BOM, sustitutos, existencias y depósitos por cada resultado.
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

    const stockByMaterial = new Map(
      stock.map((item) => [item.materialCode, item.quantity]),
    );
    const depotsByMaterial = new Map<string, Record<string, number>>();
    for (const row of depotRows) {
      const depots = depotsByMaterial.get(row.materialCode) ?? {};
      depots[row.depot] = row.quantity;
      depotsByMaterial.set(row.materialCode, depots);
    }

    const approvedBoms = productRows.map((product) => ({
      productCode: product.code,
      items: itemsByProduct.get(product.id) ?? [],
    }));
    const effective = buildEffectiveBoms(records, approvedBoms);
    const calculated = calculateRequirements(records, effective.boms);
    const shortages = calculated.requirements
      .map((item) => {
        const available = stockByMaterial.get(item.materialCode) ?? 0;
        return {
          ...item,
          available,
          depots: depotsByMaterial.get(item.materialCode) ?? {},
          shortage: Math.max(0, item.total - available),
        };
      })
      .filter((item) => item.shortage > 0);

    return Response.json({
      source: { live: Boolean(live), fetchedAt: live?.fetchedAt },
      ...calculated,
      ...effective,
      stockItems: stock.length,
      shortages,
      purchases: shortages,
    });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo calcular el consumo." }, { status: 500 }); }
}
