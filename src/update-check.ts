import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { isNewer } from "./util/semver.js";
import { CLI_VERSION, PACKAGE_NAME } from "./version.js";

const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace("/", "%2F")}/latest`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

interface CacheFile {
  latest: string;
  checkedAt: number;
}

function cachePath(): string {
  const base = process.env.XDG_CACHE_HOME?.trim() || resolve(homedir(), ".cache");
  return resolve(base, "vulcanus", "update-check.json");
}

/** Users and CI systems must be able to turn the network call off entirely. */
export function updateCheckDisabled(): boolean {
  return Boolean(
    process.env.VULCANUS_NO_UPDATE_CHECK || process.env.NO_UPDATE_NOTIFIER || process.env.CI,
  );
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(), "utf8")) as CacheFile;
    if (typeof parsed.latest !== "string" || typeof parsed.checkedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  try {
    const file = cachePath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(cache)}\n`, "utf8");
  } catch {
    // A read-only or missing cache directory must never break a command.
  }
}

async function fetchLatest(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    // Offline, blocked, or slow registry: silently skip the notice.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the latest published version, preferring a cache entry younger than a
 * day. Returns null whenever the answer is unknown — callers must treat that as
 * "no notice", never as "up to date".
 */
export async function latestVersion(): Promise<string | null> {
  if (updateCheckDisabled()) return null;

  const cache = await readCache();
  if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) return cache.latest;

  const latest = await fetchLatest();
  if (!latest) return cache?.latest ?? null;

  await writeCache({ latest, checkedAt: Date.now() });
  return latest;
}

/** The notice to print after a command, or null when nothing is newer. */
export async function updateNotice(current = CLI_VERSION): Promise<string | null> {
  const latest = await latestVersion();
  if (!latest || !isNewer(latest, current)) return null;

  return [
    `Vulcanus ${latest} is available (you have ${current}).`,
    `  npm i -g ${PACKAGE_NAME}@latest`,
    "  vulcanus update   # then bring your vault up to date",
  ].join("\n");
}
