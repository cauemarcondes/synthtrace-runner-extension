const esbuild = require("esbuild");

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: false,
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ["webview-src/main.tsx"],
  bundle: true,
  outfile: "out/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2017",
  sourcemap: true,
  minify: true,
  jsx: "automatic",
};

if (isWatch) {
  Promise.all([
    esbuild.context(extensionOptions).then((ctx) => ctx.watch()),
    esbuild.context(webviewOptions).then((ctx) => ctx.watch()),
  ])
    .then(() => {
      console.log("[esbuild] Watching for changes...");
    })
    .catch(() => process.exit(1));
} else {
  Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)])
    .then(() => {
      console.log("[esbuild] Build complete.");
    })
    .catch(() => process.exit(1));
}
