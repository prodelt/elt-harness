const fs = require('fs');
const path = require('path');

function listDirRecursive(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(listDirRecursive(fullPath));
      } else {
        results.push({ path: fullPath, size: stat.size });
      }
    }
  } catch (e) {
    // ignore
  }
  return results;
}

const memoryDirs = [
  'C:/Users/user/.claude/projects/C--',
  'C:/Users/user/.claude/projects/D--Ametrin-projects-Law-assistant'
];

for (const dir of memoryDirs) {
  console.log(`== Memory Directory: ${dir}`);
  const files = listDirRecursive(dir);
  for (const f of files) {
    if (f.path.includes('memory')) {
      console.log(`  ${f.path} : ${f.size} bytes`);
    }
  }
}
