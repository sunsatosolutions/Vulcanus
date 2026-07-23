import * as p from "@clack/prompts";
import { messages, type Locale } from "./i18n.js";

/**
 * Thin typed wrappers over @clack/prompts. Every prompt aborts the process
 * cleanly on Ctrl-C, so command code never has to check for the cancel symbol.
 */

let activeLocale: Locale = "en";

export function setPromptLocale(locale: Locale): void {
  activeLocale = locale;
}

function bail(): never {
  p.cancel(messages(activeLocale).cancelled);
  process.exit(130);
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) bail();
  return value as T;
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export async function askText(options: {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  required?: boolean;
}): Promise<string> {
  const answer = await p.text({
    message: options.message,
    placeholder: options.placeholder,
    defaultValue: options.defaultValue,
    initialValue: options.initialValue,
    validate: options.required
      ? (value) => (value.trim() ? undefined : messages(activeLocale).required)
      : undefined,
  });
  return unwrap(answer) ?? "";
}

// clack's `Option<Value>` is a conditional type that cannot resolve against an
// unresolved generic, so the wrappers talk to it in plain `string` terms and
// restore the caller's literal union on the way out.
type StringChoice = { value: string; label: string; hint?: string };

export async function askSelect<T extends string>(options: {
  message: string;
  options: Array<Choice<T>>;
  initialValue?: T;
}): Promise<T> {
  const answer = await p.select({
    message: options.message,
    options: options.options as StringChoice[],
    initialValue: options.initialValue as string | undefined,
  });
  return unwrap(answer) as T;
}

export async function askMultiselect<T extends string>(options: {
  message: string;
  options: Array<Choice<T>>;
  initialValues?: T[];
}): Promise<T[]> {
  const answer = await p.multiselect({
    message: options.message,
    options: options.options as StringChoice[],
    initialValues: (options.initialValues ?? []) as string[],
    required: false,
  });
  return unwrap(answer) as T[];
}

export async function askConfirm(options: {
  message: string;
  initialValue?: boolean;
}): Promise<boolean> {
  const answer = await p.confirm({
    message: options.message,
    initialValue: options.initialValue ?? true,
  });
  return unwrap(answer);
}

/** Comma-separated free text into a trimmed list. */
export function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
