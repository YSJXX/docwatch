# Agent Cockpit — docwatch에 에이전트 대화창 통합 설계

날짜: 2026-07-09
상태: 사용자 승인 (섹션 1–5)

## 배경과 제품 재정의

docwatch는 지금까지 "읽기 전용 모니터링 뷰어"였다. 이번 설계로 제품 정의가 바뀐다:

> **터미널에서 하던 Claude Code/Codex 작업을 통째로 웹으로 옮긴다.**
> docwatch = 입력(대화)과 모니터링을 모두 하는 운전석(관제탑).

새 원칙 (기존 "repo 불변" 원칙을 이 기능에 한해 대체):

- **사람의 UI는 읽기 전용** — 사용자는 docwatch에서 파일을 직접 편집하지 않는다.
- **변경은 오직 대화 중인 에이전트로부터** — 에이전트는 터미널에서처럼 자율적으로
  파일을 수정한다 (승인 게이트 없음, `--permission-mode acceptEdits`).
- 에이전트 병렬 작업(서브에이전트)은 메인 에이전트의 판단에 맡긴다.
  docwatch는 이를 관리하지 않고 이벤트 카드로 보여주기만 한다.

확정된 요구:

- 하나의 레포만 대상 (기존 DOCWATCH_ROOT).
- docwatch가 에이전트 프로세스를 **직접 spawn하고 소유** (외부 세션 attach 아님).
- 첫 어댑터는 **Claude Code** (`stream-json`). Codex는 어댑터 인터페이스 뒤에 후속.
- 대화에서 언급/사용된 파일은 **Ctrl+Click(mac: Cmd+Click)** 으로 프리뷰에 열기.
  일반 클릭은 아무 동작 없음 (드래그 읽기 중 오클릭 방지 — 사용자 명시 요구).
- **rename / resume / 세션 간 네비게이션**은 핵심 사용 패턴 — 1급 기능으로 지원.

## 섹션 1 — 아키텍처

```
브라우저 (/monitor)
 ├─ col1 레일: 타임라인·트리·체크리스트·TODO   (기존, SSE 갱신)
 ├─ col2 대화: 세션 스위처 + 채팅 버블 + 툴 카드 + 입력창 (신규, [상세] 탭 공존)
 └─ col3 프리뷰: 전체 문서/파일 렌더            (기존)
        ▲                    ▲
        │ SSE /api/agent-stream (에이전트 이벤트)
        │ REST /api/agent, /api/agent/sessions*
        ▼
Astro dev 서버 (docwatch)
 └─ AgentSession 매니저 (서버 싱글턴, src/server/agent/)
     ├─ ClaudeAdapter: spawn `claude -p --input-format stream-json
     │                        --output-format stream-json --verbose`
     │   cwd = DOCWATCH_ROOT(타겟 레포)
     ├─ stdout NDJSON 파서 → 정규화 AgentEvent로 변환해 SSE push
     └─ 상태: idle | running | done | error + 히스토리(메모리, seq 부여)
```

핵심 결정:

1. **단일 활성 프로세스 + 다중 세션 네비게이션.** 어느 순간에도 spawn된 claude
   프로세스는 최대 1개. 세션 전환 = 이전 프로세스 정리 + 다음 세션 lazy resume.
   동시 멀티 세션 실행은 스코프 아웃.
2. **어댑터 경계.** `AgentAdapter` 인터페이스(`start / send / stop / onEvent`)
   뒤에 `ClaudeAdapter`. Codex 추가 시 UI·API 무변경.
3. **기존 SSE와 분리.** 파일 변경 감시(`/api/activity-stream`)는 그대로.
   에이전트가 파일을 고치면 chokidar가 감지해 기존 스트림이 타임라인/NEW/MOD를
   자동 갱신 — "에이전트 작업 → 관제탑 반응"은 추가 작업 없이 성립.
4. **히스토리 = Claude Code jsonl이 원본.** 서버 메모리는 라이브 이벤트 버퍼,
   과거 대화는 `~/.claude/projects/<이스케이프된-레포경로>/<sessionId>.jsonl`
   트랜스크립트 파싱으로 재수화. docwatch 자체 영속 저장 없음.

## 섹션 2 — 대화 UI · 파일 링크

col2는 `[대화] [상세]` 탭 구조. 기본 = 대화. 기존 상세 패널(diff/메타)은 상세 탭으로 이동.
레일/타임라인/트리에서 파일 선택 시 상세 탭이 자동 활성화된다 (기존 흐름 보존).

```
[ ▾ fix-login-bug  ✎ ] [ + 새 세션 ]        [대화][상세]
──────────────────────────────────────────
 you  ▸ 로그인 버그 고쳐줘
 ⚙ Read src/auth.ts          ← 툴 카드(회색: 관측)
 ⚡ Task: 서브에이전트 실행
 ✎ Edit src/auth.ts          ← 편집 카드(주황: 변경)
 claude ▸ 원인은 토큰 만료… src/auth.ts:42 를 고쳤습니다
 ✔ 완료 · 34s · $0.12         ← result 푸터
──────────────────────────────────────────
 [ 프롬프트 입력…        ⏎ ]  [■ 중지]
```

렌더 규칙:

1. **버블 2종** — `you`(우측, primary-container) / `claude`(좌측).
   v1은 plain text + 코드펜스 `<pre>` 처리만. 풀 마크다운 렌더는 후속.
2. **툴 카드** — `tool_use`를 한 줄 칩으로: 아이콘 + 툴 이름 + 대상 요약.
   Read/Grep/Glob 회색, Edit/Write/NotebookEdit 주황, Bash 보라(명령 첫 줄),
   Task ⚡. `tool_result`는 카드에 접힌 채 붙고 일반 클릭으로 펼침/접힘
   (excerpt 2KB 절단).
3. **진행 표시** — running 중 마지막 버블 아래 점멸 인디케이터.
   대화 탭 라벨에 상태 점(초록 running / 회색 idle / 빨강 error).

**파일 링크 — 두 계층:**

- **정확 계층 (툴 카드)**: `tool_use` input의 `file_path`를 그대로 사용. 추측 없음.
- **텍스트 계층 (버블 본문)**: 경로 패턴(`[\w./-]+\.\w+` + 선택적 `:줄번호`)을
  스캔하되 **레포에 실제 존재하는 파일만** 링크화 (서버의 트리/watched 목록과 대조).
  오탐 제로 원칙 — 버전 번호(`1.2.3`), URL 등은 링크화하지 않는다.

**열기 동작 (Ctrl/Cmd+Click 전용):**

- 일반 클릭: 텍스트 선택 자유, 열기 동작 없음. 툴 카드 일반 클릭은 결과 펼침만.
- Ctrl+Click(mac Cmd+Click): 프리뷰(col3)에 열기. 기존 `select()` 재사용.
- 발견성: hover 시 밑줄 + 툴팁 "Ctrl+클릭으로 열기", Ctrl/Cmd 누른 채 hover 시
  커서 pointer (VSCode 관습).

| 클릭 대상 | 열기 경로 |
|---|---|
| md 문서 | `/preview/<id>` (기존 전체 렌더) |
| watched 파일(config·스펙·다이어그램) | `/rawpreview/<rel>` (기존) |
| 그 외 소스 파일(.ts 등) | `/rawpreview/<rel>` **확장**: 이번 세션에서 에이전트가 언급/편집한 파일 목록을 서버가 유지하고 rawpreview 허용 목록에 세션 한정 추가. traversal 방어(safeRel + root 내부 검증)는 동일 유지 |

## 섹션 3 — 데이터 흐름 · API · 세션 수명주기

**API:**

| 라우트 | 메서드 | 역할 |
|---|---|---|
| `/api/agent` | POST | `{action:'new'}` 빈 세션 컨텍스트 생성(spawn 없음) · `{action:'select', sessionId}` 세션 전환 · `{action:'send', text}` · `{action:'stop'}` · `{action:'rename', sessionId, name}` |
| `/api/agent` | GET | 현재 상태 + 활성 세션 히스토리 (재수화) |
| `/api/agent-stream` | GET (SSE) | 정규화 AgentEvent 실시간 push (seq 포함) |
| `/api/agent/sessions` | GET | 타겟 레포의 세션 목록 (jsonl 디렉토리 스캔) |
| `/api/agent/sessions/<id>` | GET | 해당 세션 트랜스크립트 → AgentEvent 배열 |

**정규화 이벤트 스키마** (UI는 이것만 안다):

```ts
type AgentEvent =
  | { kind: 'user_text';      text: string; seq: number; ts: number }
  | { kind: 'assistant_text'; text: string; seq: number; ts: number }
  | { kind: 'tool_use';   tool: string; summary: string;   // "Edit src/auth.ts"
      filePath?: string; id: string; seq: number; ts: number }
  | { kind: 'tool_result'; forId: string; excerpt: string;
      isError: boolean; seq: number; ts: number }
  | { kind: 'status'; state: 'idle'|'running'|'done'|'error';
      costUsd?: number; durationMs?: number; seq: number; ts: number };
```

**수명주기:**

1. 대화 탭 진입 → GET `/api/agent` → 히스토리 렌더 + SSE 구독.
   세션 없으면 입력창 placeholder: "첫 프롬프트를 보내면 세션이 시작됩니다".
2. 첫 send → `claude` spawn (`cwd=타겟레포`, `--permission-mode acceptEdits`,
   stream-json 양방향, `--verbose`). 이후 send는 stdin으로 user 메시지 append —
   프로세스 하나로 다회차 유지.
3. running 중에는 입력창 비활성 + 중지 버튼 노출 (v1은 턴 단위 교대, 큐 없음).
4. 프로세스 비정상 종료 → `status:error` + 빨간 시스템 카드. 다음 send가
   `--resume <sessionId>`로 자동 재spawn (히스토리 보존은 Claude Code 담당).
5. docwatch 서버 종료 → 자식 프로세스 SIGTERM 전파 (detached 금지).

**보안 경계:** `/api/agent`는 dev 서버와 동일하게 인증 없음.
`--host 0.0.0.0` 시 네트워크의 누구나 이 레포에서 에이전트를 굴릴 수 있음을
README에 명시 경고. 기본 바인드 localhost 유지.

## 섹션 4 — 에러 처리 · 테스트

**에러 처리:**

| 상황 | 처리 |
|---|---|
| claude CLI 미설치/미인증 | spawn 실패 → `status:error` + 안내 카드("claude CLI 설치·`claude login` 필요"). 서버는 생존 |
| stream-json 파싱 실패 | 해당 라인만 버리고 원문 서버 로그 기록. 스트림 계속 (스키마 드리프트 방어) |
| 프로세스 크래시/OOM | exit 코드 + stderr 마지막 5줄을 error 카드로. 다음 send 시 `--resume` 재spawn |
| SSE 끊김 | EventSource 자동 재연결 + GET 히스토리로 보정 (마지막 seq 이후만 append) |
| 중지 버튼 | SIGINT → 5초 → SIGTERM. 부분 응답 보존 |
| 툴 결과 폭주 | 서버에서 excerpt 2KB 절단 후 전송 |

**테스트 (기존 3층 유지):**

- **unit** — ① NDJSON 파서: 실제 Claude Code stream-json 캡처 픽스처로 정규화
  정확성 + 깨진 라인 내성. ② 텍스트 파일-링크 스캐너: 실존 파일만 링크,
  `:줄번호` 파싱, 오탐 케이스(버전 번호, URL) 제로. ③ jsonl 트랜스크립트 파서.
- **integration** — AgentSession 매니저를 가짜 어댑터(스크립트된 이벤트 방출)로:
  start→send→stop 수명주기, 단일 프로세스 강제, 재수화, seq 보정.
- **e2e (Playwright)** — mock 어댑터 모드(`DOCWATCH_AGENT=mock`)로 서버 기동:
  대화 탭 표시, send→버블 렌더, 툴 카드 렌더, **Ctrl+Click→프리뷰 열림 /
  일반 클릭→안 열림**, 중지 버튼, 에러 카드, 세션 3개 목록·전환·rename·새 세션.
  실제 claude 연동은 수동 스모크 1회.

## 섹션 5 — 세션 관리 (rename · resume · 네비게이션)

**원리:** Claude Code가 이미 세션을
`~/.claude/projects/<이스케이프된-레포경로>/<sessionId>.jsonl`에 영속화한다.
docwatch는 이를 **읽어서** 목록·과거 대화를 제공 — 터미널과 같은 세션 풀을 공유.
터미널에서 하던 세션을 웹에서 잇고, 웹에서 시작한 세션을 터미널 `claude -r`로
잇는 것도 자동 성립.

**UI (col2 대화 탭 헤더):**

1. **세션 드롭다운** — 이름·마지막 활동·메시지 수, 최신순.
   `GET /api/agent/sessions`.
2. **세션 전환(= resume)** — 선택 → 현재 프로세스 running이면 확인 후 종료 →
   jsonl 파싱으로 과거 대화 **즉시 렌더 (spawn 없이)** → 다음 send 때
   `claude --resume <id>`로 lazy spawn. 세션 구경은 공짜, 프로세스는 말 걸 때만.
3. **rename** — 세션명 옆 ✎ → 인라인 편집 → POST rename 액션.
   Claude Code의 세션명 메타데이터와 같은 저장소를 써서 터미널 `--resume`
   피커에도 반영되게 한다.
   ⚠️ **planning 단계 검증 항목**: 세션명 저장 방식이 CLI 버전에 따라 다를 수
   있음. 실제 저장 위치를 확인하고, 호환 불가 시 폴백 = docwatch 사이드카
   (`<sessionId>.name` 파일) — 이 경우 이름이 웹에서만 보임을 UI에 표기.
4. **새 세션** — `+` 버튼 → 빈 대화, 첫 send에서 새 spawn.
5. **단일 활성 프로세스 불변** 유지 (섹션 1).

## 스코프 아웃 (v1에서 하지 않음)

- Codex 어댑터 (AgentAdapter 인터페이스만 준비)
- 어시스턴트 텍스트 풀 마크다운 렌더
- docwatch 자체 대화 영속 저장 (jsonl이 원본)
- 동시 멀티 세션 실행 / 멀티 레포
- 편집 승인 게이트 UI
- 모바일 레이아웃
- 대화 중 프롬프트 큐잉 (턴 단위 교대만)

## 미해결/구현 시 검증 항목

1. Claude Code 세션명(rename) 메타데이터의 실제 저장 위치·형식 (섹션 5).
2. `--input-format stream-json` 다회차 유지 시 user 메시지 JSON 형식 —
   실제 CLI 버전으로 스모크 후 파서 픽스처 캡처.
3. jsonl 트랜스크립트의 스키마 (이벤트 재수화 파서 작성 전 실물 확인).
