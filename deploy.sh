#!/usr/bin/env bash
# 一键上线脚本（Ubuntu 22.04+，适用于腾讯云/阿里云【中国香港】轻量服务器）
# 用法： sudo bash deploy.sh 你的域名 [管理密码]
# 例：   sudo bash deploy.sh chouqian.example.com Tdsw2008
#
# 作用：装 Docker → 启动抽签服务 → 装 Caddy → 自动申请 HTTPS 证书 → 反代到应用
# 注意：脚本里的境外下载（Docker / Caddy / npm / Let's Encrypt）发生在【服务器】上，
#       香港节点国际出口正常；操作者本机不需要任何外网访问。
set -euo pipefail

DOMAIN="${1:-}"
ADMIN_PWD="${2:-Tdsw2008}"
if [ -z "$DOMAIN" ]; then
  echo "用法: sudo bash deploy.sh 你的域名 [管理密码]"
  echo "例  : sudo bash deploy.sh chouqian.example.com Tdsw2008"
  exit 1
fi
export ADMIN_PASSWORD="$ADMIN_PWD"

echo "==> 0/5 预检：域名解析与安全组"
PUBIP="$(curl -s --max-time 8 https://ifconfig.me || true)"
RESOLVED="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
echo "    本机公网 IP : ${PUBIP:-（获取失败，不影响部署）}"
echo "    域名解析到  : ${RESOLVED:-（尚未解析）}"
if [ -n "$PUBIP" ] && [ -n "$RESOLVED" ] && [ "$PUBIP" != "$RESOLVED" ]; then
  echo "    ⚠️  域名当前未解析到本机 IP，HTTPS 证书会签发失败。"
  echo "       请先在域名控制台把 A 记录指向 $PUBIP，并在云控制台安全组放行 80 / 443。"
  echo "       （脚本继续执行，证书会在解析生效后自动重试签发）"
fi

echo "==> 1/5 检查并安装 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update && apt-get install -y docker-compose-plugin
fi
systemctl enable --now docker >/dev/null 2>&1 || true

echo "==> 2/5 启动抽签应用"
cd "$(dirname "$0")"
mkdir -p data
docker compose up -d --build
docker compose ps

echo "==> 3/5 等待应用健康检查"
OK=0
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [ "$OK" -ne 1 ]; then
  echo "❌ 应用未起来，日志如下："; docker compose logs --tail=50; exit 1
fi
curl -s http://127.0.0.1:3000/api/health; echo

echo "==> 4/5 安装 Caddy（自动 HTTPS）"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "==> 5/5 配置反向代理 + 证书"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
EOF
systemctl enable --now caddy >/dev/null 2>&1 || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy

cat <<EOF

✅ 部署完成
   用户抽签页 : https://$DOMAIN/
   管理后台   : https://$DOMAIN/admin   （密码: $ADMIN_PWD）
   健康检查   : https://$DOMAIN/api/health  应返回 {"ok":true,"mode":"local"}
   数据文件   : $(pwd)/data/app.db（请定期备份，可用后台「备份」按钮导出 JSON）

注意：
 - 若证书尚未签发，请确认 A 记录已指向 $PUBIP 且安全组放行 80/443；
   Caddy 会自动重试，也可手动执行: systemctl restart caddy
 - 查看日志: docker compose logs -f
EOF
