// Wheresmitz: upload a photo of a mitz sticker, pin it on the shared map.
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const exifr = require('exifr');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'sightings.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_UPLOAD_MB = 25;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- Tiny JSON store -------------------------------------------------------
let sightings = [];
try { sightings = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { sightings = []; }

let writing = Promise.resolve();
function persist() {
  // Serialize writes and swap the file in atomically.
  writing = writing.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(sightings, null, 2));
    await fs.promises.rename(tmp, DB_FILE);
  });
  return writing;
}

// ---- Helpers ---------------------------------------------------------------
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

async function readPhotoMeta(buffer) {
  try {
    const gps = await exifr.gps(buffer);
    const tags = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate']);
    const taken = tags?.DateTimeOriginal || tags?.CreateDate;
    return {
      lat: gps?.latitude, lng: gps?.longitude,
      takenAt: taken instanceof Date && !isNaN(taken) ? taken.toISOString() : null,
    };
  } catch {
    return {};
  }
}

// Simple per-IP limit so one person cannot flood the map.
const hits = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < 60 * 60 * 1000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Too many uploads from you in the last hour. Try again later.' });
  recent.push(now);
  hits.set(key, recent);
  next();
}

function publicView(s) {
  return {
    id: s.id, lat: s.lat, lng: s.lng, source: s.source,
    takenAt: s.takenAt, uploadedAt: s.uploadedAt,
    caption: s.caption, spotter: s.spotter, place: s.place,
    width: s.width, height: s.height,
    photo: `/uploads/${s.id}.jpg`, thumb: `/uploads/${s.id}_t.jpg`,
  };
}

// ---- App -------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // one hosting proxy in front; keeps the upload limit from being spoofed
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

app.get('/api/sightings', (req, res) => {
  const list = [...sightings].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  res.json(list.map(publicView));
});

app.post('/api/sightings', rateLimit, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload.' });

  // Location: a pin the uploader placed or moved wins; otherwise the photo's own GPS;
  // otherwise GPS the browser read before converting the file (HEIC -> JPEG loses EXIF).
  const meta = await readPhotoMeta(req.file.buffer);
  const bodyLat = parseFloat(req.body.lat), bodyLng = parseFloat(req.body.lng);
  let lat, lng, source;
  if (req.body.source === 'pin' && validCoord(bodyLat, bodyLng)) {
    [lat, lng, source] = [bodyLat, bodyLng, 'pin'];
  } else if (validCoord(meta.lat, meta.lng)) {
    [lat, lng, source] = [meta.lat, meta.lng, 'photo'];
  } else {
    [lat, lng, source] = [bodyLat, bodyLng, req.body.source === 'photo' ? 'photo' : 'pin'];
  }
  if (!validCoord(lat, lng)) {
    return res.status(400).json({ error: 'This photo has no location data. Drop a pin on the map to say where it was taken.' });
  }

  let takenAt = meta.takenAt;
  if (!takenAt && req.body.takenAt) {
    const d = new Date(req.body.takenAt);
    if (!isNaN(d) && d.getTime() <= Date.now() + 86400000) takenAt = d.toISOString();
  }

  const id = crypto.randomBytes(8).toString('hex');
  try {
    // Re-encoding drops every bit of EXIF (camera serials, exact timestamps, etc.).
    const base = sharp(req.file.buffer, { failOn: 'error' }).rotate();
    const full = await base.clone()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(UPLOAD_DIR, `${id}.jpg`));
    await base.clone()
      .resize({ width: 240, height: 240, fit: 'cover' })
      .jpeg({ quality: 76 })
      .toFile(path.join(UPLOAD_DIR, `${id}_t.jpg`));

    const sighting = {
      id,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      source,
      takenAt,
      uploadedAt: new Date().toISOString(),
      caption: clean(req.body.caption, 280),
      spotter: clean(req.body.spotter, 40),
      place: clean(req.body.place, 120),
      width: full.width, height: full.height,
    };
    sightings.push(sighting);
    await persist();
    res.status(201).json(publicView(sighting));
  } catch (err) {
    console.error('upload failed', err.message);
    res.status(415).json({ error: 'That file could not be read as a photo. Try a JPEG, PNG, WebP or HEIC image.' });
  }
});

// Moderation: DELETE /api/sightings/:id with header "Authorization: Bearer <ADMIN_TOKEN>"
app.delete('/api/sightings/:id', async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!ADMIN_TOKEN || token.length !== ADMIN_TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN))) {
    return res.status(403).json({ error: 'Not allowed.' });
  }
  const idx = sightings.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No such sighting.' });
  const [gone] = sightings.splice(idx, 1);
  await persist();
  for (const f of [`${gone.id}.jpg`, `${gone.id}_t.jpg`]) fs.promises.unlink(path.join(UPLOAD_DIR, f)).catch(() => {});
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Photos must be under ${MAX_UPLOAD_MB} MB.` : err.message;
    return res.status(400).json({ error: msg });
  }
  next(err);
});

app.listen(PORT, () => console.log(`Wheresmitz running at http://localhost:${PORT}`));
