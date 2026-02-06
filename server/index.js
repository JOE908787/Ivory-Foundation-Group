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
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

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

// Email configuration (nodemailer)
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'localhost',
  port: parseInt(process.env.MAIL_PORT || '587'),
  secure: process.env.MAIL_SECURE === 'true', // true for 465, false for other ports
  auth: process.env.MAIL_USER ? {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD
  } : undefined
});

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const MAIL_FROM = process.env.MAIL_FROM || 'noreply@ivory.example';

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

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
      name TEXT,
      is_admin INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      reset_token TEXT,
      reset_token_expires DATETIME
    )`
  );

  // Add columns if missing (for existing databases)
  db.run("ALTER TABLE clients ADD COLUMN is_admin INTEGER DEFAULT 0", (err) => {});
  db.run("ALTER TABLE clients ADD COLUMN is_verified INTEGER DEFAULT 0", (err) => {});
  db.run("ALTER TABLE clients ADD COLUMN verification_token TEXT", (err) => {});
  db.run("ALTER TABLE clients ADD COLUMN reset_token TEXT", (err) => {});
  db.run("ALTER TABLE clients ADD COLUMN reset_token_expires DATETIME", (err) => {});

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

  // Audit logs table
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    user_id INTEGER,
    resource_type TEXT,
    resource_id INTEGER,
    details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Helper functions for audit logging
function logAudit(action, userId, resourceType, resourceId, details = '') {
  db.run(
    'INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details) VALUES (?,?,?,?,?)',
    [action, userId, resourceType, resourceId, details],
    (err) => {
      if (err) console.error('Audit log error:', err);
    }
  );
}

// Helper function to send emails
function sendEmail(to, subject, html) {
  return transporter.sendMail({
    from: MAIL_FROM,
    to,
    subject,
    html
  }).catch(err => {
    console.error('Email send error:', err);
    // In development without SMTP, this will fail but not break functionality
  });
}

// Auth endpoints
app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  db.get('SELECT id, email, password_hash, name, is_verified FROM clients WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(401).json({ error: 'Invalid credentials' });

    if (!row.is_verified) return res.status(403).json({ error: 'Email not verified. Check your inbox for a verification link.' });

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
  
  // Generate verification token
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  bcrypt.hash(password, 10).then(hash => {
    db.run('INSERT INTO clients (email, password_hash, name, is_verified, verification_token) VALUES (?,?,?,?,?)', 
      [email, hash, name || 'Client', 0, verificationToken], 
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Send verification email
        const verifyLink = `${APP_URL}/verify-email.html?token=${verificationToken}`;
        const htmlContent = `
          <h2>Welcome to Ivory Foundation Group!</h2>
          <p>Please verify your email address to activate your account:</p>
          <p><a href="${verifyLink}" style="background-color: #1a472a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Verify Email</a></p>
          <p>Or copy this link: ${verifyLink}</p>
          <p>This link expires in 24 hours.</p>
        `;
        
        sendEmail(email, 'Verify Your Email - Ivory Foundation Group', htmlContent);
        
        res.json({ id: this.lastID, email, message: 'Registration successful. Please check your email to verify your account.' });
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
      logAudit('FILE_UPLOADED', clientId, 'file', this.lastID, `File ${originalname} uploaded`);
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

// Admin: list users
app.get('/api/users', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  db.get('SELECT is_admin FROM clients WHERE id = ?', [req.session.clientId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin only' });
    db.all('SELECT id, email, name, is_admin FROM clients ORDER BY id', [], (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      res.json(rows);
    });
  });
});

// Admin: delete file by id
app.delete('/api/files/:id', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  const clientId = req.session.clientId;
  db.get('SELECT is_admin FROM clients WHERE id = ?', [clientId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin only' });
    const id = req.params.id;
    db.get('SELECT path, originalname FROM files WHERE id = ?', [id], (err2, fileRow) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      if (!fileRow) return res.status(404).json({ error: 'Not found' });
      const filePath = fileRow.path;
      // remove file from disk
      fs.unlink(filePath, (unlinkErr) => {
        // ignore unlink errors but proceed to delete DB record
        db.run('DELETE FROM files WHERE id = ?', [id], function(err3) {
          if (err3) return res.status(500).json({ error: 'DB delete error' });
          logAudit('FILE_DELETED', clientId, 'file', id, `File ${fileRow.originalname} deleted`);
          res.json({ ok: true });
        });
      });
    });
  });
});

// Admin: delete user by id (cannot delete self)
app.delete('/api/users/:id', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  const clientId = req.session.clientId;
  db.get('SELECT is_admin FROM clients WHERE id = ?', [clientId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin only' });
    const id = parseInt(req.params.id, 10);
    if (id === clientId) return res.status(400).json({ error: 'Cannot delete yourself' });
    db.get('SELECT email FROM clients WHERE id = ?', [id], (err2, userRow) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      if (!userRow) return res.status(404).json({ error: 'User not found' });
      db.run('DELETE FROM clients WHERE id = ?', [id], function(err2) {
        if (err2) return res.status(500).json({ error: 'DB delete error' });
        logAudit('USER_DELETED', clientId, 'client', id, `User ${userRow.email} deleted`);
        res.json({ ok: true });
      });
    });
  });
});

// Admin: toggle user admin role (PATCH /api/users/:id)
app.patch('/api/users/:id', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  const clientId = req.session.clientId;
  db.get('SELECT is_admin FROM clients WHERE id = ?', [clientId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin only' });
    const id = parseInt(req.params.id, 10);
    if (id === clientId) return res.status(400).json({ error: 'Cannot change your own admin role' });
    db.get('SELECT is_admin, email FROM clients WHERE id = ?', [id], (err2, targetRow) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      if (!targetRow) return res.status(404).json({ error: 'User not found' });
      const newAdminStatus = targetRow.is_admin ? 0 : 1;
      db.run('UPDATE clients SET is_admin = ? WHERE id = ?', [newAdminStatus, id], function(err3) {
        if (err3) return res.status(500).json({ error: 'DB update error' });
        db.get('SELECT id, email, name, is_admin FROM clients WHERE id = ?', [id], (err4, updated) => {
          if (err4) return res.status(500).json({ error: 'DB error' });
          const action = newAdminStatus ? 'USER_PROMOTED' : 'USER_DEMOTED';
          logAudit(action, clientId, 'client', id, `User ${targetRow.email} role changed to ${newAdminStatus ? 'admin' : 'client'}`);
          res.json(updated);
        });
      });
    });
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

// Email verification endpoint
app.post('/api/verify-email', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token required' });
  
  db.get('SELECT id, email FROM clients WHERE verification_token = ?', [token], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(400).json({ error: 'Invalid or expired token' });
    
    db.run('UPDATE clients SET is_verified = 1, verification_token = NULL WHERE id = ?', [row.id], (err2) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      logAudit('EMAIL_VERIFIED', row.id, 'client', row.id, `Email ${row.email} verified`);
      res.json({ ok: true, message: 'Email verified successfully. You can now login.' });
    });
  });
});

// Request password reset
app.post('/api/request-password-reset', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  db.get('SELECT id, name FROM clients WHERE email = ?', [email], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    
    // Always return success (privacy - don't reveal if email exists)
    if (!row) return res.json({ ok: true, message: 'If that email exists in our system, a password reset link has been sent.' });
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(); // 1 hour
    
    db.run('UPDATE clients SET reset_token = ?, reset_token_expires = ? WHERE id = ?', 
      [resetToken, expiresAt, row.id], (err2) => {
        if (err2) return res.status(500).json({ error: 'DB error' });
        
        const resetLink = `${APP_URL}/reset-password.html?token=${resetToken}`;
        const htmlContent = `
          <h2>Password Reset Request</h2>
          <p>Hi ${row.name || 'there'},</p>
          <p>We received a request to reset the password for your account. Click the link below to reset it:</p>
          <p><a href="${resetLink}" style="background-color: #1a472a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Reset Password</a></p>
          <p>Or copy this link: ${resetLink}</p>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't request this, you can ignore this email.</p>
        `;
        
        sendEmail(email, 'Password Reset - Ivory Foundation Group', htmlContent);
        logAudit('PASSWORD_RESET_REQUESTED', row.id, 'client', row.id, `Password reset requested for ${email}`);
        
        res.json({ ok: true, message: 'If that email exists in our system, a password reset link has been sent.' });
      });
  });
});

// Reset password
app.post('/api/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  
  db.get('SELECT id FROM clients WHERE reset_token = ? AND reset_token_expires > datetime("now")', [token], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(400).json({ error: 'Invalid or expired token' });
    
    bcrypt.hash(password, 10).then(hash => {
      db.run('UPDATE clients SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', 
        [hash, row.id], (err2) => {
          if (err2) return res.status(500).json({ error: 'DB error' });
          logAudit('PASSWORD_RESET_COMPLETED', row.id, 'client', row.id, 'Password successfully reset');
          res.json({ ok: true, message: 'Password reset successfully. You can now login.' });
        });
    }).catch(() => res.status(500).json({ error: 'Hashing error' }));
  });
});

// Admin: get audit logs
app.get('/api/audit-logs', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  db.get('SELECT is_admin FROM clients WHERE id = ?', [req.session.clientId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin only' });
    
    db.all('SELECT id, action, user_id, resource_type, resource_id, details, timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT 100', [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json(rows || []);
    });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
