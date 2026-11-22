// Notifications deliberately omit task details on a shared device's lock screen.
interface ExtendableEvent {waitUntil(work:Promise<unknown>):void}
declare const self:{
  addEventListener(type:"push",listener:(e:ExtendableEvent)=>void):void;
  addEventListener(type:"notificationclick",listener:(e:ExtendableEvent & {notification:{close():void}})=>void):void;
  registration: {showNotification(title:string, options:NotificationOptions):Promise<void>};
  clients:{openWindow(path:string):Promise<unknown>};
};
self.addEventListener("push",event=>{
  event.waitUntil(self.registration.showNotification("FocusPocus",{body:"A reminder is due."}));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/app/"));
});
export {};
