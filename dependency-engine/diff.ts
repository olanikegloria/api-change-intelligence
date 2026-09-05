/**
 * Schema / path diff engine for OpenAPI documents.
 */

import {
  JsonSchema,
  OpenAPIDoc,
  listOperations,
  requestSchema,
  responseSchema,
  resolveRef,
} from "../parser";

export type ChangeKind =
  | "removed_path"
  | "removed_property"
  | "type_change"
  | "required_added"
  | "required_removed";

export type BreakingChange = {
  kind: ChangeKind;
  path: string;
  method?: string;
  property?: string;
  before?: string;
  after?: string;
  location: "path" | "response" | "request";
  severity: "HIGH" | "MED" | "LOW";
  summary: string;
};

function typeOf(schema: JsonSchema | undefined): string {
  if (!schema) return "undefined";
  if (Array.isArray(schema.type)) return schema.type.join("|");
  return String(schema.type || "object");
}

function walkProperties(
  doc: OpenAPIDoc,
  schema: JsonSchema | undefined,
  prefix: string,
  visitor: (propPath: string, propSchema: JsonSchema, required: boolean) => void
): void {
  const resolved = resolveRef(doc, schema);
  if (!resolved) return;

  if (resolved.type === "array" || resolved.items) {
    walkProperties(doc, resolveRef(doc, resolved.items), prefix, visitor);
  }

  if (!resolved.properties) return;
  const required = new Set(resolved.required || []);
  for (const [name, child] of Object.entries(resolved.properties)) {
    const propPath = prefix ? `${prefix}.${name}` : name;
    const childResolved = resolveRef(doc, child) || child;
    visitor(propPath, childResolved, required.has(name));
    walkProperties(doc, childResolved, propPath, visitor);
  }
}

function collectProps(
  doc: OpenAPIDoc,
  schema: JsonSchema | undefined
): Map<string, { type: string; required: boolean }> {
  const map = new Map<string, { type: string; required: boolean }>();
  walkProperties(doc, schema, "", (propPath, propSchema, required) => {
    map.set(propPath, { type: typeOf(propSchema), required });
  });
  return map;
}

function diffSchemas(
  v1: OpenAPIDoc,
  v2: OpenAPIDoc,
  before: JsonSchema | undefined,
  after: JsonSchema | undefined,
  meta: { path: string; method: string; location: "response" | "request" }
): BreakingChange[] {
  const changes: BreakingChange[] = [];
  const a = collectProps(v1, before);
  const b = collectProps(v2, after);

  for (const [prop, info] of a.entries()) {
    if (!b.has(prop)) {
      changes.push({
        kind: "removed_property",
        path: meta.path,
        method: meta.method,
        property: prop,
        before: info.type,
        location: meta.location,
        severity: "HIGH",
        summary: `Removed ${meta.location} property '${prop}' on ${meta.method.toUpperCase()} ${meta.path}`,
      });
      continue;
    }
    const next = b.get(prop)!;
    if (info.type !== next.type) {
      changes.push({
        kind: "type_change",
        path: meta.path,
        method: meta.method,
        property: prop,
        before: info.type,
        after: next.type,
        location: meta.location,
        severity: "HIGH",
        summary: `Type change on '${prop}' (${info.type} → ${next.type}) for ${meta.method.toUpperCase()} ${meta.path}`,
      });
    }
    if (!info.required && next.required && meta.location === "request") {
      changes.push({
        kind: "required_added",
        path: meta.path,
        method: meta.method,
        property: prop,
        location: meta.location,
        severity: "HIGH",
        summary: `Property '${prop}' became required on request ${meta.method.toUpperCase()} ${meta.path}`,
      });
    }
    if (info.required && !next.required && meta.location === "response") {
      changes.push({
        kind: "required_removed",
        path: meta.path,
        method: meta.method,
        property: prop,
        location: meta.location,
        severity: "MED",
        summary: `Response property '${prop}' is no longer required on ${meta.method.toUpperCase()} ${meta.path}`,
      });
    }
  }

  // New required request fields not present before
  for (const [prop, info] of b.entries()) {
    if (!a.has(prop) && info.required && meta.location === "request") {
      changes.push({
        kind: "required_added",
        path: meta.path,
        method: meta.method,
        property: prop,
        location: meta.location,
        severity: "HIGH",
        summary: `New required request property '${prop}' on ${meta.method.toUpperCase()} ${meta.path}`,
      });
    }
  }

  return changes;
}

export function diffOpenApi(v1: OpenAPIDoc, v2: OpenAPIDoc): BreakingChange[] {
  const changes: BreakingChange[] = [];
  const ops1 = listOperations(v1);
  const ops2 = listOperations(v2);
  const key = (m: string, p: string) => `${m} ${p}`;
  const map2 = new Map(ops2.map((o) => [key(o.method, o.path), o]));

  for (const op of ops1) {
    const k = key(op.method, op.path);
    const next = map2.get(k);
    if (!next) {
      changes.push({
        kind: "removed_path",
        path: op.path,
        method: op.method,
        location: "path",
        severity: "HIGH",
        summary: `Removed endpoint ${op.method.toUpperCase()} ${op.path}`,
      });
      continue;
    }
    changes.push(
      ...diffSchemas(v1, v2, responseSchema(v1, op.operation), responseSchema(v2, next.operation), {
        path: op.path,
        method: op.method,
        location: "response",
      })
    );
    changes.push(
      ...diffSchemas(v1, v2, requestSchema(v1, op.operation), requestSchema(v2, next.operation), {
        path: op.path,
        method: op.method,
        location: "request",
      })
    );
  }

  return changes;
}

export function overallRisk(changes: BreakingChange[]): "HIGH" | "MED" | "LOW" {
  if (changes.some((c) => c.severity === "HIGH")) return "HIGH";
  if (changes.some((c) => c.severity === "MED")) return "MED";
  if (changes.length) return "LOW";
  return "LOW";
}
