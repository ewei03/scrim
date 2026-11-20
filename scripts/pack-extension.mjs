// Builds the Chrome Web Store upload: dist/scrim-extension-<version>.zip.
//
// Same files as extension/, minus the tests and type declarations, and with
// localhost taken out of the manifest so the store version only talks to the
// live site. (extension/ itself keeps localhost for local development.)
//
// Usage: npm run ext:zip

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const SRC = "extension";
const OUT = "dist";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)\//;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith(".test.ts") || name.endsWith(".d.ts") ? [] : [path];
  });
}

function storeManifest(text) {
  const manifest = JSON.parse(text);
  manifest.host_permissions = manifest.host_permissions.filter((p) => !LOCAL.test(p));
  for (const cs of manifest.content_scripts) cs.matches = cs.matches.filter((m) => !LOCAL.test(m));
  manifest.content_scripts = manifest.content_scripts.filter((cs) => cs.matches.length > 0);
  return { manifest, text: JSON.stringify(manifest, null, 2) + "\n" };
}

/** A minimal zip writer (deflate), enough for the Web Store. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // Fixed DOS timestamp (2026-01-01) so the same files give the same zip.
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

let version = "";
const entries = files(SRC)
  .sort()
  .map((path) => {
    const name = relative(SRC, path).split(sep).join("/");
    let data = readFileSync(path);
    if (name === "manifest.json") {
      const { manifest, text } = storeManifest(data.toString("utf8"));
      version = manifest.version;
      data = Buffer.from(text, "utf8");
    }
    return { name, data };
  });

mkdirSync(OUT, { recursive: true });
const out = join(OUT, `scrim-extension-${version}.zip`);
writeFileSync(out, zip(entries));
console.log(`${out} (${entries.length} files): ${entries.map((e) => e.name).join(", ")}`);
