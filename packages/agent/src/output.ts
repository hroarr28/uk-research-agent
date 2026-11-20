export function boundToolOutput(text: string, maxChars = 20_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated]`;
}

export function outputIsOk(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { ok?: unknown };
    return parsed.ok === true;
  } catch {
    return false;
  }
}
