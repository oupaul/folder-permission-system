# Ubuntu 完整部署指南 - 資料夾權限管理系統

## 📋 目錄

1. [系統需求](#系統需求)
2. [快速部署（推薦）](#快速部署推薦)
3. [全新安裝部署（手動）](#全新安裝部署手動)
4. [應用程式設定](#應用程式設定)
5. [啟動與驗證](#啟動與驗證)
6. [防火牆設定](#防火牆設定)
7. [SSL/HTTPS 設定](#sslhttps-設定)
8. [開機自動啟動](#開機自動啟動)
9. [移除與卸載](#移除與卸載)
10. [疑難排解](#疑難排解)

---

## 系統需求

### 作業系統
- Ubuntu 20.04 LTS 或更新版本
- Ubuntu 22.04 LTS（推薦）

### 硬體需求

**最低配置：**
- CPU: 1 核心
- RAM: 1GB
- 硬碟: 10GB

**建議配置：**
- CPU: 2 核心以上
- RAM: 2GB 以上
- 硬碟: 20GB 以上（含日誌和備份空間）

### 網路需求
- 固定 IP 位址或 DDNS（建議）
- 對外開放 Port（預設 5000，也支援 3000、8080）

---

## 快速部署（推薦）

### ⚡ 使用自動部署腳本（最簡單）

本系統提供了 `deploy.sh` 自動部署腳本，可一鍵完成所有部署步驟。

#### 步驟 1: 上傳專案檔案

```bash
# 方法 A: 使用 SCP
# 在本地電腦執行（替換成您的伺服器資訊）
scp -r /path/to/project/* username@your-server-ip:/tmp/folder_permission_system/

# 方法 B: 使用 Git（推薦）
ssh username@your-server-ip
cd ~
git clone https://your-repo-url.git folder_permission_system
```

#### 步驟 2: 執行自動部署

```bash
# SSH 連接到伺服器
ssh username@your-server-ip

# 進入專案目錄
cd ~/folder_permission_system  # 或您上傳的目錄

# 設定執行權限
chmod +x deploy.sh

# 執行自動部署（需要 sudo）
sudo ./deploy.sh
```

#### 自動部署腳本會完成：

```
✅ 步驟 1/8: 檢查系統需求
   - 檢查 Node.js、npm、PM2、SQLite3

✅ 步驟 2/8: 安裝缺少的依賴
   - 自動安裝 Node.js 18.x LTS
   - 自動安裝 PM2
   - 自動安裝 SQLite3

✅ 步驟 3/8: 檢查防火牆狀態
   - 檢查 UFW 狀態
   - 提示需要開放的端口

✅ 步驟 4/8: 準備應用目錄
   - 創建 /opt/folder_permission_system
   - 設定適當權限

✅ 步驟 5/8: 部署應用程式檔案
   - 複製檔案到目標目錄
   - 排除 node_modules、databases 等

✅ 步驟 6/8: 安裝依賴和設定
   - npm install --production
   - 創建 databases、uploads、logs、backups、public 目錄
   - 檢查並移動 HTML 檔案到 public/ 資料夾
   - 設定目錄權限（775）
   - 設定腳本執行權限

✅ 步驟 7/8: 啟動應用程式
   - 停止現有進程（如果存在）
   - 使用 PM2 啟動應用
   - 設定開機自動啟動

✅ 步驟 8/8: 驗證部署
   - 自動檢測應用程式端口（5000、3000、8080）
   - HTTP 連接測試
   - API 端點測試
   - 管理員帳號檢查
```

#### 部署完成後

腳本會顯示：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 部署成功！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 應用程式已成功部署並啟動

📌 訪問資訊：
   應用程式端口：5000（或自動檢測的端口）
   本地訪問：http://localhost:5000
   外部訪問：http://your-server-ip:5000

🔐 預設管理員帳號：
   使用者名稱：admin
   密碼：admin123
   ⚠️  請立即登入並修改密碼！

📋 常用命令：
   查看狀態：pm2 status
   查看日誌：pm2 logs folder-permission-system
   重啟服務：pm2 restart folder-permission-system
   停止服務：pm2 stop folder-permission-system

🔥 防火牆設定（重要！）：
   sudo ufw allow 5000/tcp
   sudo ufw reload
```

#### 驗證部署

```bash
# 1. 檢查 PM2 狀態
pm2 status

# 2. 測試 API
curl http://localhost:5000/api/auth/status

# 3. 從瀏覽器訪問
# 開啟瀏覽器訪問：http://your-server-ip:5000
```

### 🎯 快速部署優勢

- ✅ **一鍵部署** - 無需手動執行複雜步驟
- ✅ **自動檢查** - 自動檢測並安裝缺少的依賴
- ✅ **智能檢測** - 自動檢測應用程式端口（5000/3000/8080）
- ✅ **錯誤處理** - 遇到問題會給出明確提示
- ✅ **完整驗證** - 自動驗證部署是否成功
- ✅ **安全提醒** - 提供防火牆和安全設定建議

### ⚠️ 注意事項

1. **端口說明**：
   - 預設端口：5000（app.js 配置）
   - 也支援：3000、8080
   - deploy.sh 會自動檢測實際使用的端口

2. **public 資料夾**：
   - HTML 檔案必須在 `public/` 資料夾下
   - deploy.sh 會自動檢查並移動檔案
   - 如果檔案在根目錄，會自動移動到 public/

3. **防火牆**：
   - deploy.sh 只檢查，不會自動開放端口
   - 需要手動執行 `sudo ufw allow [PORT]/tcp`

4. **重複執行**：
   - deploy.sh 可以安全地重複執行
   - 會停止現有進程並重新部署

---

## 全新安裝部署（手動）

如果您想了解詳細步驟或需要自訂安裝，請參考以下手動部署流程。

### 步驟 1: 更新系統

```bash
# 更新套件列表
sudo apt update

# 升級已安裝的套件
sudo apt upgrade -y

# 安裝必要的系統工具
sudo apt install -y curl wget git build-essential
```

### 步驟 2: 安裝 Node.js

#### 方法 A: 使用 NodeSource 官方倉庫（推薦）

```bash
# 安裝 Node.js 18.x LTS（推薦）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 或安裝 Node.js 20.x（最新 LTS）
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
# sudo apt install -y nodejs

# 驗證安裝
node --version   # 應顯示 v18.x.x 或 v20.x.x
npm --version    # 應顯示 9.x.x 或更新
```

#### 方法 B: 使用 NVM（適合多版本管理）

```bash
# 安裝 NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 重新載入 shell
source ~/.bashrc

# 安裝 Node.js LTS
nvm install --lts
nvm use --lts

# 驗證安裝
node --version
npm --version
```

### 步驟 3: 安裝 PM2 進程管理器

```bash
# 全域安裝 PM2
sudo npm install -g pm2

# 驗證安裝
pm2 --version

# 設定 PM2 開機自動啟動（重要！）
pm2 startup
# 執行顯示的命令（通常類似）：
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u your-user --hp /home/your-user
```

### 步驟 4: 安裝 SQLite3

```bash
# 安裝 SQLite3
sudo apt install -y sqlite3

# 驗證安裝
sqlite3 --version   # 應顯示 3.x.x
```

### 步驟 5: 創建應用目錄

```bash
# 創建應用目錄
sudo mkdir -p /opt/folder_permission_system

# 設定目錄擁有者為當前使用者
sudo chown -R $USER:$USER /opt/folder_permission_system

# 切換到應用目錄
cd /opt/folder_permission_system
```

### 步驟 6: 上傳應用程式檔案

#### 方法 A: 使用 SCP（從本地電腦上傳）

```bash
# 在您的本地電腦執行（不是在 Ubuntu 伺服器上）
# 替換 your-server-ip 為您的伺服器 IP
# 替換 your-username 為您的 Ubuntu 使用者名稱

# 方式 1: 上傳整個專案資料夾
scp -r /path/to/your/project/* your-username@your-server-ip:/opt/folder_permission_system/

# 方式 2: 使用 tar 打包後上傳（推薦，更快）
cd /path/to/your/project
tar -czf project.tar.gz *
scp project.tar.gz your-username@your-server-ip:/tmp/

# 然後在伺服器上解壓
ssh your-username@your-server-ip
cd /opt/folder_permission_system
tar -xzf /tmp/project.tar.gz
rm /tmp/project.tar.gz
```

#### 方法 B: 使用 Git（如果專案在版本控制中）

```bash
# 在伺服器上
cd /opt/folder_permission_system

# 從 Git 倉庫 clone
git clone https://your-git-repo.git .

# 或使用 pull（如果已經 clone 過）
git pull origin main
```

#### 方法 C: 使用 SFTP 客戶端

使用 FileZilla、WinSCP 或其他 SFTP 工具：
1. 連接到伺服器
2. 上傳所有檔案到 `/opt/folder_permission_system/`

### 步驟 7: 安裝應用程式依賴

```bash
cd /opt/folder_permission_system

# 安裝 npm 套件
npm install

# 驗證安裝
ls node_modules/   # 應該看到許多套件目錄
```

**必要的套件清單：**
- express
- sqlite3
- express-session
- bcryptjs
- multer
- cors
- csv-parser
- xlsx

如果 `package.json` 不存在或不完整，請手動安裝：

```bash
npm install express sqlite3 express-session bcryptjs multer cors csv-parser xlsx
```

### 步驟 8: 創建必要目錄

```bash
cd /opt/folder_permission_system

# 創建所有必要目錄
mkdir -p databases uploads logs backups public

# 設定權限
chmod 775 databases uploads logs backups public
```

### 步驟 8.1: 設定 public 資料夾（重要！）

```bash
cd /opt/folder_permission_system

# 檢查 HTML 檔案位置
ls -l *.html 2>/dev/null

# 如果 HTML 檔案在根目錄，移動到 public/
if [ -f "index.html" ]; then
    mv index.html public/
    echo "✅ 已移動 index.html 到 public/"
fi

if [ -f "login.html" ]; then
    mv login.html public/
    echo "✅ 已移動 login.html 到 public/"
fi

if [ -f "index_old.html" ]; then
    mv index_old.html public/
    echo "✅ 已移動 index_old.html 到 public/"
fi

# 驗證檔案位置
ls -l public/*.html

# 應該看到：
# public/index.html
# public/login.html
```

**為什麼需要 public 資料夾？**

app.js 使用 `express.static('public')` 提供靜態檔案：

```javascript
// app.js 配置
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
```

所有 HTML、CSS、JS、圖片等靜態檔案都必須放在 `public/` 資料夾下。

### 步驟 9: 設定環境變數（可選）

```bash
# 創建環境變數檔案
cat > .env << 'EOF'
# 伺服器設定
PORT=5000
# 注意：預設端口為 5000，也支援 3000、8080
NODE_ENV=production

# Session 密鑰（請更改為隨機字串！）
SESSION_SECRET=your-random-secret-key-change-this-in-production-$(date +%s)

# 資料庫設定
DB_DIR=databases

# 日誌設定
LOG_LEVEL=info
EOF

# 設定檔案權限（保護敏感資訊）
chmod 600 .env
```

**端口說明：**
- 預設端口：`5000`（如 app.js 中配置）
- 也支援：`3000`、`8080`
- 建議使用 5000（避免與其他服務衝突）

---

## 應用程式設定

### 設定 1: 修改 app.js（如果需要）

```bash
cd /opt/folder_permission_system
nano app.js
```

檢查並確認以下設定：

```javascript
// 確認 Port 設定（預設 5000）
const PORT = process.env.PORT || 5000;

// 確認 Session 密鑰（生產環境應使用環境變數）
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
  // ...
}));

// 確認資料庫目錄
const DB_DIR = process.env.DB_DIR || 'databases';
```

### 設定 2: 創建 PM2 配置檔案

```bash
cd /opt/folder_permission_system

cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'folder-permission-system',
    script: './app.js',
    
    // 實例設定
    instances: 1,
    exec_mode: 'fork',
    
    // 自動重啟設定
    watch: false,
    max_memory_restart: '500M',
    
    // 環境變數
    env: {
      NODE_ENV: 'production',
      PORT: 5000  // 預設端口 5000，也可設為 3000 或 8080
    },
    
    // 日誌設定
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 自動重啟條件
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Cron 重啟（可選，每天凌晨 4 點重啟）
    // cron_restart: '0 4 * * *',
    
    // 啟動延遲
    restart_delay: 4000,
    
    // 進階設定
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // 自動修復權限（啟動前執行）
    post_update: ['chmod 775 databases', 'chmod 664 databases/*.db || true']
  }]
};
EOF
```

### 設定 3: 修復資料庫權限

```bash
cd /opt/folder_permission_system

# 執行權限修復腳本
chmod +x fix_db_permissions.sh
./fix_db_permissions.sh

# 或手動修復
sudo chown -R $USER:$USER databases/
chmod 775 databases/
chmod 664 databases/*.db 2>/dev/null || true
```

---

## 啟動與驗證

### 啟動應用程式

```bash
cd /opt/folder_permission_system

# 使用 PM2 啟動
pm2 start ecosystem.config.js

# 或直接啟動（不推薦用於生產環境）
# pm2 start app.js --name folder-permission-system

# 查看狀態
pm2 status

# 查看日誌
pm2 logs folder-permission-system

# 查看詳細資訊
pm2 show folder-permission-system
```

**預期輸出：**
```
┌─────┬──────────────────────────────┬─────────────┬─────────┬─────────┬──────────┐
│ id  │ name                         │ mode        │ ↺       │ status  │ cpu      │
├─────┼──────────────────────────────┼─────────────┼─────────┼─────────┼──────────┤
│ 0   │ folder-permission-system     │ fork        │ 0       │ online  │ 0%       │
└─────┴──────────────────────────────┴─────────────┴─────────┴─────────┴──────────┘
```

### 驗證應用程式

#### 測試 1: 本地測試

```bash
# 首先檢查應用程式實際使用的端口
pm2 logs folder-permission-system --lines 10 | grep "listening on port"

# 或檢查監聽的端口
sudo netstat -tlnp | grep node
# 或使用 ss
sudo ss -tlnp | grep node

# 測試 API 是否回應（使用實際端口，預設 5000）
curl http://localhost:5000/api/auth/has-accounts

# 應該返回類似：
# {"hasAccounts":false}  （第一次部署）
# 或
# {"hasAccounts":true}   （已有帳號）
```

#### 測試 2: 網頁測試

```bash
# 在伺服器上測試 HTTP 連接（使用實際端口）
curl -I http://localhost:5000

# 應該返回：
# HTTP/1.1 200 OK
# Content-Type: text/html; charset=UTF-8

# 或可能返回 302 重定向到登入頁面（正常）
# HTTP/1.1 302 Found
# Location: /login.html
```

#### 測試 3: 從外部訪問

在您的電腦瀏覽器中訪問（使用實際端口）：
```
http://your-server-ip:5000
```

應該看到登入頁面。

#### 測試 4: 檢查資料庫

```bash
cd /opt/folder_permission_system/databases

# 列出資料庫檔案
ls -lh

# 應該看到：
# permissions.db
# admin.db（如果已經初始化）

# 檢查管理員帳號
sqlite3 permissions.db "SELECT username, role, status FROM accounts WHERE role='admin';"

# 應該看到：
# admin|admin|active
```

### 保存 PM2 設定

```bash
# 保存當前 PM2 應用程式列表
pm2 save

# 確認已保存
pm2 list
```

---

## 防火牆設定

### 使用 UFW（Ubuntu 預設防火牆）

```bash
# 檢查防火牆狀態
sudo ufw status

# 如果未啟用，先啟用防火牆
sudo ufw enable

# 允許 SSH（重要！避免被鎖在外面）
sudo ufw allow ssh
# 或指定 Port
sudo ufw allow 22/tcp

# 允許應用程式 Port（根據您的配置選擇）
# 預設 5000
sudo ufw allow 5000/tcp

# 或如果使用 3000
# sudo ufw allow 3000/tcp

# 或如果使用 8080
# sudo ufw allow 8080/tcp

# 如果使用 HTTPS（透過 Nginx）
sudo ufw allow 443/tcp

# 如果使用 HTTP（透過 Nginx，不建議直接暴露 Node.js 端口到外網）
sudo ufw allow 80/tcp

# 重新載入防火牆
sudo ufw reload

# 查看規則
sudo ufw status numbered
```

**端口選擇建議：**

| 端口 | 用途 | 建議 |
|------|------|------|
| 5000 | Node.js 預設 | ✅ 推薦（避免衝突） |
| 3000 | Node.js 常用 | ⚠️  可能與其他服務衝突 |
| 8080 | 備用端口 | ✅ 可用 |
| 80/443 | Nginx 反向代理 | ✅ 生產環境推薦 |

**安全建議：**
```bash
# 只在本地監聽 Node.js，通過 Nginx 反向代理（最安全）
# app.js 修改為：
# app.listen(5000, 'localhost');  // 只監聽本地

# 防火牆只開放 80 和 443
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# 不開放 5000（因為只有 Nginx 能訪問）
```

### 使用 iptables（進階）

```bash
# 允許 Port 3000
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT

# 保存規則
sudo netfilter-persistent save

# 或使用 iptables-save
sudo sh -c "iptables-save > /etc/iptables/rules.v4"
```

---

## SSL/HTTPS 設定

### 方法 A: 使用 Nginx 反向代理（推薦）

#### 步驟 1: 安裝 Nginx

```bash
sudo apt install -y nginx
```

#### 步驟 2: 創建 Nginx 配置

```bash
sudo nano /etc/nginx/sites-available/folder-permission-system
```

**基本配置（HTTP）：**

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # 日誌
    access_log /var/log/nginx/folder-permission-system-access.log;
    error_log /var/log/nginx/folder-permission-system-error.log;

    # 反向代理到 Node.js（確保端口與 app.js 配置一致）
    location / {
        proxy_pass http://localhost:5000;  # 預設使用 5000，也可改為 3000 或 8080
        proxy_http_version 1.1;
        
        # WebSocket 支援（如果需要）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # 轉發真實 IP
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeout 設定
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # 靜態檔案快取
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        proxy_pass http://localhost:5000;  # 與上方端口保持一致
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # 安全性標頭
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

#### 步驟 3: 啟用配置

```bash
# 創建符號連結
sudo ln -s /etc/nginx/sites-available/folder-permission-system /etc/nginx/sites-enabled/

# 測試配置
sudo nginx -t

# 重新載入 Nginx
sudo systemctl reload nginx

# 確認 Nginx 運行
sudo systemctl status nginx
```

#### 步驟 4: 安裝 SSL 憑證（Let's Encrypt）

```bash
# 安裝 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 自動配置 SSL
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# 按照提示操作：
# 1. 輸入 email
# 2. 同意服務條款
# 3. 選擇是否重新導向 HTTP 到 HTTPS（建議選是）

# 測試自動更新
sudo certbot renew --dry-run
```

**SSL 配置完成後，Nginx 配置會自動更新為：**

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL 憑證
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # SSL 設定
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # ... 其他配置 ...
}
```

### 方法 B: Node.js 直接使用 HTTPS（不推薦生產環境）

如果不使用 Nginx，可以修改 app.js：

```javascript
const https = require('https');
const fs = require('fs');

// SSL 憑證
const options = {
  key: fs.readFileSync('/path/to/private-key.pem'),
  cert: fs.readFileSync('/path/to/certificate.pem')
};

// 創建 HTTPS 伺服器
https.createServer(options, app).listen(443, () => {
  console.log('HTTPS Server running on port 443');
});

// 可選：HTTP 重新導向到 HTTPS
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
  res.end();
}).listen(80);
```

---

## 開機自動啟動

### 已經設定（使用 PM2）

```bash
# 確認 PM2 開機自動啟動已設定
pm2 startup

# 執行顯示的命令（如果尚未執行）

# 保存當前應用程式列表
pm2 save

# 測試重開機
sudo reboot

# 重開機後檢查
pm2 list
# 應該看到應用程式自動啟動
```

### 驗證自動啟動

```bash
# 查看 systemd 服務
sudo systemctl status pm2-$USER

# 應該顯示：
# Active: active (running)

# 查看服務是否啟用
sudo systemctl is-enabled pm2-$USER
# 應該返回：enabled
```

---

## 移除與卸載

### 使用自動移除腳本（推薦）

本系統提供了 `uninstall.sh` 腳本，可安全地移除應用程式。

```bash
cd /opt/folder_permission_system

# 設定執行權限
chmod +x uninstall.sh

# 執行移除腳本（需要 sudo）
sudo ./uninstall.sh
```

### 三種移除模式

#### 模式 1: 完全移除 🗑️
```
- 刪除所有檔案
- 刪除所有資料庫
- 刪除所有備份
- 停止並移除 PM2 進程
- ❌ 無法恢復
```

**適合：** 完全不再使用此應用

#### 模式 2: 保留資料移除 💾 ⭐ 推薦
```
- 自動備份資料庫到 /opt/backups/uninstall_YYYYMMDD_HHMMSS/
- 自動備份上傳檔案
- 自動備份配置檔案
- 然後刪除應用程式目錄
- ✅ 可以恢復資料
```

**適合：** 重新部署、升級、或不確定是否需要保留資料

**恢復方法：**
```bash
# 1. 重新部署
sudo ./deploy.sh

# 2. 恢復資料
BACKUP=$(ls -td /opt/backups/uninstall_* | head -1)
sudo cp -r $BACKUP/databases/* /opt/folder_permission_system/databases/
sudo chown -R $USER:$USER /opt/folder_permission_system/databases
sudo chmod -R 775 /opt/folder_permission_system/databases

# 3. 重啟服務
pm2 restart folder-permission-system
```

#### 模式 3: 僅停止服務 🛑
```
- 停止 PM2 進程
- 釋放端口
- 保留所有檔案和資料
- ✅ 可以隨時重新啟動
```

**適合：** 臨時停止、維護、釋放資源

**重新啟動方法：**
```bash
cd /opt/folder_permission_system
pm2 start ecosystem.config.js
```

### 手動移除（如果腳本無法使用）

```bash
# 1. 停止服務
pm2 stop folder-permission-system
pm2 delete folder-permission-system
pm2 save

# 2. 備份資料（可選但建議）
sudo tar -czf ~/folder_permission_backup_$(date +%Y%m%d_%H%M%S).tar.gz \
  /opt/folder_permission_system/databases

# 3. 刪除應用目錄
sudo rm -rf /opt/folder_permission_system

# 4. 移除防火牆規則（可選）
sudo ufw delete allow 5000/tcp

# 5. 檢查端口
sudo lsof -i:5000
# 如果還有進程佔用，終止它：
# sudo kill -9 <PID>

# 6. 驗證移除
pm2 list  # 應該沒有 folder-permission-system
ls /opt/folder_permission_system  # 應該不存在
```

### 移除 PM2（完全清理）

如果不再需要 PM2：

```bash
# 1. 停止所有進程
pm2 kill

# 2. 卸載 PM2
sudo npm uninstall -g pm2

# 3. 移除 systemd 服務
sudo systemctl disable pm2-$USER
sudo rm /etc/systemd/system/pm2-$USER.service
sudo systemctl daemon-reload

# 4. 清理 PM2 配置
rm -rf ~/.pm2
```

---

## 疑難排解

### 問題 1: 應用程式無法啟動

**檢查日誌：**

```bash
# PM2 日誌
pm2 logs folder-permission-system

# 系統日誌
journalctl -u pm2-$USER -f

# 應用程式日誌
tail -f /opt/folder_permission_system/logs/pm2-error.log
```

**常見原因：**

1. **Port 已被佔用**
   ```bash
   # 檢查 Port（預設 5000，也可能是 3000 或 8080）
   sudo lsof -i :5000
   sudo lsof -i :3000
   sudo lsof -i :8080
   
   # 終止佔用的進程
   sudo kill -9 <PID>
   
   # 或使用 netstat/ss 查看
   sudo netstat -tlnp | grep :5000
   sudo ss -tlnp | grep :5000
   ```

2. **權限問題**
   ```bash
   cd /opt/folder_permission_system
   ./fix_db_permissions.sh
   ```

3. **依賴未安裝**
   ```bash
   cd /opt/folder_permission_system
   npm install
   ```

### 問題 2: 無法從外部訪問

**檢查清單：**

```bash
# 1. 應用程式是否運行
pm2 status

# 2. Port 是否監聽（檢查實際使用的端口）
sudo netstat -tlnp | grep :5000
sudo netstat -tlnp | grep :3000
sudo netstat -tlnp | grep :8080
# 或使用 ss
sudo ss -tlnp | grep node

# 3. 防火牆是否開放（檢查對應端口）
sudo ufw status | grep 5000
sudo ufw status | grep 3000
sudo ufw status | grep 8080

# 4. 本地可以訪問嗎（使用實際端口）
curl http://localhost:5000
# 或
curl http://localhost:3000

# 5. 確認監聽地址
# 檢查是否只監聽 localhost（127.0.0.1）還是所有地址（0.0.0.0）
sudo netstat -tlnp | grep node
# 如果看到 127.0.0.1:5000，表示只監聽本地（需要通過 Nginx 代理）
# 如果看到 0.0.0.0:5000，表示監聽所有地址（可以直接訪問）

# 6. SELinux 狀態（某些發行版，Ubuntu 預設沒有）
getenforce
# 如果是 Enforcing，可能需要調整規則
```

**常見解決方案：**

1. **如果本地可以訪問但外部不行** → 防火牆問題
   ```bash
   sudo ufw allow 5000/tcp
   sudo ufw reload
   ```

2. **如果監聽 127.0.0.1** → 需要設定 Nginx 反向代理或修改 app.js
   ```javascript
   // app.js 修改為監聽所有地址
   app.listen(PORT, '0.0.0.0', () => {
     console.log(`Server running on port ${PORT}`);
   });
   ```

3. **如果使用雲端主機（AWS/GCP/Azure）** → 檢查安全組/網路規則

### 問題 3: 資料庫錯誤

**SQLITE_READONLY 錯誤：**

```bash
cd /opt/folder_permission_system
./fix_db_permissions.sh
pm2 restart folder-permission-system
```

**資料庫損壞：**

```bash
cd /opt/folder_permission_system/databases

# 備份資料庫
cp permissions.db permissions.db.backup.$(date +%Y%m%d_%H%M%S)

# 檢查完整性
sqlite3 permissions.db "PRAGMA integrity_check;"

# 如果損壞，嘗試修復
sqlite3 permissions.db ".dump" | sqlite3 permissions_new.db
mv permissions.db permissions.db.corrupt
mv permissions_new.db permissions.db
```

### 問題 4: PM2 應用程式頻繁重啟

**檢查原因：**

```bash
# 查看重啟次數
pm2 show folder-permission-system

# 查看錯誤日誌
pm2 logs folder-permission-system --err

# 查看記憶體使用
pm2 monit
```

**常見原因：**

1. **記憶體不足**
   ```bash
   # 增加最大記憶體限制
   pm2 stop folder-permission-system
   pm2 delete folder-permission-system
   pm2 start ecosystem.config.js
   # 確保 ecosystem.config.js 中 max_memory_restart 設定合理
   ```

2. **未捕捉的錯誤**
   - 檢查日誌找出錯誤原因
   - 修正程式碼錯誤

### 問題 5: Nginx 502 Bad Gateway

**檢查：**

```bash
# 1. Node.js 應用是否運行
pm2 status

# 2. Nginx 錯誤日誌
sudo tail -f /var/log/nginx/folder-permission-system-error.log

# 3. 測試反向代理（使用實際端口）
curl http://localhost:5000
# 如果 Nginx 配置使用 3000，則測試：
# curl http://localhost:3000

# 4. 檢查 Nginx 配置中的端口設定
sudo nano /etc/nginx/sites-available/folder-permission-system
# 確認 proxy_pass http://localhost:5000; 使用正確的端口

# 5. 檢查 Nginx 配置語法
sudo nginx -t

# 6. 重啟 Nginx
sudo systemctl restart nginx

# 7. 檢查 Nginx 和 Node.js 連接
sudo netstat -tlnp | grep :5000  # Node.js
sudo netstat -tlnp | grep :80    # Nginx HTTP
sudo netstat -tlnp | grep :443   # Nginx HTTPS
```

**Nginx 配置示例（確保端口正確）：**

```nginx
# /etc/nginx/sites-available/folder-permission-system
server {
    listen 80;
    server_name your-domain.com;

    location / {
        # 確保這裡的端口與 Node.js 實際監聽的端口一致
        proxy_pass http://localhost:5000;  # 改為 5000 或您實際使用的端口
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📊 部署檢查清單

使用此清單確保所有步驟都已完成：

```
系統準備：
 ☐ Ubuntu 系統已更新
 ☐ Node.js 已安裝（v16+ 或 v18+）
 ☐ PM2 已安裝
 ☐ SQLite3 已安裝

應用程式：
 ☐ 應用程式檔案已上傳到 /opt/folder_permission_system
 ☐ npm 依賴已安裝（npm install）
 ☐ 必要目錄已創建（databases, uploads, logs）
 ☐ 資料庫權限已修復（chmod 775 databases）
 ☐ PM2 配置檔案已創建（ecosystem.config.js）

啟動與測試：
 ☐ PM2 應用程式已啟動
 ☐ PM2 設定已保存（pm2 save）
 ☐ 本地可以訪問（curl localhost:3000）
 ☐ 管理員帳號已創建（admin/admin123）
 ☐ 應用程式功能測試正常

網路與安全：
 ☐ 防火牆已設定（允許 Port 3000 或 80/443）
 ☐ 可從外部訪問
 ☐ Session 密鑰已更改（非預設值）
 ☐ SSL 憑證已安裝（如果使用 HTTPS）

自動化與維護：
 ☐ PM2 開機自動啟動已設定
 ☐ 重開機測試成功
 ☐ 日誌輪替已設定
 ☐ 備份腳本已設定
```

---

## 🎉 部署完成

恭喜！如果您已完成所有步驟，系統應該已經成功部署並運行。

**接下來：**
1. 參閱《系統維護管理手冊.md》了解日常維護
2. 設定定期備份（參見維護手冊）
3. 查看《完整移除腳本說明.md》了解如何安全移除應用
4. 查看《故障排除手冊.md》了解常見問題解決

**預設管理員帳號：**
- 使用者名稱：`admin`
- 密碼：`admin123`
- **重要：** 首次登入後請立即更改密碼！

---

## 📚 相關文檔

### 部署相關
- ✅ `deploy.sh` - 自動部署腳本（一鍵部署）
- ✅ `Ubuntu完整部署指南.md` - 本文檔（詳細步驟）
- ✅ `deploy.sh public資料夾處理說明.md` - public 資料夾處理說明
- ✅ `deploy.sh Port自動檢測修正說明.md` - 端口自動檢測說明
- ✅ `deploy.sh錯誤處理修正說明.md` - 錯誤處理機制說明

### 移除相關
- ✅ `uninstall.sh` - 自動移除腳本（三種模式）
- ✅ `完整移除腳本說明.md` - 詳細移除文檔
- ✅ `快速移除指南.md` - 快速參考指南

### 維護相關
- ✅ `系統維護管理手冊.md` - 日常維護指南
- ✅ `故障排除手冊.md` - 問題排查手冊
- ✅ `常用命令快速參考.md` - 命令速查表
- ✅ `部署維護文檔總覽.md` - 文檔索引

### 功能說明
- ✅ `多租戶架構修改說明.md` - 多使用者支援說明
- ✅ `修改密碼功能說明.md` - 密碼修改功能
- ✅ `資料庫權限問題修正指南.md` - 權限問題處理

---

## 🚀 快速命令參考

```bash
# === 部署 ===
sudo ./deploy.sh                    # 自動部署

# === 服務管理 ===
pm2 status                          # 查看狀態
pm2 logs folder-permission-system   # 查看日誌
pm2 restart folder-permission-system # 重啟服務
pm2 stop folder-permission-system    # 停止服務
pm2 monit                           # 監控資源

# === 資料庫 ===
./fix_db_permissions.sh             # 修復權限
./backup_databases.sh               # 備份資料庫

# === 診斷 ===
./health_check.sh                   # 健康檢查
./quick_diagnose.sh                 # 快速診斷

# === 移除 ===
sudo ./uninstall.sh                 # 移除應用

# === 防火牆 ===
sudo ufw allow 5000/tcp             # 開放端口
sudo ufw status                     # 查看狀態
```

---

## ⚠️ 重要提醒

### 端口配置
- **預設端口：5000** （推薦使用）
- 也支援：3000、8080
- deploy.sh 會自動檢測實際使用的端口
- 記得在防火牆開放對應端口：`sudo ufw allow 5000/tcp`

### public 資料夾
- **所有 HTML 檔案必須在 `public/` 資料夾下**
- deploy.sh 會自動檢查並移動檔案
- 手動部署請確認檔案位置正確

### 安全設定
- 首次登入後立即修改管理員密碼
- 使用環境變數設定 SESSION_SECRET
- 建議使用 Nginx 反向代理，不要直接暴露 Node.js 端口
- 定期備份資料庫

### 腳本使用
- `deploy.sh` 可以重複執行（冪等）
- `uninstall.sh` 有三種模式，建議選擇「保留資料移除」
- 所有腳本都需要 sudo 權限執行

---

**文件版本：** v2.0  
**最後更新：** 2024年11月  
**適用版本：** Ubuntu 20.04 LTS / 22.04 LTS  
**應用端口：** 5000（預設）/ 3000 / 8080

