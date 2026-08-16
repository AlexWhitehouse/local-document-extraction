export type LocalSubmissionAdmissionSnapshot = {
  active: number;
  maxConcurrent: number;
  maxReservedBytes: number;
  rejected: number;
  reservedBytes: number;
};

export type LocalSubmissionAdmission = {
  run(request: Request, handle: () => Response | Promise<Response>): Promise<Response>;
  snapshot(): LocalSubmissionAdmissionSnapshot;
};

export function createLocalSubmissionAdmission({
  canReserve = () => true,
  maxConcurrent = 8,
  maxReservedBytes = 128 * 1024 * 1024,
  unknownRequestBytes = 11 * 1024 * 1024,
  retryAfterSeconds = 1,
}: {
  canReserve?: (input: { requestBytes: number; reservedBytes: number }) => boolean | Promise<boolean>;
  maxConcurrent?: number;
  maxReservedBytes?: number;
  unknownRequestBytes?: number;
  retryAfterSeconds?: number;
} = {}): LocalSubmissionAdmission {
  const normalizedMaxConcurrent = positiveInteger(maxConcurrent, 8);
  const normalizedMaxReservedBytes = positiveInteger(maxReservedBytes, 128 * 1024 * 1024);
  const normalizedUnknownRequestBytes = positiveInteger(unknownRequestBytes, 11 * 1024 * 1024);
  const normalizedRetryAfterSeconds = positiveInteger(retryAfterSeconds, 1);
  let active = 0;
  let rejected = 0;
  let reservedBytes = 0;

  return {
    run: async (request, handle) => {
      const reservation = requestReservationBytes(request, normalizedUnknownRequestBytes);
      const localCapacityFull =
        active >= normalizedMaxConcurrent
        || reservedBytes + reservation > normalizedMaxReservedBytes;
      const resourcesAvailable = localCapacityFull
        ? false
        : await canReserve({ requestBytes: reservation, reservedBytes });
      if (localCapacityFull || !resourcesAvailable) {
        rejected += 1;
        await drainRequestBody(request.body);
        return Response.json(
          {
            error: {
              code: "local_submission_capacity_unavailable",
              message: "Local Document submission capacity is temporarily full",
            },
          },
          {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "retry-after": String(normalizedRetryAfterSeconds),
            },
          },
        );
      }

      active += 1;
      reservedBytes += reservation;
      try {
        return await handle();
      } finally {
        active -= 1;
        reservedBytes -= reservation;
      }
    },
    snapshot: () => ({
      active,
      maxConcurrent: normalizedMaxConcurrent,
      maxReservedBytes: normalizedMaxReservedBytes,
      rejected,
      reservedBytes,
    }),
  };
}

async function drainRequestBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  try {
    while (!(await reader.read()).done) {
      // Discard bounded stream chunks without constructing FormData or Source bytes.
    }
  } catch {
    // A disconnected rejected client has already released its upload resources.
  } finally {
    reader.releaseLock();
  }
}

function requestReservationBytes(request: Request, fallback: number): number {
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isSafeInteger(contentLength) && contentLength > 0
    ? contentLength
    : fallback;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
