const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const logPath = path.join(projectRoot, 'ts_errors.log');

if (!fs.existsSync(logPath)) {
  console.log('No ts_errors.log found.');
  process.exit(0);
}

const logContent = fs.readFileSync(logPath, 'utf8');

// Build a file index
const fileIndex = {}; // basename -> array of { absolutePath, aliasPath }

function walkDir(dir, baseAlias) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    
    // Construct the alias path
    // dir: 'shared/lib/db', baseAlias: '@shared'
    // relative to root: 'shared/lib/db/db.ts'
    const relToRoot = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
    let aliasPath = relToRoot;
    if (relToRoot.startsWith('shared/')) aliasPath = relToRoot.replace('shared/', '@shared/');
    else if (relToRoot.startsWith('services/')) {
        // e.g. services/api-gateway/src/auth/foo.ts -> @services/api-gateway/src/auth/foo.ts
        aliasPath = relToRoot.replace('services/', '@services/');
    }

    // Replace .ts with .js for imports
    if (aliasPath.endsWith('.ts')) aliasPath = aliasPath.replace(/\.ts$/, '.js');
    if (aliasPath.endsWith('.tsx')) aliasPath = aliasPath.replace(/\.tsx$/, '.js');

    if (entry.isDirectory()) {
      walkDir(fullPath, baseAlias);
    } else {
      const baseName = entry.name; // e.g. db.ts
      const baseNameJs = baseName.replace(/\.tsx?$/, '.js');
      
      if (!fileIndex[baseNameJs]) fileIndex[baseNameJs] = [];
      fileIndex[baseNameJs].push({ fullPath, aliasPath });
    }
  }
}

console.log('Building file index...');
walkDir(path.join(projectRoot, 'shared'));
walkDir(path.join(projectRoot, 'services'));

console.log('Parsing errors...');
const regex = /^(.*?\.tsx?)\(\d+,\d+\): error TS2307: Cannot find module ['"](.*?)['"]/gm;
let match;
let fixCount = 0;

const fileEdits = {}; // filePath -> { search, replace }[]

while ((match = regex.exec(logContent)) !== null) {
  const filePathRel = match[1];
  const brokenImport = match[2]; // e.g. ../../../lib/db/db.js
  
  const basename = path.basename(brokenImport); // e.g. db.js
  
  const matches = fileIndex[basename];
  
  if (matches && matches.length === 1) {
    // Exact match found
    const aliasPath = matches[0].aliasPath;
    
    const fullFilePath = path.join(projectRoot, filePathRel);
    if (!fileEdits[fullFilePath]) fileEdits[fullFilePath] = [];
    
    // Only add if not already added to avoid duplicates
    if (!fileEdits[fullFilePath].find(e => e.brokenImport === brokenImport)) {
        fileEdits[fullFilePath].push({ brokenImport, aliasPath });
    }
  } else if (matches && matches.length > 1) {
      // Try to disambiguate by parent dir
      const parentDir = path.basename(path.dirname(brokenImport)); // e.g. 'db'
      const refined = matches.filter(m => m.aliasPath.includes(`/${parentDir}/`));
      if (refined.length === 1) {
        const fullFilePath = path.join(projectRoot, filePathRel);
        if (!fileEdits[fullFilePath]) fileEdits[fullFilePath] = [];
        if (!fileEdits[fullFilePath].find(e => e.brokenImport === brokenImport)) {
            fileEdits[fullFilePath].push({ brokenImport, aliasPath: refined[0].aliasPath });
        }
      } else if (refined.length > 1) {
          // Disambiguate even further using the whole broken import structure
          const suffixToMatch = brokenImport.replace(/(\.\.\/)+/g, '').replace(/^\.\//, ''); // e.g. lib/db/db.js
          const refinedMore = refined.filter(m => m.aliasPath.endsWith(suffixToMatch));
          if (refinedMore.length === 1) {
              const fullFilePath = path.join(projectRoot, filePathRel);
              if (!fileEdits[fullFilePath]) fileEdits[fullFilePath] = [];
              if (!fileEdits[fullFilePath].find(e => e.brokenImport === brokenImport)) {
                  fileEdits[fullFilePath].push({ brokenImport, aliasPath: refinedMore[0].aliasPath });
              }
          }
      }
  }
}

// Apply edits
console.log(`Found fixes for ${Object.keys(fileEdits).length} files.`);
for (const [filePath, edits] of Object.entries(fileEdits)) {
    if (!fs.existsSync(filePath)) continue;
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;
    
    for (const edit of edits) {
        // Find import '...' or import "..."
        // Use a global replacement for the exact string
        // We have to escape special regex chars just in case
        const safeSearch = edit.brokenImport.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const r = new RegExp(`(['"])${safeSearch}(['"])`, 'g');
        content = content.replace(r, `$1${edit.aliasPath}$2`);
    }
    
    if (content !== originalContent) {
        fs.writeFileSync(filePath, content);
        fixCount++;
    }
}

console.log(`Applied fixes to ${fixCount} files.`);
