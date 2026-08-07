import test from "node:test";import assert from "node:assert/strict";import {suggestBomFromProgram}from"../lib/bom-suggestions.ts";
const base={productCode:"P1",action:"FRACCIONAR",unitsPerCase:"6",materials:{bottle:"B1",closure:"",capsuleOrCap:"T1",case:"C1",frontLabel:"",backLabel:""}} as never;
test("sugiere solo insumos informados y calcula consumo de caja",()=>{const result=suggestBomFromProgram([base],"P1");assert.equal(result.items.length,3);assert.equal(result.items.find(item=>item.materialCode==="C1")?.quantity,1/6);});
test("marca como parcial cuando una operación todavía no tiene insumos",()=>{const empty={...base,materials:{bottle:"",closure:"",capsuleOrCap:"",case:"",frontLabel:"",backLabel:""}} as never;const result=suggestBomFromProgram([base,empty],"P1");assert.equal(result.complete,false);assert.equal(result.populatedRows,1);});

test("convierte códigos alternativos del mismo insumo en sustitutos",()=>{
  const first={...base,id:"1",materials:{...base.materials,capsuleOrCap:"30354"}} as never;
  const second={...base,id:"2",materials:{...base.materials,capsuleOrCap:"30354A"}} as never;
  const result=suggestBomFromProgram([first,second],"P1");
  const capsule=result.items.find(item=>item.category==="Cápsulas");
  assert.equal(capsule?.materialCode,"30354");
  assert.deepEqual(capsule?.substitutes,["30354A"]);
});
