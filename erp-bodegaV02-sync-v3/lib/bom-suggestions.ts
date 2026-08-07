import type { ProgramRecord } from "./program-data";

type SuggestedItem={materialCode:string;materialName:string;category:string;quantity:number;unit:string;action:string;substitutes:string[]};
const fields = [
  ["bottle","Botella","Botellas"], ["closure","Tapón / cierre","Tapones"], ["capsuleOrCap","Cápsula / tapa","Cápsulas"],
  ["case","Caja","Cajas"], ["frontLabel","Etiqueta frente","Etiquetas"], ["backLabel","Contraetiqueta","Etiquetas"],
] as const;

export function suggestBomFromProgram(records:ProgramRecord[],productCode:string){
  const productRows=records.filter(row=>row.productCode===productCode);
  const suggestions=new Map<string,SuggestedItem>();
  for(const row of productRows) for(const [field,name,category] of fields){
    const materialCode=row.materials[field]?.trim(); if(!materialCode)continue;
    const quantity=field==="case"&&Number(row.unitsPerCase)>0?1/Number(row.unitsPerCase):1;
    // Para un mismo producto, tipo de insumo y operación, los códigos
    // alternativos se consideran sustitutos. Así 30354/30354A o 31044/31047
    // no generan una necesidad doble: se usa uno u otro y el stock se suma.
    const key=`${field}:${row.action}`;
    const current=suggestions.get(key);
    if(!current){
      suggestions.set(key,{materialCode,materialName:name,category,quantity,unit:"unidad",action:row.action,substitutes:[]});
      continue;
    }
    if(current.materialCode!==materialCode&&!current.substitutes.includes(materialCode))current.substitutes.push(materialCode);
  }
  const populated=productRows.filter(row=>Object.values(row.materials).some(Boolean)).length;
  return {items:[...suggestions.values()],sourceRows:productRows.length,populatedRows:populated,complete:productRows.length>0&&populated===productRows.length};
}
