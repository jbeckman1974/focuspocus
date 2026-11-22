import { useState } from "react";
import { parseMonthDays } from "./repeat.ts";
import type { RepeatRule } from "./repeat.ts";

const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function Weekdays({values,change}: {values: number[];change:(values:number[])=>void}) {
  return <fieldset><legend>Days of the week</legend>
    {days.map((name,day)=><label key={day}><input type="checkbox" checked={values.includes(day)} onChange={event=>change(event.currentTarget.checked ? [...values,day].sort() : values.filter(v=>v!==day))}/>{name}</label>)}
  </fieldset>;
}

export function RepeatPattern({rule,change,invalid}: {rule:RepeatRule;change:(rule:RepeatRule)=>void;invalid:(message:string)=>void}) {
  const [rawDays,setRawDays]=useState((rule.monthDays ?? [1]).join(", "));
  if(rule.unit==="week") return <Weekdays values={rule.weekdays ?? []} change={values=>{
    const next={...rule};if(values.length) next.weekdays=values;else delete next.weekdays;change(next);
  }}/>;
  if(rule.unit!=="month") return null;
  const pattern=rule.ordinal ? "ordinal" : rule.monthDays ? "days" : "anniversary";
  return <fieldset><legend>Monthly pattern</legend>
    <select aria-label="Monthly pattern" value={pattern} onChange={event=>{
      const next={...rule};delete next.monthDays;delete next.ordinal;invalid("");
      if(event.currentTarget.value==="ordinal") next.ordinal={position:1,days:[0]};
      if(event.currentTarget.value==="days"){ next.monthDays=[1];setRawDays("1");}
      change(next);
    }}><option value="anniversary">Same calendar day</option><option value="days">Selected month days</option><option value="ordinal">Weekday position</option></select>
    {pattern==="days" && <label>Month days (1–31, -1 for last)<input value={rawDays} onChange={event=>{
      const raw=event.currentTarget.value;setRawDays(raw);try{change({...rule,monthDays:parseMonthDays(raw)});invalid("");}catch(error){invalid((error as Error).message);}
    }}/></label>}
    {rule.ordinal && <><label>Position<select value={rule.ordinal.position} onChange={event=>change({...rule,ordinal:{position:Number(event.currentTarget.value),days:rule.ordinal!.days}})}>
      {[[1,"First"],[2,"Second"],[3,"Third"],[4,"Fourth"],[5,"Fifth"],[-2,"Second last"],[-1,"Last"]].map(([v,label])=><option key={v} value={v}>{label}</option>)}
    </select></label>
    <Weekdays values={rule.ordinal.days} change={values=>change({...rule,ordinal:{position:rule.ordinal!.position,days:values}})}/></>}
  </fieldset>;
}
