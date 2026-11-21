const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(state, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
}

// Preserve an existing workspace store on the first launch with local storage.
function prepareDataFile() {
  if (process.env.DATA_FILE) return path.resolve(process.env.DATA_FILE);
  const home = os.homedir();
  const directory = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Stockroom')
    : path.join(home, '.local', 'share', 'stockroom');
  const file = path.join(directory, 'orders.json');
  const local = new JsonStore(file);
  const legacy = new JsonStore(path.join(__dirname, '..', 'data', 'db.json'));
  if (!local.exists() && legacy.exists()) local.save(legacy.load());
  return file;
}

module.exports = { JsonStore, prepareDataFile };
