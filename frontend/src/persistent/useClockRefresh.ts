import { useEffect } from "react";

export function useClockRefresh(boundary: string | null | undefined, refresh: () => Promise<void>) {
  useEffect(()=>{
    if (!boundary) return;
    const remaining=Date.parse(boundary)-Date.now();
    if(!Number.isFinite(remaining)) return;
    const timer = window.setTimeout(refresh, Math.max(200,Math.min(2147483647,remaining)));
    return ()=>window.clearTimeout(timer);
  },[boundary,refresh]);
  useEffect(()=>{
    const zoneDay=()=>Intl.DateTimeFormat().resolvedOptions().timeZone+" "+new Date().toDateString();
    let last=zoneDay();
    const check=()=>{
      const current=zoneDay();
      if(current!==last){last=current;void refresh();}
    };
    const timer=window.setInterval(check,60000);
    window.addEventListener("focus",check);
    return ()=>{window.clearInterval(timer);window.removeEventListener("focus",check);};
  },[refresh]);
}
