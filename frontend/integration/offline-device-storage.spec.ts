import { expect, test } from "@playwright/test";
import { signIn } from "./account.ts";

const database = "focuspocus-trusted-device";

test("a failed offline enrollment reports the storage error and leaves the workspace online", async ({page})=>{
  await signIn(page,"planner");
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey) {
      if(this.name==="workspaces") throw new DOMException("Offline disk quota reached.","QuotaExceededError");
      return key===undefined ? original.call(this,value) : original.call(this,value,key);
    };
  });
  const control=page.getByRole("button",{name:"Enable offline editing on this device"});
  await control.click();
  await expect(page.getByRole("alert")).toContainText("quota");
  await expect(control).toBeEnabled();
  await expect(page.getByText("Offline editing enabled on this device.",{exact:true})).toHaveCount(0);
  const count=await page.evaluate(name=>new Promise<number>((resolve,reject)=>{
    const opening=indexedDB.open(name);
    opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{
      const db=opening.result;
      const rows=db.transaction("workspaces").objectStore("workspaces").count();
      rows.onsuccess=()=>{db.close();resolve(rows.result);};
      rows.onerror=()=>reject(rows.error);
    };
  }),database);
  expect(count).toBe(0);
  await expect(page.getByRole("textbox",{name:"Task titles"})).toBeEnabled();
});

test("a stale enrollment cannot repopulate storage after another tab signs out",async({page,context})=>{
  await signIn(page,"planner");
  const other=await context.newPage();
  await other.goto("/app/");
  const enable=other.getByRole("button",{name:"Enable offline editing on this device"});
  await expect(enable).toBeEnabled();

  // Pause the real service worker registration just before the enrollment's
  // database write. The old click resumes with its original device epoch.
  await other.evaluate(()=>{
    const worker=navigator.serviceWorker;
    const register=worker.register.bind(worker);
    worker.register=async (...args)=>{
      const registered=await register(...args);
      document.documentElement.dataset.trustPending="yes";
      await new Promise<void>(resolve=>window.addEventListener("resume-trust",()=>resolve(),{once:true}));
      const transact=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(...params){
        const transaction=transact.apply(this,params);
        if(params[1]==="readwrite"){
          IDBDatabase.prototype.transaction=transact;
          transaction.addEventListener("abort",()=>{document.documentElement.dataset.staleTrust="refused";},{once:true});
          transaction.addEventListener("complete",()=>{document.documentElement.dataset.staleTrust="committed";},{once:true});
        }
        return transaction;
      };
      return registered;
    };
  });
  await enable.click();
  await expect(other.locator("html")).toHaveAttribute("data-trust-pending","yes");
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(other.getByRole("button",{name:"Sign in",exact:true})).toBeVisible();
  await other.evaluate(()=>window.dispatchEvent(new Event("resume-trust")));
  await expect(other.locator("html")).toHaveAttribute("data-stale-trust","refused");
  await context.setOffline(true);
  await other.reload();
  await expect(other.getByRole("textbox",{name:"Task titles"})).toHaveCount(0);
  await expect(other.getByRole("button",{name:"Retry connection"})).toBeVisible();
});
