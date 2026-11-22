import {expect,test} from "@playwright/test";
import {createDestination,signIn} from "./account.ts";
import {createShared,toolsPanel} from "./workspace-tools.ts";

test("AT-18/26 · two tablets reconcile a shared place and keep location optional",async({page,browser})=>{
  test.setTimeout(120000);
  const peer=await browser.newContext({baseURL:"http://127.0.0.1:8000"});
  try {
    const other=await peer.newPage();
    await other.addInitScript(()=>Object.defineProperty(navigator,"geolocation",{value:{
      getCurrentPosition:(_ok:unknown,fail:(e:{code:number})=>void)=>fail({code:1}),
    }}));
    const name="Place concurrency board",tag="Review station";
    await signIn(page,"planner");await createShared(page,name);await createDestination(page,"tag",tag);
    await signIn(other,"planner");
    await other.getByLabel("Active workspace").selectOption({label:name});
    const first=await toolsPanel(page,"Nearby"),second=await toolsPanel(other,"Nearby");
    await second.getByRole("button",{name:"Use current location"}).click();
    await expect(second.getByRole("alert")).toContainText("unavailable or denied");
    for (const pane of [first,second]) {
      await pane.getByLabel("Location tag").selectOption({label:tag});
      await pane.getByLabel("Latitude",{exact:true}).fill("28.20");
      await pane.getByLabel("Longitude",{exact:true}).fill("-82.1");
    }
    await second.getByLabel("Radius in meters").fill("400");
    const created=page.waitForResponse(r=>r.url().endsWith("/integrations/places")&&r.request().method()==="POST");
    await first.getByRole("button",{name:"Save tag location"}).click();expect((await created).status()).toBe(200);
    await expect(second.getByRole("group",{name:"Location changed since editing began"})).toBeVisible({timeout:15000});
    await expect(second.getByLabel("Radius in meters")).toHaveValue("400");
    await expect(second.getByRole("button",{name:"Save tag location"})).toBeDisabled();
    await second.getByRole("button",{name:"Keep my edits against this version"}).click();
    const attempts:{operationId:string;expectedVersion:number}[]=[];
    await other.route(/\/integrations\/places$/,async route=>{
      if(route.request().method()!=="POST")return route.continue();
      attempts.push(route.request().postDataJSON());
      if(attempts.length>1)return route.continue();
      expect((await route.fetch()).status()).toBe(200);await route.abort("connectionreset");
    });
    await second.getByRole("button",{name:"Save tag location"}).click();
    await second.getByRole("button",{name:"Retry same location change"}).click();
    await expect(second.getByRole("button",{name:"Retry same location change"})).toHaveCount(0);
    expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);
    await first.getByRole("button",{name:"Load current location"}).click({timeout:15000});
    await expect(first.getByLabel("Radius in meters")).toHaveValue("400");
    await second.getByLabel("Or choose a saved place").selectOption({label:tag});
    await expect(second.getByText("No available tasks within these radii.")).toBeVisible();
  }finally{await peer.close();}
});
