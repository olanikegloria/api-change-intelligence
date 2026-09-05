import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { test } from "node:test";
import { loadOpenApi } from "../parser";
import { diffOpenApi, scanConsumers } from "../dependency-engine";

const root = path.resolve(__dirname, "..");

test("diff detects removed paths, properties, types, and required changes", () => {
  const v1 = loadOpenApi(
    JSON.parse(fs.readFileSync(path.join(root, "fixtures/openapi-v1.json"), "utf8"))
  );
  const v2 = loadOpenApi(
    JSON.parse(fs.readFileSync(path.join(root, "fixtures/openapi-v2.json"), "utf8"))
  );
  const changes = diffOpenApi(v1, v2);
  const kinds = new Set(changes.map((c) => c.kind));

  assert.ok(kinds.has("removed_path"), "expected removed_path");
  assert.ok(
    changes.some((c) => c.path === "/users/{id}" && c.method === "delete"),
    "DELETE /users/{id} removed"
  );
  assert.ok(
    changes.some((c) => c.path === "/users/{id}/profile"),
    "profile path removed"
  );
  assert.ok(kinds.has("removed_property"), "expected removed_property");
  assert.ok(
    changes.some((c) => c.property === "name" && c.kind === "removed_property"),
    "User.name removed"
  );
  assert.ok(kinds.has("type_change"), "expected type_change");
  assert.ok(
    changes.some((c) => c.property === "role" && c.before === "string" && c.after === "integer"),
    "role type change"
  );
  assert.ok(kinds.has("required_added"), "expected required_added");
  assert.ok(
    changes.some((c) => c.property === "tenantId" && c.kind === "required_added"),
    "tenantId required on create"
  );
});

test("consumer scanner finds /users references", () => {
  const v1 = loadOpenApi(
    JSON.parse(fs.readFileSync(path.join(root, "fixtures/openapi-v1.json"), "utf8"))
  );
  const v2 = loadOpenApi(
    JSON.parse(fs.readFileSync(path.join(root, "fixtures/openapi-v2.json"), "utf8"))
  );
  const changes = diffOpenApi(v1, v2);
  const hits = scanConsumers(path.join(root, "sample-consumers"), changes);
  assert.ok(hits.length > 0, "expected consumer hits");
  assert.ok(
    hits.some((h) => h.matched.includes("/users")),
    "expected /users path match"
  );
  assert.ok(
    hits.some((h) => h.consumer === "billing-service" || h.consumer === "mobile-bff")
  );
});
