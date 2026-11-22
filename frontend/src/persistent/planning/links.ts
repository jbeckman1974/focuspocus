import type { IconName } from "../../components/frame/Icon.tsx";
import type { PlanningLink } from "../../components/frame/Navigation.tsx";
import type { Catalog } from "./perspective.ts";

const icons: Record<string,IconName>={list:"all",star:"star",flag:"flag",folder:"projects",calendar:"calendar",tag:"tags",check:"complete",clock:"changed",search:"search",layers:"browse"};
export function planningLinks(catalog?:Catalog):PlanningLink[]{
  return [
    {id:"forecast",label:"Forecast",icon:"calendar"},{id:"review",label:"Review",icon:"review"},{id:"perspectives",label:"Perspectives",icon:"search"},
    ...(catalog?.perspectives.filter((entry)=>entry.favorite).map((entry)=>({id:"saved-"+entry.id,label:entry.name,icon:icons[entry.icon]??"all"}))??[])
  ];
}
