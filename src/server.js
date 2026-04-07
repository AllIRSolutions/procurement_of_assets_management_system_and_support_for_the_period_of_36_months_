import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});
app.use(limiter);

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

let db;

async function initializeDatabase() {
  db = await open({
    filename: 'municipal_assets.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      department TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      subcategory TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      acquisition_date DATE,
      acquisition_cost DECIMAL(15,2),
      current_value DECIMAL(15,2),
      depreciation_rate DECIMAL(5,2),
      useful_life_years INTEGER,
      location TEXT,
      gps_latitude DECIMAL(10,8),
      gps_longitude DECIMAL(11,8),
      barcode TEXT,
      qr_code TEXT,
      serial_number TEXT,
      manufacturer TEXT,
      model TEXT,
      warranty_start_date DATE,
      warranty_end_date DATE,
      insurance_value DECIMAL(15,2),
      insurance_policy_number TEXT,
      department_id TEXT,
      responsible_officer TEXT,
      condition_rating INTEGER DEFAULT 5,
      last_inspection_date DATE,
      next_maintenance_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      maintenance_type TEXT NOT NULL,
      frequency TEXT NOT NULL,
      last_performed_date DATE,
      next_due_date DATE,
      estimated_cost DECIMAL(10,2),
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      order_number TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      assigned_to TEXT,
      requested_by INTEGER,
      estimated_cost DECIMAL(10,2),
      actual_cost DECIMAL(10,2),
      scheduled_date DATE,
      completion_date DATE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id),
      FOREIGN KEY (requested_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER,
      uploaded_by INTEGER,
      version INTEGER DEFAULT 1,
      is_current BOOLEAN DEFAULT 1,
      category TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      is_read BOOLEAN DEFAULT 0,
      asset_id INTEGER,
      work_order_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (asset_id) REFERENCES assets(id),
      FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
    );

    CREATE TABLE IF NOT EXISTS asset_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      from_location TEXT,
      to_location TEXT,
      movement_date DATE NOT NULL,
      moved_by INTEGER,
      reason TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES assets(id),
      FOREIGN KEY (moved_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
    CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location);
    CREATE INDEX IF NOT EXISTS idx_maintenance_next_due ON maintenance_schedules(next_due_date);
    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  `);

  const userCount = await db.get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await db.run(`
      INSERT INTO users (username, email, password, role, department) 
      VALUES (?, ?, ?, ?, ?)
    `, ['admin', 'admin@municipality.gov.za', hashedPassword, 'admin', 'IT']);
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        department: user.department
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
});

app.get('/api/assets', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category, status, location, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (name LIKE ? OR asset_code LIKE ? OR description LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (location) {
      whereClause += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }

    const allowedSortColumns = ['name', 'asset_code', 'category', 'status', 'acquisition_date', 'created_at'];
    const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countQuery = `SELECT COUNT(*) as total FROM assets ${whereClause}`;
    const totalResult = await db.get(countQuery, params);
    const total = totalResult.total;

    const query = `
      SELECT * FROM assets 
      ${whereClause}
      ORDER BY ${sortColumn} ${order}
      LIMIT ? OFFSET ?
    `;
    
    const assets = await db.all(query, [...params, parseInt(limit), offset]);

    res.json({
      assets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve assets' });
  }
});

app.post('/api/assets', authenticateToken, requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const {
      asset_code, name, description, category, subcategory, acquisition_date,
      acquisition_cost, useful_life_years, depreciation_rate, location,
      gps_latitude, gps_longitude, serial_number, manufacturer, model,
      warranty_start_date, warranty_end_date, insurance_value,
      insurance_policy_number, department_id, responsible_officer
    } = req.body;

    if (!asset_code || !name || !category) {
      return res.status(400).json({ error: 'Asset code, name, and category are required' });
    }

    const existingAsset = await db.get('SELECT id FROM assets WHERE asset_code = ?', [asset_code]);
    if (existingAsset) {
      return res.status(400).json({ error: 'Asset code already exists' });
    }

    const current_value = acquisition_cost;
    const barcode = `BC${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const qr_code = `QR${asset_code}`;

    const result = await db.run(`
      INSERT INTO assets (
        asset_code, name, description, category, subcategory, acquisition_date,
        acquisition_cost, current_value, useful_life_years, depreciation_rate,
        location, gps_latitude, gps_longitude, barcode, qr_code, serial_number,
        manufacturer, model, warranty_start_date, warranty_end_date,
        insurance_value, insurance_policy_number, department_id, responsible_officer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      asset_code, name, description, category, subcategory, acquisition_date,
      acquisition_cost, current_value, useful_life_years, depreciation_rate,
      location, gps_latitude, gps_longitude, barcode, qr_code, serial_number,
      manufacturer, model, warranty_start_date, warranty_end_date,
      insurance_value, insurance_policy_number, department_id, responsible_officer
    ]);

    const newAsset = await db.get('SELECT * FROM assets WHERE id = ?', [result.lastID]);

    await db.run(`
      INSERT INTO notifications (title, message, type, asset_id)
      VALUES (?, ?, ?, ?)
    `, [
      'New Asset Registered',
      `Asset ${name} (${asset_code}) has been registered in the system`,
      'info',
      result.lastID
    ]);

    res.status(201).json(newAsset);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

app.put('/api/assets/:id', authenticateToken, requireRole(['admin', 'manager', 'user']), async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;

    const asset = await db.get('SELECT * FROM assets WHERE id = ?', [id]);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const allowedFields = [
      'name', 'description', 'status', 'location', 'gps_latitude', 'gps_longitude',
      'current_value', 'condition_rating', 'responsible_officer', 'last