import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

/**
 * Bundle the Vercel serverless entry into the api/ entry files themselves.
 *
 * Shipping a thin re-export of dist/*.mjs caused Vercel to also package and
 * execute apps/gateway/src/*.js (Express 5 ESM without extensions → runtime
 * ERR_MODULE_NOT_FOUND). The handler file must BE the bundle.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const outfiles = [
  path.join(here, "api", "index.js"),
  path.join(here, "..", "..", "api", "index.js"),
];

const shared = {
  entryPoints: [path.join(here, "src", "vercel-handler.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Pull dependencies into the bundle so monorepo-root deploys don't rely on
  // resolving express from the root package.json.
  packages: "bundle",
  sourcemap: false,
  banner: {
    js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
    `.trim(),
  },
};

for (const outfile of outfiles) {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({ ...shared, outfile });
  console.log(`Wrote ${outfile}`);
}
