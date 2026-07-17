import type { ProgramRecord } from "./program-data";

export function diffProgram(previous: ProgramRecord[], next: ProgramRecord[]) {
  const before = new Map(previous.map((record) => [record.id, signature(record)]));
  const after = new Map(next.map((record) => [record.id, signature(record)]));
  let added = 0; let removed = 0; let modified = 0;
  for (const [id, value] of after) { if (!before.has(id)) added += 1; else if (before.get(id) !== value) modified += 1; }
  for (const id of before.keys()) if (!after.has(id)) removed += 1;
  return { added, removed, modified, total: added + removed + modified };
}

function signature(record: ProgramRecord) {
  return JSON.stringify([record.weekId, record.line, record.action, record.pin, record.productCode, record.brand, record.variety, record.vintage, record.bottles, record.client, record.country, record.materials]);
}
