import { readObjectResponse, responseError } from "./responseFixture";
import type { LocalAuth } from "../localAuth";

type FetchApplication = (request: Request) => Response | Promise<Response>;

/** Signs up, verifies and signs in a user through the application, returning their session cookie. */
export async function createSignedInUser({
  application,
  auth,
  email,
  name,
  verificationLinks,
}: {
  application: FetchApplication;
  auth: LocalAuth;
  email: string;
  name: string;
  verificationLinks: string[];
}) {
  await application(
    new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "Strong1!" }),
    }),
  );

  const verificationLink =
    verificationLinks.find((link) => link.includes(encodeURIComponent(email))) ?? verificationLinks.at(-1)!;

  await application(new Request(verificationLink, { redirect: "manual" }));

  const signIn = await application(
    new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Strong1!" }),
    }),
  );

  const cookie = signIn.headers.get("set-cookie")!.split(";", 1)[0]!;
  const session = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie } }));

  return { cookie, session: session! };
}

/** A `/v1` JSON client that throws `{ code, status }` errors for non-2xx responses. */
export function createFetchRequest(application: FetchApplication, cookie: string, workspaceId?: string) {
  return async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("cookie", cookie);

    if (workspaceId) headers.set("x-workspace-id", workspaceId);
    const response = await application(new Request(`http://127.0.0.1:8787/v1${path}`, { ...options, headers }));
    const data = await readObjectResponse(response);

    if (!response.ok) {
      throw responseError(data, response.status);
    }

    return data;
  };
}
