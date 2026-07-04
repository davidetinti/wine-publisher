import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Archivio su file: bozze in data/drafts.json, foto in data/photos/<id>/.
export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.photosDir = path.join(dataDir, 'photos');
    this.file = path.join(dataDir, 'drafts.json');
    fs.mkdirSync(this.photosDir, { recursive: true });
    this.drafts = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : [];
  }

  persist() {
    fs.writeFileSync(this.file, JSON.stringify(this.drafts, null, 2));
  }

  list() {
    return this.drafts;
  }

  get(id) {
    return this.drafts.find((d) => d.id === id) || null;
  }

  create(fields, photoBuffers) {
    const id = crypto.randomBytes(6).toString('hex');
    const dir = path.join(this.photosDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const photos = photoBuffers.map((buf, i) => {
      const name = `${i + 1}.jpg`;
      fs.writeFileSync(path.join(dir, name), buf);
      return name;
    });
    const draft = {
      id,
      createdAt: new Date().toISOString(),
      status: 'bozza',
      photos,
      ...fields,
    };
    this.drafts.unshift(draft);
    this.persist();
    return draft;
  }

  addPhotos(id, buffers) {
    const draft = this.get(id);
    if (!draft) return null;
    const dir = path.join(this.photosDir, path.basename(id));
    const maxN = draft.photos.reduce((m, n) => Math.max(m, parseInt(n, 10) || 0), 0);
    buffers.forEach((buf, i) => {
      const name = `${maxN + i + 1}.jpg`;
      fs.writeFileSync(path.join(dir, name), buf);
      draft.photos.push(name);
    });
    this.persist();
    return draft;
  }

  update(id, fields) {
    const draft = this.get(id);
    if (!draft) return null;
    Object.assign(draft, fields);
    this.persist();
    return draft;
  }

  remove(id) {
    const i = this.drafts.findIndex((d) => d.id === id);
    if (i === -1) return false;
    this.drafts.splice(i, 1);
    fs.rmSync(path.join(this.photosDir, path.basename(id)), { recursive: true, force: true });
    this.persist();
    return true;
  }

  photoPath(id, name) {
    return path.join(this.photosDir, path.basename(id), path.basename(name));
  }
}
