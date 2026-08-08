import esbuild from "esbuild";

/**
 * Bundle the Vercel serverless entry to plain ESM JS.
 * Vercel's @vercel/node TypeScript pass mis-resolves Express 5 types under
 * pnpm (NextFunction not callable / Request.body missing). Shipping JS avoids that.
 */
await esbuild.build({
  entryPoints: ["src/vercel-handler.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/vercel-api.mjs",
  sourcemap: true,
  packages: "external",
  banner: {
    js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
    `.trim(),
  },
});

console.log("Wrote dist/vercel-api.mjs");
