/**
 * Docker build helper — run once during `docker build`.
 * 1. Replaces every "catalog:" version reference with "*" in all package.json files
 *    (pnpm catalogs are not supported inside a Docker build context).
 * 2. Strips the preinstall guard and Replit-only dependency from the root package.json.
 */
const fs = require("fs");

function walk(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const full = dir + "/" + f;
    if (f === "node_modules" || f === ".git") continue;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else if (f === "package.json") out.push(full);
  }
  return out;
}

for (const file of walk(".")) {
  let txt = fs.readFileSync(file, "utf8");
  let out = txt.replace(/"catalog:"/g, '"*"');

  if (file === "./package.json") {
    const pkg = JSON.parse(out);
    if (pkg.scripts) delete pkg.scripts.preinstall; // remove pnpm-only guard
    delete pkg.dependencies;                         // @replit/connectors-sdk not needed
    out = JSON.stringify(pkg, null, 2);
  }

  if (txt !== out) fs.writeFileSync(file, out);
}

console.log("docker-setup: catalog refs replaced, root package.json cleaned.");
