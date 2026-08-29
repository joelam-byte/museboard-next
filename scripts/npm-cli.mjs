import fs from "node:fs";
import path from "node:path";

export function npmCliInvocation(args) {
  const npmCliPath = resolveNpmCliPath();
  if (npmCliPath) {
    return {
      command: process.execPath,
      args: [npmCliPath, ...args]
    };
  }
  if (process.platform !== "win32") {
    return { command: "npm", args };
  }
  throw new Error("Unable to locate npm-cli.js. Run this visual check through an npm script.");
}

function resolveNpmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}
