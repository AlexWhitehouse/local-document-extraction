import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export type FetchApplication = (request: Request) => Response | Promise<Response>;

export type LocalRuntimeOptions = {
  api: FetchApplication;
  assetsDirectory: string;
};

export async function ensureLocalStateDirectories(stateDirectory: string): Promise<void> {
  await Promise.all([
    "data",
    "data/workspaces",
    "source-files/workspaces",
    "mail",
    "analytics",
  ].map((directory) => mkdir(resolve(stateDirectory, directory), { recursive: true })));
}

export function createLocalRuntimeFetchHandler({
  api,
  assetsDirectory,
}: LocalRuntimeOptions): FetchApplication {
  return async (request) => {
    const url = new URL(request.url);

    if (isApiPath(url.pathname)) {
      return api(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Not found", { status: 404 });
    }

    const assetResponse = await readAssetResponse(assetsDirectory, url.pathname, request.method);
    if (assetResponse) {
      return assetResponse;
    }

    const spaResponse = await readAssetResponse(assetsDirectory, "/index.html", request.method);
    return spaResponse ?? new Response("Frontend build not found", { status: 503 });
  };
}

function isApiPath(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/") || pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

async function readAssetResponse(
  assetsDirectory: string,
  pathname: string,
  method: "GET" | "HEAD",
): Promise<Response | null> {
  const assetPath = resolveAssetPath(assetsDirectory, pathname);
  if (!assetPath) {
    return null;
  }

  const details = await stat(assetPath).catch(() => null);
  if (!details?.isFile()) {
    return null;
  }

  return new Response(method === "HEAD" ? null : await readFile(assetPath), {
    headers: { "content-type": contentTypeFor(assetPath) },
  });
}

function resolveAssetPath(assetsDirectory: string, pathname: string): string | null {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const root = resolve(assetsDirectory);
  const assetPath = resolve(root, decodedPathname.replace(/^\/+/, ""));
  return assetPath.startsWith(`${root}${sep}`) ? assetPath : null;
}

function contentTypeFor(pathname: string): string {
  switch (extname(pathname).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
