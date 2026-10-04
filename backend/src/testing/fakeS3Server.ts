/** A minimal in-memory S3 endpoint for tests: object PUT/GET/HEAD/DELETE, with outage and multipart tracking. */
export function startFakeS3Server() {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  const state = { down: false, multipartRequests: 0, puts: 0 };

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);

      if (url.searchParams.has("uploads") || url.searchParams.has("uploadId")) state.multipartRequests += 1;

      if (state.down) return new Response("<Error><Code>ServiceUnavailable</Code></Error>", { status: 503 });
      // Path-style: /<bucket>/<key>
      const key = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));

      const missing = () =>
        request.method === "HEAD"
          ? new Response(null, { status: 404 })
          : new Response("<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>", {
              status: 404,
              headers: { "content-type": "application/xml" },
            });

      switch (request.method) {
        case "PUT": {
          state.puts += 1;
          objects.set(key, {
            bytes: new Uint8Array(await request.arrayBuffer()),
            type: request.headers.get("content-type") || "application/octet-stream",
          });

          return new Response(null, { headers: { etag: `"${state.puts}"` } });
        }

        case "HEAD":
        case "GET": {
          const object = objects.get(key);

          if (!object) return missing();

          const headers = {
            "content-type": object.type,
            "content-length": String(object.bytes.byteLength),
            etag: '"1"',
            "last-modified": new Date().toUTCString(),
          };

          return new Response(request.method === "HEAD" ? null : new Blob([new Uint8Array(object.bytes)]), { headers });
        }

        case "DELETE":
          objects.delete(key);

          return new Response(null, { status: 204 });
        default:
          return new Response(null, { status: 405 });
      }
    },
  });

  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    objects,
    state,
    stop: () => server.stop(true),
  };
}
