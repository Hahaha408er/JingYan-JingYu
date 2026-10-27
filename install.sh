#!/usr/bin/env bash
# 一键安装（Ubuntu / Debian / 其他常见 Linux 都行）
# 用法：bash install.sh            手动启动（nohup）
#       bash install.sh --with-systemd   顺便装成开机自启的服务
set -u

# 全程用"当前这个目录"当根，脚本里不写死任何绝对路径——
# 你把包解压到 /root/xxx、/home/pi/yyy、/opt/zzz 都行，装出来的服务也指向你自己的目录。
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"

WITH_SYSTEMD=0
for a in "$@"; do
  case "$a" in
    --with-systemd|--systemd) WITH_SYSTEMD=1 ;;
  esac
done

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

echo "════════ 鲸言鲸语 · 安装 ════════"
echo ""
echo "  免责声明：本程序为开源二次开发，属于技术学习交流。"
echo "  请使用 QQ 小号运行；因腾讯风控导致的封号，概不退换。"
echo ""
echo "  安装目录：$HERE"
echo ""

# 0. 解压完整性（防止网盘丢文件、只解压了第一层、或者用了不认 UTF-8 的工具）
#    这四个文件正常包里一定存在；缺任何一个，后面必然会以看不懂的报错崩掉，不如现在说清。
for f in src/index.js src/features.js role.md package.json; do
  if [ ! -f "$f" ]; then
    echo ""
    warn "目录里没有 $f —— 这个包解压得不完整。"
    echo "    常见原因：① 网盘/传输工具丢了嵌套目录 ② 只解压了最外层 ③ 用了不认 UTF-8 的压缩工具。"
    echo "    怎么修：删掉现在这个目录，重新解压一次，并确认解压后能看到 src/ tools/ data/ 三个子目录。"
    echo "    推荐命令：unzip -o <包名>.zip && cd <解压出来的目录>"
    echo ""
    die "解压不完整，先重新解压再来。"
  fi
done
ok "文件完整（src/ 与配置都在）"

# 1. Node
if ! command -v node >/dev/null 2>&1; then
  die "没找到 node。先装 Node 20 或更高版本：curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node 版本太低（$(node -v)）。她要 Node 20+，最好是 22 或 24。"
fi
ok "Node $(node -v)"

# 2. 依赖（只需要 ws；它没装的话连不上 NapCat 会直接报错）
if [ ! -d node_modules/ws ]; then
  echo "  正在装依赖（只有 ws 一个）…"
  npm install --omit=dev --no-audit --no-fund >/tmp/ac-install.log 2>&1 \
    || die "npm install 失败，看 /tmp/ac-install.log（国内可以试试 npm config set registry https://registry.npmmirror.com）"
fi
node -e "import('ws').then(()=>process.exit(0)).catch(()=>process.exit(1))" \
  && ok "依赖 ws 已就绪" || die "ws 装不上。手动跑：npm install ws"

# 3. config.json
if [ ! -f config.json ]; then
  cp config.example.json config.json
  warn "已生成 config.json —— 现在必须去填三处："
  echo "      apiKey     你的 DeepSeek 密钥"
  echo "      ownerIds   [\"你的QQ号\"]（字符串，别写数字）"
  echo "      onebot     里面填 NapCat 的 ws 地址、http 地址和 token"
  NEED_CONFIG=1
else
  ok "config.json 已存在（没动它）"
  NEED_CONFIG=0
fi

# 4. features.json（功能开关：这版是几档）
#    默认档位不用买家自己猜：包里带 presets/pro 的就是进阶版，否则是基础版。
#    想手动指定就 TIER=free / TIER=pro 覆盖。
TIER_DEFAULT="free"
if [ -f presets/pro/features.json ]; then TIER_DEFAULT="pro"; fi
TIER="${TIER:-$TIER_DEFAULT}"
if [ ! -f features.json ]; then
  if [ "$TIER" = "pro" ] && [ -f presets/pro/features.json ]; then
    cp presets/pro/features.json features.json
    ok "features.json 已生成（进阶版：功能全开）"
  else
    cp presets/free/features.json features.json 2>/dev/null \
      && ok "features.json 已生成（基础版）" \
      || warn "没找到 presets/free/features.json，跳过（缺文件时默认全开）"
  fi
else
  ok "features.json 已存在（没动它）"
fi

# 5. 数据目录
mkdir -p data/diary data/days data/gallery data/stickers
ok "data 目录已就绪"

# 4b. 授权码（进阶版才需要；没有也照常能跑，基础版永久免费）
if [ -s data/license.txt ]; then
  ok "授权码已填过（没动它）"
elif [ -t 0 ] && [ -f src/license-pub.pem ]; then
  echo ""
  echo "如果你买过进阶版，把卖家给你的授权码粘进来（一整行，回车确认）。"
  printf "没有就直接回车跳过："
  read -r LIC_CODE
  if [ -n "${LIC_CODE:-}" ]; then
    printf '%s\n' "$LIC_CODE" > data/license.txt
    node -e "import('./src/license.js').then(m=>{const r=m.loadLicense({dataDir:'data'});console.log(m.describeLicense(r));if(!r.ok)console.log('  原因：'+r.reason)})" 2>/dev/null \
      || warn "码已写入，但这次没能验证（重启后看启动横幅那一行）"
  else
    warn "跳过了。以后想激活：把授权码整行写进 data/license.txt，然后重启"
  fi
else
  warn "没有授权码文件（基础版不需要，进阶版可稍后补：data/license.txt）"
fi

# 5b. 识图要用的 NapCat 目录：先只探测，不写文件
echo ""
echo "  探测 NapCat 的图片目录（识图功能要用）…"
if node tools/detect-napcat.js 2>/dev/null | tail -n 9; then
  echo "  上面如果报出了路径，确认无误后执行这一句把它写进 config.json："
  echo "    node tools/detect-napcat.js --apply"
else
  warn "没探测到（可能没用 docker、或者要 sudo）。不影响聊天，只是她看不了图。"
fi

# 5c. 进阶版：语音合成的依赖（只检查+提示，不自动装，避免动系统包）
if [ "$TIER" = "pro" ]; then
  VOICE_BIN="${VOICE_BIN:-/opt/tts/bin/edge-tts}"
  if [ -x "$VOICE_BIN" ]; then
    ok "语音合成已就绪（$VOICE_BIN）"
  else
    warn "进阶版的语音还没装（不影响其它功能，只是她发不出语音条）。三步装好："
    echo "    sudo apt update && sudo apt install -y python3-venv python3-pip"
    echo "    sudo python3 -m venv /opt/tts && sudo /opt/tts/bin/pip install -U edge-tts"
    echo "  装完重启，横幅里会出现「语音 开（edge-tts / zh-CN-XiaoyiNeural）」"
    echo "  装在别处的话，把路径填进 config.json 的 voice.ttsBin"
  fi
fi

# 6. 体检
echo ""
if [ "$NEED_CONFIG" = "1" ]; then
  warn "先把 config.json 填完，再跑：node tools/doctor.js"
else
  node tools/doctor.js || warn "体检发现了问题，按上面 ❌ 的提示改"
fi

echo ""
echo "════════ 装完了 ════════"

# 7. 自启（可选）：unit 里的路径全部由 $HERE 现场生成，不写死任何人的服务器路径
SERVICE_NAME="jingyanjingyu"
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_BIN="$(command -v node || true)"

if [ "$WITH_SYSTEMD" = "1" ]; then
  echo ""
  if [ "$(id -u)" != "0" ]; then
    warn "要装自启得用 root：sudo bash install.sh --with-systemd"
  elif [ -z "$NODE_BIN" ]; then
    warn "找不到 node，先装 Node 再来"
  else
    cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=鲸言鲸语 (JingYan JingYu)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$HERE
ExecStart=$NODE_BIN src/index.js --config ./config.json
Restart=always
RestartSec=5
# 日志进 journald：journalctl -u $SERVICE_NAME -f
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT_EOF
    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME" >/dev/null 2>&1 \
      && ok "已装成开机自启：systemctl status $SERVICE_NAME" \
      || warn "unit 写好了，但启动失败，看：journalctl -u $SERVICE_NAME -n 50 --no-pager"
    echo "  看日志  journalctl -u $SERVICE_NAME -f"
    echo "  重启    systemctl restart $SERVICE_NAME"
    echo "  停掉    systemctl stop $SERVICE_NAME"
    echo "  卸掉    systemctl disable --now $SERVICE_NAME && rm -f $UNIT"
    echo ""
    echo "  注意：装了这个之后，别再 nohup 起第二份，否则会双发。"
  fi
else
  echo ""
  echo "启动（会一直跑下去）："
  echo "  nohup npm start >> bot.log 2>&1 &"
  echo "看日志："
  echo "  tail -f bot.log"
  echo "重启："
  echo "  pkill -9 -f \"src/index.js\"; sleep 1; nohup npm start >> bot.log 2>&1 &"
  echo ""
  if command -v systemctl >/dev/null 2>&1; then
    echo "想开机自启（推荐，掉线自动拉起）："
    echo "  sudo bash install.sh --with-systemd"
  fi
fi
echo ""
echo "⚠️ 第一次启动前确认 NapCat 已经登录、WS 开在 3001、HTTP 开在 3000（token 要和 config.json 里一致）"
