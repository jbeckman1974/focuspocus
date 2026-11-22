import workerUrl from "./notification-worker.ts?worker&url";
import { browserDevice } from "../preferences/device.ts";
import { useAction, useResource } from "./hooks.ts";
import type { WorkspaceClient } from "./transport.ts";

async function activeWorker(reg:ServiceWorkerRegistration){
  if(reg.active)return;
  const worker=reg.installing ?? reg.waiting;
  if(!worker)throw new Error("The notification worker is unavailable.");
  await new Promise<void>((resolve,reject)=>{
    const finish=(error?:Error)=>{window.clearTimeout(timer);worker.removeEventListener("statechange",change);if(error)reject(error);else resolve();};
    const change=()=>{if(worker.state==="activated")finish();else if(worker.state==="redundant")finish(new Error("The notification worker could not activate."));};
    const timer=window.setTimeout(()=>finish(new Error("The browser did not activate notifications in time.")),15000);
    worker.addEventListener("statechange",change);change();
  });
}
export function DeviceNotifications({client,publicKey}:{client:WorkspaceClient;publicKey:string|null}){
  const path="integrations/devices/"+browserDevice();
  const device=useResource<{enabled:boolean}>(client,path),action=useAction();
  const supported=window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const enabled=device.data?.enabled===true;
  async function enroll(){
    if(!publicKey||!supported)return;
    const consent=await Notification.requestPermission();
    if(consent!=="granted")throw new Error("Browser notifications are unavailable. Reminders remain in your list.");
    const key=Uint8Array.from(atob(publicKey.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));
    const reg=await navigator.serviceWorker.register(workerUrl,{type:"module"});
    await activeWorker(reg);
    client.signal.throwIfAborted();
    const subscription=await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    device.setData(await client.post<{enabled:boolean}>(path,{endpoint:subscription.endpoint}));
  }
  return <fieldset><legend>Notifications on this browser</legend>
    {enabled?<button disabled={action.busy} onClick={()=>void action.run(async()=>{device.setData(await client.post<{enabled:boolean}>(path,{endpoint:null}));})}>Disable notifications for this workspace</button>:
      (supported && publicKey?<button disabled={action.busy||!device.data} onClick={()=>void action.run(enroll)}>Enable browser notifications</button>:<p>{!supported?"This browser cannot receive push notifications.":"The operator has not configured push delivery."} Reminders are available here.</p>)}
    {(device.error||action.error) && <p role="alert">{device.error||action.error}</p>}
  </fieldset>;
}
