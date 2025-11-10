const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const multer = require('multer');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const PORT = 5000;
const UPLOAD_DIR = 'uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session 中介軟體
app.use(session({
  secret: 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // 如果使用 HTTPS 設為 true
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 小時
    sameSite: 'lax' // 允許跨頁面導航時保持 session
  }
}));

// 多資料庫管理
let db = null; // 當前使用的資料庫連線
let currentDbName = 'permissions.db'; // 當前資料庫名稱
const DB_DIR = 'databases'; // 資料庫存放目錄

// 確保資料庫目錄存在且權限正確
function ensureDatabaseDirectory() {
  try {
    // 檢查目錄是否存在
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { mode: 0o775 });
      console.log('✅ Created databases directory with proper permissions (775)');
    }
    
    // 測試寫入權限
    const testFile = path.join(DB_DIR, '.write_test_' + Date.now());
    try {
      fs.writeFileSync(testFile, 'permission test');
      fs.unlinkSync(testFile);
      console.log('✅ Database directory has write permissions');
    } catch (writeError) {
      console.error('\n' + '='.repeat(70));
      console.error('❌ DATABASE PERMISSION ERROR - 資料庫權限錯誤');
      console.error('='.repeat(70));
      console.error('\n錯誤：資料庫目錄無法寫入！');
      console.error('\n可能原因：');
      console.error('  1. 目錄權限不足');
      console.error('  2. 檔案擁有者不正確');
      console.error('  3. 磁碟空間不足');
      console.error('\n修復方法（在伺服器上執行）：');
      console.error('  cd ' + process.cwd());
      console.error('  sudo chown -R $USER:$USER ' + DB_DIR + '/');
      console.error('  chmod 775 ' + DB_DIR + '/');
      console.error('  chmod 664 ' + DB_DIR + '/*.db');
      console.error('\n然後重啟應用：');
      console.error('  pm2 restart all');
      console.error('\n' + '='.repeat(70) + '\n');
      throw new Error('Database directory is not writable: ' + writeError.message);
    }
    
    // 檢查現有資料庫檔案權限
    const dbFiles = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.db'));
    if (dbFiles.length > 0) {
      console.log(`📂 Found ${dbFiles.length} database file(s)`);
      
      // 嘗試檢查每個檔案的可寫性
      let hasPermissionIssue = false;
      dbFiles.forEach(dbFile => {
        const dbPath = path.join(DB_DIR, dbFile);
        try {
          fs.accessSync(dbPath, fs.constants.W_OK);
          console.log(`  ✅ ${dbFile} - writable`);
        } catch (err) {
          console.error(`  ❌ ${dbFile} - NOT writable!`);
          hasPermissionIssue = true;
        }
      });
      
      if (hasPermissionIssue) {
        console.error('\n⚠️  警告：某些資料庫檔案沒有寫入權限');
        console.error('   請執行：chmod 664 ' + DB_DIR + '/*.db\n');
      }
    }
  } catch (error) {
    if (error.message.includes('not writable')) {
      throw error; // 重新拋出我們自訂的錯誤
    }
    console.error('Database directory setup error:', error);
    throw error;
  }
}

// 執行權限檢查
ensureDatabaseDirectory();

// 初始化資料庫連線
function connectDatabase(dbName) {
  const dbPath = path.join(DB_DIR, dbName);
  
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('DB Connection Error:', err);
        reject(err);
        return;
      }
      console.log(`Connected to database: ${dbName}`);
      
      // 初始化資料表結構
      initializeTables(database, (initErr) => {
        if (initErr) {
          console.error('Table initialization error:', initErr);
          reject(initErr);
          return;
        }
        resolve(database);
      });
    });
  });
}

// 初始化資料表
function initializeTables(database, callback) {
  database.serialize(() => {
    // 帳號表（全域，用於登入認證）
    database.run(`CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'pending',
      user_database TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // 資料夾表
    database.run(`CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      path TEXT
    )`);
    
    // 人員表
    database.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL
    )`);
    
    // 群組表
    database.run(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )`);
    
    // 群組成員關聯表
    database.run(`CREATE TABLE IF NOT EXISTS group_users (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    
    // 權限表
    database.run(`CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      user_id INTEGER,
      group_id INTEGER,
      permission_type TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
    )`, callback);
  });
}

// 建立預設管理員帳號和資料庫
async function createDefaultAdmin() {
  const adminUsername = 'admin';
  const adminPassword = 'admin123'; // 預設密碼
  const adminDbName = 'admin.db';
  
  return new Promise(async (resolve, reject) => {
    // 檢查管理員帳號是否已存在
    db.get('SELECT id FROM accounts WHERE username = ?', [adminUsername], async (err, row) => {
      if (err) return reject(err);
      
      if (row) {
        console.log('✓ Admin account already exists');
        return resolve();
      }
      
      try {
        // 建立管理員帳號
        const passwordHash = await bcrypt.hash(adminPassword, 10);
        
        await new Promise((res, rej) => {
          db.run(
            'INSERT INTO accounts (username, password_hash, full_name, role, status, user_database) VALUES (?, ?, ?, ?, ?, ?)',
            [adminUsername, passwordHash, '系統管理員', 'admin', 'active', adminDbName],
            function(err) {
              if (err) return rej(err);
              console.log(`✓ Created default admin account: ${adminUsername} / ${adminPassword}`);
              res(this.lastID);
            }
          );
        });
        
        // 建立管理員專屬資料庫
        const adminDb = await connectDatabase(adminDbName);
        adminDb.close();
        console.log(`✓ Created admin database: ${adminDbName}`);
        
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

// 載入預設資料庫或最後使用的資料庫
async function loadDefaultDatabase() {
  const configFile = path.join(DB_DIR, 'config.json');
  let dbToLoad = 'system.db'; // 系統資料庫，用於帳號管理
  
  // 讀取上次使用的資料庫
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (config.lastDatabase) {
        dbToLoad = config.lastDatabase;
      }
    } catch (err) {
      console.error('Failed to read config:', err);
    }
  }
  
  try {
    db = await connectDatabase(dbToLoad);
    currentDbName = dbToLoad;
    console.log(`System database loaded: ${dbToLoad}`);
    
    // 建立預設管理員帳號
    await createDefaultAdmin();
  } catch (err) {
    console.error('Failed to load default database:', err);
    process.exit(1);
  }
}

// 啟動時載入預設資料庫
loadDefaultDatabase().then(() => {
  console.log('Database initialized!');
});

// ==================== 認證中介軟體 ====================

// 檢查是否已登入
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'unauthorized', message: '請先登入' });
  }
}

// 檢查是否為管理員
function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'forbidden', message: '需要管理員權限' });
  }
}

// 取得使用者資料庫的中介軟體
async function withUserDatabase(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'unauthorized', message: '請先登入' });
  }
  
  try {
    const userDb = await getUserDatabase(req.session.userId, req.session.userDatabase);
    req.userDb = userDb; // 將使用者資料庫附加到請求物件
    next();
  } catch (error) {
    console.error('無法取得使用者資料庫:', error);
    res.status(500).json({ error: '無法連接到資料庫' });
  }
}

// ==================== 帳號管理 API ====================

// 註冊
app.post('/api/auth/register', async (req, res) => {
  console.log('Hit POST /api/auth/register', req.body);
  const { username, password, full_name } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '請提供使用者名稱和密碼' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: '密碼長度至少需要 6 個字元' });
  }
  
  // 驗證使用者名稱格式（只允許英數字和底線）
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: '使用者名稱只能包含英數字和底線' });
  }
  
  try {
    // 檢查使用者是否已存在
    const existingUser = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM accounts WHERE username = ?', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (existingUser) {
      return res.status(400).json({ error: '使用者名稱已存在' });
    }
    
    // 雜湊密碼
    const passwordHash = await bcrypt.hash(password, 10);
    
    // 建立使用者專屬資料庫名稱
    const userDbName = `user_${username}.db`;
    
    // 建立帳號（待審核狀態）
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO accounts (username, password_hash, full_name, role, status, user_database) VALUES (?, ?, ?, ?, ?, ?)',
        [username, passwordHash, full_name || null, 'user', 'pending', userDbName],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
    
    // 建立使用者專屬資料庫
    const userDb = await connectDatabase(userDbName);
    userDb.close();
    
    console.log(`✓ 帳號建立成功（待審核）: ${username}, 資料庫: ${userDbName}`);
    res.json({ 
      success: true, 
      message: '註冊成功！您的帳號正在等待管理員審核，審核通過後即可登入。',
      requiresApproval: true
    });
    
  } catch (error) {
    console.error('註冊錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

// 使用者資料庫連線管理（每個使用者一個連線）
const userDatabases = new Map();

// 取得使用者的資料庫連線
async function getUserDatabase(userId, userDbName) {
  // Key 包含 userId 和資料庫名稱，確保切換資料庫時不會使用錯誤的緩存
  const key = `user_${userId}_${userDbName}`;
  
  if (userDatabases.has(key)) {
    console.log(`Using cached database connection: ${key}`);
    return userDatabases.get(key);
  }
  
  console.log(`Creating new database connection: ${key}`);
  const userDb = await connectDatabase(userDbName);
  userDatabases.set(key, userDb);
  return userDb;
}

// 登入
app.post('/api/auth/login', async (req, res) => {
  console.log('Hit POST /api/auth/login', { username: req.body.username });
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '請提供使用者名稱和密碼' });
  }
  
  try {
    // 查找使用者（從系統資料庫）
    const systemDb = db; // 保存系統資料庫連線
    const user = await new Promise((resolve, reject) => {
      systemDb.get('SELECT * FROM accounts WHERE username = ?', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!user) {
      return res.status(401).json({ error: '使用者名稱或密碼錯誤' });
    }
    
    // 檢查帳號狀態
    if (user.status === 'pending') {
      return res.status(403).json({ 
        error: '帳號尚未通過審核',
        message: '您的帳號正在等待管理員審核，請稍後再試。'
      });
    }
    
    if (user.status === 'rejected') {
      return res.status(403).json({ 
        error: '帳號已被拒絕',
        message: '您的帳號申請已被拒絕，請聯繫管理員。'
      });
    }
    
    if (user.status !== 'active') {
      return res.status(403).json({ error: '帳號狀態異常，請聯繫管理員' });
    }
    
    // 驗證密碼
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: '使用者名稱或密碼錯誤' });
    }
    
    // 切換到使用者的專屬資料庫
    try {
      const userDb = await getUserDatabase(user.id, user.user_database);
      
      // 設定 session（包含使用者資料庫資訊）
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.fullName = user.full_name;
      req.session.role = user.role;
      req.session.userDatabase = user.user_database;
      
      console.log(`✓ 登入成功: ${username}, 資料庫: ${user.user_database}`);
      res.json({ 
        success: true, 
        message: '登入成功',
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role,
          database: user.user_database
        }
      });
    } catch (dbError) {
      console.error('資料庫切換失敗:', dbError);
      return res.status(500).json({ error: '無法連接到您的資料庫，請聯繫管理員' });
    }
    
  } catch (error) {
    console.error('登入錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  console.log('Hit POST /api/auth/logout');
  req.session.destroy((err) => {
    if (err) {
      console.error('登出錯誤:', err);
      return res.status(500).json({ error: '登出失敗' });
    }
    res.json({ success: true, message: '登出成功' });
  });
});

// 修改密碼
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.session.userId;
  
  try {
    // 驗證輸入
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: '請提供當前密碼和新密碼' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密碼長度至少需要 6 個字元' });
    }
    
    // 使用系統資料庫（帳號資料庫）
    const systemDb = db;
    
    // 查詢當前使用者
    const user = await new Promise((resolve, reject) => {
      systemDb.get('SELECT * FROM accounts WHERE id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!user) {
      return res.status(404).json({ error: '使用者不存在' });
    }
    
    // 驗證當前密碼
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: '當前密碼錯誤' });
    }
    
    // 檢查新密碼是否與舊密碼相同
    const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({ error: '新密碼不能與當前密碼相同' });
    }
    
    // 加密新密碼
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    // 更新密碼
    await new Promise((resolve, reject) => {
      systemDb.run(
        'UPDATE accounts SET password_hash = ? WHERE id = ?',
        [newPasswordHash, userId],
        function(err) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });
    
    console.log(`✓ 使用者 ${user.username} 已成功修改密碼`);
    
    res.json({
      success: true,
      message: '密碼修改成功'
    });
    
  } catch (error) {
    console.error('修改密碼錯誤:', error);
    res.status(500).json({ error: '修改密碼失敗，請稍後再試' });
  }
});

// 檢查登入狀態
app.get('/api/auth/status', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({
      loggedIn: true,
      user: {
        id: req.session.userId,
        username: req.session.username,
        fullName: req.session.fullName,
        role: req.session.role
      }
    });
  } else {
    res.json({ loggedIn: false });
  }
});

// 檢查是否有任何帳號
app.get('/api/auth/has-accounts', (req, res) => {
  db.get('SELECT COUNT(*) as count FROM accounts', [], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ hasAccounts: row.count > 0 });
  });
});

// ==================== 管理員 API ====================

// 取得所有待審核的帳號（管理員專用）
app.get('/api/admin/pending-accounts', requireAdmin, (req, res) => {
  db.all(
    'SELECT id, username, full_name, created_at FROM accounts WHERE status = ? ORDER BY created_at DESC',
    ['pending'],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// 取得所有帳號（管理員專用）
app.get('/api/admin/accounts', requireAdmin, (req, res) => {
  db.all(
    'SELECT id, username, full_name, role, status, user_database, created_at FROM accounts ORDER BY created_at DESC',
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

// 審核帳號（批准/拒絕）
app.post('/api/admin/review-account', requireAdmin, async (req, res) => {
  const { accountId, action } = req.body; // action: 'approve' or 'reject'
  
  if (!accountId || !action) {
    return res.status(400).json({ error: '缺少必要參數' });
  }
  
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: '無效的操作' });
  }
  
  const newStatus = action === 'approve' ? 'active' : 'rejected';
  
  try {
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE accounts SET status = ? WHERE id = ? AND status = ?',
        [newStatus, accountId, 'pending'],
        function(err) {
          if (err) reject(err);
          else if (this.changes === 0) reject(new Error('帳號不存在或狀態已變更'));
          else resolve();
        }
      );
    });
    
    console.log(`✓ 帳號審核完成: ID ${accountId}, 狀態: ${newStatus}`);
    res.json({ 
      success: true, 
      message: action === 'approve' ? '已批准帳號' : '已拒絕帳號'
    });
  } catch (error) {
    console.error('審核帳號失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// 刪除帳號（管理員專用）
app.delete('/api/admin/accounts/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    // 不能刪除自己的帳號
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: '不能刪除自己的帳號' });
    }
    
    // 取得帳號資訊
    const account = await new Promise((resolve, reject) => {
      db.get('SELECT user_database FROM accounts WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!account) {
      return res.status(404).json({ error: '帳號不存在' });
    }
    
    // 刪除帳號
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM accounts WHERE id = ?', [id], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // 刪除使用者資料庫檔案（選用，可能保留作為備份）
    const dbPath = path.join(DB_DIR, account.user_database);
    if (fs.existsSync(dbPath)) {
      // 備份後刪除
      const backupPath = path.join(DB_DIR, `deleted_${Date.now()}_${account.user_database}`);
      fs.renameSync(dbPath, backupPath);
      console.log(`✓ 資料庫已備份: ${backupPath}`);
    }
    
    console.log(`✓ 帳號已刪除: ID ${id}`);
    res.json({ success: true, message: '帳號已刪除' });
  } catch (error) {
    console.error('刪除帳號失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// 輔助：建構路徑（加入循環檢測）- 使用全域 db（向後兼容）
function buildPath(id, callback, visited = new Set()) {
  buildPathWithDb(db, id, callback, visited);
}

// 輔助：建構路徑（支援指定資料庫）
function buildPathWithDb(database, id, callback, visited = new Set()) {
  // 檢測循環引用
  if (visited.has(id)) {
    console.error(`Circular reference detected for folder ID ${id}`);
    return callback('Circular reference detected');
  }
  
  visited.add(id);
  
  database.get('SELECT * FROM folders WHERE id = ?', [id], (err, folder) => {
    if (err) {
      console.error(`Error fetching folder ${id}:`, err);
      return callback(err);
    }
    if (!folder) {
      console.error(`Folder ${id} not found`);
      return callback('Folder not found');
    }
    
    // 根資料夾
    if (!folder.parent_id || folder.parent_id === null || folder.parent_id === '') {
      return callback(null, '/' + folder.name);
    }
    
    // 遞迴建構父路徑
    buildPathWithDb(database, folder.parent_id, (err, parentPath) => {
      if (err) {
        console.error(`Error building parent path for folder ${id}:`, err);
        // 如果父資料夾有問題，將此資料夾視為根資料夾
        return callback(null, '/' + folder.name);
      }
      callback(null, parentPath + '/' + folder.name);
    }, visited);
  });
}

// API: 資料夾
app.get('/api/folders', withUserDatabase, (req, res) => {
  console.log('Hit /api/folders');
  req.userDb.all('SELECT * FROM folders', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});
console.log('Registered /api/folders');

app.get('/api/folders/:id', withUserDatabase, (req, res) => {
  const { id } = req.params;
  console.log(`Hit GET /api/folders/${id}`);
  req.userDb.get('SELECT * FROM folders WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });
});

app.post('/api/folders', withUserDatabase, (req, res) => {
  console.log('Hit POST /api/folders', req.body);
  const { name, parent_id } = req.body;
  req.userDb.run('INSERT INTO folders (name, parent_id) VALUES (?, ?)', [name, parent_id || null], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    buildPathWithDb(req.userDb, this.lastID, (err, path) => {
      if (err) return res.status(500).json({ error: err });
      req.userDb.run('UPDATE folders SET path = ? WHERE id = ?', [path, this.lastID]);
      res.json({ id: this.lastID, path });
    });
  });
});

app.put('/api/folders/:id', withUserDatabase, (req, res) => {
  const { id } = req.params;
  const { name, parent_id } = req.body;
  console.log('Hit PUT /api/folders/' + id, { name, parent_id });
  
  const userDb = req.userDb;
  
  // 更新名稱和父資料夾
  userDb.run('UPDATE folders SET name = ?, parent_id = ? WHERE id = ?', [name, parent_id, id], function(err) {
    if (err || this.changes === 0) return res.status(500).json({ error: err ? err.message : 'Not found' });
    
    // 重新計算此資料夾的路徑
    buildPathWithDb(userDb, id, (err, path) => {
      if (err) return res.status(500).json({ error: err });
      userDb.run('UPDATE folders SET path = ? WHERE id = ?', [path, id], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        
        // 重新計算所有子資料夾的路徑（因為父資料夾可能改變了）
        userDb.all('SELECT id FROM folders WHERE parent_id = ?', [id], (err3, children) => {
          if (err3) return res.status(500).json({ error: err3.message });
          
          // 遞迴更新所有子資料夾的路徑
          const updateChildPaths = (childIds, callback) => {
            if (childIds.length === 0) return callback();
            
            const childId = childIds[0];
            buildPathWithDb(userDb, childId, (err, childPath) => {
              if (err) return callback(err);
              userDb.run('UPDATE folders SET path = ? WHERE id = ?', [childPath, childId], (err2) => {
                if (err2) return callback(err2);
                
                // 查找此子資料夾的子資料夾
                userDb.all('SELECT id FROM folders WHERE parent_id = ?', [childId], (err3, grandchildren) => {
                  if (err3) return callback(err3);
                  
                  // 遞迴處理
                  updateChildPaths(grandchildren.map(g => g.id), (err4) => {
                    if (err4) return callback(err4);
                    // 繼續處理同層的其他子資料夾
                    updateChildPaths(childIds.slice(1), callback);
                  });
                });
              });
            });
          };
          
          updateChildPaths(children.map(c => c.id), (err4) => {
            if (err4) return res.status(500).json({ error: err4.message });
            console.log(`✓ Updated folder ${id} and all its descendants`);
            res.json({ success: true });
          });
        });
      });
    });
  });
});

app.delete('/api/folders', withUserDatabase, (req, res) => {
  const { id } = req.body;
  console.log('Hit DELETE /api/folders', { id });
  
  // 檢查是否有子資料夾
  req.userDb.get('SELECT COUNT(*) as count FROM folders WHERE parent_id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (row.count > 0) {
      return res.status(400).json({ 
        error: 'cannot_delete_folder_with_children',
        message: '此資料夾有子資料夾，無法刪除'
      });
    }
    
    // 檢查是否有權限指派
    req.userDb.get('SELECT COUNT(*) as count FROM permissions WHERE folder_id = ?', [id], (err2, row2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      
      if (row2.count > 0) {
        return res.status(400).json({ 
          error: 'cannot_delete_folder_with_permissions',
          message: '此資料夾已被指派權限，無法刪除'
        });
      }
      
      // 可以安全刪除
      req.userDb.run('DELETE FROM folders WHERE id = ?', [id], (err3) => {
        if (err3) return res.status(500).json({ error: err3.message });
        console.log(`✓ Deleted folder: ${id}`);
        res.json({ success: true });
      });
    });
  });
});

// API: 人員
app.get('/api/users', withUserDatabase, (req, res) => {
  console.log('Hit /api/users');
  req.userDb.all('SELECT * FROM users', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});
console.log('Registered /api/users');

app.get('/api/users/:id', withUserDatabase, (req, res) => {
  const { id } = req.params;
  console.log(`Hit GET /api/users/${id}`);
  req.userDb.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });
});

app.post('/api/users', withUserDatabase, (req, res) => {
  console.log('Hit POST /api/users', req.body);
  const { name, email } = req.body;
  req.userDb.run('INSERT INTO users (name, email) VALUES (?, ?)', [name, email], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put('/api/users/:id', withUserDatabase, (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;
  console.log('Hit PUT /api/users/' + id, { name, email });
  req.userDb.run('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, id], (err) => {
    if (err || this.changes === 0) return res.status(500).json({ error: err ? err.message : 'Not found' });
    res.json({ success: true });
  });
});

app.delete('/api/users', withUserDatabase, (req, res) => {
  const { id } = req.body;
  console.log('Hit DELETE /api/users', { id });
  
  // 先檢查是否有關聯的權限
  req.userDb.all(`
    SELECT p.id, p.permission_type, f.name as folder_name, f.path as folder_path
    FROM permissions p
    LEFT JOIN folders f ON p.folder_id = f.id
    WHERE p.user_id = ?
  `, [id], (err, permissions) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (permissions && permissions.length > 0) {
      // 有關聯的權限，禁止刪除
      return res.status(400).json({ 
        error: 'cannot_delete_user_with_permissions',
        message: '此人員已被指派權限，無法刪除',
        permissions: permissions.map(p => ({
          id: p.id,
          folder: p.folder_path || p.folder_name || '未知資料夾',
          permission_type: p.permission_type
        }))
      });
    }
    
    // 沒有關聯的權限，可以刪除
    req.userDb.run('DELETE FROM users WHERE id = ?', [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// API: 群組
app.get('/api/groups', withUserDatabase, (req, res) => {
  console.log('Hit /api/groups');
  req.userDb.all('SELECT * FROM groups', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});
console.log('Registered /api/groups');

app.get('/api/groups/:id', withUserDatabase, (req, res) => {
  const { id } = req.params;
  console.log(`Hit GET /api/groups/${id}`);
  req.userDb.get('SELECT * FROM groups WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });
});

app.post('/api/groups', withUserDatabase, (req, res) => {
  console.log('Hit POST /api/groups', req.body);
  const { name } = req.body;
  req.userDb.run('INSERT INTO groups (name) VALUES (?)', [name], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put('/api/groups/:id', withUserDatabase, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  console.log('Hit PUT /api/groups/' + id, { name });
  req.userDb.run('UPDATE groups SET name = ? WHERE id = ?', [name, id], (err) => {
    if (err || this.changes === 0) return res.status(500).json({ error: err ? err.message : 'Not found' });
    res.json({ success: true });
  });
});

app.delete('/api/groups', withUserDatabase, (req, res) => {
  const { id } = req.body;
  console.log('Hit DELETE /api/groups', { id });
  
  // 先檢查是否有關聯的權限
  req.userDb.all(`
    SELECT p.id, p.permission_type, f.name as folder_name, f.path as folder_path
    FROM permissions p
    LEFT JOIN folders f ON p.folder_id = f.id
    WHERE p.group_id = ?
  `, [id], (err, permissions) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (permissions && permissions.length > 0) {
      // 有關聯的權限，禁止刪除
      return res.status(400).json({ 
        error: 'cannot_delete_group_with_permissions',
        message: '此群組已被指派權限，無法刪除',
        permissions: permissions.map(p => ({
          id: p.id,
          folder: p.folder_path || p.folder_name || '未知資料夾',
          permission_type: p.permission_type
        }))
      });
    }
    
    // 沒有關聯的權限，可以刪除
    req.userDb.run('DELETE FROM groups WHERE id = ?', [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

// 群組-人員
app.get('/api/groups/:id/users', withUserDatabase, (req, res) => {
  const { id } = req.params;
  console.log('Hit /api/groups/' + id + '/users');
  req.userDb.all('SELECT u.* FROM users u JOIN group_users gu ON u.id = gu.user_id WHERE gu.group_id = ?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// 獲取人員所屬的群組
app.get('/api/users/:id/groups', withUserDatabase, (req, res) => {
  const { id } = req.params;
  console.log('Hit /api/users/' + id + '/groups');
  req.userDb.all('SELECT g.* FROM groups g JOIN group_users gu ON g.id = gu.group_id WHERE gu.user_id = ?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/groups/:id/users', withUserDatabase, (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  console.log('Hit POST /api/groups/' + id + '/users', { user_id });
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  req.userDb.run('INSERT INTO group_users (group_id, user_id) VALUES (?, ?)', [parseInt(id), parseInt(user_id)], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/groups/:id/users', withUserDatabase, (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  console.log('Hit DELETE /api/groups/' + id + '/users', { user_id });
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  req.userDb.run('DELETE FROM group_users WHERE group_id = ? AND user_id = ?', [parseInt(id), parseInt(user_id)], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// API: 權限 (修復：加 folder_id 驗證)
app.get('/api/permissions', withUserDatabase, (req, res) => {
  console.log('Hit /api/permissions');
  req.userDb.all(`SELECT p.*, f.path, u.name as user_name, g.name as group_name
          FROM permissions p
          LEFT JOIN folders f ON p.folder_id = f.id
          LEFT JOIN users u ON p.user_id = u.id
          LEFT JOIN groups g ON p.group_id = g.id`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});
console.log('Registered /api/permissions');

app.post('/api/permissions', withUserDatabase, (req, res) => {
  console.log('Hit POST /api/permissions', req.body);
  const { folder_id, user_id, group_id, permission_type } = req.body;
  // 修復：驗證 folder_id 必須為有效數字
  if (!folder_id || isNaN(folder_id) || folder_id <= 0) {
    console.error('Invalid folder_id:', folder_id);
    return res.status(400).json({ error: 'folder_id must be a positive integer' });
  }
  req.userDb.run('INSERT INTO permissions (folder_id, user_id, group_id, permission_type) VALUES (?, ?, ?, ?)',
    [parseInt(folder_id), user_id ? parseInt(user_id) : null, group_id ? parseInt(group_id) : null, permission_type], function(err) {
    if (err) {
      console.error('Insert permission error:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID });
  });
});

app.delete('/api/permissions', withUserDatabase, (req, res) => {
  const { id } = req.body;
  console.log('Hit DELETE /api/permissions', { id });
  req.userDb.run('DELETE FROM permissions WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// 清空所有資料（使用 Promise 確保操作完成）
app.post('/api/clear_all', withUserDatabase, async (req, res) => {
  console.log('Hit /api/clear_all - Clearing all data');
  const { confirm } = req.body;
  
  // 安全確認
  if (confirm !== 'CLEAR_ALL_DATA') {
    return res.status(400).json({ error: 'Confirmation code incorrect' });
  }
  
  try {
    // 依序刪除所有資料（注意外鍵關係）
    const tables = ['permissions', 'group_users', 'groups', 'users', 'folders'];
    
    for (const table of tables) {
      await new Promise((resolve, reject) => {
        req.userDb.run(`DELETE FROM ${table}`, (err) => {
          if (err) {
            console.error(`Error clearing ${table}:`, err);
            reject(err);
          } else {
            console.log(`✓ Cleared ${table} (user: ${req.session.username})`);
            resolve();
          }
        });
      });
    }
    
    // 重置自動遞增 ID
    await new Promise((resolve, reject) => {
      req.userDb.run('DELETE FROM sqlite_sequence', (err) => {
        if (err) {
          console.error('Error resetting sequences:', err);
          reject(err);
        } else {
          console.log('✓ Reset sequences');
          resolve();
        }
      });
    });
    
    console.log(`All data cleared successfully for user: ${req.session.username}`);
    res.json({ success: true, message: 'All data cleared' });
  } catch (error) {
    console.error('Clear all error:', error);
    res.status(500).json({ error: 'Failed to clear data: ' + error.message });
  }
});

// 匯出權限 CSV (UTF-8 with BOM)
app.get('/export_csv', withUserDatabase, (req, res) => {
  console.log('Hit /export_csv');
  req.userDb.all(`SELECT p.*, f.path, f.name as folder_name, u.name as user_name, g.name as group_name
          FROM permissions p
          LEFT JOIN folders f ON p.folder_id = f.id
          LEFT JOIN users u ON p.user_id = u.id
          LEFT JOIN groups g ON p.group_id = g.id
          ORDER BY p.id`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // 手動建立 CSV 內容，並加入 UTF-8 BOM
    // 使用標準格式，可直接匯入
    const BOM = '\uFEFF';
    const headers = ['type', 'folder_id', 'user_id', 'group_id', 'permission_type', 'folder_path', 'user_name', 'group_name'];
    let csvContent = BOM + headers.join(',') + '\n';
    
    (rows || []).forEach(row => {
      const values = [
        'permission',
        row.folder_id || '',
        row.user_id || '',
        row.group_id || '',
        row.permission_type || '',
        row.path || row.folder_name || '',
        row.user_name || '',
        row.group_name || ''
      ].map(val => {
        // 如果欄位包含逗號、引號或換行符號，需要用引號包起來
        const strVal = String(val);
        if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
          return `"${strVal.replace(/"/g, '""')}"`;
        }
        return strVal;
      });
      csvContent += values.join(',') + '\n';
    });
    
    console.log(`Exported ${rows.length} permissions`);
    
    // 寫入檔案
    const tempFile = 'temp_permissions.csv';
    fs.writeFileSync(tempFile, csvContent, 'utf8');
    
    // 設置正確的 Content-Type 並下載
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.download(tempFile, 'permissions.csv', (err) => {
      if (err) console.error('Download error:', err);
      // 下載完成後刪除暫存檔
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
  });
});

// 匯出資料夾 CSV (UTF-8 with BOM)
app.get('/export_folders_csv', withUserDatabase, (req, res) => {
  console.log('Hit /export_folders_csv');
  req.userDb.all('SELECT * FROM folders ORDER BY id', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // 手動建立 CSV 內容，並加入 UTF-8 BOM
    const BOM = '\uFEFF';
    const headers = ['type', 'name', 'parent_id'];
    let csvContent = BOM + headers.join(',') + '\n';
    
    (rows || []).forEach(row => {
      const values = [
        'folder',
        row.name || '',
        row.parent_id || ''
      ].map(val => {
        const strVal = String(val);
        if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
          return `"${strVal.replace(/"/g, '""')}"`;
        }
        return strVal;
      });
      csvContent += values.join(',') + '\n';
    });
    
    // 寫入檔案
    const tempFile = 'temp_folders.csv';
    fs.writeFileSync(tempFile, csvContent, 'utf8');
    
    // 設置正確的 Content-Type 並下載
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.download(tempFile, 'folders.csv', (err) => {
      if (err) console.error('Download error:', err);
      // 下載完成後刪除暫存檔
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
  });
});

// 匯出人員 CSV (UTF-8 with BOM)
app.get('/export_users_csv', withUserDatabase, (req, res) => {
  console.log('Hit /export_users_csv');
  req.userDb.all('SELECT * FROM users ORDER BY id', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // 手動建立 CSV 內容，並加入 UTF-8 BOM
    const BOM = '\uFEFF';
    const headers = ['type', 'name', 'email'];
    let csvContent = BOM + headers.join(',') + '\n';
    
    (rows || []).forEach(row => {
      const values = [
        'user',
        row.name || '',
        row.email || ''
      ].map(val => {
        const strVal = String(val);
        if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
          return `"${strVal.replace(/"/g, '""')}"`;
        }
        return strVal;
      });
      csvContent += values.join(',') + '\n';
    });
    
    // 寫入檔案
    const tempFile = 'temp_users.csv';
    fs.writeFileSync(tempFile, csvContent, 'utf8');
    
    // 設置正確的 Content-Type 並下載
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.download(tempFile, 'users.csv', (err) => {
      if (err) console.error('Download error:', err);
      // 下載完成後刪除暫存檔
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
  });
});

// 匯出群組 CSV (UTF-8 with BOM)
app.get('/export_groups_csv', withUserDatabase, async (req, res) => {
  console.log('Hit /export_groups_csv');
  
  try {
    // 1. 先取得所有群組
    const groups = await new Promise((resolve, reject) => {
      req.userDb.all('SELECT * FROM groups ORDER BY id', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 2. 取得所有群組成員關係
    const groupMembers = await new Promise((resolve, reject) => {
      req.userDb.all(`
        SELECT gu.group_id, gu.user_id, u.name as user_name, u.email
        FROM group_users gu
        LEFT JOIN users u ON gu.user_id = u.id
        ORDER BY gu.group_id, gu.user_id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 3. 手動建立 CSV 內容，並加入 UTF-8 BOM
    const BOM = '\uFEFF';
    const headers = ['type', 'name', 'group_id', 'user_id'];
    let csvContent = BOM + headers.join(',') + '\n';
    
    // 4. 先輸出所有群組
    groups.forEach(group => {
      const values = [
        'group',
        group.name || '',
        '',
        ''
      ].map(val => {
        const strVal = String(val);
        if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
          return `"${strVal.replace(/"/g, '""')}"`;
        }
        return strVal;
      });
      csvContent += values.join(',') + '\n';
    });
    
    // 5. 再輸出所有群組成員關係
    groupMembers.forEach(member => {
      const values = [
        'group_member',
        '', // name 欄位留空
        member.group_id || '',
        member.user_id || ''
      ].map(val => {
        const strVal = String(val);
        if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
          return `"${strVal.replace(/"/g, '""')}"`;
        }
        return strVal;
      });
      csvContent += values.join(',') + '\n';
    });
    
    // 6. 寫入檔案
    const tempFile = 'temp_groups.csv';
    fs.writeFileSync(tempFile, csvContent, 'utf8');
    
    console.log(`Exported ${groups.length} groups and ${groupMembers.length} group members`);
    
    // 7. 設置正確的 Content-Type 並下載
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.download(tempFile, 'groups.csv', (err) => {
      if (err) console.error('Download error:', err);
      // 下載完成後刪除暫存檔
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
  } catch (error) {
    console.error('Export groups error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 匯出完整資料 CSV（一次性匯出所有資料：資料夾、人員、群組、群組成員、權限）
app.get('/export_full_csv', withUserDatabase, async (req, res) => {
  console.log('Hit /export_full_csv - Exporting all data');
  
  try {
    // 1. 查詢所有資料夾
    const allFolders = await new Promise((resolve, reject) => {
      req.userDb.all(`SELECT id, name, parent_id FROM folders ORDER BY id`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 依賴排序：確保父資料夾在子資料夾之前
    const folders = [];
    const processed = new Set();
    const folderMap = {};
    
    allFolders.forEach(f => {
      folderMap[f.id] = f;
    });
    
    function processFolder(folder) {
      if (processed.has(folder.id)) return;
      
      // 如果有父資料夾，先處理父資料夾
      if (folder.parent_id) {
        const parent = folderMap[folder.parent_id];
        if (parent && !processed.has(parent.id)) {
          processFolder(parent);
        }
      }
      
      folders.push(folder);
      processed.add(folder.id);
    }
    
    allFolders.forEach(folder => {
      processFolder(folder);
    });
    
    // 建立資料夾 ID 到名稱的映射
    const folderIdToName = {};
    folders.forEach(f => {
      folderIdToName[f.id] = f.name;
    });
    
    // 2. 查詢所有人員
    const users = await new Promise((resolve, reject) => {
      req.userDb.all(`SELECT id, name, email FROM users ORDER BY id`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 建立人員 ID 到名稱的映射
    const userIdToName = {};
    users.forEach(u => {
      userIdToName[u.id] = u.name;
    });
    
    // 3. 查詢所有群組
    const groups = await new Promise((resolve, reject) => {
      req.userDb.all(`SELECT id, name FROM groups ORDER BY id`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 建立群組 ID 到名稱的映射
    const groupIdToName = {};
    groups.forEach(g => {
      groupIdToName[g.id] = g.name;
    });
    
    // 4. 查詢所有群組成員關係（只包含有效關係）
    const groupMembers = await new Promise((resolve, reject) => {
      req.userDb.all(`
        SELECT gu.group_id, gu.user_id, g.name as group_name, u.name as user_name
        FROM group_users gu
        INNER JOIN groups g ON gu.group_id = g.id
        INNER JOIN users u ON gu.user_id = u.id
        ORDER BY gu.group_id, gu.user_id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 5. 查詢所有權限
    const permissions = await new Promise((resolve, reject) => {
      req.userDb.all(`
        SELECT p.folder_id, p.user_id, p.group_id, p.permission_type,
               f.name as folder_name, u.name as user_name, g.name as group_name
        FROM permissions p
        LEFT JOIN folders f ON p.folder_id = f.id
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN groups g ON p.group_id = g.id
        ORDER BY p.id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 6. 建立 CSV 內容（使用 UTF-8 BOM）
    const BOM = '\uFEFF';
    let csvContent = BOM;
    
    // 輔助函數：轉義 CSV 值
    const escapeCSV = (val) => {
      const strVal = String(val || '');
      if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
        return `"${strVal.replace(/"/g, '""')}"`;
      }
      return strVal;
    };
    
    // 使用統一的標題行（包含所有可能的欄位）
    // type,name,parent_name,email,group_name,user_name,folder_name,permission_type
    csvContent += 'type,name,parent_name,email,group_name,user_name,folder_name,permission_type\n';
    
    // 6.1 匯出資料夾（使用名稱和父資料夾名稱，已按依賴順序排序）
    folders.forEach(folder => {
      if (!folder.parent_id) {
        // 根資料夾
        csvContent += `folder,${escapeCSV(folder.name)},,,,,,\n`;
      } else {
        // 子資料夾
        const parentName = folderIdToName[folder.parent_id] || '';
        csvContent += `folder,${escapeCSV(folder.name)},${escapeCSV(parentName)},,,,,,\n`;
      }
    });

    // 6.2 匯出人員
    users.forEach(user => {
      csvContent += `user,${escapeCSV(user.name)},,${escapeCSV(user.email)},,,,\n`;
    });

    // 6.3 匯出群組
    groups.forEach(group => {
      csvContent += `group,${escapeCSV(group.name)},,,,,,\n`;
    });

    // 6.4 匯出群組成員（使用群組名稱和人員名稱）
    // 使用 INNER JOIN 確保只匯出有效關係
    groupMembers.forEach(member => {
      csvContent += `group_member,,,"","${escapeCSV(member.group_name)}","${escapeCSV(member.user_name)}",,\n`;
    });

    // 6.5 匯出權限（使用資料夾名稱、群組名稱/人員名稱）
    permissions.forEach(perm => {
      csvContent += `permission,,,,"${escapeCSV(perm.group_name)}","${escapeCSV(perm.user_name)}","${escapeCSV(perm.folder_name)}","${escapeCSV(perm.permission_type)}"\n`;
    });
    
    console.log(`Exported full data: ${folders.length} folders, ${users.length} users, ${groups.length} groups, ${groupMembers.length} group members, ${permissions.length} permissions`);
    
    // 7. 寫入檔案
    const tempFile = 'temp_full_data.csv';
    fs.writeFileSync(tempFile, csvContent, 'utf8');
    
    // 8. 設置正確的 Content-Type 並下載
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.download(tempFile, `full_data_${new Date().toISOString().slice(0, 10)}.csv`, (err) => {
      if (err) console.error('Download error:', err);
      // 下載完成後刪除暫存檔
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
  } catch (error) {
    console.error('Export full data error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 匯入 CSV (改用 Promise 確保操作完成)
const upload = multer({ dest: UPLOAD_DIR });
app.post('/import_csv', withUserDatabase, upload.single('file'), (req, res) => {
  console.log('Hit /import_csv');
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const results = [];
  
  fs.createReadStream(req.file.path)
    .pipe(csv({
      mapHeaders: ({ header }) => {
        // 清理欄位名稱：移除引號、空格、BOM
        return header.replace(/^['"\uFEFF\s]+|['"\s]+$/g, '').trim();
      }
    }))
    .on('data', (row) => {
      console.log('CSV row read:', row);
      results.push(row);
    })
    .on('end', async () => {
      try {
        console.log(`CSV parsing completed. Total rows: ${results.length}`);
        if (results.length > 0) {
          console.log('First row keys:', Object.keys(results[0]));
          console.log('First row values:', results[0]);
        }
        
        let importCount = 0;
        const stats = {
          folders: 0,
          users: 0,
          groups: 0,
          group_members: 0,
          permissions: 0
        };
        
        // 定義處理順序（確保依賴關係正確）
        // 順序：folder → user → group → group_member → permission
        const typeOrder = {
          'folder': 1,
          'user': 2,
          'group': 3,
          'group_member': 4,
          'permission': 5
        };
        
        // 按照類型排序，確保處理順序正確
        results.sort((a, b) => {
          const typeA = (a.type || a.Type || a.TYPE || '').toLowerCase();
          const typeB = (b.type || b.Type || b.TYPE || '').toLowerCase();
          const orderA = typeOrder[typeA] || 999;
          const orderB = typeOrder[typeB] || 999;
          
          // 如果類型相同，保持原始順序（對於資料夾的依賴排序很重要）
          if (orderA === orderB && typeA === 'folder') {
            // 資料夾需要保持原始順序（父資料夾在前）
            return 0;
          }
          
          return orderA - orderB;
        });
        
        console.log(`Sorted ${results.length} rows by type order: folder -> user -> group -> group_member -> permission`);
        
        // 循序處理每一行（已按正確順序排序）
        for (const row of results) {
          const type = row.type || row.Type || row.TYPE;
          console.log(`Processing row - type: ${type}, name: ${row.name}`);
          
          if (!type) {
            console.log('Skipping row with no type:', row);
            continue;
          }
          
          if (type === 'user') {
            const name = row.name || row.Name;
            const email = row.email || row.Email;
            await new Promise((resolve, reject) => {
              req.userDb.run('INSERT OR IGNORE INTO users (name, email) VALUES (?, ?)', 
                [name, email], 
                (err) => {
                  if (err) reject(err);
                  else {
                    importCount++;
                    stats.users++;
                    resolve();
                  }
                }
              );
            });
          } else if (type === 'group') {
            const name = row.name || row.Name;
            
            // 插入群組
            const groupId = await new Promise((resolve, reject) => {
              req.userDb.run('INSERT OR IGNORE INTO groups (name) VALUES (?)', 
                [name], 
                function(err) {
                  if (err) {
                    reject(err);
                  } else {
                    console.log(`✓ Inserted group: ${name}, ID: ${this.lastID}`);
                    importCount++;
                    stats.groups++;
                    resolve(this.lastID);
                  }
                }
              );
            });
            
            // 自動指派權限：根據群組名稱自動對應資料夾
            // 格式：資料夾名_RO 或 資料夾名_RW
            if (name.endsWith('_RO') || name.endsWith('_RW')) {
              const folderName = name.endsWith('_RO') 
                ? name.substring(0, name.length - 3) 
                : name.substring(0, name.length - 3);
              
              const permissionType = name.endsWith('_RO') ? 'read' : 'write';
              
              // 查找對應的資料夾
              const folder = await new Promise((resolve, reject) => {
                req.userDb.get('SELECT id FROM folders WHERE name = ?', [folderName], (err, row) => {
                  if (err) reject(err);
                  else resolve(row);
                });
              });
              
              if (folder) {
                // 指派權限
                await new Promise((resolve, reject) => {
                  req.userDb.run(
                    'INSERT OR IGNORE INTO permissions (folder_id, user_id, group_id, permission_type) VALUES (?, NULL, ?, ?)',
                    [folder.id, groupId, permissionType],
                    (err) => {
                      if (err) {
                        console.error(`❌ Error assigning permission for group ${name}:`, err);
                        reject(err);
                      } else {
                        console.log(`✓ Auto-assigned ${permissionType} permission: group "${name}" (${groupId}) → folder "${folderName}" (${folder.id})`);
                        resolve();
                      }
                    }
                  );
                });
              } else {
                console.warn(`⚠ Folder "${folderName}" not found for group "${name}", skipping auto-permission`);
              }
            }
          } else if (type === 'folder') {
            const name = row.name || row.Name;
            const parent_id_raw = row.parent_id || row.Parent_id || row.parent_Id || row.Parent_Id;
            const parent_name_raw = row.parent_name || row.Parent_name || row.parent_Name || row.Parent_Name;
            let parent_id = parent_id_raw ? parseInt(parent_id_raw) : null;
            
            // 如果沒有 parent_id 但有 parent_name，根據名稱查找
            if (!parent_id && parent_name_raw) {
              console.log(`Looking up parent folder ID for name: "${parent_name_raw}"`);
              const parentFolder = await new Promise((res) => {
                req.userDb.get('SELECT id FROM folders WHERE name = ?', [parent_name_raw], (err, row) => {
                  if (err) {
                    console.error('Error looking up parent folder:', err);
                    res(null);
                  } else {
                    res(row);
                  }
                });
              });
              
              if (parentFolder) {
                parent_id = parentFolder.id;
                console.log(`✓ Found parent folder ID ${parent_id} for name "${parent_name_raw}"`);
              } else {
                console.warn(`⚠ Parent folder "${parent_name_raw}" not found for "${name}", creating as root folder`);
                parent_id = null;
              }
            }
            
            console.log(`Inserting folder: name="${name}", parent_id=${parent_id}`);
            
            // 驗證 parent_id 是否有效（如果有提供的話）
            if (parent_id) {
              const parentExists = await new Promise((res) => {
                req.userDb.get('SELECT id FROM folders WHERE id = ?', [parent_id], (err, row) => {
                  res(!err && row);
                });
              });
              
              if (!parentExists) {
                console.warn(`⚠ Parent folder ${parent_id} not found for "${name}", creating as root folder`);
                // 將 parent_id 設為 null，作為根資料夾
                parent_id = null;
              }
            }
            
            // 插入資料夾（循序執行，確保順序）
            await new Promise((resolve, reject) => {
              req.userDb.run('INSERT INTO folders (name, parent_id) VALUES (?, ?)', 
                [name, parent_id], 
                function(err) {
                  if (err) {
                    console.error('Error inserting folder:', err);
                    return reject(err);
                  }
                  const folderId = this.lastID;
                  console.log(`✓ Inserted folder: ${name}, ID: ${folderId}, parent_id: ${parent_id || 'null'}`);
                  importCount++;
                  stats.folders++;
                  
                  // 建構路徑
                  buildPathWithDb(req.userDb, folderId, (err, pth) => {
                    if (err) {
                      console.error('Error building path:', err);
                      // 路徑建構失敗，使用簡單路徑
                      const simplePath = '/' + name;
                      req.userDb.run('UPDATE folders SET path = ? WHERE id = ?', [simplePath, folderId], () => {
                        console.log(`✓ Used simple path for folder ${folderId}: ${simplePath}`);
                        resolve();
                      });
                      return;
                    }
                    req.userDb.run('UPDATE folders SET path = ? WHERE id = ?', 
                      [pth, folderId], 
                      (err) => {
                        if (err) console.error('Error updating path:', err);
                        else console.log(`✓ Updated path for folder ${folderId}: ${pth}`);
                        resolve();
                      }
                    );
                  });
                }
              );
            });
          } else if (type === 'group_member') {
            // 支援群組成員匯入（支援 ID 或名稱）
            // 嘗試多種可能的欄位名稱格式
            const group_id_raw = row.group_id || row.Group_id || row.GROUP_ID || row['group_id'] || row['Group_id'];
            const user_id_raw = row.user_id || row.User_id || row.USER_ID || row['user_id'] || row['User_id'];
            const group_name_raw = row.group_name || row.Group_name || row.group_Name || row.Group_Name || 
                                   row['group_name'] || row['Group_name'] || row['group_Name'] || row['Group_Name'] || '';
            const user_name_raw = row.user_name || row.User_name || row.user_Name || row.User_Name || 
                                 row['user_name'] || row['User_name'] || row['user_Name'] || row['User_name'] || '';
            
            console.log(`Processing group_member row:`, {
              group_id: group_id_raw,
              user_id: user_id_raw,
              group_name: group_name_raw,
              user_name: user_name_raw,
              row_keys: Object.keys(row),
              row_values: Object.values(row),
              raw_row: row
            });
            
            let group_id = group_id_raw ? parseInt(group_id_raw) : null;
            let user_id = user_id_raw ? parseInt(user_id_raw) : null;
            
            // 如果沒有 group_id 但有 group_name，根據名稱查找
            if (!group_id && group_name_raw && typeof group_name_raw === 'string' && group_name_raw.trim() !== '') {
              const groupNameClean = group_name_raw.trim();
              console.log(`Looking up group ID for name: "${groupNameClean}"`);
              const groupRow = await new Promise((res) => {
                req.userDb.get('SELECT id FROM groups WHERE name = ?', [groupNameClean], (err, row) => {
                  if (err) {
                    console.error('Error looking up group:', err);
                    res(null);
                  } else {
                    res(row);
                  }
                });
              });
              
              if (groupRow) {
                group_id = groupRow.id;
                console.log(`✓ Found group ID ${group_id} for name "${groupNameClean}"`);
              } else {
                console.warn(`⚠ Group "${groupNameClean}" not found, skipping group member`);
              }
            }
            
            // 如果沒有 user_id 但有 user_name，根據名稱查找
            if (!user_id && user_name_raw && typeof user_name_raw === 'string' && user_name_raw.trim() !== '') {
              const userNameClean = user_name_raw.trim();
              console.log(`Looking up user ID for name: "${userNameClean}"`);
              const userRow = await new Promise((res) => {
                req.userDb.get('SELECT id FROM users WHERE name = ?', [userNameClean], (err, row) => {
                  if (err) {
                    console.error('Error looking up user:', err);
                    res(null);
                  } else {
                    res(row);
                  }
                });
              });
              
              if (userRow) {
                user_id = userRow.id;
                console.log(`✓ Found user ID ${user_id} for name "${userNameClean}"`);
              } else {
                console.warn(`⚠ User "${userNameClean}" not found, skipping group member`);
              }
            }
            
            if (group_id && !isNaN(group_id) && user_id && !isNaN(user_id)) {
              console.log(`Adding user ${user_id} to group ${group_id}`);
              await new Promise((resolve, reject) => {
                req.userDb.run('INSERT OR IGNORE INTO group_users (group_id, user_id) VALUES (?, ?)',
                  [group_id, user_id],
                  function(err) {
                    if (err) {
                      console.error('Error adding group member:', err);
                      reject(err);
                    } else {
                      if (this.changes > 0) {
                        console.log(`✓ Added user ${user_id} to group ${group_id}`);
                        importCount++;
                        stats.group_members++;
                      } else {
                        console.log(`ℹ User ${user_id} already in group ${group_id} (skipped)`);
                      }
                      resolve();
                    }
                  }
                );
              });
            } else {
              console.warn(`⚠ Skipping group_member: group_id=${group_id}, user_id=${user_id}, group_name="${group_name_raw}", user_name="${user_name_raw}"`);
              console.warn(`   Full row data:`, JSON.stringify(row, null, 2));
            }
          } else if (type === 'permission') {
            // 改進：支援多種欄位名稱格式（支援 ID 或名稱）
            let folder_id_raw = row.folder_id || row.Folder_id || row.FOLDER_ID;
            const folder_name_raw = row.folder_name || row.Folder_name || row.FOLDER_NAME;
            let user_id_raw = row.user_id || row.User_id || row.USER_ID;
            const user_name_raw = row.user_name || row.User_name || row.user_Name || row.User_Name;
            let group_id_raw = row.group_id || row.Group_id || row.GROUP_ID;
            const group_name_raw = row.group_name || row.Group_name || row.group_Name || row.Group_Name;
            const permission_type_raw = row.permission_type || row.Permission_type || row.PERMISSION_TYPE;
            
            // 如果沒有 folder_id 但有 folder_name，嘗試從資料夾名稱查找 ID
            if (!folder_id_raw && folder_name_raw) {
              console.log(`Looking up folder ID for name: "${folder_name_raw}"`);
              const folderRow = await new Promise((res) => {
                req.userDb.get('SELECT id FROM folders WHERE name = ?', [folder_name_raw], (err, row) => {
                  if (err) {
                    console.error('Error looking up folder:', err);
                    res(null);
                  } else {
                    res(row);
                  }
                });
              });
              if (folderRow) {
                folder_id_raw = folderRow.id;
                console.log(`✓ Found folder ID ${folder_id_raw} for name "${folder_name_raw}"`);
              } else {
                console.warn(`⚠ Folder not found for name: "${folder_name_raw}"`);
              }
            }
            
            // 如果沒有 user_id 但有 user_name，嘗試從人員名稱查找 ID
            if (!user_id_raw && user_name_raw) {
              console.log(`Looking up user ID for name: "${user_name_raw}"`);
              const userRow = await new Promise((res) => {
                req.userDb.get('SELECT id FROM users WHERE name = ?', [user_name_raw], (err, row) => {
                  if (err) {
                    console.error('Error looking up user:', err);
                    res(null);
                  } else {
                    res(row);
                  }
                });
              });
              if (userRow) {
                user_id_raw = userRow.id;
                console.log(`✓ Found user ID ${user_id_raw} for name "${user_name_raw}"`);
              } else {
                console.warn(`⚠ User not found for name: "${user_name_raw}"`);
              }
            }
            
            // 如果沒有 group_id 但有 group_name，嘗試從群組名稱查找 ID
            if (!group_id_raw && group_name_raw) {
              console.log(`Looking up group ID for name: "${group_name_raw}"`);
              const groupRow = await new Promise((res) => {
                req.userDb.get('SELECT id FROM groups WHERE name = ?', [group_name_raw], (err, row) => {
                  if (err) {
                    console.error('Error looking up group:', err);
                    res(null);
                  } else {
                    res(row);
                  }
                });
              });
              if (groupRow) {
                group_id_raw = groupRow.id;
                console.log(`✓ Found group ID ${group_id_raw} for name "${group_name_raw}"`);
              } else {
                console.warn(`⚠ Group not found for name: "${group_name_raw}"`);
              }
            }
            
            const folder_id = folder_id_raw ? parseInt(folder_id_raw) : null;
            const user_id = user_id_raw ? parseInt(user_id_raw) : null;
            const group_id = group_id_raw ? parseInt(group_id_raw) : null;
            const permission_type = permission_type_raw;
            
            console.log(`Processing permission: folder_id=${folder_id}, user_id=${user_id}, group_id=${group_id}, type=${permission_type}`);
            
            // 權限 CSV 匯入：處理不同來源的權限記錄
            // 1. 如果同時有 user_id 和 group_id，表示要將人員加入群組（來自權限CSV生成器）
            // 2. 如果有 folder_id，表示要設定資料夾權限（來自完整資料匯出）
            if (user_id && !isNaN(user_id) && group_id && !isNaN(group_id) && !folder_id) {
              // 來自權限CSV生成器：將人員加入群組
              console.log(`Adding user ${user_id} to group ${group_id} (from permission CSV generator)`);

              await new Promise((resolve, reject) => {
                req.userDb.run('INSERT OR IGNORE INTO group_users (group_id, user_id) VALUES (?, ?)',
                  [group_id, user_id],
                  (err) => {
                    if (err) {
                      console.error('Error adding user to group:', err);
                      reject(err);
                    } else {
                      console.log(`✓ Added user ${user_id} to group ${group_id}`);
                      importCount++;
                      stats.group_members++;
                      resolve();
                    }
                  }
                );
              });
            } else if (folder_id && !isNaN(folder_id) && permission_type) {
              // 其他情況：建立權限記錄（保留原有邏輯，供其他工具使用）
              // 只有 group_id（群組對資料夾的權限）
              if (group_id && !isNaN(group_id)) {
                await new Promise((resolve, reject) => {
                  req.userDb.run('INSERT OR IGNORE INTO permissions (folder_id, user_id, group_id, permission_type) VALUES (?, ?, ?, ?)',
                    [folder_id, null, group_id, permission_type],
                    (err) => {
                      if (err) {
                        console.error('Error inserting permission:', err);
                        reject(err);
                      } else {
                        console.log(`✓ Inserted permission: folder ${folder_id}, group ${group_id}, type ${permission_type}`);
                        importCount++;
                        stats.permissions++;
                        resolve();
                      }
                    }
                  );
                });
              } 
              // 只有 user_id（人員對資料夾的直接權限）
              else if (user_id && !isNaN(user_id)) {
                await new Promise((resolve, reject) => {
                  req.userDb.run('INSERT OR IGNORE INTO permissions (folder_id, user_id, group_id, permission_type) VALUES (?, ?, ?, ?)',
                    [folder_id, user_id, null, permission_type],
                    (err) => {
                      if (err) {
                        console.error('Error inserting permission:', err);
                        reject(err);
                      } else {
                        console.log(`✓ Inserted permission: folder ${folder_id}, user ${user_id}, type ${permission_type}`);
                        importCount++;
                        stats.permissions++;
                        resolve();
                      }
                    }
                  );
                });
              } else {
                console.log('Skipping permission: no valid user_id or group_id specified');
              }
            } else {
              console.log('Skipping permission with invalid data:', { folder_id, permission_type, row });
            }
          } else {
            console.log('Unknown type:', type);
          }
        }
        
        // 所有操作已循序完成
        console.log(`Import completed: ${importCount} operations`);
        console.log('Import statistics:', stats);
        
        // 刪除上傳的檔案
        fs.unlinkSync(req.file.path);
        
        res.json({ 
          success: true, 
          imported: importCount,
          count: importCount,  // 向後兼容
          stats: stats
        });
      } catch (error) {
        console.error('Import error:', error);
        // 確保刪除上傳的檔案
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
      }
    })
    .on('error', (error) => {
      console.error('CSV parse error:', error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: 'CSV parse error: ' + error.message });
    });
});

// 靜態檔案 (放最後)
app.use(express.static('public'));

// 首頁
app.get('/', (req, res) => {
  console.log('Hit / (root)');
  res.sendFile(path.join(__dirname, 'public/index.html'), (err) => {
    if (err) {
      console.error('SendFile error:', err);
      res.status(404).json({ error: 'Index not found' });
    }
  });
});

// 匯出完整 Excel 報表（中文欄位，多個 Sheet）
app.get('/export_excel', withUserDatabase, async (req, res) => {
  console.log('Hit /export_excel - Exporting all data to Excel');
  
  try {
    // 1. 查詢所有資料夾
    const folders = await new Promise((resolve, reject) => {
      req.userDb.all(`SELECT id, name, parent_id, path FROM folders ORDER BY id`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 2. 查詢所有人員
    const users = await new Promise((resolve, reject) => {
      req.userDb.all(`SELECT id, name, email FROM users ORDER BY id`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 3. 查詢所有群組及成員
    const groups = await new Promise((resolve, reject) => {
      req.userDb.all(`SELECT id, name FROM groups ORDER BY id`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 4. 查詢群組成員詳細資訊
    const groupMembers = await new Promise((resolve, reject) => {
      req.userDb.all(`
        SELECT g.id as group_id, g.name as group_name, 
               u.id as user_id, u.name as user_name, u.email
        FROM groups g
        LEFT JOIN group_users gu ON g.id = gu.group_id
        LEFT JOIN users u ON gu.user_id = u.id
        ORDER BY g.id, u.id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 5. 查詢所有權限
    const permissions = await new Promise((resolve, reject) => {
      req.userDb.all(`
        SELECT p.id, 
               f.name as folder_name, f.path as folder_path,
               u.name as user_name, u.email as user_email,
               g.name as group_name,
               p.permission_type
        FROM permissions p
        LEFT JOIN folders f ON p.folder_id = f.id
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN groups g ON p.group_id = g.id
        ORDER BY p.id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    // 6. 建立 Excel 工作簿
    const workbook = XLSX.utils.book_new();
    
    // 7. 建立「資料夾」工作表
    const foldersData = folders.map(f => ({
      '編號': f.id,
      '資料夾名稱': f.name,
      '父資料夾編號': f.parent_id || '',
      '完整路徑': f.path || ''
    }));
    const foldersSheet = XLSX.utils.json_to_sheet(foldersData);
    XLSX.utils.book_append_sheet(workbook, foldersSheet, '資料夾');
    
    // 8. 建立「人員」工作表
    const usersData = users.map(u => ({
      '編號': u.id,
      '姓名': u.name,
      'Email': u.email
    }));
    const usersSheet = XLSX.utils.json_to_sheet(usersData);
    XLSX.utils.book_append_sheet(workbook, usersSheet, '人員');
    
    // 9. 建立「群組」工作表
    const groupsData = groups.map(g => {
      const members = groupMembers
        .filter(m => m.group_id === g.id && m.user_id)
        .map(m => m.user_name)
        .join(', ');
      return {
        '編號': g.id,
        '群組名稱': g.name,
        '成員人數': groupMembers.filter(m => m.group_id === g.id && m.user_id).length,
        '成員清單': members || '無'
      };
    });
    const groupsSheet = XLSX.utils.json_to_sheet(groupsData);
    XLSX.utils.book_append_sheet(workbook, groupsSheet, '群組');
    
    // 10. 建立「群組成員明細」工作表
    const groupMembersData = groupMembers
      .filter(m => m.user_id) // 只顯示有成員的記錄
      .map(m => ({
        '群組編號': m.group_id,
        '群組名稱': m.group_name,
        '人員編號': m.user_id,
        '人員姓名': m.user_name,
        '人員Email': m.email
      }));
    const groupMembersSheet = XLSX.utils.json_to_sheet(groupMembersData);
    XLSX.utils.book_append_sheet(workbook, groupMembersSheet, '群組成員明細');
    
    // 11. 建立「權限」工作表
    const permissionsData = permissions.map(p => {
      const permType = p.permission_type === 'read' ? '讀取' :
                       p.permission_type === 'write' ? '寫入' : p.permission_type;
      const target = p.user_name ? `人員: ${p.user_name}` : 
                     p.group_name ? `群組: ${p.group_name}` : '未知';
      return {
        '編號': p.id,
        '資料夾': p.folder_path || p.folder_name,
        '授權對象': target,
        '對象名稱': p.user_name || p.group_name || '',
        'Email/說明': p.user_email || '',
        '權限類型': permType
      };
    });
    const permissionsSheet = XLSX.utils.json_to_sheet(permissionsData);
    XLSX.utils.book_append_sheet(workbook, permissionsSheet, '權限');
    
    // 12. 建立統計摘要工作表
    const summaryData = [
      { '項目': '資料夾總數', '數量': folders.length },
      { '項目': '人員總數', '數量': users.length },
      { '項目': '群組總數', '數量': groups.length },
      { '項目': '群組成員總數', '數量': groupMembers.filter(m => m.user_id).length },
      { '項目': '權限總數', '數量': permissions.length }
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, '統計摘要');
    
    // 13. 寫入檔案
    const tempFile = 'temp_export_' + Date.now() + '.xlsx';
    XLSX.writeFile(workbook, tempFile);
    
    console.log(`Exported Excel: ${folders.length} folders, ${users.length} users, ${groups.length} groups, ${permissions.length} permissions`);
    
    // 14. 下載檔案
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `權限管理系統_完整報表_${timestamp}.xlsx`;
    
    res.download(tempFile, filename, (err) => {
      if (err) console.error('Download error:', err);
      // 刪除臨時檔案
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
    
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 資料庫管理 API ====================

// 取得所有資料庫列表
app.get('/api/databases', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(DB_DIR);
    const userDatabase = req.session.userDatabase; // 當前使用者的資料庫
    const username = req.session.username;
    const isAdmin = req.session.role === 'admin';
    
    let databases = files
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const dbPath = path.join(DB_DIR, f);
        const stats = fs.statSync(dbPath);
        return {
          name: f,
          size: stats.size,
          modified: stats.mtime,
          isCurrent: f === userDatabase
        };
      });
    
    // 一般使用者只能看到自己的資料庫
    if (!isAdmin) {
      const userPrefix = `user_${username}_`;
      const initialDb = `user_${username}.db`;
      
      databases = databases.filter(db => 
        db.name.startsWith(userPrefix) || db.name === initialDb
      );
    }
    
    res.json({ 
      databases, 
      current: userDatabase,
      isAdmin: isAdmin,
      username: username,
      message: isAdmin ? 
        '管理員可查看所有資料庫' : 
        '顯示您的所有資料庫（可新增多個資料庫並在它們之間切換）'
    });
  } catch (err) {
    console.error('Failed to list databases:', err);
    res.status(500).json({ error: err.message });
  }
});

// 新增資料庫
app.post('/api/databases', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: '資料庫名稱為必填' });
    }
    
    const username = req.session.username;
    const isAdmin = req.session.role === 'admin';
    
    // 驗證檔名格式
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+\.db$/.test(name)) {
      return res.status(400).json({ error: '資料庫名稱格式不正確，請使用英文、數字、底線或中文，並以 .db 結尾' });
    }
    
    // 一般使用者只能創建以 user_{username}_ 開頭的資料庫
    if (!isAdmin) {
      const requiredPrefix = `user_${username}_`;
      if (!name.startsWith(requiredPrefix)) {
        return res.status(403).json({ 
          error: '權限不足',
          message: `一般使用者只能創建以 "${requiredPrefix}" 開頭的資料庫\n例如：${requiredPrefix}project1.db`
        });
      }
    }
    
    const dbPath = path.join(DB_DIR, name);
    
    // 檢查是否已存在
    if (fs.existsSync(dbPath)) {
      return res.status(400).json({ error: '資料庫已存在' });
    }
    
    // 建立新資料庫
    const newDb = await connectDatabase(name);
    newDb.close((err) => {
      if (err) {
        console.error('Failed to close new database:', err);
      }
    });
    
    console.log(`✓ 使用者 ${username} 創建資料庫: ${name}`);
    res.json({ 
      success: true,
      message: '資料庫建立成功', 
      name: name,
      isAdmin: isAdmin
    });
  } catch (err) {
    console.error('Failed to create database:', err);
    res.status(500).json({ error: err.message });
  }
});

// 切換資料庫（基於 session，使用者獨立）
app.post('/api/databases/switch', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: '資料庫名稱為必填' });
    }
    
    const username = req.session.username;
    const isAdmin = req.session.role === 'admin';
    
    // 一般使用者只能切換到以 user_{username}_ 開頭的資料庫
    if (!isAdmin) {
      const requiredPrefix = `user_${username}_`;
      // 或者是他們最初註冊時的資料庫 user_{username}.db
      const initialDb = `user_${username}.db`;
      
      if (!name.startsWith(requiredPrefix) && name !== initialDb) {
        return res.status(403).json({ 
          error: '權限不足',
          message: `您只能切換到自己的資料庫（以 "${requiredPrefix}" 開頭或 "${initialDb}"）`
        });
      }
    }
    
    const dbPath = path.join(DB_DIR, name);
    
    // 檢查資料庫是否存在
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: '資料庫不存在' });
    }
    
    // 更新 session 中的資料庫名稱（不影響其他使用者）
    const oldDatabase = req.session.userDatabase;
    req.session.userDatabase = name;
    
    // 關閉當前使用者的舊資料庫連接（如果存在）
    const userId = req.session.userId;
    const oldKey = `user_${userId}_${oldDatabase}`;
    
    if (userDatabases.has(oldKey)) {
      console.log(`Closing old database connection: ${oldKey}`);
      const oldDb = userDatabases.get(oldKey);
      await new Promise((resolve) => {
        oldDb.close((err) => {
          if (err) console.error('Error closing old database:', err);
          resolve();
        });
      });
      userDatabases.delete(oldKey);
      console.log(`Deleted old database connection from cache: ${oldKey}`);
    }
    
    console.log(`✓ 使用者 ${username} 切換到資料庫: ${name}`);
    res.json({ 
      success: true,
      message: '已切換到資料庫',
      name: name,
      note: '此切換僅影響您的 session，不會影響其他使用者',
      isAdmin: isAdmin
    });
  } catch (err) {
    console.error('Failed to switch database:', err);
    res.status(500).json({ error: err.message });
  }
});

// 刪除資料庫
app.delete('/api/databases', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Database name is required' });
    }
    
    // 不能刪除當前使用中的資料庫
    if (name === currentDbName) {
      return res.status(400).json({ error: '無法刪除目前使用中的資料庫，請先切換到其他資料庫' });
    }
    
    const dbPath = path.join(DB_DIR, name);
    
    // 檢查資料庫是否存在
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: '資料庫不存在' });
    }
    
    // 刪除檔案
    fs.unlinkSync(dbPath);
    
    res.json({ message: '資料庫已刪除', name });
  } catch (err) {
    console.error('Failed to delete database:', err);
    res.status(500).json({ error: err.message });
  }
});

// 複製資料庫
app.post('/api/databases/copy', (req, res) => {
  try {
    const { source, target } = req.body;
    if (!source || !target) {
      return res.status(400).json({ error: 'Source and target names are required' });
    }
    
    // 驗證檔名格式
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+\.db$/.test(target)) {
      return res.status(400).json({ error: '資料庫名稱格式不正確' });
    }
    
    const sourcePath = path.join(DB_DIR, source);
    const targetPath = path.join(DB_DIR, target);
    
    // 檢查來源是否存在
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: '來源資料庫不存在' });
    }
    
    // 檢查目標是否已存在
    if (fs.existsSync(targetPath)) {
      return res.status(400).json({ error: '目標資料庫已存在' });
    }
    
    // 複製檔案
    fs.copyFileSync(sourcePath, targetPath);
    
    res.json({ message: '資料庫已複製', source, target });
  } catch (err) {
    console.error('Failed to copy database:', err);
    res.status(500).json({ error: err.message });
  }
});

// 重新命名資料庫
app.post('/api/databases/rename', (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) {
      return res.status(400).json({ error: 'Old and new names are required' });
    }
    
    // 不能重新命名當前使用中的資料庫
    if (oldName === currentDbName) {
      return res.status(400).json({ error: '無法重新命名目前使用中的資料庫，請先切換到其他資料庫' });
    }
    
    // 驗證檔名格式
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+\.db$/.test(newName)) {
      return res.status(400).json({ error: '資料庫名稱格式不正確' });
    }
    
    const oldPath = path.join(DB_DIR, oldName);
    const newPath = path.join(DB_DIR, newName);
    
    // 檢查舊檔案是否存在
    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: '資料庫不存在' });
    }
    
    // 檢查新檔案是否已存在
    if (fs.existsSync(newPath)) {
      return res.status(400).json({ error: '目標名稱已存在' });
    }
    
    // 重新命名
    fs.renameSync(oldPath, newPath);
    
    res.json({ message: '資料庫已重新命名', oldName, newName });
  } catch (err) {
    console.error('Failed to rename database:', err);
    res.status(500).json({ error: err.message });
  }
});

// 自動生成群組並指派權限（優化版本 - 批次處理）
app.post('/api/auto-generate-groups', withUserDatabase, async (req, res) => {
  console.log('Hit POST /api/auto-generate-groups');
  
  try {
    const { folders } = req.body;
    
    if (!folders || folders.length === 0) {
      return res.status(400).json({ error: '沒有資料夾需要處理' });
    }
    
    console.log(`開始處理 ${folders.length} 個資料夾...`);
    
    let groupsCreated = 0;
    let groupsExisted = 0;
    let permissionsCreated = 0;
    let permissionsExisted = 0;
    let foldersProcessed = 0;
    
    // 先一次性獲取所有現有群組（減少查詢次數）
    const existingGroups = await new Promise((resolve, reject) => {
      req.userDb.all('SELECT id, name FROM groups', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    const groupMap = {};
    existingGroups.forEach(g => {
      groupMap[g.name] = g.id;
    });
    
    console.log(`現有群組數量: ${existingGroups.length}`);
    
    // 先一次性獲取所有現有權限（減少查詢次數）
    const existingPermissions = await new Promise((resolve, reject) => {
      req.userDb.all('SELECT folder_id, group_id, permission_type FROM permissions WHERE group_id IS NOT NULL', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    const permissionSet = new Set();
    existingPermissions.forEach(p => {
      permissionSet.add(`${p.folder_id}-${p.group_id}-${p.permission_type}`);
    });
    
    console.log(`現有權限數量: ${existingPermissions.length}`);
    
    // 準備批次插入的資料
    const groupsToInsert = [];
    const permissionsToInsert = [];
    
    for (const folder of folders) {
      const folderName = folder.name;
      const folderId = folder.id;
      
      const groupsToCreate = [
        { name: `${folderName}_RO`, permissionType: 'read' },
        { name: `${folderName}_RW`, permissionType: 'write' }
      ];
      
      for (const groupInfo of groupsToCreate) {
        const groupName = groupInfo.name;
        const permType = groupInfo.permissionType;
        
        let groupId = groupMap[groupName];
        
        if (groupId) {
          groupsExisted++;
        } else {
          // 準備插入新群組
          groupsToInsert.push(groupName);
        }
      }
      
      foldersProcessed++;
    }
    
    // 批次插入群組
    if (groupsToInsert.length > 0) {
      console.log(`批次建立 ${groupsToInsert.length} 個群組...`);
      
      for (const groupName of groupsToInsert) {
        const groupId = await new Promise((resolve, reject) => {
          req.userDb.run('INSERT OR IGNORE INTO groups (name) VALUES (?)', [groupName], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          });
        });
        
        if (groupId > 0) {
          groupMap[groupName] = groupId;
          groupsCreated++;
        }
      }
      
      console.log(`✓ 成功建立 ${groupsCreated} 個群組`);
    }
    
    // 準備權限資料
    for (const folder of folders) {
      const folderName = folder.name;
      const folderId = folder.id;
      
      const groupsToCheck = [
        { name: `${folderName}_RO`, permissionType: 'read' },
        { name: `${folderName}_RW`, permissionType: 'write' }
      ];
      
      for (const groupInfo of groupsToCheck) {
        const groupName = groupInfo.name;
        const permType = groupInfo.permissionType;
        const groupId = groupMap[groupName];
        
        if (groupId) {
          const permKey = `${folderId}-${groupId}-${permType}`;
          
          if (permissionSet.has(permKey)) {
            permissionsExisted++;
          } else {
            permissionsToInsert.push({
              folderId,
              groupId,
              permType
            });
          }
        }
      }
    }
    
    // 批次插入權限
    if (permissionsToInsert.length > 0) {
      console.log(`批次指派 ${permissionsToInsert.length} 個權限...`);
      
      for (const perm of permissionsToInsert) {
        await new Promise((resolve, reject) => {
          req.userDb.run(
            'INSERT OR IGNORE INTO permissions (folder_id, user_id, group_id, permission_type) VALUES (?, NULL, ?, ?)',
            [perm.folderId, perm.groupId, perm.permType],
            function(err) {
              if (err) reject(err);
              else {
                if (this.changes > 0) {
                  permissionsCreated++;
                }
                resolve();
              }
            }
          );
        });
      }
      
      console.log(`✓ 成功指派 ${permissionsCreated} 個權限`);
    }
    
    const result = {
      success: true,
      groupsCreated,
      groupsExisted,
      permissionsCreated,
      permissionsExisted,
      foldersProcessed
    };
    
    console.log('自動生成完成:', result);
    
    res.json(result);
    
  } catch (error) {
    console.error('自動生成群組時發生錯誤:', error);
    res.status(500).json({ error: error.message });
  }
});

// 自訂 404
app.use((req, res) => {
  console.log('404 for:', req.url);
  res.status(404).json({ error: 'Not Found: ' + req.url });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server on ${PORT}`);
});

