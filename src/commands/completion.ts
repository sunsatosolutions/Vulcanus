import type { Command } from "commander";
import { reportProblem } from "../errors.js";

export type Shell = "bash" | "zsh" | "fish" | "pwsh";

export const SHELLS: Shell[] = ["bash", "zsh", "fish", "pwsh"];

/**
 * The completion tables are read from the command tree the CLI actually parses
 * with, so a new command or flag reaches every shell without a second list to
 * keep in step.
 */
interface CommandSpec {
  name: string;
  description: string;
  flags: string[];
  subcommands?: CommandSpec[];
}

interface Tables {
  commands: CommandSpec[];
  topLevel: string[];
  globalFlags: string[];
}

function flagsOf(command: Command): string[] {
  return command.options.map((option) => option.long).filter((flag): flag is string => !!flag);
}

/** A command's flags, with its subcommands' flags folded in: the shells complete one level of flags. */
function specOf(command: Command): CommandSpec {
  return {
    name: command.name(),
    description: command.description(),
    flags: [...new Set([flagsOf(command), ...command.commands.map(flagsOf)].flat())],
    ...(command.commands.length ? { subcommands: command.commands.map(specOf) } : {}),
  };
}

function tablesOf(program: Command): Tables {
  const commands = program.commands.map(specOf);
  return {
    commands,
    topLevel: commands.map((command) => command.name),
    globalFlags: ["--help", ...flagsOf(program)],
  };
}

/** A fish double-quoted string: only these characters are special inside one. */
function fishQuote(text: string): string {
  return `"${text.replace(/[\\"$]/g, "\\$&")}"`;
}

function bashScript({
  commands: COMMANDS,
  topLevel: TOP_LEVEL,
  globalFlags: GLOBAL_FLAGS,
}: Tables): string {
  const subcases = COMMANDS.filter((command) => command.subcommands?.length)
    .map(
      (command) =>
        `      ${command.name}) words="${command.subcommands!.map((sub) => sub.name).join(" ")}" ;;`,
    )
    .join("\n");

  const flagcases = COMMANDS.map(
    (command) => `      ${command.name}) words="$words ${command.flags.join(" ")}" ;;`,
  ).join("\n");

  return `# vulcanus bash completion
_vulcanus() {
  local cur prev words
  cur="\${COMP_WORDS[COMP_CWORD]}"
  words="${TOP_LEVEL.join(" ")} ${GLOBAL_FLAGS.join(" ")}"

  if [ "\${COMP_CWORD}" -gt 1 ]; then
    case "\${COMP_WORDS[1]}" in
${subcases}
      *) words="" ;;
    esac
    case "\${COMP_WORDS[1]}" in
${flagcases}
    esac
    words="$words ${GLOBAL_FLAGS.join(" ")}"
  fi

  COMPREPLY=( $(compgen -W "$words" -- "$cur") )
}
complete -F _vulcanus vulcanus
`;
}

function zshScript({ commands: COMMANDS, globalFlags: GLOBAL_FLAGS }: Tables): string {
  const describe = COMMANDS.map(
    (command) => `    '${command.name}:${command.description.replace(/'/g, "")}'`,
  ).join("\n");

  const subs = COMMANDS.filter((command) => command.subcommands?.length)
    .map(
      (command) => `      ${command.name})
        _values 'subcommand' ${command.subcommands!.map((sub) => `'${sub.name}'`).join(" ")}
        ;;`,
    )
    .join("\n");

  const flags = COMMANDS.map(
    (command) =>
      `      ${command.name}) _values 'flag' ${command.flags
        .concat(GLOBAL_FLAGS)
        .map((flag) => `'${flag}'`)
        .join(" ")} ;;`,
  ).join("\n");

  return `#compdef vulcanus
# vulcanus zsh completion
_vulcanus() {
  local -a commands
  commands=(
${describe}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "\${words[2]}" in
${subs}
  esac

  case "\${words[2]}" in
${flags}
  esac
}
compdef _vulcanus vulcanus
`;
}

function fishScript({ commands: COMMANDS, globalFlags: GLOBAL_FLAGS }: Tables): string {
  const lines: string[] = ["# vulcanus fish completion"];
  lines.push("complete -c vulcanus -f");
  for (const command of COMMANDS) {
    lines.push(
      `complete -c vulcanus -n "__fish_use_subcommand" -a "${command.name}" -d ${fishQuote(command.description)}`,
    );
    for (const flag of command.flags) {
      lines.push(
        `complete -c vulcanus -n "__fish_seen_subcommand_from ${command.name}" -l "${flag.replace(/^--/, "")}"`,
      );
    }
    for (const sub of command.subcommands ?? []) {
      lines.push(
        `complete -c vulcanus -n "__fish_seen_subcommand_from ${command.name}" -a "${sub.name}" -d ${fishQuote(sub.description)}`,
      );
    }
  }
  for (const flag of GLOBAL_FLAGS) {
    lines.push(`complete -c vulcanus -l "${flag.replace(/^--/, "")}"`);
  }
  return `${lines.join("\n")}\n`;
}

function pwshScript({
  commands: COMMANDS,
  topLevel: TOP_LEVEL,
  globalFlags: GLOBAL_FLAGS,
}: Tables): string {
  const table = COMMANDS.map(
    (command) =>
      `    '${command.name}' = @(${[
        ...command.flags,
        ...(command.subcommands ?? []).map((sub) => sub.name),
      ]
        .map((entry) => `'${entry}'`)
        .join(", ")})`,
  ).join("\n");

  return `# vulcanus PowerShell completion
Register-ArgumentCompleter -Native -CommandName vulcanus -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(${TOP_LEVEL.map((name) => `'${name}'`).join(", ")})
  $perCommand = @{
${table}
  }

  $tokens = $commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() }
  $first = $tokens | Select-Object -First 1

  $candidates = if ($first -and $perCommand.ContainsKey($first)) {
    $perCommand[$first] + @(${GLOBAL_FLAGS.map((flag) => `'${flag}'`).join(", ")})
  } else {
    $commands
  }

  $candidates |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`;
}

const GENERATORS: Record<Shell, (tables: Tables) => string> = {
  bash: bashScript,
  zsh: zshScript,
  fish: fishScript,
  pwsh: pwshScript,
};

export function completionScript(shell: Shell, program: Command): string {
  return GENERATORS[shell](tablesOf(program));
}

const INSTALL_HINT: Record<Shell, string> = {
  bash: "vulcanus completion bash >> ~/.bashrc",
  zsh: "vulcanus completion zsh > ~/.zfunc/_vulcanus   # with ~/.zfunc on your $fpath",
  fish: "vulcanus completion fish > ~/.config/fish/completions/vulcanus.fish",
  pwsh: "vulcanus completion pwsh >> $PROFILE",
};

export function completionCommand(shell: string | undefined, program: Command): number {
  if (!shell || !SHELLS.includes(shell as Shell)) {
    return reportProblem({
      what: shell ? `No completion script for "${shell}".` : "Which shell?",
      why: `Supported shells: ${SHELLS.join(", ")}.`,
      fix: SHELLS.map((entry) => INSTALL_HINT[entry]),
    });
  }

  process.stdout.write(completionScript(shell as Shell, program));
  return 0;
}
