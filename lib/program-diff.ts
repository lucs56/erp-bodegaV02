import type { ProgramRecord } from "./program-data";

export function diffProgram(previous: ProgramRecord[], next: ProgramRecord[]) {
  const beforeRecords = new Map(previous.map((record) => [record.id, record]));
  const afterRecords = new Map(next.map((record) => [record.id, record]));
  const before = new Map(previous.map((record) => [record.id, signature(record)]));
  const after = new Map(next.map((record) => [record.id, signature(record)]));
  let added = 0; let removed = 0; let modified = 0;
  const changedIds:string[]=[]; const changedWeekIds=new Set<string>();
  for (const [id, value] of after) {
    if (!before.has(id)) { added += 1; changedIds.push(id); changedWeekIds.add(afterRecords.get(id)!.weekId); }
    else if (before.get(id) !== value) { modified += 1; changedIds.push(id); changedWeekIds.add(afterRecords.get(id)!.weekId); }
  }
  for (const id of before.keys()) if (!after.has(id)) { removed += 1; changedWeekIds.add(beforeRecords.get(id)!.weekId); }
  return { added, removed, modified, total: added + removed + modified, changedIds, changedWeekIds:[...changedWeekIds] };
}

function signature(record: ProgramRecord) {
  return JSON.stringify([record.weekId, record.line, record.action, record.pin, record.productCode, record.brand, record.variety, record.vintage, record.bottles, record.client, record.country, record.materials]);
}

export type ProgramChangeDetail = {
  id: string;
  weekId: string;
  weekLabel: string;
  action: ProgramRecord["action"];
  productCode: string;
  productName: string;
  bottles: number;
  line: string;
};

export type DetailedProgramDiff = ReturnType<typeof diffProgram> & {
  addedRecords: ProgramChangeDetail[];
  modifiedRecords: ProgramChangeDetail[];
  removedRecords: ProgramChangeDetail[];
};

/**
 * Conserva el resumen liviano utilizado por la interfaz y agrega una muestra
 * legible de los registros afectados para el historial compartido y el
 * asistente. Se limita cada grupo para no convertir D1 en un archivo de log.
 */
export function diffProgramDetailed(
  previous: ProgramRecord[],
  next: ProgramRecord[],
  detailLimit = 40,
): DetailedProgramDiff {
  const summary = diffProgram(previous, next);
  const before = new Map(previous.map((record) => [record.id, record]));
  const after = new Map(next.map((record) => [record.id, record]));
  const addedRecords: ProgramChangeDetail[] = [];
  const modifiedRecords: ProgramChangeDetail[] = [];
  const removedRecords: ProgramChangeDetail[] = [];

  for (const record of next) {
    const prior = before.get(record.id);
    if (!prior) {
      if (addedRecords.length < detailLimit) addedRecords.push(changeDetail(record));
    } else if (signature(prior) !== signature(record)) {
      if (modifiedRecords.length < detailLimit)
        modifiedRecords.push(changeDetail(record));
    }
  }
  for (const record of previous) {
    if (!after.has(record.id) && removedRecords.length < detailLimit)
      removedRecords.push(changeDetail(record));
  }

  return { ...summary, addedRecords, modifiedRecords, removedRecords };
}

function changeDetail(record: ProgramRecord): ProgramChangeDetail {
  return {
    id: record.id,
    weekId: record.weekId,
    weekLabel: record.weekLabel,
    action: record.action,
    productCode: record.productCode,
    productName: [record.brand, record.variety, record.vintage]
      .filter(Boolean)
      .join(" "),
    bottles: record.bottles,
    line: record.line,
  };
}
