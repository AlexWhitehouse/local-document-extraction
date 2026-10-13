import { isJsonArray, isJsonObject, isString, parseJson, type JsonValue } from "../../shared/json";
import { SEARCH_LIMITS, isIsoDate } from "../../shared/documentSearch";
import { interpretCommand, type InterpretationSegment } from "./consumer/searchInterpretation";
import { ExtractionCancelledError, ModelGatewayRequestError, RetryableError } from "./consumer/modelGateway";
import { HttpError } from "./lib/http";
import { withAuthorizedProductStore, type ProductServices } from "./localApplication";
import {
  assistantModelEnvironment,
  assistantModelOf,
  configurationMissing,
  createWorkspaceCredentialVault,
} from "./workspaceModelConfiguration";

const noStore = { "cache-control": "no-store" };

const SEGMENT_TYPE = /^[a-z_]{1,32}$/;

const TIME_ZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;

const invalid = (message: string) => new HttpError(400, "invalid_search_interpretation_request", message);

export type SearchInterpretationRequest = {
  text: string;
  segments: InterpretationSegment[];
  today: string;
  timeZone: string;
};

/** The client's lexer output travels as hints; only each segment's type and text reach the model. */
export function validateSearchInterpretationRequest(body: JsonValue | undefined): SearchInterpretationRequest {
  if (!isJsonObject(body)) throw invalid("Send a JSON object with text, segments, today and time_zone.");
  const extra = Object.keys(body).find((key) => !["text", "segments", "today", "time_zone"].includes(key));

  if (extra) throw invalid(`Unknown property "${extra}".`);
  const { text, segments, today, time_zone: timeZone } = body;

  if (!isString(text) || !text.trim() || text.length > SEARCH_LIMITS.interpretationTextCharacters || text.includes("\0"))
    throw invalid(`text must be 1 to ${SEARCH_LIMITS.interpretationTextCharacters} characters.`);

  if (!isJsonArray(segments) || segments.length > SEARCH_LIMITS.interpretationSegments)
    throw invalid(`segments must be a list of at most ${SEARCH_LIMITS.interpretationSegments}.`);

  if (!isIsoDate(today)) throw invalid("today must be a date in YYYY-MM-DD form.");

  if (!isString(timeZone) || !TIME_ZONE.test(timeZone)) throw invalid("time_zone must be a time zone name.");

  return {
    text: text.trim(),
    segments: segments.map((segment) => {
      if (
        !isJsonObject(segment) ||
        Object.keys(segment).some((key) => !["type", "text", "start", "end"].includes(key)) ||
        !isString(segment.type) ||
        !SEGMENT_TYPE.test(segment.type) ||
        !isString(segment.text) ||
        segment.text.length > SEARCH_LIMITS.interpretationTextCharacters
      )
        throw invalid("Each segment needs a type and text.");

      return { type: segment.type, text: segment.text };
    }),
    today,
    timeZone,
  };
}

/** POST /v1/search/interpret: any Workspace-authorised caller, including API keys. */
export async function handleSearchInterpretation({
  product,
  request,
  modelGatewayRequestTimeoutMs,
}: {
  product: ProductServices;
  request: Request;
  modelGatewayRequestTimeoutMs: string;
}): Promise<Response> {
  const response = await withAuthorizedProductStore(product, request, async ({ store, signal: workspaceSignal, workspace }) => {
    const callTimeoutMs = Math.max(1, Math.min(60_000, Number(modelGatewayRequestTimeoutMs) || 60_000));
    // Only the client or Workspace deletion cancels; the deadline is a model failure, not a cancellation.
    const cancelled = AbortSignal.any([request.signal, workspaceSignal]);
    // Each call has its own gateway timeout; the overall deadline leaves the correction attempt a full call.
    const deadline = AbortSignal.timeout(callTimeoutMs * 2);
    const signal = AbortSignal.any([cancelled, deadline]);

    try {
      let body: JsonValue;

      try {
        body = parseJson(await request.text());
      } catch {
        throw invalid("Request body must be valid JSON.");
      }

      const input = validateSearchInterpretationRequest(body);
      const configuration = store.getModelConfiguration();

      if (!configuration) throw configurationMissing();

      // The server's own catalogue: a client can't offer the model fields from elsewhere.
      const catalog = store.getSearchCatalog();

      const credential = createWorkspaceCredentialVault(product.stateDirectory).decrypt(
        workspace.id,
        configuration.credential_ciphertext,
      );

      const environment = assistantModelEnvironment(configuration, {
        credential,
        workspaceId: workspace.id,
        requestTimeoutMs: String(callTimeoutMs),
      });

      const interpretation = await interpretCommand(
        {
          ...environment,
          modelCallObserver: store.workspaceModelCallObserver({
            purpose: "search",
            model: assistantModelOf(configuration).model_name,
            configurationRevision: configuration.revision,
            now: () => new Date().toISOString(),
          }),
        },
        { ...input, catalog },
        signal,
      );

      if (signal.aborted) throw new ExtractionCancelledError("Search interpretation cancelled");

      return Response.json({ interpretation }, { headers: noStore });
    } catch (error) {
      if (cancelled.aborted) return fail(499, "request_cancelled", "The request was cancelled.");

      if (deadline.aborted || error instanceof ExtractionCancelledError)
        return fail(502, "search_interpretation_failed", "The configured model didn't respond in time. Try again.");

      if (error instanceof HttpError) return fail(error.status, error.code, error.message);

      if (error instanceof ModelGatewayRequestError || error instanceof RetryableError)
        return fail(502, "search_interpretation_failed", "The configured model couldn't interpret this request.");

      return fail(500, "search_interpretation_failed", "The request couldn't be interpreted.");
    }
  });

  response.headers.set("cache-control", "no-store");

  return response;
}

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: noStore });
}
