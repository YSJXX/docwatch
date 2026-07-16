#!/usr/bin/env bash
#
# docwatch 서버 가동 스크립트
#
#   scripts/serve.sh [start|stop|restart|status] [TARGET] [옵션]
#
# 예)
#   scripts/serve.sh                       # 마지막 타깃(없으면 기본값)으로 start/restart
#   scripts/serve.sh start ~/Glance        # Glance 감시 서버 기동
#   scripts/serve.sh restart ~/docwatch    # 타깃 전환(+ .astro 캐시 자동 정리)
#   scripts/serve.sh status                # 실행 여부 확인
#   scripts/serve.sh stop                  # 종료
#
# 옵션:
#   --port N        포트 (기본 4321)
#   --host H        바인드 호스트 (기본 0.0.0.0)
#   --clean         이번 기동에서 .astro 캐시를 강제로 지움(타깃 동일해도)
#   --foreground    백그라운드가 아니라 현재 터미널에서 실행(Ctrl+C로 종료)
#
set -euo pipefail

# --- 위치·상태 경로 (스크립트 위치 기준 절대경로) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$ROOT/bin/cli.mjs"
PID_FILE="$ROOT/.docwatch-serve.pid"
TARGET_FILE="$ROOT/.docwatch-serve.target"
LOG_FILE="$ROOT/.docwatch-serve.log"

DEFAULT_TARGET="/home/ysj/Glance"
DEFAULT_PORT=4321
DEFAULT_HOST="0.0.0.0"

# --- 인자 파싱 ---
ACTION=""
TARGET=""
PORT="$DEFAULT_PORT"
HOST="$DEFAULT_HOST"
CLEAN=0
FOREGROUND=0

while [ $# -gt 0 ]; do
  case "$1" in
    start|stop|restart|status) ACTION="$1" ;;
    --port) PORT="${2:?--port 값 필요}"; shift ;;
    --host) HOST="${2:?--host 값 필요}"; shift ;;
    --clean) CLEAN=1 ;;
    --foreground|--fg) FOREGROUND=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    -*) echo "알 수 없는 옵션: $1" >&2; exit 2 ;;
    *)  TARGET="$(cd "$1" 2>/dev/null && pwd || echo "$1")" ;;
  esac
  shift
done

[ -z "$ACTION" ] && ACTION="start"

log() { printf '\033[36m[serve]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[serve]\033[0m %s\n' "$*" >&2; }

# --- 정확한 PID만 종료 (pkill 금지: 자기 자신을 죽일 수 있음) ---
running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  # 살아있고, 실제로 우리 cli.mjs 프로세스인지 검증
  if kill -0 "$pid" 2>/dev/null && grep -qa 'bin/cli.mjs' "/proc/$pid/cmdline" 2>/dev/null; then
    echo "$pid"; return 0
  fi
  return 1
}

stop_server() {
  local pid
  if pid="$(running_pid)"; then
    # SIGINT 필수: cli.mjs 는 SIGINT 만 핸들해 자식 astro 까지 정리한다.
    # 기본 SIGTERM 을 쓰면 부모만 죽고 자식 astro 가 고아로 남아 포트를 계속 점유한다.
    kill -INT "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    log "종료함 (pid $pid)"
  else
    log "실행 중인 서버 없음"
  fi
  rm -f "$PID_FILE"
  # 자식 astro 의 소켓 반환 레이스 방지: 포트가 실제로 풀릴 때까지 잠깐 대기
  for _ in $(seq 1 12); do port_busy || break; sleep 0.3; done
}

# 포트 점유 여부. ss가 리스닝 소켓을 볼 수 있으면 빠르게, 아니면(샌드박스 등)
# curl 로 실제 응답이 오는지로 판정한다. 우리 서버는 호출 전에 이미 종료된 상태다.
port_busy() {
  if command -v ss >/dev/null 2>&1 && ss -ltnH 2>/dev/null | grep -qE ":$PORT(\s|$)"; then
    return 0
  fi
  curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/" 2>/dev/null
}

wait_up() {
  for i in $(seq 1 20); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/monitor" 2>/dev/null)" = "200" ]; then
      log "UP (${i}s) — http://localhost:$PORT/monitor 200"; return 0
    fi
    sleep 1
  done
  err "20초 안에 /monitor 200 응답 없음 — 로그: $LOG_FILE"; return 1
}

start_server() {
  [ -f "$CLI" ] || { err "cli.mjs 없음: $CLI"; exit 1; }

  # 이미 떠 있으면 restart로 취급
  if running_pid >/dev/null; then
    log "기존 서버 감지 → 재기동"
    stop_server
  fi

  # 타깃 결정: 인자 > 마지막 타깃 > 기본값
  local last=""; [ -f "$TARGET_FILE" ] && last="$(cat "$TARGET_FILE" 2>/dev/null || true)"
  [ -z "$TARGET" ] && TARGET="${last:-$DEFAULT_TARGET}"
  [ -d "$TARGET" ] || { err "타깃 디렉터리 없음: $TARGET"; exit 1; }

  # 타깃 전환 시(또는 --clean) .astro 캐시 정리 — 안 하면 stale content-collection 500
  if [ "$CLEAN" = "1" ] || { [ -n "$last" ] && [ "$last" != "$TARGET" ]; }; then
    rm -rf "$ROOT/.astro"
    log ".astro 캐시 정리 (타깃 전환/clean)"
  fi

  # 포트 점유 검사(우리 서버는 위에서 이미 종료됨)
  if port_busy; then
    err "포트 $PORT 를 다른 프로세스가 사용 중입니다. --port 로 바꾸거나 해당 프로세스를 종료하세요."
    exit 1
  fi

  echo "$TARGET" > "$TARGET_FILE"

  if [ "$FOREGROUND" = "1" ]; then
    log "포그라운드 실행 — 타깃 $TARGET, 포트 $PORT (Ctrl+C 로 종료)"
    exec node "$CLI" "$TARGET" --host "$HOST" --port "$PORT" --no-open
  fi

  log "기동 — 타깃 $TARGET, 포트 $PORT"
  nohup node "$CLI" "$TARGET" --host "$HOST" --port "$PORT" --no-open > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  log "pid $(cat "$PID_FILE") · 로그 $LOG_FILE"
  wait_up
}

status_server() {
  local pid
  if pid="$(running_pid)"; then
    local tgt=""; [ -f "$TARGET_FILE" ] && tgt="$(cat "$TARGET_FILE")"
    local code; code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/monitor" 2>/dev/null || echo '---')"
    log "실행 중 · pid $pid · 타깃 ${tgt:-?} · 포트 $PORT · /monitor $code"
  else
    log "중지 상태"
    return 1
  fi
}

case "$ACTION" in
  start)   start_server ;;
  restart) stop_server; start_server ;;
  stop)    stop_server ;;
  status)  status_server ;;
  *) err "알 수 없는 동작: $ACTION"; exit 2 ;;
esac
