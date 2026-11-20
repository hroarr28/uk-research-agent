import { redactValue, scrub } from "./redact.js";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
};

const rank = { debug: 10, info: 20, warn: 30 } as const;

export function createLogger(options?: {
  write?: (line: string) => void;
  secrets?: readonly string[];
  level?: keyof typeof rank;
}): Logger {
  const write = options?.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const secrets = options?.secrets ?? [];
  const min = rank[options?.level ?? "info"];

  function emit(level: keyof typeof rank, message: string, fields?: LogFields): void {
    if (rank[level] < min) return;
    const payload: Record<string, unknown> = {
      level,
      message: scrub(message, secrets),
    };
    if (fields) payload.fields = redactValue(fields, secrets);
    write(JSON.stringify(payload));
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
};
