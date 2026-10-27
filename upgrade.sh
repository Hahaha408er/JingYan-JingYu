#!/usr/bin/env bash
# 鲸言鲸语 · 升级脚本
# 在“当前安装目录”里执行（脚本会以自己所在目录为安装目录）：
#   bash upgrade.sh /root/_up/jingyanjingyu-v1.0.0-pro      # 已解压的新包目录
#   bash upgrade.sh --zip /root/jingyanjingyu-v1.0.0-pro.zip
# 选项：
#   --tier pro|free|auto   切档位（默认 auto：新包带进阶模块就 pro，否则 free）
#   --with-tts             顺手装 edge-tts（仅进阶版且缺失时）
#   --dry                  只打印会做什么，不动任何文件
# 它做四件事：备份 → 只覆盖代码（跳过 data/）→ 切档位 → 自检并重启。
set -euo pipefail

cd "$(dirname "$0")"
HERE="$(pwd)"
TS="$(date +%Y-%m-%d-%H-%M-%S)"
SERVICE="jingyanjingyu"

say()  { printf '%s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*"; }
die()  { printf '❌ %s\n' "$*" >&2; exit 1; }

SRC=""; ZIP=""; TIER="auto"; DRY=0; WITH_TTS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --zip)      ZIP="${2:-}"; shift 2 ;;
    --tier)     TIER="${2:-auto}"; shift 2 ;;
    --dry)      DRY=1; shift ;;
    --with-tts) WITH_TTS=1; shift ;;
    -h|--help)  sed -n '2,12p' "$0" 2>/dev/null || true; exit 0 ;;
    *)          SRC="$1"; shift ;;
  esac
done

[ -f "$HERE/src/index.js" ] || die "当前目录看起来不像安装目录（没有 src/index.js）。请 cd 到安装目录再跑本脚本。"

if [ -z "$SRC" ] && [ -n "$ZIP" ]; then
  [ -f "$ZIP" ] || die "找不到压缩包：$ZIP"
  command -v unzip >/dev/null 2>&1 || die "没有 unzip，先 apt install -y unzip"
  SRC="$HERE/../_upgrade_$TS"
  mkdir -p "$SRC"
  if [ $DRY -eq 1 ]; then
    say "[dry] 先把包解到临时目录看结构（不改安装目录）："
  else
    say "解压 $ZIP"
  fi
  say "  → $SRC"
  unzip -q -o "$ZIP" -d "$SRC"
fi
[ -n "$SRC" ] || die "用法：bash upgrade.sh <解压好的新包目录>，或 bash upgrade.sh --zip 新包.zip"
[ -d "$SRC" ] || die "目录不存在：$SRC"

if [ ! -f "$SRC/src/index.js" ]; then
  inner="$(find "$SRC" -maxdepth 3 -type f -path '*/src/index.js' | head -n 1 || true)"
  [ -n "$inner" ] && SRC="$(cd "$(dirname "$inner")/.." && pwd)"
fi
[ -f "$SRC/src/index.js" ] || die "新包里没找到 src/index.js，路径给错了？"

IS_PRO=0
[ -f "$SRC/presets/pro/features.json" ] && IS_PRO=1

if [ "$TIER" = "auto" ]; then
  if [ $IS_PRO -eq 1 ]; then TIER="pro"; else TIER="free"; fi
fi
if [ "$TIER" = "pro" ] && [ $IS_PRO -eq 0 ]; then
  warn "你要 pro，但新包里没有 presets/pro（这是个基础版包），按 free 处理"
  TIER="free"
fi
case "$TIER" in free|pro) ;; *) die "--tier 只能是 pro / free / auto" ;; esac

say ""
say "════════ 鲸言鲸语 · 升级 ════════"
say "安装目录  $HERE"
say "新包目录  $SRC"
say "新包档位  $([ $IS_PRO -eq 1 ] && echo 进阶版 || echo 基础版)"
say "这次切到  $TIER"
say ""

# ---------- 1. 停服务 ----------
HAS_UNIT=0
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}.service"; then
  HAS_UNIT=1
  if [ $DRY -eq 1 ]; then
    say "[dry] systemctl stop $SERVICE"
  else
    systemctl stop "$SERVICE" && ok "已停 $SERVICE"
  fi
else
  warn "没有 systemd 单元 ${SERVICE}.service：如果她是 nohup 起的，升级前请自己 pkill -f \"src/index.js\""
fi

# ---------- 2. 备份 ----------
BK="$HOME/upgrade-backup-$TS.tar.gz"
if [ $DRY -eq 1 ]; then
  say "[dry] 备份 data/ config.json features.json → $BK"
else
  tar czf "$BK" -C "$HERE" data config.json features.json 2>/dev/null || true
  if [ -f "$BK" ]; then ok "已备份 → $BK"; else warn "备份没生成（data/ 可能还是空的），继续"; fi
fi

# ---------- 3. 只覆盖代码，跳过 data/ ----------
COPY_LIST="src tools presets agent install.sh upgrade.sh README.md package.json role.md LICENSE VERSION .gitignore config.example.json"
n=0
for x in $COPY_LIST; do
  if [ -e "$SRC/$x" ]; then
    if [ $DRY -eq 1 ]; then
      say "[dry] cp -rf $x"
    else
      cp -rf "$SRC/$x" "$HERE/"
    fi
    n=$((n+1))
  fi
done
[ $DRY -eq 1 ] || ok "覆盖了 $n 项（data/ config.json 没动）"

# ---------- 4. 切档位 ----------
if [ -f "$HERE/tools/apply-preset.js" ] && [ $IS_PRO -eq 1 ]; then
  if [ $DRY -eq 1 ]; then
    say "[dry] node tools/apply-preset.js $TIER"
  else
    node tools/apply-preset.js "$TIER" >/dev/null && ok "档位已切到 $TIER（config/features 改前已自动备份）"
  fi
else
  warn "新包里没有 tools/apply-preset.js（基础版包），档位保持原样"
fi

if [ ! -s "$HERE/data/license.txt" ]; then
  warn "还没填授权码：进阶功能能用，但横幅会显示「未激活」"
  say "    填法： printf '%s\\n' 'AK1.你的码' > data/license.txt"
fi

# ---------- 5. 语音依赖（进阶版） ----------
if [ "$TIER" = "pro" ]; then
  TTS="${VOICE_BIN:-/opt/tts/bin/edge-tts}"
  if [ -x "$TTS" ]; then
    ok "edge-tts 已就绪（$TTS）"
  else
    warn "没找到 $TTS：语音功能会静默不出声"
    if [ $WITH_TTS -eq 1 ] && [ $DRY -eq 0 ]; then
      say "    开始装 edge-tts（约 2 分钟）…"
      apt install -y python3-venv python3-pip >/dev/null
      python3 -m venv /opt/tts
      /opt/tts/bin/pip install -q -U edge-tts
      ok "edge-tts 装好了"
    else
      say "    装法：apt install -y python3-venv python3-pip && python3 -m venv /opt/tts && /opt/tts/bin/pip install -U edge-tts"
      say "    或者重跑一次加 --with-tts"
    fi
  fi
fi

# ---------- 6. 依赖 + 自检 ----------
if [ $DRY -eq 1 ]; then
  say "[dry] npm install --omit=dev && node tools/doctor.js"
else
  (npm install --omit=dev >/dev/null 2>&1 && ok "依赖就绪") || warn "npm install 出错了，手动跑一次看报错"
  say ""
  node tools/doctor.js || true
fi

# ---------- 7. 起服务 ----------
if [ $HAS_UNIT -eq 1 ]; then
  if [ $DRY -eq 1 ]; then
    say "[dry] systemctl start $SERVICE"
  else
    systemctl start "$SERVICE"
    sleep 3
    systemctl status "$SERVICE" --no-pager 2>/dev/null | head -n 4 || true
  fi
else
  say "自己起： nohup npm start > bot.log 2>&1 &"
fi

say ""
say "──────── 完 ────────"
say "回滚（万一升坏了）："
say "  sudo systemctl stop $SERVICE"
say "  tar xzf \"$BK\" -C \"$HERE\""
say "  sudo systemctl start $SERVICE"
say ""
say "升级后核对横幅这三行："
say "  功能    记忆 / 表情包 / 图库 / 日记 / 语音 / 主动找你 / 听歌 / 手机 / 月度画像 / 状态 / 生活感"
say "  授权    进阶档 · 你的名字，订单 XXX（更新至 …）"
say "  语音    开（edge-tts / zh-CN-XiaoyiNeural）"
