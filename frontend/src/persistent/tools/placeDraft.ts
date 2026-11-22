export interface Coordinates { latitude:number; longitude:number; radiusMeters:number }
export interface PlaceDraft {tagId:string; version:number; latitude:string; longitude:string; radius:string}
export interface SavedPlace extends Coordinates {tagId:string;title:string;version:number;itemIds:string[]}
export interface Places {revision:number;places:SavedPlace[]}

export function editPlace(tagId:string,version:number,place?:SavedPlace):PlaceDraft {
  return {tagId,version,latitude:place ? String(place.latitude):"", longitude:place ? String(place.longitude):"", radius:String(place?.radiusMeters??250)};
}
export function placeChange(draft:PlaceDraft,remove:boolean,context:string,operationId:string){
  const head={tagId:draft.tagId,expectedVersion:draft.version,context,operationId};
  return remove ? {...head,remove:true} : {...head,latitude:Number(draft.latitude),longitude:Number(draft.longitude),radiusMeters:Number(draft.radius)};
}
