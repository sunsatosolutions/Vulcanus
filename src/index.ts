// Programmatic entry point. The CLI in `cli.ts` is a thin wrapper over these
// same building blocks, so anything reachable here is safe to depend on.

export { CLI_VERSION, PACKAGE_NAME } from "./version.js";

// The locale table, so a tool that reads or writes a manifest knows which
// languages a vault may declare. The catalogs behind it are not exported: their
// keys are an implementation detail and are expected to move.
export { LOCALES, LOCALE_LABELS, type Locale } from "./i18n.js";

export {
  MANIFEST_VERSION,
  MANIFEST_FILENAME,
  DEFAULT_STRUCTURE,
  CORE_PROJECT_NOTES,
  KNOWN_SPECIALIZED_NOTES,
  CORE_SYSTEM_NOTES,
  FULL_SYSTEM_NOTES,
  makeProjectId,
  validateManifest,
} from "./manifest/schema.js";
export type {
  Language,
  NamingStyle,
  VaultProfile,
  VaultIdentity,
  AdminIdentity,
  StructureConfig,
  ProjectGroup,
  ProjectNode,
  ImportRecord,
  VaultManifest,
  ValidationIssue,
} from "./manifest/schema.js";

export {
  ManifestError,
  findVaultRoot,
  manifestPath,
  readManifest,
  writeManifest,
  normalizeManifest,
} from "./manifest/io.js";

export {
  systemNoteKinds,
  operatorSystemNoteKinds,
  projectDirName,
  buildPlan,
  hubExpectations,
  hubNavigationSections,
  returnLinkExpectations,
  recallRouteExpectations,
} from "./manifest/derive.js";
export type { NoteRef, ProjectPlan, GroupPlan, VaultPlan } from "./manifest/derive.js";

export { generateFiles, writeFiles } from "./generate/index.js";
export type { GeneratedFile, WriteAction, WriteResult, WriteOptions } from "./generate/index.js";

export { runDoctor } from "./doctor/index.js";
export type { FindingLevel, DoctorFinding, DoctorReport } from "./doctor/index.js";

export { ADAPTERS, adapterFor, detectSources, analyzeConversations } from "./importers/index.js";
export type {
  DetectedSource,
  ImportAdapter,
  ImportSourceId,
  NormalizedConversation,
  AnalysisResult,
  ProjectCandidate,
  Confidence,
} from "./importers/index.js";

export {
  openVault,
  matchProject,
  recall,
  search,
  appendDecision,
  listProjects,
} from "./mcp/tools.js";
export type {
  VaultHandle,
  RecallResult,
  SearchHit,
  AppendDecisionResult,
  ProjectListing,
} from "./mcp/tools.js";
