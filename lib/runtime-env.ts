import "server-only";

export async function readRuntimeEnv(
  names: string[],
): Promise<Record<string, string | undefined>> {
  const values: Record<string, string | undefined> = {};
  for (const name of names)
    values[name] =
      typeof process !== "undefined" ? process.env[name] : undefined;

  try {
    const workers = await import("cloudflare:workers");
    const workerEnv = workers.env as unknown as Record<string, unknown>;
    for (const name of names) {
      if (!values[name] && typeof workerEnv[name] === "string")
        values[name] = workerEnv[name] as string;
    }
  } catch {
    // Las validaciones de Node no exponen el entorno de Cloudflare.
  }
  return values;
}
