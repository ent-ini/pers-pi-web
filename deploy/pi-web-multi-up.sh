#!/usr/bin/env bash
# Bring the corporate pi-web stack up after a host reboot and make sure the
# published port really exists.
#
# Why this is not just `docker compose up -d`:
#
#   The control plane is published on the Tailscale address of the host
#   (100.100.20.0:30141) so that the reverse proxy can reach it while the
#   office LAN stays closed. Docker can only bind a host port to an address
#   that already exists on the host. At boot the docker daemon and tailscaled
#   start at the same time, so the daemon tries to restore the container
#   before tailscale has assigned 100.100.20.0 and the bind fails with
#   "cannot assign requested address". Docker then keeps the container in a
#   half-started state: it runs, but the published port is missing
#   (`docker port pi_web_multi` is empty) and the reverse proxy answers 502.
#
#   This script waits for the address, starts the stack and verifies the
#   published port, recreating the control plane when the mapping is missing.
set -uo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-/opt/pi-web-multi/docker-compose.multi.yml}
WORKDIR=${WORKDIR:-/opt/pi-web-multi}
CONTAINER=${CONTAINER:-pi_web_multi}
BIND_IP=${BIND_IP:-100.100.20.0}
PORT=${PORT:-30141}
IP_WAIT_SECONDS=${IP_WAIT_SECONDS:-180}
DOCKER_WAIT_SECONDS=${DOCKER_WAIT_SECONDS:-120}
HTTP_ATTEMPTS=${HTTP_ATTEMPTS:-30}

log() { echo "[pi-web-multi-up] $(date -Is) $*"; }

have_bind_ip() { ip -4 addr show 2>/dev/null | grep -q "inet ${BIND_IP}/"; }

port_published() {
  docker port "$CONTAINER" 2>/dev/null | grep -q "${PORT}/tcp -> ${BIND_IP}:${PORT}"
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://${BIND_IP}:${PORT}/login" 2>/dev/null
}

wait_for_docker() {
  local i
  for i in $(seq 1 "$DOCKER_WAIT_SECONDS"); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_bind_ip() {
  local i
  for i in $(seq 1 "$IP_WAIT_SECONDS"); do
    if have_bind_ip; then
      log "tailscale address ${BIND_IP} is up"
      return 0
    fi
    if [ $((i % 10)) -eq 0 ]; then
      log "waiting for the tailscale address ${BIND_IP} (${i}s)"
    fi
    sleep 1
  done
  return 1
}

start_stack() {
  cd "$WORKDIR" || return 1
  docker compose -f "$COMPOSE_FILE" up -d
}

recreate_control_plane() {
  cd "$WORKDIR" || return 1
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate pi-web
}

# 1. The daemon must be up, otherwise there is nothing to talk to.
if ! wait_for_docker; then
  log "ERROR: the docker daemon did not become ready"
  exit 1
fi

# 2. The published port can only exist when the address exists.
if ! wait_for_bind_ip; then
  log "ERROR: ${BIND_IP} never appeared, the port cannot be published"
  exit 1
fi

# 3. Start the stack (control plane + worker manager).
if ! start_stack; then
  log "ERROR: docker compose up failed"
  exit 1
fi

# 4. The port mapping must really be there. A container that survived a failed
#    bind keeps running without the mapping, so recreate it when needed.
for attempt in 1 2 3; do
  if port_published; then
    log "port ${BIND_IP}:${PORT} is published"
    break
  fi
  log "the port is not published (attempt ${attempt}), recreating the control plane"
  recreate_control_plane || true
  sleep 3
done

if ! port_published; then
  log "ERROR: ${BIND_IP}:${PORT} is still not published"
  exit 1
fi

# 5. The application itself must answer on the published port.
for i in $(seq 1 "$HTTP_ATTEMPTS"); do
  code=$(http_code)
  case "$code" in
    200|307|302)
      log "the control plane answers on /login with ${code}"
      exit 0
      ;;
  esac
  sleep 2
done

log "ERROR: the control plane does not answer on /login, recreating it once"
recreate_control_plane || true
for i in $(seq 1 "$HTTP_ATTEMPTS"); do
  code=$(http_code)
  case "$code" in
    200|307|302)
      log "the control plane answers on /login with ${code} after a recreate"
      exit 0
      ;;
  esac
  sleep 2
done

log "ERROR: the control plane still does not answer on /login"
exit 1
