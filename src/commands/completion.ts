import { reportProblem } from "../errors.js";

export type Shell = "bash" | "zsh" | "fish" | "pwsh";

export const SHELLS: Shell[] = ["bash", "zsh", "fish", "pwsh"];

/**
 * The completion tables are generated from one description of the CLI rather
 * than hand-written per shell, so a new command cannot be added to three shells
 * and forgotten in the fourth.
 */
interface CommandSpec {
  name: string;
  description: string;
  flags: string[];
  subcommands?: CommandSpec[];
}

const GLOBAL_FLAGS = ["--help", "--version", "--verbose", "--quiet"];

const COMMANDS: CommandSpec[] = [
  {
    name: "init",
    description: "Create a new vault",
    flags: [
      "--lang",
      "--yes",
      "--ai",
      "--name",
      "--full-name",
      "--tagline",
      "--naming",
      "--profile",
      "--operator",
      "--role",
      "--aliases",
      "--projects",
      "--no-import",
      "--git",
      "--no-git",
      "--defaults",
      "--dry-run",
    ],
  },
  { name: "status", description: "One-screen vault health", flags: ["--json"] },
  { name: "stats", description: "Token budget report", flags: ["--json"] },
  { name: "doctor", description: "Validate the vault", flags: ["--repair", "--json"] },
  {
    name: "add",
    description: "Add memory nodes",
    flags: [],
    subcommands: [{ name: "project", description: "Add projects", flags: ["--ai"] }],
  },
  {
    name: "project",
    description: "Manage existing projects",
    flags: [],
    subcommands: [
      { name: "remove", description: "Remove a project", flags: [] },
      { name: "rename", description: "Rename a project", flags: [] },
      { name: "archive", description: "Archive a project", flags: ["--restore"] },
    ],
  },
  {
    name: "import",
    description: "Propose projects from an AI export",
    flags: ["--source", "--path", "--ai", "--json", "--all"],
  },
  { name: "agents", description: "Print the agent enforcement block", flags: ["--raw"] },
  {
    name: "skills",
    description: "Agent skills for this vault",
    flags: ["--raw", "--install", "--force"],
  },
  { name: "serve", description: "Serve the vault over MCP", flags: ["--cwd"] },
  {
    name: "hooks",
    description: "Git hooks that validate before a commit",
    flags: [],
    subcommands: [
      { name: "install", description: "Install the pre-commit hook", flags: ["--force"] },
      { name: "uninstall", description: "Remove the pre-commit hook", flags: [] },
    ],
  },
  {
    name: "update",
    description: "Bring a vault up to date",
    flags: ["--dry-run", "--force", "--profile", "--json"],
  },
  {
    name: "sync",
    description: "Validate, commit, and push",
    flags: ["--dry-run", "--json", "--watch"],
  },
  { name: "completion", description: "Print a shell completion script", flags: [] },
];

const TOP_LEVEL = COMMANDS.map((command) => command.name);

function bashScript(): string {
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

function zshScript(): string {
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

function fishScript(): string {
  const lines: string[] = ["# vulcanus fish completion"];
  lines.push("complete -c vulcanus -f");
  for (const command of COMMANDS) {
    lines.push(
      `complete -c vulcanus -n "__fish_use_subcommand" -a "${command.name}" -d "${command.description}"`,
    );
    for (const flag of command.flags) {
      lines.push(
        `complete -c vulcanus -n "__fish_seen_subcommand_from ${command.name}" -l "${flag.replace(/^--/, "")}"`,
      );
    }
    for (const sub of command.subcommands ?? []) {
      lines.push(
        `complete -c vulcanus -n "__fish_seen_subcommand_from ${command.name}" -a "${sub.name}" -d "${sub.description}"`,
      );
    }
  }
  for (const flag of GLOBAL_FLAGS) {
    lines.push(`complete -c vulcanus -l "${flag.replace(/^--/, "")}"`);
  }
  return `${lines.join("\n")}\n`;
}

function pwshScript(): string {
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

const GENERATORS: Record<Shell, () => string> = {
  bash: bashScript,
  zsh: zshScript,
  fish: fishScript,
  pwsh: pwshScript,
};

export function completionScript(shell: Shell): string {
  return GENERATORS[shell]();
}

const INSTALL_HINT: Record<Shell, string> = {
  bash: "vulcanus completion bash >> ~/.bashrc",
  zsh: "vulcanus completion zsh > ~/.zfunc/_vulcanus   # with ~/.zfunc on your $fpath",
  fish: "vulcanus completion fish > ~/.config/fish/completions/vulcanus.fish",
  pwsh: "vulcanus completion pwsh >> $PROFILE",
};

export function completionCommand(shell: string | undefined): number {
  if (!shell || !SHELLS.includes(shell as Shell)) {
    return reportProblem({
      what: shell ? `No completion script for "${shell}".` : "Which shell?",
      why: `Supported shells: ${SHELLS.join(", ")}.`,
      fix: SHELLS.map((entry) => INSTALL_HINT[entry]),
    });
  }

  process.stdout.write(completionScript(shell as Shell));
  return 0;
}
