import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("prints the shortage report through an embedded document instead of about:blank", () => {
  const start = source.indexOf("const printShortageReport");
  const end = source.indexOf("const saveStock", start);
  const block = source.slice(start, end);

  assert.ok(start >= 0, "printShortageReport must exist");
  assert.match(block, /document\.createElement\("iframe"\)/);
  assert.match(block, /printFrame\.srcdoc=buildShortageReportHtml/);
  assert.match(block, /printWindow\.print\(\)/);
  assert.doesNotMatch(block, /window\.open\(/);
});
