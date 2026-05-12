#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/interview-transcriber}
ENV_DIR=${ENV_DIR:-/etc/interview-transcriber}
SERVICE_NAME=${SERVICE_NAME:-interview-transcriber-worker}
WORKER_USER=${WORKER_USER:-interview-worker}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg ffmpeg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

node -v
npm -v

if ! id "$WORKER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$WORKER_USER"
fi

mkdir -p "$ENV_DIR"

if [ ! -f "$ENV_DIR/worker.env" ]; then
  install -o root -g "$WORKER_USER" -m 0640 "$APP_DIR/worker/.env.example" "$ENV_DIR/worker.env"
  echo "Created $ENV_DIR/worker.env. Fill in real secrets before starting the service." >&2
fi

if ! grep -q '^WORKER_POLL_INTERVAL_MS=' "$ENV_DIR/worker.env"; then
  printf '\nWORKER_POLL_INTERVAL_MS=10000\n' >> "$ENV_DIR/worker.env"
  echo "Added WORKER_POLL_INTERVAL_MS=10000 to $ENV_DIR/worker.env." >&2
fi

cd "$APP_DIR/worker"
npm ci
npm run build

chown -R "$WORKER_USER:$WORKER_USER" "$APP_DIR"
install -o root -g root -m 0644 "$APP_DIR/worker/systemd/interview-transcriber-worker.service" \
  "/etc/systemd/system/$SERVICE_NAME.service"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "Node runtime: $(node -v)"
echo "Edit $ENV_DIR/worker.env, then run:"
echo "  systemctl restart $SERVICE_NAME"
echo "  systemctl status $SERVICE_NAME"
