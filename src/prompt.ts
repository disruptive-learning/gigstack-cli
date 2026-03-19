import { createInterface } from "node:readline";
import pc from "picocolors";

const rl = () => createInterface({ input: process.stdin, output: process.stdout });

export function ask(question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? pc.dim(` (${defaultVal})`) : "";
  return new Promise((resolve) => {
    const r = rl();
    r.question(`${pc.bold(question)}${suffix}: `, (answer) => {
      r.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export function askRequired(question: string): Promise<string> {
  return new Promise(async (resolve) => {
    let val = "";
    while (!val) {
      val = await ask(question);
      if (!val) console.log(pc.red("  Campo requerido"));
    }
    resolve(val);
  });
}

export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const r = rl();
    process.stdout.write(`${pc.bold(question)}: `);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let input = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r") {
          process.stdin.setRawMode!(false);
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          r.close();
          resolve(input.trim());
        } else if (c === "\u007f" || c === "\b") {
          input = input.slice(0, -1);
        } else if (c === "\u0003") {
          process.exit(0);
        } else {
          input += c;
        }
      };
      process.stdin.on("data", onData);
    } else {
      r.question("", (answer) => {
        r.close();
        resolve(answer.trim());
      });
    }
  });
}

export async function select(question: string, options: { label: string; value: string }[]): Promise<string> {
  console.log(pc.bold(question));
  options.forEach((o, i) => console.log(`  ${pc.dim(`${i + 1})`)} ${o.label}`));
  const answer = await ask("Selecciona", "1");
  const idx = parseInt(answer) - 1;
  if (idx >= 0 && idx < options.length) return options[idx].value;
  // Try matching by value
  const match = options.find((o) => o.value === answer || o.label.toLowerCase().includes(answer.toLowerCase()));
  return match?.value || options[0].value;
}

export async function confirm(question: string, defaultVal = true): Promise<boolean> {
  const hint = defaultVal ? "S/n" : "s/N";
  const answer = await ask(`${question} (${hint})`);
  if (!answer) return defaultVal;
  return answer.toLowerCase().startsWith("s") || answer.toLowerCase().startsWith("y");
}
