import * as clack from "@clack/prompts";

/**
 * Every line a command prints goes through here, so `--quiet` and `--verbose`
 * are a property of the CLI rather than something each command remembers to
 * check. The surface deliberately mirrors the part of @clack/prompts the
 * commands were already using, so switching a command over is an import change.
 *
 * Prompts themselves stay in `prompts.ts`: a question is not output, and
 * silencing one would hang the wizard.
 */

export type LogLevel = "quiet" | "normal" | "verbose";

let level: LogLevel = "normal";

export function setLogLevel(next: LogLevel): void {
  level = next;
}

export function logLevel(): LogLevel {
  return level;
}

/** True when the operator asked for the extra detail `--verbose` adds. */
export function isVerbose(): boolean {
  return level === "verbose";
}

function speaks(): boolean {
  return level !== "quiet";
}

export function intro(message: string): void {
  if (speaks()) clack.intro(message);
}

export function outro(message: string): void {
  if (speaks()) clack.outro(message);
}

export function note(message: string, title?: string): void {
  if (speaks()) clack.note(message, title);
}

export function cancel(message: string): void {
  // A cancellation is the outcome of the command, not chatter: it survives --quiet.
  clack.cancel(message);
}

export const log = {
  info(message: string): void {
    if (speaks()) clack.log.info(message);
  },
  success(message: string): void {
    if (speaks()) clack.log.success(message);
  },
  step(message: string): void {
    if (speaks()) clack.log.step(message);
  },
  warn(message: string): void {
    if (speaks()) clack.log.warn(message);
  },
  message(message: string): void {
    if (speaks()) clack.log.message(message);
  },
  /** Errors are the one thing `--quiet` still shows. */
  error(message: string): void {
    clack.log.error(message);
  },
  /** Detail that is noise at normal volume: timings, paths, per-file results. */
  debug(message: string): void {
    if (level === "verbose") clack.log.message(message);
  },
};

export interface Spinner {
  start(message?: string): void;
  stop(message?: string): void;
  message(message?: string): void;
}

const silentSpinner: Spinner = {
  start() {},
  stop() {},
  message() {},
};

export function spinner(): Spinner {
  return speaks() ? clack.spinner() : silentSpinner;
}
