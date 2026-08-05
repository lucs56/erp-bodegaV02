import test from "node:test"; import assert from "node:assert/strict";
import { buildEffectiveBoms, calculateRequirements } from "../lib/requirements.ts";
import { calculateClientRequirements } from "../lib/client-requirements.ts";
const record = { id:"1",weekId:"w1",weekLabel:"Semana 1",sourceSheet:"S",sourceRow:1,line:"linea-1",action:"FRACCIONAR",pin:"",productCode:"P1",brand:"Vino",variety:"Malbec",vintage:"2025",bottles:100,client:"",country:"",materials:{} } as never;
test("calcula consumo por operación y conserva sustitutos",()=>{ const result=calculateRequirements([record],[{productCode:"P1",items:[{materialCode:"T1",materialName:"Tapón",category:"Tapones",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:["T2"]}]}]); assert.equal(result.requirements[0].total,100); assert.deepEqual(result.requirements[0].substitutes,["T2"]); assert.equal(result.mappedOperations,1); });
test("no consume una línea de BOM asignada a otra acción",()=>{ const result=calculateRequirements([record],[{productCode:"P1",items:[{materialCode:"E1",materialName:"Etiqueta",category:"Etiquetas",quantity:1,unit:"unidad",action:"VESTIR",substitutes:[]}]}]); assert.equal(result.requirements.length,0); });
test("crea una BOM provisional desde los insumos del Sheet cuando no hay una aprobada",()=>{const withMaterial={...record,materials:{bottle:"B1",closure:"",capsuleOrCap:"T1",case:"",frontLabel:"",backLabel:""}} as never;const result=buildEffectiveBoms([withMaterial],[]);assert.equal(result.provisionalProducts,1);assert.equal(result.boms[0].items.length,2);});
test("excluye del consumo las operaciones tachadas como realizadas",()=>{const completed={...record,completed:true} as never;const result=calculateRequirements([completed],[{productCode:"P1",items:[{materialCode:"T1",materialName:"Tapón",category:"Tapones",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}]);assert.equal(result.requirements.length,0);assert.equal(result.mappedOperations,0);assert.equal(result.completedOperations,1);});
test("una operación tachada tampoco genera faltantes en el cliente",()=>{const completed={...record,completed:true} as never;const result=calculateClientRequirements([completed],[{code:"P1",items:[{materialCode:"T1",materialName:"Tapón",category:"Tapones",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}],[]);assert.equal(result.requirements.length,0);assert.equal(result.shortages.length,0);assert.equal(result.completedOperations,1);});
test("calcula faltantes en el cliente sin consultar nuevamente D1",()=>{const result=calculateClientRequirements([record],[{code:"P1",items:[{materialCode:"T1",materialName:"Tapón",category:"Tapones",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}],[{materialCode:"t1",materialName:"Tapón",category:"Tapones",quantity:40,unit:"unidad",depots:{"13":25,"2":15}}]);assert.equal(result.requirements[0].total,100);assert.equal(result.shortages[0].available,40);assert.equal(result.shortages[0].shortage,60);assert.deepEqual(result.shortages[0].depots,{"13":25,"2":15});assert.equal(result.stockItems,1);});

test("suma el stock de códigos sustitutos y evita mostrar un falso faltante",()=>{
  const result=calculateClientRequirements(
    [record],
    [{code:"P1",items:[{materialCode:"30354",materialName:"Cápsula / tapa",category:"Cápsulas",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:["30354A"]}]}],
    [
      {materialCode:"30354",materialName:"Cápsula marrón",category:"Cápsulas",quantity:30,unit:"unidad",depots:{"2":20,C18:10}},
      {materialCode:"30354A",materialName:"Cápsula alternativa",category:"Cápsulas",quantity:80,unit:"unidad",depots:{"2":50,C18:30}},
    ],
  );
  assert.equal(result.requirements.length,1);
  assert.equal(result.shortages.length,0);
  assert.deepEqual(result.comparedRequirements[0].stockCodes,["30354","30354A"]);
  assert.equal(result.comparedRequirements[0].available,110);
  assert.deepEqual(result.comparedRequirements[0].depots,{"2":70,C18:40});
});

test("interpreta un código compuesto cuando sus partes existen en stock",()=>{
  const result=calculateClientRequirements(
    [record],
    [{code:"P1",items:[{materialCode:"31044-31047",materialName:"Cápsula / tapa",category:"Cápsulas",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}],
    [
      {materialCode:"31044",materialName:"Cápsula 44",category:"Cápsulas",quantity:20,unit:"unidad",depots:{"2":20}},
      {materialCode:"31047",materialName:"Cápsula 47",category:"Cápsulas",quantity:25,unit:"unidad",depots:{C18:25}},
    ],
  );
  assert.equal(result.shortages[0].available,45);
  assert.equal(result.shortages[0].shortage,55);
  assert.deepEqual(result.shortages[0].stockCodes,["31044","31047"]);
});

test("el traslado a línea reduce el faltante y se asigna cronológicamente por semana",()=>{
  const second={...record,id:"2",weekId:"w2",weekLabel:"Semana 2",bottles:60} as never;
  const base=calculateClientRequirements(
    [record,second],
    [{code:"P1",items:[{materialCode:"B1",materialName:"Botella",category:"Botellas",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}],
    [{materialCode:"B1",materialName:"Botella",category:"Botellas",quantity:80,unit:"unidad",depots:{"2":80}}],
  );
  const key=base.comparedRequirements[0].groupKey;
  const adjusted=calculateClientRequirements(
    [record,second],
    [{code:"P1",items:[{materialCode:"B1",materialName:"Botella",category:"Botellas",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}],
    [{materialCode:"B1",materialName:"Botella",category:"Botellas",quantity:80,unit:"unidad",depots:{"2":80}}],
    {[key]:30},
  );
  assert.equal(adjusted.shortages[0].shortage,50);
  assert.equal(adjusted.shortages[0].transferred,30);
  assert.deepEqual(adjusted.shortages[0].weeklyShortages.map(week=>week.shortage),[0,50]);
});

test("resta el traslado una sola vez de la necesidad antes de calcular el faltante",()=>{
  const largeRecord={...record,bottles:817560} as never;
  const base=calculateClientRequirements(
    [largeRecord],
    [{code:"P1",items:[{materialCode:"31043",materialName:"Cápsula / tapa",category:"Cápsulas",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}],
    [{materialCode:"31043",materialName:"Cápsula / tapa",category:"Cápsulas",quantity:522662,unit:"unidad",depots:{"2":157590,C18:365072}}],
  );
  const key=base.comparedRequirements[0].groupKey;
  const adjusted=calculateClientRequirements(
    [largeRecord],
    [{code:"P1",items:[{materialCode:"31043",materialName:"Cápsula / tapa",category:"Cápsulas",quantity:1,unit:"unidad",action:"FRACCIONAR",substitutes:[]}]}],
    [{materialCode:"31043",materialName:"Cápsula / tapa",category:"Cápsulas",quantity:522662,unit:"unidad",depots:{"2":157590,C18:365072}}],
    {[key]:100000},
  );
  const item=adjusted.comparedRequirements[0];
  assert.equal(item.originalTotal,817560);
  assert.equal(item.transferred,100000);
  assert.equal(item.pendingNeed,717560);
  assert.equal(item.shortage,194898);
  assert.equal(item.weeklyShortages.reduce((sum,week)=>sum+week.pendingQuantity,0),717560);
});
