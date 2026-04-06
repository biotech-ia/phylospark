#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

sudo usermod -aG docker "$USER"
sudo mkdir -p /opt/phylospark
sudo chown -R "$USER":"$USER" /opt/phylospark

if docker compose version >/dev/null 2>&1; then
  echo "docker compose already available"
elif command -v docker-compose >/dev/null 2>&1; then
  echo "docker-compose binary already available"
else
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -SL https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-x86_64 \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

echo "EC2 ready. Reconnect to refresh docker group membership if needed."