import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, request, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

type Interruption = "after-commit" | "partial-upload";

function operationIdentity(req: IncomingMessage) {
  const hash = createHash("sha256");
  for (const key of [
    "x-write-context",
    "x-operation-id",
    "x-file-id",
    "x-file-sha256",
    "x-workspace-revision",
    "x-item-version",
  ])
    hash.update(JSON.stringify([key, req.headers[key] ?? ""]));
  return hash;
}

// Both browser pages and their service worker share this loopback origin.
// The peer browser contacts the real disposable QA server directly.
export async function createOfflineNetwork() {
  let connected = true;
  let backend = "127.0.0.1";
  let watch: RegExp | undefined;
  let interrupt: Interruption | undefined;
  let transmitted = 0;
  const identities: string[] = [];
  const statuses: number[] = [];
  const server = createServer((req, res) => {
    if (!connected) {
      req.socket.destroy();
      return;
    }
    const path = req.url ?? "/";
    const observed = req.method === "POST" && !!watch?.test(path);
    const fault = observed ? interrupt : undefined;
    if (observed) interrupt = undefined;
    const upstream = request({
      host: backend,
      port: 8000,
      path,
      method: req.method,
      headers: req.headers,
    });
    upstream.on("error", () => res.destroy());
    req.on("error", () => upstream.destroy());
    res.on("error", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    upstream.on("response", (reply) => {
      reply.on("error", () => res.destroy());
      if (observed) statuses.push(reply.statusCode ?? 0);
      if (fault === "after-commit") {
        reply.resume();
        reply.on("end", () => {
          connected = false;
          res.destroy();
        });
        return;
      }
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });

    if (fault === "partial-upload") {
      req.once("data", (chunk: Buffer) => {
        const prefix = chunk.subarray(0, 32);
        transmitted = prefix.length;
        identities.push(operationIdentity(req).digest("hex"));
        upstream.write(prefix, () => {
          connected = false;
          upstream.destroy();
          res.destroy();
        });
      });
      return;
    }
    if (observed) {
      const hash = operationIdentity(req);
      // File identity includes the declared content digest. Compare the whole
      // command body for JSON writes, without retaining a signed write token.
      if (!req.headers["x-file-sha256"])
        req.on("data", (data: Buffer) => hash.update(data));
      req.once("end", () => identities.push(hash.digest("hex")));
    }
    req.pipe(upstream);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    origin: "http://127.0.0.1:" + (server.address() as AddressInfo).port,
    online(value: boolean) {
      connected = value;
    },
    openRestoredDatabase() {
      const name = process.env.FOCUSPOCUS_QA_RESTORE_HOST ?? "";
      if (connected || !/^focuspocus-qa-stack-[a-z0-9]+-clone$/.test(name))
        throw new Error(
          "Recovery needs the disconnected profile and its isolated restore service.",
        );
      backend = name;
    },
    interrupt(path: RegExp, disruption: Interruption) {
      watch = path;
      interrupt = disruption;
    },
    wasInterrupted: () => !connected && !interrupt,
    bytesForwarded: () => transmitted,
    identities,
    statuses,
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
