import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { stockItems } from "../../../db/schema";
import { readStockSnapshot } from "../../../lib/stock-read";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await readStockSnapshot();
    return Response.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo leer el stock.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
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
    if (!materialCode || !materialName || !Number.isFinite(quantity) || quantity < 0)
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
