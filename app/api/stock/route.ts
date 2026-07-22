import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { stockDepotItems, stockItems } from "../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const [items, depotRows] = await Promise.all([
      db
        .select()
        .from(stockItems)
        .orderBy(asc(stockItems.category), asc(stockItems.materialCode)),
      db.select().from(stockDepotItems).orderBy(asc(stockDepotItems.depot)),
    ]);

    // Antes se filtraban todos los depósitos una vez por cada insumo. Con
    // archivos grandes eso generaba millones de comparaciones y Error 1102.
    const depotsByMaterial = new Map<string, Record<string, number>>();
    for (const row of depotRows) {
      const depots = depotsByMaterial.get(row.materialCode) ?? {};
      depots[row.depot] = row.quantity;
      depotsByMaterial.set(row.materialCode, depots);
    }

    return Response.json({
      items: items.map((item) => ({
        ...item,
        depots: depotsByMaterial.get(item.materialCode) ?? {},
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "No se pudo leer el stock.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      materialCode?: string;
      materialName?: string;
      category?: string;
      quantity?: number;
      unit?: string;
    };
    const materialCode = payload.materialCode?.trim();
    const materialName = payload.materialName?.trim();
    const quantity = Number(payload.quantity);
    if (
      !materialCode ||
      !materialName ||
      !Number.isFinite(quantity) ||
      quantity < 0
    )
      return Response.json(
        { error: "Código, descripción y cantidad válida son obligatorios." },
        { status: 400 },
      );

    const db = await getDb();
    const old = await db
      .select()
      .from(stockItems)
      .where(eq(stockItems.materialCode, materialCode))
      .limit(1);
    const values = {
      materialCode,
      materialName,
      category: payload.category?.trim() || "Otros",
      quantity,
      unit: payload.unit?.trim() || "unidad",
      updatedAt: new Date().toISOString(),
    };
    if (old.length)
      await db
        .update(stockItems)
        .set(values)
        .where(eq(stockItems.id, old[0].id));
    else await db.insert(stockItems).values(values);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el stock.",
      },
      { status: 500 },
    );
  }
}
