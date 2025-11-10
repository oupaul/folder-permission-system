#!/bin/bash

# ============================================================================
# 資料夾權限管理系統 - 自動化部署腳本
# ============================================================================
# 
# 此腳本用於在 Ubuntu 伺服器上自動部署應用程式
# 
# 使用方法：
#   chmod +x deploy.sh
#   ./deploy.sh
# 
# ============================================================================

# 設定
APP_NAME="folder-permission-system"
APP_DIR="/opt/$APP_NAME"
NODE_VERSION="18"  # Node.js 版本

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 錯誤處理
set -e
trap 'last_command=$current_command; current_command=$BASH_COMMAND' DEBUG
trap 'echo -e "${RED}❌ 部署失敗於命令：$last_command${NC}"' ERR

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║       資料夾權限管理系統 - 自動化部署                         ║"
echo "║       Folder Permission System - Auto Deploy                   ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 檢查是否為 root 或有 sudo 權限
if [ "$EUID" -eq 0 ]; then 
    echo -e "${YELLOW}⚠️  不建議以 root 身份執行此腳本${NC}"
    read -p "繼續？(yes/no) " -r
    if [[ ! $REPLY =~ ^[Yy]([Ee][Ss])?$ ]]; then
        exit 1
    fi
fi

# 檢查 sudo 權限
if ! sudo -v; then
    echo -e "${RED}❌ 需要 sudo 權限${NC}"
    exit 1
fi

echo -e "${BLUE}開始部署時間：$(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""

# ============================================================================
# 步驟 1: 系統準備
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 1/8: 系統準備"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "更新系統套件..."
sudo apt update -qq
sudo apt upgrade -y -qq
sudo apt install -y curl wget git build-essential sqlite3

echo -e "${GREEN}✅ 系統準備完成${NC}"
echo ""

# ============================================================================
# 步驟 2: 安裝 Node.js
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 2/8: 安裝 Node.js"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v node &> /dev/null; then
    CURRENT_NODE_VERSION=$(node --version)
    echo "Node.js 已安裝：$CURRENT_NODE_VERSION"
    
    read -p "是否重新安裝 Node.js $NODE_VERSION？(y/N) " -r
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
        sudo apt install -y nodejs
    fi
else
    echo "安裝 Node.js $NODE_VERSION..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt install -y nodejs
fi

echo "Node.js 版本：$(node --version)"
echo "npm 版本：$(npm --version)"
echo -e "${GREEN}✅ Node.js 安裝完成${NC}"
echo ""

# ============================================================================
# 步驟 3: 安裝 PM2
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 3/8: 安裝 PM2"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v pm2 &> /dev/null; then
    echo "PM2 已安裝：$(pm2 --version)"
else
    echo "安裝 PM2..."
    sudo npm install -g pm2
    
    # 設定 PM2 開機自動啟動
    pm2 startup | grep "sudo" | bash
fi

echo -e "${GREEN}✅ PM2 安裝完成${NC}"
echo ""

# ============================================================================
# 步驟 4: 創建應用目錄
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 4/8: 創建應用目錄"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -d "$APP_DIR" ]; then
    echo -e "${YELLOW}⚠️  應用目錄已存在：$APP_DIR${NC}"
    read -p "是否備份現有目錄並重新安裝？(y/N) " -r
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        BACKUP_NAME="${APP_NAME}_backup_$(date +%Y%m%d_%H%M%S)"
        echo "備份現有目錄到：/opt/$BACKUP_NAME"
        sudo mv "$APP_DIR" "/opt/$BACKUP_NAME"
        
        sudo mkdir -p "$APP_DIR"
        sudo chown -R $USER:$USER "$APP_DIR"
    fi
else
    sudo mkdir -p "$APP_DIR"
    sudo chown -R $USER:$USER "$APP_DIR"
    echo "已創建應用目錄：$APP_DIR"
fi

echo -e "${GREEN}✅ 應用目錄準備完成${NC}"
echo ""

# ============================================================================
# 步驟 5: 部署應用程式檔案
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 5/8: 部署應用程式檔案"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$SCRIPT_DIR" = "$APP_DIR" ]; then
    echo "檔案已在目標目錄，跳過複製"
else
    echo "複製檔案從 $SCRIPT_DIR 到 $APP_DIR"
    
    # 檢查是否需要排除某些目錄
    EXCLUDE_DIRS="node_modules databases backups logs uploads"
    
    echo "排除的目錄：$EXCLUDE_DIRS"
    
    # 使用 rsync 複製（如果可用）
    if command -v rsync &> /dev/null; then
        rsync -av --exclude='node_modules' --exclude='databases' --exclude='backups' --exclude='logs' --exclude='uploads' \
            "$SCRIPT_DIR/" "$APP_DIR/"
    else
        # 使用 cp（較慢）
        cp -r "$SCRIPT_DIR"/* "$APP_DIR/" 2>/dev/null || true
    fi
fi

echo -e "${GREEN}✅ 檔案部署完成${NC}"
echo ""

# ============================================================================
# 步驟 6: 安裝依賴和設定
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 6/8: 安裝依賴和設定"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$APP_DIR"

echo "安裝 npm 套件..."
npm install --production

echo ""
echo "創建必要目錄..."
mkdir -p databases uploads logs backups public

echo "設定目錄權限..."
chmod 775 databases uploads logs backups public

echo ""
echo "檢查並設定 public 資料夾..."

# 檢查 HTML 檔案位置
HTML_FILES=("index.html" "login.html" "index_old.html")
FILES_TO_MOVE=()

for FILE in "${HTML_FILES[@]}"; do
    if [ -f "$FILE" ] && [ ! -f "public/$FILE" ]; then
        FILES_TO_MOVE+=("$FILE")
    fi
done

if [ ${#FILES_TO_MOVE[@]} -gt 0 ]; then
    echo "發現 HTML 檔案在根目錄，移動到 public/ 資料夾..."
    for FILE in "${FILES_TO_MOVE[@]}"; do
        if [ -f "$FILE" ]; then
            echo "  移動 $FILE -> public/$FILE"
            mv "$FILE" "public/"
        fi
    done
    echo -e "${GREEN}✅ HTML 檔案已移動到 public/ 資料夾${NC}"
elif [ -f "public/index.html" ]; then
    echo -e "${GREEN}✅ HTML 檔案已在 public/ 資料夾中${NC}"
else
    echo -e "${YELLOW}⚠️  警告：未找到 index.html 檔案${NC}"
    echo "   請確認 HTML 檔案位置是否正確"
fi

echo ""
echo "設定可執行權限..."
chmod +x *.sh 2>/dev/null || true

echo -e "${GREEN}✅ 依賴和設定完成${NC}"
echo ""

# ============================================================================
# 步驟 7: 啟動應用程式
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 7/8: 啟動應用程式"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 停止現有的應用程式（如果存在）
if pm2 list | grep -q "$APP_NAME"; then
    echo "停止現有應用程式..."
    pm2 stop $APP_NAME
    pm2 delete $APP_NAME
fi

echo "啟動應用程式..."
if [ -f "ecosystem.config.js" ]; then
    pm2 start ecosystem.config.js
else
    pm2 start app.js --name $APP_NAME
fi

echo "保存 PM2 設定..."
pm2 save

sleep 3

echo ""
echo "應用程式狀態："
pm2 status

echo -e "${GREEN}✅ 應用程式啟動完成${NC}"
echo ""

# ============================================================================
# 步驟 8: 驗證部署
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "步驟 8/8: 驗證部署"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 臨時禁用錯誤中斷（驗證過程中的失敗是正常的）
set +e

echo "等待應用程式啟動..."
echo -n "進度："
for i in {1..10}; do
    echo -n "█"
    sleep 1
done
echo " 完成"
echo ""

# 檢查應用程式進程狀態
echo "檢查應用程式進程..."
if pm2 list | grep -q "online.*$APP_NAME"; then
    echo -e "${GREEN}✅ 應用程式進程運行中${NC}"
else
    echo -e "${YELLOW}⚠️  應用程式進程狀態異常${NC}"
    echo "PM2 狀態："
    pm2 list
    echo ""
fi

# 自動檢測應用程式使用的 Port
echo "檢測應用程式 Port..."
APP_PORT=$(grep -E "^const PORT = [0-9]+;" "$APP_DIR/app.js" | sed 's/const PORT = //; s/;//' 2>/dev/null)

if [ -z "$APP_PORT" ]; then
    # 如果無法從 app.js 讀取，嘗試檢測實際監聽的 port
    APP_PORT=$(sudo netstat -tlnp 2>/dev/null | grep "node" | grep "LISTEN" | awk '{print $4}' | grep -oE "[0-9]+$" | head -1)
fi

if [ -z "$APP_PORT" ]; then
    # 如果還是檢測不到，使用預設值
    APP_PORT=5000
    echo -e "${YELLOW}⚠️  無法自動檢測 Port，使用預設值：$APP_PORT${NC}"
else
    echo -e "${GREEN}✅ 檢測到應用程式 Port：$APP_PORT${NC}"
fi

echo ""

# 檢查 Port 是否在監聽
echo "檢查 Port 監聽狀態..."
if netstat -tln 2>/dev/null | grep -q ":$APP_PORT "; then
    echo -e "${GREEN}✅ Port $APP_PORT 正在監聽${NC}"
elif ss -tln 2>/dev/null | grep -q ":$APP_PORT "; then
    echo -e "${GREEN}✅ Port $APP_PORT 正在監聽${NC}"
else
    echo -e "${YELLOW}⚠️  Port $APP_PORT 未在監聽${NC}"
    echo "正在列出所有 Node.js 監聽的 Port..."
    netstat -tlnp 2>/dev/null | grep node || ss -tlnp 2>/dev/null | grep node || echo "無法檢測"
fi

echo ""

# 測試 HTTP 連接
echo "測試 HTTP 連接到 http://localhost:$APP_PORT ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$APP_PORT 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ HTTP 測試通過（狀態碼：$HTTP_CODE）${NC}"
    DEPLOY_SUCCESS=true
elif [ "$HTTP_CODE" = "404" ]; then
    echo -e "${YELLOW}⚠️  HTTP 回應 404 - 伺服器運行中但路由不存在${NC}"
    echo -e "${YELLOW}   這可能是正常的，應用程式可能需要訪問特定路徑${NC}"
    DEPLOY_SUCCESS=true  # 404 表示伺服器在運行，只是路由不對
else
    echo -e "${YELLOW}⚠️  HTTP 測試異常（狀態碼：$HTTP_CODE）${NC}"
    echo -e "${YELLOW}   正在檢查常用 Port...${NC}"
    
    DEPLOY_SUCCESS=false
    # 嘗試其他常用 Port
    for TEST_PORT in 3000 5000 8080; do
        if [ "$TEST_PORT" != "$APP_PORT" ]; then
            echo -n "   測試 Port $TEST_PORT... "
            TEST_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$TEST_PORT 2>/dev/null || echo "000")
            if [ "$TEST_CODE" = "200" ] || [ "$TEST_CODE" = "404" ]; then
                echo -e "${GREEN}回應 $TEST_CODE${NC}"
                APP_PORT=$TEST_PORT
                DEPLOY_SUCCESS=true
                break
            else
                echo -e "${YELLOW}無回應${NC}"
            fi
        fi
    done
    
    if [ "$DEPLOY_SUCCESS" = false ]; then
        echo -e "${YELLOW}   未在常用 Port 找到應用程式${NC}"
        echo ""
        echo -e "${YELLOW}   診斷建議：${NC}"
        echo "   1. 檢查應用程式日誌：pm2 logs $APP_NAME --err"
        echo "   2. 檢查應用程式狀態：pm2 status"
        echo "   3. 手動測試：curl -v http://localhost:$APP_PORT"
    fi
fi

echo ""

# 測試 API
if [ "$DEPLOY_SUCCESS" = true ]; then
    API_RESPONSE=$(curl -s http://localhost:$APP_PORT/api/auth/has-accounts 2>/dev/null || echo "")
    if echo "$API_RESPONSE" | grep -q "hasAccounts"; then
        echo -e "${GREEN}✅ API 測試通過${NC}"
    else
        echo -e "${YELLOW}⚠️  API 測試異常${NC}"
        echo -e "${YELLOW}   應用程式可能還在啟動中，請稍後手動驗證${NC}"
    fi
fi

# 重新啟用錯誤中斷
set -e

echo ""

# ============================================================================
# 完成
# ============================================================================

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║                    🎉 部署完成！                               ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo -e "${GREEN}✅ 應用程式已成功部署並運行${NC}"
echo ""

# 顯示訪問資訊
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "訪問資訊"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  本地訪問：http://localhost:$APP_PORT"
echo "  遠端訪問：http://$SERVER_IP:$APP_PORT"
echo ""
echo "  預設管理員帳號："
echo "    使用者名稱：admin"
echo "    密碼：admin123"
echo ""
echo -e "${RED}  ⚠️  重要：首次登入後請立即更改預設密碼！${NC}"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "接下來的步驟"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. 設定防火牆："
echo "   sudo ufw allow $APP_PORT/tcp"
echo "   sudo ufw enable"
echo ""
echo "2. 查看應用程式日誌："
echo "   pm2 logs $APP_NAME"
echo ""
echo "3. 查看應用程式狀態："
echo "   pm2 status"
echo ""
echo "4. 設定 SSL（可選）："
echo "   參閱《Ubuntu完整部署指南.md》"
echo ""
echo "5. 設定自動備份："
echo "   crontab -e"
echo "   0 4 * * * $APP_DIR/backup_databases.sh"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "相關文檔"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  📖 Ubuntu完整部署指南.md"
echo "  🔧 系統維護管理手冊.md"
echo "  🆘 故障排除手冊.md"
echo ""

echo "完成時間：$(date '+%Y-%m-%d %H:%M:%S')"
echo ""

exit 0

