import type { Snapshot } from "../api.ts";
import { childrenOf, defaultValue, enumValues, fieldLabels, group, operators } from "./perspective.ts";
import type { Expression, Operator, Predicate, Value } from "./perspective.ts";

function Leaf({node, snapshot, change}: {node:Predicate;snapshot:Snapshot;change:(node:Expression)=>void}) {
  const {field,value}=node;
  const tags=snapshot.tags;
  const containers=[...(snapshot.folders??[]),...snapshot.projects,...snapshot.tasks.filter((t)=>t.kind==="group")];
  const set=(value:Value)=>change({field,value});
  const options=enumValues[field];
  const isDate=["defer","planned","due"].includes(field);
  const isRange=field==="duration" || isDate&&typeof value==="object";
  return <div className="planning-controls">
    <label>Property <select aria-label="Rule property" value={field} onChange={(e)=>change({field:e.target.value,value:defaultValue(e.target.value,tags.map((t)=>t.id),containers.map((c)=>c.id))})}>
      {Object.entries(fieldLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select></label>
    {options && <select aria-label="Rule value" value={String(value)} onChange={(e)=>set(e.target.value)}>{options.map((option)=><option key={option}>{option}</option>)}</select>}
    {(field==="tag"||field==="contains") && <select aria-label="Rule value" value={String(value)} onChange={(e)=>set(e.target.value)}>
      <option value="">Choose…</option>{(field==="tag"?tags:containers).map((entry)=><option key={entry.id} value={entry.id}>{entry.title}</option>)}
    </select>}
    {field==="text" && <input aria-label="Rule text" maxLength={255} required value={String(value)} onChange={(e)=>set(e.target.value)}/>}
    {typeof value==="boolean" && !isDate && <select aria-label="Rule value" value={String(value)} onChange={(e)=>set(e.target.value==="true")}><option value="true">Yes</option><option value="false">No</option></select>}
    {isDate && <select aria-label="Date condition" value={typeof value==="boolean"?String(value):"range"} onChange={(e)=>set(e.target.value==="range"?{}:e.target.value==="true")}><option value="true">Has date</option><option value="false">No date</option><option value="range">In range</option></select>}
    {isRange && typeof value==="object" && (field==="duration"?["min","max"]:["from","through"]).map((key)=><label key={key}>{key} <input aria-label={fieldLabels[field]+" "+key} type={isDate?"date":"number"} min={isDate?undefined:0} value={value[key]??""} onChange={(e)=>{const next={...value};if(e.target.value==="")delete next[key];else next[key]=isDate?e.target.value:Number(e.target.value);set(next)}}/></label>)}
  </div>;
}

export function RuleEditor({node, snapshot, change, depth=0}: {node:Expression;snapshot:Snapshot;change:(node:Expression)=>void;depth?:number}) {
  if("field" in node)return <Leaf node={node} snapshot={snapshot} change={change}/>;
  const [operator,children]=childrenOf(node)!;
  return <fieldset className="planning-rule"><legend>Rule group</legend>
    <label>Match <select aria-label="Match rules" value={operator} onChange={(e)=>change(group(e.target.value as Operator,children))}>{operators.map((op)=><option value={op} key={op}>{op}</option>)}</select></label>
    {children.map((child,index)=><div className="planning-child" key={index}>
      <RuleEditor node={child} change={(updated)=>change(group(operator,children.map((old,i)=>i===index?updated:old)))} snapshot={snapshot} depth={depth+1}/>
      <button type="button" aria-label={`Remove rule ${index+1}`} onClick={()=>change(group(operator,children.filter((_,i)=>i!==index)))}>Remove</button>
    </div>)}
    {depth<8 && <div className="planning-actions"><button type="button" onClick={()=>change(group(operator,[...children,{field:"flagged",value:true}]))}>Add rule</button>
      {depth<7 && <button type="button" onClick={()=>change(group(operator,[...children,{any:[]}]))}>Add rule group</button>}</div>}
  </fieldset>;
}
