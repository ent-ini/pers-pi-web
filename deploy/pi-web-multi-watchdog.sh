#!/usr/bin/env bash
# Periodic watchdog for the corporate pi-web stack.
#
# The boot unit brings the stack up once; this watchdog makes sure it stays
# up. It heals the two failure modes seen in production:
#
#   * the control plane container is running but the published port is gone
#     (docker started it before tailscale had the address), so the reverse
#     proxy answers 502;
#   * the control plane container is stopped or not answering.
#
# A healthy stack is left completely untouched.
set -uo pipefail

CONTAINER=${CONTAINER:-pi_web_multi}
BIND_IP=${BIND_IP:-100.100.20.0}
PORT=${PORT:-30141}
UNIT=${UNIT:-pi-web-multi.service}

log() { echo "[pi-web-multi-watchdog] $(date -Is) $*"; }

if ! docker info >/dev/null 2>&1; then
  log "the docker daemon is not ready, nothing to check"
  exit 0
fi

running=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo "missing")
published=no
if docker port "$CONTAINER" 2>/dev/null | grep -q "${PORT}/tcp -> ${BIND_IP}:${PORT}"; then
  published=yes
fi
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://${BIND_IP}:${PORT}/login" 2>/dev/null)

if [ "$running" = "true" ] && [ "$published" = "yes" ] && { [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "302" ]; }; then
  log "the stack is healthy (running=${running}, port=${published}, /login=${code})"
  exit 0
fi

log "the stack is broken (running=${running}, port=${published}, /login=${code}), restarting ${UNIT}"
if ! systemctl restart "$UNIT"; then
  log "ERROR: ${UNIT} could not be restarted"
  exit 1
fi

log "the stack was restarted"
exit 0
