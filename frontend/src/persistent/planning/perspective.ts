export const operators = ["all","any","none"] as const;
export type Operator = (typeof operators)[number];
type Bounds = Record<string, number | string>;
export type Value = string | boolean | Bounds;
export type Predicate = {field:string; value:Value};
export type Expression = Predicate | {all:Expression[]} | {any:Expression[]} | {none:Expression[]};
export interface Definition {
  version:1; expression:Expression; scopeIds:string[]; groupBy:string; sortBy:string; direction:"asc"|"desc"; presentation:"list"|"outline";
}
export interface Perspective { id:string;name:string;favorite:boolean;icon:string;version:number;definition:Definition }
export interface Catalog { personalVersion:number;focusIds:string[];perspectives:Perspective[] }
export interface SaveBody { id:string;name:string;favorite:boolean;icon:string;definition:Definition }
export type PersonalChange = {action:"save";payload:SaveBody}|{action:"delete";payload:{id:string}}|{action:"focus";payload:{ids:string[]}};
export const fieldLabels: Record<string,string> = { availability:"Availability",status:"Status",kind:"Item kind",flagged:"Flagged",tag:"Tag",contains:"Inside",inbox:"In Inbox",singleAction:"Single-action project",repeating:"Repeating",duration:"Duration",defer:"Defer date",planned:"Planned date",due:"Due date",text:"Text" };
export const enumValues:Record<string,string[]> = {availability:["remaining","available","first-available","blocked"],status:["active","held","completed","dropped"],kind:["action","group","project","folder"]};
export const groupNames:Record<string,string> = {none:"None",project:"Project",tag:"Tag",status:"Status",due:"Due day"};
export const sortNames:Record<string,string> = {manual:"Manual order",title:"Title",due:"Due date",planned:"Planned date",defer:"Defer date",changed:"Last changed",duration:"Duration"};
export const icons = ["list","star","flag","folder","calendar","tag","check","clock","search","layers"];
export function newDefinition():Definition {
  return {version:1,expression:{all:[{field:"availability",value:"remaining"}]},scopeIds:[],groupBy:"none",sortBy:"manual",direction:"asc",presentation:"list"};
}
export function childrenOf(node:Expression):[Operator,Expression[]] | null {
  if ("field" in node) return null;
  if ("all" in node) return ["all",node.all];
  if ("any" in node) return ["any",node.any];
  return ["none",node.none];
}
export function group(operator:Operator,children:Expression[]):Expression {
  if(operator==="any")return {any:children};
  if(operator==="none")return {none:children};
  return {all:children};
}
export function defaultValue(field:string,tags:string[],containers:string[]):Value {
  if(enumValues[field])return enumValues[field][0];
  if(field==="tag")return tags[0]??"";
  if(field==="contains")return containers[0]??"";
  if(field==="text")return "";
  if(field==="duration")return {min:0};
  return true;
}
export function toggleId(list:string[], id:string) {return list.includes(id)?list.filter((value)=>value!==id):[...list,id]}
