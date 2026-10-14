#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { CliError, EXIT, formatProblem, reportProblem } from "./errors.js";
import { ManifestError } from "./manifest/io.js";
import { updateNotice } from "./update-check.js";

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);

  // Machine-readable output must stay clean, so the notice is skipped for --json.
  if (!process.argv.includes("--json")) {
    const notice = await updateNotice();
    if (notice) process.stderr.write(`\n${notice}\n`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(formatProblem(error.problem));
    process.exitCode = error.exitCode;
    return;
  }
  // A malformed vulcanus.json is the operator's file to fix, not a CLI bug.
  if (error instanceof ManifestError) {
    process.exitCode = reportProblem({
      what: error.message,
      why: "vulcanus.json could not be read as a vault manifest.",
      fix: "Fix the field by hand, or restore the file from Git: git checkout -- vulcanus.json",
    });
    return;
  }
  // An unexpected throw is a bug in the CLI, not operator error: say so, and
  // point at the one place that can act on it.
  process.stderr.write(
    formatProblem({
      what: error instanceof Error ? error.message : String(error),
      why: "Vulcanus did not expect this failure.",
      fix: "Report it: https://github.com/sunsatosolutions/Vulcanus/issues",
    }),
  );
  process.exitCode = EXIT.failed;
});
