import test from "node:test"; import assert from "node:assert/strict";
import type { ProgramRecord } from "../lib/program-data.ts";
import { diffProgram } from "../lib/program-diff.ts";
const base: ProgramRecord = { id:"a",weekId:"w",weekLabel:"W",weekStatus:"actual",sourceSheet:"S",sourceRow:1,section:"",line:"linea-1",action:"FRACCIONAR",dateLabel:"",pin:"",productCode:"P",brand:"V",variety:"M",vintage:"2025",capacity:"",closure:"",liters:"",client:"",country:"",cases:"",unitsPerCase:"",bottles:100,notes:"",materials:{bottle:"",closure:"",capsuleOrCap:"",case:"",frontLabel:"",backLabel:""} };
test("detecta altas, bajas y modificaciones",()=>{ const result=diffProgram([base,{...base,id:"b"}],[{...base,bottles:120},{...base,id:"c"}]); assert.deepEqual(result,{added:1,removed:1,modified:1,total:3,changedIds:["a","c"],changedWeekIds:[base.weekId]}); });
test("detecta cuando una operación se tacha como realizada",()=>{const result=diffProgram([base],[{...base,completed:true}]);assert.equal(result.modified,1);assert.deepEqual(result.changedIds,["a"]);});
