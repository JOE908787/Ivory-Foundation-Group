const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const multer = require('multer');

// multer will be configured after the protected directory is created

const APP_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(__dirname, 'db.sqlite');

const app = express();
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json());

// Sessions
const SESSION_SECRET = process.env.SESSION_SECRET || 'replace-with-secure-secret';
// If running behind a proxy (nginx) enable trust proxy so secure cookies work
if (process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: (process.env.USE_SECURE_COOKIE === '1' || process.env.NODE_ENV === 'production'),
    sameSite: 'lax'
  }
}));

// Serve the static website files from project root
app.use(express.static(APP_ROOT));

// Protected resources folder (not served statically)
const protectedDir = path.join(__dirname, 'protected');
if (!fs.existsSync(protectedDir)) fs.mkdirSync(protectedDir);

// Uploads directory inside protected folder
const uploadsDir = path.join(protectedDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadsDir); },
  filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')); }
});
const upload = multer({ storage });

// Initialize DB
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open DB:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      name TEXT
    )`
  );

  // Add is_admin column if missing
  db.run("ALTER TABLE clients ADD COLUMN is_admin INTEGER DEFAULT 0", (err) => {});

  // Files metadata table
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    originalname TEXT,
    mimetype TEXT,
    path TEXT,
    uploaded_by INTEGER,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Seed a default client if none exists
  db.get('SELECT COUNT(1) AS cnt FROM clients', (err, row) => {
    if (err) return console.error(err);
    if (row.cnt === 0) {
      const defaultEmail = 'client@ivory.example';
      const defaultPassword = 'ChangeMe123!';
      const adminEmail = 'admin@ivory.example';
      const adminPassword = 'AdminChangeMe!';
      bcrypt.hash(defaultPassword, 10).then(hash => {
        db.run('INSERT INTO clients (email, password_hash, name, is_admin) VALUES (?,?,?,?)', [defaultEmail, hash, 'Default Client', 0], (e) => {
          if (e) return console.error('Failed to seed client:', e.message);
          console.log('Seeded default client:', defaultEmail, 'password:', defaultPassword);
        });
      });
      bcrypt.hash(adminPassword, 10).then(hash => {
        db.run('INSERT INTO clients (email, password_hash, name, is_admin) VALUES (?,?,?,?)', [adminEmail, hash, 'Administrator', 1], (e) => {
          if (e) return console.error('Failed to seed admin:', e.message);
          console.log('Seeded admin:', adminEmail, 'password:', adminPassword);
        });
      });
    }
  });
});

// Auth endpoints
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  db.get('SELECT id, email, password_hash, name FROM clients WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(401).json({ error: 'Invalid credentials' });

    bcrypt.compare(password, row.password_hash).then(ok => {
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.clientId = row.id;
      req.session.clientEmail = row.email;
      res.json({ ok: true, email: row.email, name: row.name });
    }).catch(() => res.status(500).json({ error: 'Hash error' }));
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  db.get('SELECT id, email, name FROM clients WHERE id = ?', [req.session.clientId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ id: row.id, email: row.email, name: row.name });
  });
});

// Register endpoint (for administrators) — keep disabled in production
app.post('/api/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  bcrypt.hash(password, 10).then(hash => {
    db.run('INSERT INTO clients (email, password_hash, name) VALUES (?,?,?)', [email, hash, name || 'Client'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, email });
    });
  }).catch(() => res.status(500).json({ error: 'Hashing error' }));
});

// Upload endpoint - only admin users can upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  const clientId = req.session.clientId;
  db.get('SELECT is_admin FROM clients WHERE id = ?', [clientId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin only' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { filename, originalname, mimetype, path: fpath } = req.file;
    db.run('INSERT INTO files (filename, originalname, mimetype, path, uploaded_by) VALUES (?,?,?,?,?)', [filename, originalname, mimetype, fpath, clientId], function(err) {
      if (err) return res.status(500).json({ error: 'DB insert error' });
      res.json({ ok: true, id: this.lastID });
    });
  });
});

// List files for authenticated clients
app.get('/api/files', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  db.all('SELECT id, originalname, mimetype, uploaded_at FROM files ORDER BY uploaded_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// Serve protected file by id
app.get('/protected-files/:id', (req, res) => {
  if (!req.session.clientId) return res.status(401).send('Not authenticated');
  const id = req.params.id;
  db.get('SELECT path, originalname, mimetype FROM files WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).send('DB error');
    if (!row) return res.status(404).send('Not found');
    res.setHeader('Content-Type', row.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.originalname.replace(/\"/g,'') }"`);
    res.sendFile(row.path);
  });
});

// Protected portal — serve an HTML only when authenticated
app.get('/portal', (req, res) => {
  if (!req.session.clientId) return res.redirect('/clients.html');
  const protectedFile = path.join(protectedDir, 'clients-protected.html');
  if (!fs.existsSync(protectedFile)) {
    fs.writeFileSync(protectedFile, `<!doctype html><html><head><meta charset="utf-8"><title>Client Resources</title><link rel="stylesheet" href="/css/style.css"></head><body><div class="container"><h1>Protected Client Resources</h1><p>Welcome, client. This area contains specification sheets, datasheets, and private links.</p><ul><li><a href="#">Specification Sheet (PDF)</a></li><li><a href="#">Installation Guide</a></li><li><a href="#">Maintenance Plan</a></li></ul><p><a href="#" id="logout">Logout</a></p></div><script>document.getElementById('logout').addEventListener('click', function(e){e.preventDefault();fetch('/api/logout',{method:'POST'}).then(()=>location='/clients.html')});</script></body></html>`);
  }
  res.sendFile(protectedFile);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
