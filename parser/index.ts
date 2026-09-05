/**
 * OpenAPI 3.x loader + normalizer (MVP).
 */

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  $ref?: string;
  [key: string]: unknown;
};

export type OpenAPIDoc = {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, JsonSchema> };
};

export type PathItem = Record<string, Operation | unknown>;

export type Operation = {
  operationId?: string;
  summary?: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: {
    content?: Record<string, { schema?: JsonSchema }>;
  };
  responses?: Record<
    string,
    {
      content?: Record<string, { schema?: JsonSchema }>;
    }
  >;
};

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

export function loadOpenApi(doc: unknown): OpenAPIDoc {
  if (!doc || typeof doc !== "object") {
    throw new Error("OpenAPI document must be an object");
  }
  const typed = doc as OpenAPIDoc;
  if (!typed.paths || typeof typed.paths !== "object") {
    throw new Error("OpenAPI document missing paths");
  }
  return typed;
}

export function listOperations(doc: OpenAPIDoc): Array<{
  path: string;
  method: string;
  operation: Operation;
}> {
  const out: Array<{ path: string; method: string; operation: Operation }> = [];
  for (const [path, item] of Object.entries(doc.paths || {})) {
    if (!item || typeof item !== "object") continue;
    for (const [method, op] of Object.entries(item as PathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      out.push({
        path,
        method: method.toLowerCase(),
        operation: op as Operation,
      });
    }
  }
  return out.sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`)
  );
}

export function resolveRef(
  doc: OpenAPIDoc,
  schema: JsonSchema | undefined
): JsonSchema | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;
  const ref = schema.$ref;
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return schema;
  const name = ref.slice(prefix.length);
  return doc.components?.schemas?.[name] || schema;
}

export function responseSchema(
  doc: OpenAPIDoc,
  op: Operation,
  status = "200"
): JsonSchema | undefined {
  const resp = op.responses?.[status] || op.responses?.["201"] || op.responses?.default;
  const content = resp?.content || {};
  const json = content["application/json"] || Object.values(content)[0];
  return resolveRef(doc, json?.schema);
}

export function requestSchema(doc: OpenAPIDoc, op: Operation): JsonSchema | undefined {
  const content = op.requestBody?.content || {};
  const json = content["application/json"] || Object.values(content)[0];
  return resolveRef(doc, json?.schema);
}
