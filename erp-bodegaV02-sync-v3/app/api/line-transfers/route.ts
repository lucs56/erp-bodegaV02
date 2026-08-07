import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { lineTransfers } from "../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const transfers = await db.select().from(lineTransfers);
    return Response.json(
      { transfers },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudieron leer los traslados a línea.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      materialKey?: string;
      materialCode?: string;
      quantity?: number;
    };
    const materialKey = payload.materialKey?.trim();
    const materialCode = payload.materialCode?.trim();
    const quantity = Number(payload.quantity);
    if (!materialKey || !materialCode || !Number.isFinite(quantity) || quantity < 0) {
      return Response.json(
        { error: "Código, grupo y cantidad válida son obligatorios." },
        { status: 400 },
      );
    }

    const db = await getDb();
    if (quantity === 0) {
      await db.delete(lineTransfers).where(eq(lineTransfers.materialKey, materialKey));
      return Response.json({ ok: true, deleted: true });
    }

    const values = {
      materialKey,
      materialCode,
      quantity,
      updatedAt: new Date().toISOString(),
    };
    await db
      .insert(lineTransfers)
      .values(values)
      .onConflictDoUpdate({
        target: lineTransfers.materialKey,
        set: values,
      });
    return Response.json({ ok: true, transfer: values });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el traslado a línea.",
      },
      { status: 500 },
    );
  }
}
