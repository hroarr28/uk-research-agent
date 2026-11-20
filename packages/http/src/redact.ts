const SECRET_KEY =
  /^(authorization|proxy-authorization|api[-_]?key|x-api-key|token|password|secret)$/i;

export function scrub(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    if (out.includes(secret)) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

export function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return scrub(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactValue(entry, secrets);
    }
    return out;
  }
  return value;
}
