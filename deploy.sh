#!/usr/bin/env bash
# 一键上线脚本（Ubuntu 22.04+，适用于腾讯云/阿里云轻量服务器）
# 用法： sudo bash deploy.sh 你的域名
# 例：   sudo bash deploy.sh chouqian.example.com
#
# 作用：装 Docker → 启动抽签服务 → 装 Caddy → 自动申请 HTTPS 证书 → 反代到应用
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "用法: sudo bash deploy.sh 你的域名   (例: chouqian.example.com)"
  exit 1
fi

echo "==> 1/4 检查并安装 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> 2/4 启动抽签应用"
cd "$(dirname "$0")"
docker compose up -d --build
docker compose ps

echo "==> 3/4 安装 Caddy（自动 HTTPS）"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "==> 4/4 配置反向代理 + 证书"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
EOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy

cat <<EOF

✅ 部署完成
   用户抽签页 : https://$DOMAIN/
   管理后台   : https://$DOMAIN/admin
   数据文件   : $(pwd)/data/app.db（请定期备份）

提示：
 - 请先在域名控制台把 $DOMAIN 的 A 记录解析到本机公网 IP，证书才能签发成功。
 - 首次访问会自动申请 Let's Encrypt 证书，可能需要 10~60 秒。
EOF
