import { agents } from "./agents.js";
import { claude } from "./claude.js";
import { copilot } from "./copilot.js";
import { cursor } from "./cursor.js";
import type { EmitTemplate } from "./types.js";

export type { EmitTemplate } from "./types.js";

/** Every file `emit` writes; the order is the order it reports them in. */
export const TEMPLATES: readonly EmitTemplate[] = [agents, claude, cursor, copilot];
