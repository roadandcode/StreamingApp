/**
 * Jest transformer for ESM-only packages in node_modules (NestJS 12 ships as ESM).
 *
 * At runtime Node 22 loads those packages through require(esm). Jest's module registry can only do
 * that on Node 24.9+, so on Node 22 the tests compile ESM-only dependencies to CommonJS instead.
 * Files that are already CommonJS are returned untouched.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

const TRANSFORMER_VERSION = '2';
const packageTypeCache = new Map();

function nearestPackageType(filename) {
  let dir = path.dirname(filename);
  const visited = [];
  while (true) {
    if (packageTypeCache.has(dir)) {
      const type = packageTypeCache.get(dir);
      for (const v of visited) packageTypeCache.set(v, type);
      return type;
    }
    visited.push(dir);
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      let type = 'commonjs';
      try {
        const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (json.type === 'module') type = 'module';
      } catch {
        // Unreadable package.json: treat as CommonJS.
      }
      for (const v of visited) packageTypeCache.set(v, type);
      return type;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      for (const v of visited) packageTypeCache.set(v, 'commonjs');
      return 'commonjs';
    }
    dir = parent;
  }
}

function isEsmFile(filename) {
  if (filename.endsWith('.mjs')) return true;
  if (filename.endsWith('.cjs')) return false;
  return nearestPackageType(filename) === 'module';
}

module.exports = {
  canInstrument: false,
  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash('sha256')
      .update(TRANSFORMER_VERSION)
      .update('\0')
      .update(ts.version)
      .update('\0')
      .update(sourcePath)
      .update('\0')
      .update(sourceText)
      .digest('hex');
  },
  process(sourceText, sourcePath) {
    if (!isEsmFile(sourcePath)) {
      return { code: sourceText };
    }
    const fileUrl = `require('node:url').pathToFileURL(__filename).href`;
    const prepared = sourceText
      // `const require = createRequire(import.meta.url)` would shadow CommonJS's own `require`.
      .replace(/\b(?:const|let|var)\s+require\s*=\s*createRequire\(\s*import\.meta\.url\s*\)\s*;?/g, '')
      .replace(/\bimport\.meta\.url\b/g, fileUrl)
      .replace(/\bimport\.meta\.dirname\b/g, '__dirname')
      .replace(/\bimport\.meta\.filename\b/g, '__filename');
    const result = ts.transpileModule(prepared, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowJs: true,
        sourceMap: false,
        inlineSourceMap: false,
      },
    });
    return { code: result.outputText };
  },
};
