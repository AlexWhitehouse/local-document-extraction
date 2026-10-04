import { isJsonObject, isString, parseJson, type JsonObject, type JsonValue } from "../../../shared/json";
import { jsonArray, jsonObject, jsonText } from "./jsonFixture";

export async function readObjectResponse(response: Pick<Response, "text">) {
  return jsonObject(parseJson(await response.text()));
}

export async function readObjectList(response: Response, key: string) {
  const body = await readObjectResponse(response);

  return jsonArray(body[key]).map((entry) => jsonTextFields(entry, "id"));
}

export function responseError(body: JsonObject, status: number) {
  const detail = isJsonObject(body.error) ? body.error : {};

  return Object.assign(new Error(isString(detail.message) ? detail.message : `Request failed (${status})`), {
    code: isString(detail.code) ? detail.code : null,
    status,
  });
}

function hasTextFields<K extends string>(
  value: JsonValue | undefined,
  keys: K[],
): value is JsonObject & Record<K, string> {
  return isJsonObject(value) && keys.every((key) => isString(value[key]));
}

export function jsonTextFields<K extends string>(
  value: JsonValue | undefined,
  ...keys: K[]
): JsonObject & Record<K, string> {
  if (!hasTextFields(value, keys)) throw new Error(`Expected string fields: ${keys.join(", ")}`);

  return value;
}

export async function readTextFieldsResponse<K extends string>(response: Response, ...keys: K[]) {
  return jsonTextFields(await readObjectResponse(response), ...keys);
}

export async function readUserResponse(response: Response) {
  const body = await readObjectResponse(response);
  const user = jsonObject(body.user);

  return { user: { id: jsonText(user.id), name: jsonText(user.name), email: jsonText(user.email) } };
}

export async function readJobAdmission(response: Response) {
  const body = await readObjectResponse(response);

  return { job_id: jsonText(body.job_id) };
}

export async function readTemplateCreation(response: Response) {
  const body = await readObjectResponse(response);

  return { template_id: jsonText(body.template_id) };
}
