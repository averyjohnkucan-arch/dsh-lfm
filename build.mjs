import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

// DSH provides React and loads this factory; installation never needs a build step.
const result = await build({
  entryPoints: ["client/main.jsx"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["react"],
  loader: { ".css": "text" },
  minify: false,
});
const body = result.outputFiles[0].text;
await writeFile(
  "client.js",
  `// Generated from client/ by npm run build. Edit the source modules.\nwindow.__ModuleLoader__.load({id:'dsh-lfm',factory(require){\nconst module={exports:{}};const exports=module.exports;\n${body}\nreturn module.exports;\n}});\n`,
);
