import { Command } from "commander";

const COMMANDS: Record<string, string[]> = {
  "": [
    "login", "logout", "whoami", "switch", "profiles",
    "context", "status", "doctor", "pay",
    "clients", "invoices", "payments", "services",
    "webhooks", "receipts", "teams", "export", "completions",
  ],
  clients: ["list", "get", "create", "update", "search", "validate", "delete"],
  invoices: ["list", "get", "create", "cancel", "search", "files", "download", "drafts", "credit-notes", "complements"],
  payments: ["list", "get", "request", "register", "refund"],
  services: ["list", "get", "create", "update", "delete"],
  receipts: ["list", "stamp", "cancel"],
  webhooks: ["list", "create", "delete"],
  teams: ["list", "get", "integrations"],
  export: ["invoices", "payments", "receipts", "clients"],
  context: ["payments", "invoices", "receipts", "clients", "cobranza", "automations", "services", "webhooks"],
  completions: ["bash", "zsh", "fish"],
};

function bashScript(): string {
  const topLevel = COMMANDS[""].join(" ");
  const cases = Object.entries(COMMANDS)
    .filter(([k]) => k !== "")
    .map(([cmd, subs]) => `      ${cmd}) COMPREPLY=( $(compgen -W "${subs.join(" ")}" -- "$cur") ) ;;`)
    .join("\n");

  return `# gigstack bash completion
# Add to ~/.bashrc: eval "$(gigstack completions bash)"
_gigstack_completions() {
  local cur prev words cword
  _init_completion || return

  local top_commands="${topLevel}"

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$top_commands" -- "$cur") )
    return
  fi

  case "\${words[1]}" in
${cases}
  esac
}

complete -F _gigstack_completions gigstack
`;
}

function zshScript(): string {
  const topLevel = COMMANDS[""].join(" ");
  const cases = Object.entries(COMMANDS)
    .filter(([k]) => k !== "")
    .map(([cmd, subs]) => `      ${cmd}) compadd -- ${subs.join(" ")} ;;`)
    .join("\n");

  return `# gigstack zsh completion
# Add to ~/.zshrc: eval "$(gigstack completions zsh)"
_gigstack_completions() {
  local -a top_commands
  top_commands=(${topLevel})

  if (( CURRENT == 2 )); then
    compadd -- \${top_commands[@]}
    return
  fi

  case "\${words[2]}" in
${cases}
  esac
}

compdef _gigstack_completions gigstack
`;
}

function fishScript(): string {
  const lines: string[] = [
    "# gigstack fish completion",
    "# Save to ~/.config/fish/completions/gigstack.fish",
    "",
    "# Disable file completions",
    "complete -c gigstack -f",
    "",
    "# Top-level commands",
  ];

  for (const cmd of COMMANDS[""]) {
    lines.push(`complete -c gigstack -n '__fish_use_subcommand' -a '${cmd}'`);
  }

  lines.push("");

  for (const [cmd, subs] of Object.entries(COMMANDS)) {
    if (cmd === "") continue;
    lines.push(`# ${cmd} subcommands`);
    for (const sub of subs) {
      lines.push(`complete -c gigstack -n '__fish_seen_subcommand_from ${cmd}' -a '${sub}'`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

export function registerCompletionsCommand(program: Command) {
  program
    .command("completions")
    .description("Generar script de autocompletado para tu shell")
    .argument("<shell>", "Shell: bash, zsh, o fish")
    .action((shell: string) => {
      switch (shell) {
        case "bash":
          process.stdout.write(bashScript());
          break;
        case "zsh":
          process.stdout.write(zshScript());
          break;
        case "fish":
          process.stdout.write(fishScript());
          break;
        default:
          console.error(`Shell no soportado: ${shell}. Usa bash, zsh, o fish.`);
          process.exit(1);
      }
    });
}
