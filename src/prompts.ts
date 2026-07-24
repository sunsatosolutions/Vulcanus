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

export interface TextRequest {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  required?: boolean;
}

export interface SelectRequest {
  message: string;
  options: Array<Choice<string>>;
  initialValue?: string;
}

export interface MultiselectRequest {
  message: string;
  options: Array<Choice<string>>;
  initialValues?: string[];
}

export interface ConfirmRequest {
  message: string;
  initialValue?: boolean;
}

/**
 * Where the answers come from. Swapping this is what makes a command's question
 * flow testable — the wizards are otherwise reachable only through a TTY, and
 * the order and shape of what they ask is exactly the part worth pinning down.
 */
export interface PromptDriver {
  text(request: TextRequest): Promise<string>;
  select(request: SelectRequest): Promise<string>;
  multiselect(request: MultiselectRequest): Promise<string[]>;
  confirm(request: ConfirmRequest): Promise<boolean>;
}

const clackDriver: PromptDriver = {
  async text(request) {
    const answer = await p.text({
      message: request.message,
      placeholder: request.placeholder,
      defaultValue: request.defaultValue,
      initialValue: request.initialValue,
      validate: request.required
        ? (value) => (value.trim() ? undefined : messages(activeLocale).required)
        : undefined,
    });
    return unwrap(answer) ?? "";
  },
  async select(request) {
    return unwrap(
      await p.select({
        message: request.message,
        options: request.options as StringChoice[],
        initialValue: request.initialValue,
      }),
    );
  },
  async multiselect(request) {
    return unwrap(
      await p.multiselect({
        message: request.message,
        options: request.options as StringChoice[],
        initialValues: request.initialValues ?? [],
        required: false,
      }),
    );
  },
  async confirm(request) {
    return unwrap(
      await p.confirm({
        message: request.message,
        initialValue: request.initialValue ?? true,
      }),
    );
  },
};

let driver: PromptDriver = clackDriver;

/** Returns a restore function, so a test can never leak its driver into the next one. */
export function setPromptDriver(next: PromptDriver): () => void {
  const previous = driver;
  driver = next;
  return () => {
    driver = previous;
  };
}

export async function askText(options: TextRequest): Promise<string> {
  return driver.text(options);
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
  return (await driver.select(options as SelectRequest)) as T;
}

export async function askMultiselect<T extends string>(options: {
  message: string;
  options: Array<Choice<T>>;
  initialValues?: T[];
}): Promise<T[]> {
  return (await driver.multiselect(options as MultiselectRequest)) as T[];
}

export async function askConfirm(options: ConfirmRequest): Promise<boolean> {
  return driver.confirm(options);
}

/** Comma-separated free text into a trimmed list. */
export function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
