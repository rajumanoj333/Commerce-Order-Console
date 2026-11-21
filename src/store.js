const fs = require('node:fs');
const path = require('node:path');

// Minimal durable JSON store. Writes go to a temp file then rename, so a crash
// mid-write never leaves a half-written data file.
class JsonStore {
  constructor(file) {
    this.file = file;
  }
  exists() {
    return fs.existsSync(this.file);
  }
  load() {
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
