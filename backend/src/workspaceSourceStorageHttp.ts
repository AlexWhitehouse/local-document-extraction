import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isBoolean, isJsonObject, isString, parseJson, type JsonObject, type JsonValue } from "../../shared/json";
import { HttpError, toHttpError } from "./lib/http";
import {
  parseS3SourceStorageLocation,
  type S3SourceStorageConfiguration,
  type S3SourceStorageLocation,
  type SourceStorageProvider,
} from "./localConfiguration";
import type { LocalSourceObjectManifest } from "./localSourceObjectManifest";
import type {
  LocalSourceStorageDestinations,
  SourceStorageCredentials,
  WorkspaceSourceStorageDestination,
} from "./localSourceStorageDestinations";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { probeS3SourceStorage, SourceStorageProbeError } from "./s3SourceObjectStore";

const noStore = { "cache-control": "no-store" };

/** Field labels as people see them in the storage form; errors name the field to fix. */
const FIELD_LABELS = {
  bucket: "Bucket",
  region: "Region",
  endpoint: "Endpoint",
  prefix: "Prefix",
  access_key_id: "Access key ID",
  secret_access_key: "Secret access key",
  session_token: "Session token",
} as const;

const PROBE_FAILURES = {
  write: "Couldn't write a test file to the bucket. Check the endpoint, bucket name, region and credentials.",
  read: "Wrote a test file but couldn't read it back. Check that the credentials allow reading objects.",
  delete: "Couldn't delete the test file. Check that the credentials allow deleting objects.",
} as const;

/** Instance metadata services: signed requests there could expose the host's own cloud credentials. */
const BLOCKED_HOSTNAMES = new Set(["metadata", "metadata.google.internal", "metadata.goog", "instance-data"]);

export type EndpointAddressLookup = (hostname: string) => Promise<string[]>;

const lookupAddresses: EndpointAddressLookup = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

export type WorkspaceSourceStorageHttp = {
  handle(input: { request: Request; workspaceId: string; userId: string; test: boolean }): Promise<Response>;
};

/**
 * Owner/admin control of a Workspace's own S3-compatible bucket. Every save is tested against the bucket
 * first, and a changed location only redirects new uploads: existing originals stay where they are.
 */
export function createWorkspaceSourceStorageHttp({
  workspaceControl,
  destinations,
  manifest,
  installationProvider,
  overridesEnabled,
  probe = probeS3SourceStorage,
  resolveAddresses = lookupAddresses,
}: {
  workspaceControl: Pick<LocalWorkspaceControl, "getAcceptedWorkspaceContext">;
  destinations: LocalSourceStorageDestinations;
  manifest: Pick<LocalSourceObjectManifest, "countsByDestination">;
  installationProvider: SourceStorageProvider;
  overridesEnabled: boolean;
  probe?: (configuration: S3SourceStorageConfiguration) => Promise<void>;
  resolveAddresses?: EndpointAddressLookup;
}): WorkspaceSourceStorageHttp {
  const represent = (workspaceId: string, current: WorkspaceSourceStorageDestination | null) => {
    const headers = new Headers(noStore);

    if (current) headers.set("etag", sourceStorageETag(current.revision));

    return Response.json(
      {
        workspace_id: workspaceId,
        overrides_enabled: overridesEnabled,
        installation_provider: installationProvider,
        override: current && publicOverride(current, credentialStatus(destinations, current)),
        previous_locations_pending: destinations.previousLocationsPending(workspaceId, manifest.countsByDestination()),
      },
      { headers },
    );
  };

  const storedConfiguration = (current: WorkspaceSourceStorageDestination) => {
    try {
      return destinations.configuration(current);
    } catch {
      throw credentialsUnreadable();
    }
  };

  const testedConfiguration = async (
    body: JsonObject,
    current: WorkspaceSourceStorageDestination | null,
  ): Promise<{ location: S3SourceStorageLocation; credentials: SourceStorageCredentials | null }> => {
    const location = parseLocation(body);
    const credentials = parseCredentials(body);

    if (!credentials && !current)
      throw invalid("Enter an access key ID and secret access key for the bucket.");
    await assertEndpointAllowed(location.endpoint, resolveAddresses);

    const configuration: S3SourceStorageConfiguration = {
      ...location,
      ...(credentials ?? pickCredentials(storedConfiguration(current!))),
    };

    try {
      await probe(configuration);
    } catch (error) {
      if (!(error instanceof SourceStorageProbeError)) throw error;
      console.warn("Workspace storage test failed", error);
      throw new ProbeFailure(error.stage);
    }

    return { location, credentials };
  };

  return {
    async handle({ request, workspaceId, userId, test }) {
      try {
        const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId });

        if (!workspace) throw new HttpError(403, "forbidden", "Workspace access is unavailable.");

        if (workspace.role !== "owner" && workspace.role !== "admin")
          throw new HttpError(
            403,
            "insufficient_workspace_role",
            "Only Workspace owners and admins can manage document storage.",
          );
        const allowed = test ? ["POST"] : ["GET", "PUT", "DELETE"];

        if (!allowed.includes(request.method))
          return Response.json(
            { error: { code: "method_not_allowed", message: "Method not allowed" } },
            { status: 405, headers: { ...noStore, allow: allowed.join(", ") } },
          );
        const current = destinations.current(workspaceId);

        if (request.method === "GET") return represent(workspaceId, current);

        if (request.method === "DELETE") {
          const revision = matchedRevision(request, current);

          if (revision === null || !destinations.clear({ workspaceId, expectedRevision: revision }))
            throw failedCondition();

          return new Response(null, { status: 204, headers: noStore });
        }

        if (!overridesEnabled)
          throw new HttpError(
            409,
            "source_storage_overrides_disabled",
            "Workspace storage is turned off for this installation.",
          );

        const body = await readBody(request);

        if (test) {
          await testedConfiguration(body, current);

          return Response.json({ ok: true }, { headers: noStore });
        }

        const expectedRevision = current ? matchedRevision(request, current) : null;

        if (current ? expectedRevision === null : !createsNew(request)) throw failedCondition();

        if (body.confirm_unversioned_bucket !== true)
          throw new HttpError(
            400,
            "source_storage_confirmation_required",
            "Confirm that the bucket does not use object versioning or Object Lock.",
          );
        const { location, credentials } = await testedConfiguration(body, current);
        let saved: WorkspaceSourceStorageDestination | null;

        try {
          saved = destinations.save({ workspaceId, location, credentials, expectedRevision });
        } catch {
          throw credentialsUnreadable();
        }

        if (!saved) throw failedCondition();

        return represent(workspaceId, saved);
      } catch (error) {
        if (error instanceof ProbeFailure) return probeFailureResponse(error);

        if (!(error instanceof HttpError)) console.error("Workspace storage request failed", error);

        return httpErrorResponse(toHttpError(error));
      }
    },
  };
}

export function sourceStorageETag(revision: number): string {
  return `"source-storage-${revision}"`;
}

class ProbeFailure extends Error {
  constructor(readonly stage: SourceStorageProbeError["stage"]) {
    super(PROBE_FAILURES[stage]);
  }
}

function probeFailureResponse(failure: ProbeFailure): Response {
  return Response.json(
    { error: { code: "source_storage_test_failed", message: failure.message, stage: failure.stage } },
    { status: 422, headers: noStore },
  );
}

function httpErrorResponse(error: HttpError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status, headers: noStore },
  );
}

function publicOverride(destination: WorkspaceSourceStorageDestination, credential_status: "configured" | "unavailable") {
  return {
    endpoint: destination.location.endpoint ?? null,
    region: destination.location.region,
    bucket: destination.location.bucket,
    prefix: destination.location.prefix,
    force_path_style: destination.location.forcePathStyle,
    access_key_id_hint: destination.accessKeyIdHint,
    credential_status,
    revision: destination.revision,
    updated_at: destination.updatedAt,
  };
}

function credentialStatus(
  destinations: Pick<LocalSourceStorageDestinations, "configuration">,
  destination: WorkspaceSourceStorageDestination,
): "configured" | "unavailable" {
  try {
    destinations.configuration(destination);

    return "configured";
  } catch {
    return "unavailable";
  }
}

/** The revision an `If-Match` names, or null when it is missing or stale. */
function matchedRevision(request: Request, current: WorkspaceSourceStorageDestination | null): number | null {
  const ifMatch = request.headers.get("if-match");

  if (!ifMatch && !request.headers.get("if-none-match"))
    throw new HttpError(428, "precondition_required", "A storage settings precondition is required.");

  return current && ifMatch === sourceStorageETag(current.revision) ? current.revision : null;
}

function createsNew(request: Request): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");

  if (!ifNoneMatch && !request.headers.get("if-match"))
    throw new HttpError(428, "precondition_required", "A storage settings precondition is required.");

  return ifNoneMatch?.trim() === "*";
}

function failedCondition() {
  return new HttpError(412, "precondition_failed", "The storage settings changed. Reload them before trying again.");
}

function credentialsUnreadable() {
  return new HttpError(
    409,
    "source_storage_credentials_unavailable",
    "The saved storage credentials can't be read. Enter the access key ID and secret access key again.",
  );
}

function invalid(message: string) {
  return new HttpError(400, "invalid_source_storage", message);
}

async function readBody(request: Request): Promise<JsonObject> {
  let value: JsonValue;

  try {
    value = parseJson(await request.text());
  } catch {
    throw invalid("Provide valid JSON for the storage settings.");
  }

  if (!isJsonObject(value)) throw invalid("Provide valid JSON for the storage settings.");

  return value;
}

function parseLocation(body: JsonObject): S3SourceStorageLocation {
  const text = (field: "bucket" | "region" | "endpoint" | "prefix", required: boolean): string | undefined => {
    const value = body[field];

    if (value === undefined || value === null || (isString(value) && !value.trim())) {
      if (required) throw invalid(`Enter the ${FIELD_LABELS[field].toLowerCase()}.`);

      return undefined;
    }

    if (!isString(value) || value.length > 2048) throw invalid(`${FIELD_LABELS[field]} must be text.`);

    return value.trim();
  };

  const forcePathStyle = body.force_path_style;

  if (forcePathStyle !== undefined && forcePathStyle !== null && !isBoolean(forcePathStyle))
    throw invalid("Path-style addressing must be on or off.");
  const endpoint = text("endpoint", false);
  const prefix = text("prefix", false);

  try {
    return parseS3SourceStorageLocation(
      {
        bucket: text("bucket", true)!,
        region: text("region", true)!,
        endpoint,
        prefix,
        forcePathStyle: isBoolean(forcePathStyle) ? forcePathStyle : undefined,
      },
      (field) => FIELD_LABELS[field],
    );
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : "The storage location is not valid.");
  }
}

/** Both keys together replace the credentials; neither keeps the saved ones. */
function parseCredentials(body: JsonObject): SourceStorageCredentials | null {
  const secret = (field: "access_key_id" | "secret_access_key" | "session_token", maximum: number) => {
    const value = body[field];

    if (value === undefined || value === null || value === "") return undefined;

    // Credentials go into signed request headers, so control characters are never valid.
    if (!isString(value) || value.length > maximum || /[\s\p{Cc}]/u.test(value))
      throw invalid(`${FIELD_LABELS[field]} isn't valid. Paste it again without spaces.`);

    return value;
  };

  const accessKeyId = secret("access_key_id", 256);
  const secretAccessKey = secret("secret_access_key", 1024);
  const sessionToken = secret("session_token", 8192);

  if (!accessKeyId && !secretAccessKey) {
    if (sessionToken) throw invalid("A session token needs an access key ID and secret access key.");

    return null;
  }

  if (!accessKeyId || !secretAccessKey) throw invalid("Enter both the access key ID and the secret access key.");

  const credentials: SourceStorageCredentials = { accessKeyId, secretAccessKey };

  if (sessionToken) credentials.sessionToken = sessionToken;

  return credentials;
}

function pickCredentials(configuration: S3SourceStorageConfiguration): SourceStorageCredentials {
  const credentials: SourceStorageCredentials = {
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
  };

  if (configuration.sessionToken) credentials.sessionToken = configuration.sessionToken;

  return credentials;
}

/**
 * Workspace admins choose the endpoint, so the server refuses link-local and cloud metadata addresses.
 * Private networks stay allowed, as for the model gateway. The check runs on save and test; a hostname
 * that later resolves elsewhere is not re-checked.
 */
async function assertEndpointAllowed(endpoint: string | undefined, resolveAddresses: EndpointAddressLookup) {
  if (!endpoint) return;
  const hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) throw blockedEndpoint();
  let addresses: string[];

  try {
    addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
  } catch {
    // An unresolvable endpoint fails the bucket test with a clearer message.
    return;
  }

  if (addresses.some(isBlockedAddress)) throw blockedEndpoint();
}

function blockedEndpoint() {
  return new HttpError(
    400,
    "source_storage_endpoint_blocked",
    "This endpoint uses a link-local or cloud metadata address. Choose the address of your storage server.",
  );
}

export function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const embedded = isIP(normalized) === 6 ? embeddedIPv4(normalized) : null;

  if (embedded) return isBlockedAddress(embedded);

  if (isIP(normalized) === 4) {
    const [first, second] = normalized.split(".").map(Number);

    // 0.0.0.0/8 reaches the host itself; 169.254.0.0/16 is link-local; 100.100.100.200 is Alibaba Cloud metadata.
    return first === 0 || (first === 169 && second === 254) || normalized === "100.100.100.200";
  }

  if (isIP(normalized) === 6)
    return normalized === "::" || /^fe[89ab][0-9a-f]:/.test(normalized) || normalized === "fd00:ec2::254";

  return false;
}

/**
 * The IPv4 address inside an IPv4-mapped (`::ffff:a.b.c.d`), IPv4-translated (`::ffff:0:a.b.c.d`) or
 * IPv4-compatible (`::a.b.c.d`) IPv6 address, in any spelling. `URL` rewrites dotted forms as hex
 * (`::ffff:a9fe:a9fe`), so both must be decoded before the IPv4 rules apply.
 */
function embeddedIPv4(address: string): string | null {
  const groups = ipv6Groups(address);

  if (!groups || groups.slice(0, 4).some((group) => group !== 0)) return null;
  const [marker = 0, translation = 0, high = 0, low = 0] = groups.slice(4);
  const mapped = marker === 0 && translation === 0xffff;
  const translated = marker === 0xffff && translation === 0;
  // `::` and `::1` are IPv6's own unspecified and loopback addresses, not embedded IPv4.
  const compatible = marker === 0 && translation === 0 && (high !== 0 || low > 1);

  if (!mapped && !translated && !compatible) return null;

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/** Eight 16-bit groups of a valid IPv6 address, expanding `::` and a trailing dotted IPv4 part. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];

  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted.split(".").map(Number);
    text = `${text.slice(0, -dotted.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head = "", tail, extra] = text.split("::");

  if (extra !== undefined) return null;
  const parse = (part: string) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const missing = 8 - left.length - right.length;

  if (tail === undefined ? missing !== 0 : missing < 0) return null;
  const groups = [...left, ...new Array<number>(missing).fill(0), ...right];

  return groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}
