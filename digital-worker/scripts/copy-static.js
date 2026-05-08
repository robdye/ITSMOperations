// Post-build helper: copy static assets from src/ to dist/.
// Invoked from `npm run build` (see package.json).
const fs = require('fs');
const path = require('path');

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('Copied', src, '->', dst);
}

function copyDir(src, dst, filter = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp, filter);
    else if (filter(entry.name)) fs.copyFileSync(sp, dp);
  }
}

// Voice
copyFile(path.join('src', 'voice', 'voice.html'), path.join('dist', 'voice', 'voice.html'));

// Mission Control: html + css + js
copyFile(path.join('src', 'mission-control.html'), path.join('dist', 'mission-control.html'));
copyFile(path.join('src', 'mission-control.css'), path.join('dist', 'mission-control.css'));
copyFile(path.join('src', 'mission-control.js'), path.join('dist', 'mission-control.js'));

// Demo JSON resources
const isJson = (name) => name.endsWith('.json');
copyDir(path.join('src', 'demo', 'scenarios'), path.join('dist', 'demo', 'scenarios'), isJson);
copyDir(path.join('src', 'demo', 'seed-data'), path.join('dist', 'demo', 'seed-data'), isJson);
copyDir(path.join('src', 'demo', 'tenant-profiles'), path.join('dist', 'demo', 'tenant-profiles'), isJson);

// A2A resources
copyDir(path.join('src', 'a2a'), path.join('dist', 'a2a'), isJson);

console.log('Copied demo JSON resources');
