type ShellRequest = Pick<Request, "method" | "url" | "headers" | "mode">;

export function shellPath(
  request: ShellRequest,
  origin: string,
  resources: Record<string, string>,
) {
  if (
    request.method !== "GET" ||
    request.headers.has("authorization") ||
    request.headers.has("range") ||
    request.headers.has("x-focuspocus-actor")
  )
    return null;
  const url = new URL(request.url);
  if (
    url.origin !== origin ||
    url.search ||
    !Object.hasOwn(resources, url.pathname)
  )
    return null;
  if (url.pathname === "/app/" && request.mode !== "navigate") return null;
  return url.href;
}

export function publicRequests(
  origin: string,
  resources: Record<string, string>,
) {
  return Object.entries(resources).map(
    ([path, integrity]) =>
      new Request(new URL(path, origin), {
        mode: "same-origin",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        integrity,
      }),
  );
}
