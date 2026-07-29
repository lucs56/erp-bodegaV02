import type { ProgramRecord } from "./program-data";

export type DetailedProgramDiff = {
  added: number;
  modified: number;
  removed: number;
  total: number;
  addedRecords: ProgramRecord[];
  modifiedRecords: ProgramRecord[];
  removedRecords: ProgramRecord[];
};

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

export function diffProgramDetailed(previous: ProgramRecord[], next: ProgramRecord[]): DetailedProgramDiff {
  const beforeRecords = new Map(previous.map((record) => [record.id, record]));
  const afterRecords = new Map(next.map((record) => [record.id, record]));
  const before = new Map(previous.map((record) => [record.id, signature(record)]));
  const after = new Map(next.map((record) => [record.id, signature(record)]));

  const addedRecords: ProgramRecord[] = [];
  const modifiedRecords: ProgramRecord[] = [];
  const removedRecords: ProgramRecord[] = [];
  let added = 0; let removed = 0; let modified = 0;

  for (const [id, value] of after) {
    const current = afterRecords.get(id);
    if (!before.has(id)) {
      added += 1;
      if (current) addedRecords.push(current);
    } else if (before.get(id) !== value) {
      modified += 1;
      if (current) modifiedRecords.push(current);
    }
  }

  for (const id of before.keys()) {
    if (!after.has(id)) {
      removed += 1;
      const current = beforeRecords.get(id);
      if (current) removedRecords.push(current);
    }
  }

  return {
    added,
    modified,
    removed,
    total: added + removed + modified,
    addedRecords,
    modifiedRecords,
    removedRecords,
  };
}

function signature(record: ProgramRecord) {
  return JSON.stringify([record.weekId, record.line, record.action, record.pin, record.productCode, record.brand, record.variety, record.vintage, record.bottles, record.client, record.country, record.completed, record.materials]);
}
