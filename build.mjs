import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.mjs",
  banner: { js: "#!/usr/bin/env node\nimport{createRequire}from'module';const require=createRequire(import.meta.url);" },
  packages: "external",
});

console.log("Built dist/cli.mjs");
