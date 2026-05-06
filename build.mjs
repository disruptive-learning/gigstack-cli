import { build } from "esbuild";
import pkg from "./package.json" with { type: "json" };

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/cli.mjs",
  banner: { js: "#!/usr/bin/env node\nimport{createRequire}from'module';const require=createRequire(import.meta.url);" },
  packages: "external",
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
});

console.log("Built dist/cli.mjs");
