import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolErrorBody = {
  code: string;
  message: string;
  status?: number;
};

export type ToolSuccess<T> = { ok: true; data: T };
export type ToolFailure = { ok: false; error: ToolErrorBody };
export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export function toolOk<T>(data: T): ToolSuccess<T> {
  return { ok: true, data };
}

export function toolError(code: string, message: string, status?: number): ToolFailure {
  if (status === undefined) {
    return { ok: false, error: { code, message } };
  }
  return { ok: false, error: { code, message, status } };
}

export function toolJson(result: ToolResult<unknown>): string {
  return JSON.stringify(result);
}

export function toJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const json: unknown = zodToJsonSchema(schema, { target: "jsonSchema7" });
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("Expected zod-to-json-schema to return an object");
  }
  const copy: Record<string, unknown> = { ...json };
  delete copy.$schema;
  return copy;
}

export function formatZodIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
