export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function toHttpError(cause: unknown): HttpError {
  if (cause instanceof HttpError) {
    return cause;
  }

  return new HttpError(500, "internal_error", "Unexpected server error");
}

export function bearerApiKey(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim() || "";

  if (!value.toLowerCase().startsWith("bearer ")) return null;

  return value.slice(7).trim() || null;
}
