import { mkdir, realpath, stat } from "node:fs/promises";
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
  let canonicalAssetsDirectory: Promise<string | null> | null = null;
  const getCanonicalAssetsDirectory = () => {
    canonicalAssetsDirectory ??= realpath(assetsDirectory)
      .catch(() => null)
      .then((directory) => {
        if (!directory) canonicalAssetsDirectory = null;
        return directory;
      });
    return canonicalAssetsDirectory;
  };

  return async (request) => {
    const url = new URL(request.url);

    if (isApiPath(url.pathname)) {
      return api(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Not found", { status: 404 });
    }

    const assetsRoot = getCanonicalAssetsDirectory();
    const assetResponse = await readAssetResponse(assetsRoot, url.pathname, request);
    if (assetResponse) {
      return assetResponse;
    }

    const spaResponse = await readAssetResponse(assetsRoot, "/index.html", request);
    return spaResponse ?? new Response("Frontend build not found", { status: 503 });
  };
}

function isApiPath(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/") || pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

async function readAssetResponse(
  canonicalAssetsDirectory: Promise<string | null>,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  const assetsDirectory = await canonicalAssetsDirectory;
  if (!assetsDirectory) {
    return null;
  }

  const assetPath = await resolveAssetPath(assetsDirectory, pathname);
  if (!assetPath) {
    return null;
  }

  const details = await stat(assetPath).catch(() => null);
  if (!details?.isFile()) {
    return null;
  }

  const etag = createWeakEtag(details.size, details.mtimeMs);
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-length": String(details.size),
    "content-type": contentTypeFor(assetPath),
    etag,
    "last-modified": details.mtime.toUTCString(),
    "cache-control": /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.[a-z0-9]+$/.test(pathname)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  if (isNotModified(request.headers, etag, details.mtimeMs)) {
    return new Response(null, { status: 304, headers });
  }

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader && isRangeAllowed(request.headers, etag, details.mtimeMs)
    ? parseByteRange(rangeHeader, details.size)
    : null;
  if (rangeHeader && range?.kind === "invalid") {
    headers.set("content-range", `bytes */${details.size}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }

  const selectedRange = range?.kind === "valid" ? range : null;
  const file = Bun.file(assetPath);
  const body = selectedRange
    ? file.slice(selectedRange.start, selectedRange.end + 1)
    : rangeHeader
      ? file.stream().pipeThrough(new TransformStream())
      : file;
  if (selectedRange) {
    headers.set("content-range", `bytes ${selectedRange.start}-${selectedRange.end}/${details.size}`);
    headers.set("content-length", String(selectedRange.end - selectedRange.start + 1));
  }
  return new Response(request.method === "HEAD" ? null : body, {
    status: selectedRange ? 206 : 200,
    headers,
  });
}

async function resolveAssetPath(assetsDirectory: string, pathname: string): Promise<string | null> {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalizedPathname = decodedPathname.replaceAll("\\", "/");
  const assetPath = resolve(assetsDirectory, normalizedPathname.replace(/^\/+/, ""));
  if (!isInsideRoot(assetsDirectory, assetPath)) {
    return null;
  }

  const canonicalAssetPath = await realpath(assetPath).catch(() => null);
  return canonicalAssetPath && isInsideRoot(assetsDirectory, canonicalAssetPath)
    ? canonicalAssetPath
    : null;
}

function isInsideRoot(root: string, candidate: string): boolean {
  return candidate.startsWith(`${root}${sep}`);
}

function createWeakEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

function isNotModified(headers: Headers, etag: string, mtimeMs: number): boolean {
  const ifNoneMatch = headers.get("if-none-match");
  if (ifNoneMatch) {
    return ifNoneMatch.split(",").some((candidate) => {
      const normalized = candidate.trim();
      return normalized === "*" || normalized === etag || normalized.replace(/^W\//, "") === etag.replace(/^W\//, "");
    });
  }

  const ifModifiedSince = headers.get("if-modified-since");
  if (!ifModifiedSince) return false;
  const modifiedSinceMs = Date.parse(ifModifiedSince);
  return Number.isFinite(modifiedSinceMs) && Math.floor(mtimeMs / 1_000) <= Math.floor(modifiedSinceMs / 1_000);
}

function isRangeAllowed(headers: Headers, etag: string, mtimeMs: number): boolean {
  const ifRange = headers.get("if-range");
  if (!ifRange) return true;
  if (ifRange.startsWith('"') || ifRange.startsWith("W/")) {
    return ifRange === etag;
  }
  const ifRangeMs = Date.parse(ifRange);
  return Number.isFinite(ifRangeMs) && Math.floor(mtimeMs / 1_000) <= Math.floor(ifRangeMs / 1_000);
}

type ParsedByteRange =
  | { kind: "invalid" }
  | { kind: "valid"; start: number; end: number };

function parseByteRange(header: string, size: number): ParsedByteRange {
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || size < 1) return { kind: "invalid" };
  const [, startText = "", endText = ""] = match;
  if (!startText && !endText) return { kind: "invalid" };

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return { kind: "invalid" };
    return {
      kind: "valid",
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return { kind: "invalid" };
  }
  return { kind: "valid", start, end: Math.min(requestedEnd, size - 1) };
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
