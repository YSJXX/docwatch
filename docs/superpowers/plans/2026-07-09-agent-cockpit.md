# Agent Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** docwatch /monitor의 col2에 Claude Code 대화 탭을 추가 — docwatch가 claude 프로세스를 spawn·소유하고, 세션 rename/resume/네비게이션과 Ctrl+Click 파일 열기를 지원한다.

**Architecture:** 서버 싱글턴 `AgentSessionManager`(src/server/agent/)가 어댑터(`ClaudeAdapter`/`MockAdapter`) 뒤에서 claude stream-json 프로세스를 관리하고, 정규화된 `AgentEvent`를 SSE로 push한다. 과거 대화는 `~/.claude/projects/<esc>/<id>.jsonl` 트랜스크립트를 파싱해 재수화한다. UI는 ChatPanel.astro 컴포넌트.

**Tech Stack:** Astro 5 서버 라우트, Node child_process + readline (신규 npm 의존성 **0개**), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-09-agent-cockpit-design.md`

## Global Constraints

- Node >= 18, 신규 npm 의존성 추가 금지 (child_process/readline/fs 내장만).
- claude CLI 2.1.201에서 검증된 플래그만 사용: `-p --input-format stream-json --output-format stream-json --verbose --permission-mode acceptEdits --resume <id>`.
- 사람의 UI는 읽기 전용. 파일 변경은 에이전트 프로세스만 수행.
- 파일 열기는 **Ctrl+Click(metaKey 포함) 전용**. 일반 클릭은 열기 금지 (툴 카드 일반 클릭 = 결과 접기/펼치기만).
- 텍스트 파일 링크는 **레포에 실존하는 파일만** (오탐 제로 원칙).
- 단일 활성 프로세스: 어느 순간에도 spawn된 claude는 최대 1개.
- JSON을 `set:html`로 넣을 때 반드시 `<`,`>`,`&`를 `<` 식으로 이스케이프 (기존 XSS 규칙).
- JS로 생성하는 DOM의 스타일은 `<style is:global>`에 두어야 함 (Astro scoped style 미적용 gotcha).
- UI 카피는 기존과 동일하게 한국어.

## 사전 확인된 사실 (구현 중 재조사 불필요)

- **stream-json 출력 실물** (CLI 2.1.201에서 캡처):
  - `{"type":"system","subtype":"init","session_id":"…","cwd":"…","tools":[…]}` — 세션 ID 획득처
  - `{"type":"system","subtype":"hook_started"|"hook_response",…}` — **노이즈, 스킵**
  - `{"type":"rate_limit_event",…}` — 노이즈, 스킵
  - `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"OK"}|{"type":"tool_use","id":"toolu_…","name":"Edit","input":{…}}]},"session_id":"…"}`
  - `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_…","content":…,"is_error":false}]}}`
  - `{"type":"result","subtype":"success","is_error":false,"duration_ms":4394,"total_cost_usd":0.0856,"result":"OK","session_id":"…"}`
- **stream-json 입력** (한 줄 NDJSON): `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`
- **트랜스크립트**: `~/.claude/projects/<rootDir의 '/'와 '.'을 '-'로 치환>/<sessionId>.jsonl`. 라인 타입: `user|assistant`(message.role/content, timestamp ISO 문자열, isSidechain), `attachment`, `system`, `custom-title`, `agent-name`.
- **rename 저장** = jsonl에 두 줄 append (마지막 것이 이김):
  `{"type":"custom-title","customTitle":"이름","sessionId":"<id>"}` 와 `{"type":"agent-name","agentName":"이름","sessionId":"<id>"}`
- **스펙 대비 의도적 단순화 2건**: ① `GET /api/agent/sessions/<id>` 라우트는 `POST select` + `GET /api/agent` 조합으로 대체(동일 데이터, 라우트 1개 절약). ② status 이벤트에 `message?: string` 필드 추가(에러 카드 본문).

---

### Task 1: Agent 이벤트 타입 + stream-json 파서

**Files:**
- Create: `src/server/agent/types.ts`
- Create: `src/server/agent/claude-stream.ts`
- Test: `tests/unit/claude-stream.test.ts`

**Interfaces:**
- Produces: `AgentEvent`, `AgentEventDraft`, `AgentState`, `FileLink`, `SessionInfo`, `AgentAdapter`, `AdapterFactory`, `AdapterHandlers` (types.ts) / `parseStreamLine(line): { drafts: AgentEventDraft[]; sessionId?: string }`, `recordToDrafts(rec, ts): AgentEventDraft[]`, `summarizeToolUse(name, input): string` (claude-stream.ts)
- Consumes: 없음 (기반 태스크)

- [ ] **Step 1: types.ts 작성**

```ts
// src/server/agent/types.ts
export type AgentState = 'idle' | 'running' | 'done' | 'error';

export type FileLink = { text: string; rel: string; line?: number };

export type AgentEvent =
  | { kind: 'user_text'; text: string; seq: number; ts: number }
  | { kind: 'assistant_text'; text: string; links: FileLink[]; seq: number; ts: number }
  | { kind: 'tool_use'; tool: string; summary: string; filePath?: string; id: string; seq: number; ts: number }
  | { kind: 'tool_result'; forId: string; excerpt: string; isError: boolean; seq: number; ts: number }
  | { kind: 'status'; state: AgentState; message?: string; costUsd?: number; durationMs?: number; seq: number; ts: number };

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
/** seq는 매니저가 부여한다 — 파서/어댑터는 Draft(ts 포함)를 낸다. */
export type AgentEventDraft = DistributiveOmit<AgentEvent, 'seq'>;

export type SessionInfo = { id: string; name: string; mtime: number; messageCount: number };

export type AdapterHandlers = {
  onEvent: (e: AgentEventDraft) => void;
  onSession: (sessionId: string) => void;
  onExit: (info: { code: number | null; stderrTail: string }) => void;
};

export interface AgentAdapter {
  send(text: string): void;
  stop(): Promise<void>;
}

export type AdapterFactory = (opts: {
  rootDir: string;
  resumeSessionId: string | null;
  handlers: AdapterHandlers;
}) => AgentAdapter;
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/unit/claude-stream.test.ts
import { describe, expect, it } from 'vitest';
import { parseStreamLine, summarizeToolUse } from '../../src/server/agent/claude-stream';

// CLI 2.1.201 실물 캡처 기반 픽스처
const INIT = '{"type":"system","subtype":"init","cwd":"/x","session_id":"sess-1","tools":["Edit"],"permissionMode":"acceptEdits"}';
const HOOK = '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup","session_id":"sess-1"}';
const RATE = '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"sess-1"}';
const TEXT = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"OK"}]},"session_id":"sess-1"}';
const TOOL = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Edit","input":{"file_path":"/repo/src/auth.ts","old_string":"a","new_string":"b"}}]},"session_id":"sess-1"}';
const TOOL_RESULT = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"done"}],"is_error":false}]}}';
const RESULT = '{"type":"result","subtype":"success","is_error":false,"duration_ms":4394,"total_cost_usd":0.0856,"result":"OK","session_id":"sess-1"}';

describe('parseStreamLine', () => {
  it('init에서 sessionId를 뽑고 running 상태를 낸다', () => {
    const { drafts, sessionId } = parseStreamLine(INIT);
    expect(sessionId).toBe('sess-1');
    expect(drafts).toEqual([expect.objectContaining({ kind: 'status', state: 'running' })]);
  });

  it('훅/rate_limit/빈 줄/깨진 JSON은 조용히 스킵한다', () => {
    for (const line of [HOOK, RATE, '', '   ', '{broken', '{"type":"unknown-future"}']) {
      expect(parseStreamLine(line).drafts).toEqual([]);
    }
  });

  it('assistant 텍스트 블록 → assistant_text (links는 빈 배열 placeholder)', () => {
    const { drafts } = parseStreamLine(TEXT);
    expect(drafts).toEqual([expect.objectContaining({ kind: 'assistant_text', text: 'OK', links: [] })]);
  });

  it('tool_use 블록 → tool_use (요약 + filePath)', () => {
    const { drafts } = parseStreamLine(TOOL);
    expect(drafts).toEqual([expect.objectContaining({
      kind: 'tool_use', tool: 'Edit', id: 'toolu_1',
      summary: 'Edit /repo/src/auth.ts', filePath: '/repo/src/auth.ts',
    })]);
  });

  it('tool_result → excerpt 결합 + 2KB 절단', () => {
    const { drafts } = parseStreamLine(TOOL_RESULT);
    expect(drafts).toEqual([expect.objectContaining({ kind: 'tool_result', forId: 'toolu_1', excerpt: 'done', isError: false })]);
    const long = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(5000), is_error: false }] } });
    const d = parseStreamLine(long).drafts[0];
    expect(d.kind === 'tool_result' && d.excerpt.length).toBe(2048);
  });

  it('result → status done + 비용/시간', () => {
    const { drafts } = parseStreamLine(RESULT);
    expect(drafts).toEqual([expect.objectContaining({ kind: 'status', state: 'done', costUsd: 0.0856, durationMs: 4394 })]);
  });

  it('result is_error → status error', () => {
    const { drafts } = parseStreamLine('{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":10}');
    expect(drafts).toEqual([expect.objectContaining({ kind: 'status', state: 'error' })]);
  });
});

describe('summarizeToolUse', () => {
  it.each([
    ['Edit', { file_path: 'src/a.ts' }, 'Edit src/a.ts'],
    ['Bash', { command: 'npm test\necho done' }, 'Bash npm test'],
    ['Task', { description: '병렬 조사', prompt: '…' }, 'Task 병렬 조사'],
    ['Grep', { pattern: 'TODO' }, 'Grep TODO'],
    ['WebSearch', { query: 'x' }, 'WebSearch'],
  ])('%s', (name, input, expected) => {
    expect(summarizeToolUse(name, input as Record<string, unknown>)).toBe(expected);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd /home/ysj/docwatch && npx vitest run tests/unit/claude-stream.test.ts`
Expected: FAIL — "Cannot find module …claude-stream"

- [ ] **Step 4: claude-stream.ts 구현**

```ts
// src/server/agent/claude-stream.ts
import type { AgentEventDraft } from './types';

const EXCERPT_MAX = 2048;

function fileOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const rec = input as Record<string, unknown>;
  const p = rec.file_path ?? rec.notebook_path;
  return typeof p === 'string' ? p : undefined;
}

export function summarizeToolUse(name: string, input: Record<string, unknown>): string {
  const file = fileOf(input);
  if (file) return `${name} ${file}`;
  if (name === 'Bash' && typeof input.command === 'string') return `Bash ${input.command.split('\n')[0].slice(0, 80)}`;
  if (name === 'Task' && typeof input.description === 'string') return `Task ${input.description}`;
  if ((name === 'Grep' || name === 'Glob') && typeof input.pattern === 'string') return `${name} ${input.pattern}`;
  return name;
}

function excerptOfResult(content: unknown): string {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map(block => (block && typeof block === 'object' && (block as any).type === 'text' ? String((block as any).text ?? '') : ''))
      .join('\n');
  }
  return text.slice(0, EXCERPT_MAX);
}

/** stream-json/트랜스크립트 공용: {type:'user'|'assistant', message:{content}} 레코드 → 이벤트 초안. */
export function recordToDrafts(rec: any, ts: number): AgentEventDraft[] {
  const drafts: AgentEventDraft[] = [];
  const content = rec?.message?.content;
  if (rec?.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        drafts.push({ kind: 'assistant_text', text: block.text, links: [], ts });
      } else if (block?.type === 'tool_use') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        drafts.push({
          kind: 'tool_use', tool: String(block.name ?? '?'),
          summary: summarizeToolUse(String(block.name ?? '?'), input),
          ...(fileOf(input) ? { filePath: fileOf(input) } : {}),
          id: String(block.id ?? ''), ts,
        });
      }
    }
  } else if (rec?.type === 'user') {
    if (typeof content === 'string') {
      const text = content.trim();
      if (text && !text.startsWith('<')) drafts.push({ kind: 'user_text', text, ts });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_result') {
          drafts.push({
            kind: 'tool_result', forId: String(block.tool_use_id ?? ''),
            excerpt: excerptOfResult(block.content), isError: Boolean(block.is_error), ts,
          });
        } else if (block?.type === 'text' && typeof block.text === 'string') {
          const text = block.text.trim();
          if (text && !text.startsWith('<')) drafts.push({ kind: 'user_text', text, ts });
        }
      }
    }
  }
  return drafts;
}

/** claude --output-format stream-json 의 NDJSON 한 줄 → 이벤트 초안들. 미지의 라인은 조용히 스킵. */
export function parseStreamLine(line: string): { drafts: AgentEventDraft[]; sessionId?: string } {
  const trimmed = line.trim();
  if (!trimmed) return { drafts: [] };
  let rec: any;
  try { rec = JSON.parse(trimmed); } catch { return { drafts: [] }; }
  const ts = Date.now();

  if (rec.type === 'system' && rec.subtype === 'init') {
    return { drafts: [{ kind: 'status', state: 'running', ts }], sessionId: String(rec.session_id ?? '') || undefined };
  }
  if (rec.type === 'result') {
    return {
      drafts: [{
        kind: 'status', state: rec.is_error ? 'error' : 'done',
        ...(typeof rec.total_cost_usd === 'number' ? { costUsd: rec.total_cost_usd } : {}),
        ...(typeof rec.duration_ms === 'number' ? { durationMs: rec.duration_ms } : {}),
        ts,
      }],
    };
  }
  if (rec.type === 'assistant' || rec.type === 'user') return { drafts: recordToDrafts(rec, ts) };
  return { drafts: [] }; // hook_started/hook_response/rate_limit_event/미래 타입
}
```

- [ ] **Step 5: 통과 확인 + 타입체크**

Run: `cd /home/ysj/docwatch && npx vitest run tests/unit/claude-stream.test.ts && npm run typecheck`
Expected: PASS (전 케이스) / tsc 에러 0

- [ ] **Step 6: Commit**

```bash
git add src/server/agent/types.ts src/server/agent/claude-stream.ts tests/unit/claude-stream.test.ts
git commit -m "feat(agent): stream-json parser and agent event types"
```

---

### Task 2: 트랜스크립트 파서 + 세션 목록 + rename

**Files:**
- Create: `src/server/agent/transcript.ts`
- Test: `tests/unit/transcript.test.ts`

**Interfaces:**
- Consumes: `recordToDrafts` (Task 1), `AgentEventDraft`, `SessionInfo` (types.ts)
- Produces: `claudeProjectDir(rootDir): string`, `listSessions(rootDir): Promise<SessionInfo[]>`, `parseTranscript(rootDir, sessionId): Promise<AgentEventDraft[]>`, `renameSession(rootDir, sessionId, name): Promise<void>`
- 환경변수: `DOCWATCH_CLAUDE_DIR` — 세션 베이스 디렉토리 오버라이드 (기본 `~/.claude/projects`). 테스트/e2e용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/transcript.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeProjectDir, listSessions, parseTranscript, renameSession } from '../../src/server/agent/transcript';

const ROOT = '/fake/target.repo'; // '.'도 '-'로 치환되는지 확인용
let base = '';

const S1 = [
  '{"type":"custom-title","customTitle":"옛 이름","sessionId":"s1"}',
  '{"type":"user","message":{"role":"user","content":"로그인 버그 고쳐줘"},"timestamp":"2026-07-09T01:00:00.000Z"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"확인하겠습니다"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"src/a.ts"}}]},"timestamp":"2026-07-09T01:00:05.000Z"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"내용","is_error":false}]},"timestamp":"2026-07-09T01:00:06.000Z"}',
  '{"type":"user","isSidechain":true,"message":{"role":"user","content":"서브에이전트 내부"},"timestamp":"2026-07-09T01:00:07.000Z"}',
  '{"type":"user","message":{"role":"user","content":"<system-reminder>노이즈</system-reminder>"},"timestamp":"2026-07-09T01:00:08.000Z"}',
  '{"type":"custom-title","customTitle":"fix-login","sessionId":"s1"}',
].join('\n') + '\n';

const S2 = [
  '{"type":"user","message":{"role":"user","content":"두번째 세션 첫 프롬프트입니다"},"timestamp":"2026-07-08T01:00:00.000Z"}',
].join('\n') + '\n';

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-transcript-'));
  process.env.DOCWATCH_CLAUDE_DIR = base;
  const dir = claudeProjectDir(ROOT);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 's1.jsonl'), S1);
  await fs.writeFile(path.join(dir, 's2.jsonl'), S2);
  const past = new Date(Date.now() - 86_400_000);
  await fs.utimes(path.join(dir, 's2.jsonl'), past, past);
});

afterEach(async () => {
  delete process.env.DOCWATCH_CLAUDE_DIR;
  await fs.rm(base, { recursive: true, force: true });
});

describe('claudeProjectDir', () => {
  it("루트 경로의 '/'와 '.'을 '-'로 치환한다", () => {
    expect(claudeProjectDir(ROOT)).toBe(path.join(base, '-fake-target-repo'));
  });
});

describe('listSessions', () => {
  it('최신순 정렬 + 마지막 custom-title이 이름 + user/assistant 라인 수', async () => {
    const sessions = await listSessions(ROOT);
    expect(sessions.map(s => s.id)).toEqual(['s1', 's2']);
    expect(sessions[0].name).toBe('fix-login');
    expect(sessions[0].messageCount).toBe(5); // sidechain 제외한 user/assistant 라인
  });

  it('custom-title 없으면 첫 user 텍스트 60자로 이름을 만든다', async () => {
    const sessions = await listSessions(ROOT);
    expect(sessions[1].name).toBe('두번째 세션 첫 프롬프트입니다');
  });

  it('디렉토리 없으면 빈 배열', async () => {
    expect(await listSessions('/no/such/root')).toEqual([]);
  });
});

describe('parseTranscript', () => {
  it('user_text/assistant_text/tool_use/tool_result를 시간과 함께 복원, sidechain·<로 시작하는 텍스트 제외', async () => {
    const drafts = await parseTranscript(ROOT, 's1');
    expect(drafts.map(d => d.kind)).toEqual(['user_text', 'assistant_text', 'tool_use', 'tool_result']);
    expect(drafts[0]).toMatchObject({ kind: 'user_text', text: '로그인 버그 고쳐줘', ts: Date.parse('2026-07-09T01:00:00.000Z') });
  });

  it('경로 조작 sessionId는 거부한다', async () => {
    await expect(parseTranscript(ROOT, '../evil')).rejects.toThrow();
  });
});

describe('renameSession', () => {
  it('custom-title + agent-name 두 줄을 append하고 listSessions에 반영된다', async () => {
    await renameSession(ROOT, 's1', '새 이름');
    const raw = await fs.readFile(path.join(claudeProjectDir(ROOT), 's1.jsonl'), 'utf8');
    expect(raw).toContain('"customTitle":"새 이름"');
    expect(raw).toContain('"agentName":"새 이름"');
    const sessions = await listSessions(ROOT);
    expect(sessions[0].name).toBe('새 이름');
  });

  it('없는 세션 rename은 에러', async () => {
    await expect(renameSession(ROOT, 'nope', 'x')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /home/ysj/docwatch && npx vitest run tests/unit/transcript.test.ts`
Expected: FAIL — "Cannot find module …transcript"

- [ ] **Step 3: transcript.ts 구현**

```ts
// src/server/agent/transcript.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordToDrafts } from './claude-stream';
import type { AgentEventDraft, SessionInfo } from './types';

const SESSION_ID_RE = /^[\w-]+$/;

function baseDir(): string {
  return process.env.DOCWATCH_CLAUDE_DIR
    ? path.resolve(process.env.DOCWATCH_CLAUDE_DIR)
    : path.join(os.homedir(), '.claude', 'projects');
}

/** Claude Code의 프로젝트 디렉토리 규칙: 루트 절대경로의 '/'와 '.'을 '-'로 치환. */
export function claudeProjectDir(rootDir: string): string {
  return path.join(baseDir(), rootDir.replace(/[/.]/g, '-'));
}

function sessionFile(rootDir: string, sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
  return path.join(claudeProjectDir(rootDir), `${sessionId}.jsonl`);
}

function tsOf(rec: any): number {
  if (typeof rec?.timestamp === 'string') {
    const parsed = Date.parse(rec.timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof rec?.timestamp === 'number') return rec.timestamp;
  return Date.now();
}

function parseLines(raw: string): any[] {
  const out: any[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* 손상 라인 스킵 */ }
  }
  return out;
}

export async function listSessions(rootDir: string): Promise<SessionInfo[]> {
  const dir = claudeProjectDir(rootDir);
  let files: string[];
  try { files = (await fs.readdir(dir)).filter(f => f.endsWith('.jsonl')); } catch { return []; }

  const infos = await Promise.all(files.map(async file => {
    const full = path.join(dir, file);
    const [stat, raw] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf8')]);
    let name = '';
    let firstUser = '';
    let messageCount = 0;
    for (const rec of parseLines(raw)) {
      if (rec.type === 'custom-title' && typeof rec.customTitle === 'string') name = rec.customTitle;
      if ((rec.type === 'user' || rec.type === 'assistant') && !rec.isSidechain) {
        messageCount++;
        if (!firstUser && rec.type === 'user' && typeof rec.message?.content === 'string') {
          const text = rec.message.content.trim();
          if (text && !text.startsWith('<')) firstUser = text;
        }
      }
    }
    return { id: file.slice(0, -'.jsonl'.length), name: name || firstUser.slice(0, 60) || '(제목 없음)', mtime: stat.mtimeMs, messageCount };
  }));
  return infos.sort((a, b) => b.mtime - a.mtime);
}

export async function parseTranscript(rootDir: string, sessionId: string): Promise<AgentEventDraft[]> {
  const raw = await fs.readFile(sessionFile(rootDir, sessionId), 'utf8');
  const drafts: AgentEventDraft[] = [];
  for (const rec of parseLines(raw)) {
    if (rec.isSidechain) continue;
    if (rec.type !== 'user' && rec.type !== 'assistant') continue;
    drafts.push(...recordToDrafts(rec, tsOf(rec)));
  }
  return drafts;
}

export async function renameSession(rootDir: string, sessionId: string, name: string): Promise<void> {
  const file = sessionFile(rootDir, sessionId);
  await fs.access(file); // 없는 세션이면 throw
  const lines =
    JSON.stringify({ type: 'custom-title', customTitle: name, sessionId }) + '\n' +
    JSON.stringify({ type: 'agent-name', agentName: name, sessionId }) + '\n';
  await fs.appendFile(file, lines, 'utf8');
}
```

- [ ] **Step 4: 통과 확인 + 타입체크**

Run: `cd /home/ysj/docwatch && npx vitest run tests/unit/transcript.test.ts && npm run typecheck`
Expected: PASS / tsc 에러 0

- [ ] **Step 5: Commit**

```bash
git add src/server/agent/transcript.ts tests/unit/transcript.test.ts
git commit -m "feat(agent): session transcript parser, listing, and rename"
```

---

### Task 3: 파일 링크 어노테이터

**Files:**
- Create: `src/server/agent/file-links.ts`
- Test: `tests/unit/file-links.test.ts`

**Interfaces:**
- Consumes: `FileLink` (types.ts)
- Produces: `annotateFileLinks(text: string, rootDir: string): Promise<FileLink[]>` — 텍스트에서 레포에 **실존하는** 파일 경로만 추출. `link.text`는 원문에 등장한 문자열 그대로(클라이언트가 문자열 매칭으로 링크화).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/file-links.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { annotateFileLinks } from '../../src/server/agent/file-links';

let root = '';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-links-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'auth.ts'), 'x');
  await fs.writeFile(path.join(root, 'README.md'), 'x');
});

afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('annotateFileLinks', () => {
  it('실존 파일만 링크화하고 :줄번호를 파싱한다', async () => {
    const links = await annotateFileLinks('src/auth.ts:42 를 고쳤고 README.md 도 봤습니다', root);
    expect(links).toEqual([
      { text: 'src/auth.ts:42', rel: 'src/auth.ts', line: 42 },
      { text: 'README.md', rel: 'README.md' },
    ]);
  });

  it('실존하지 않는 경로·버전 번호·URL은 링크화하지 않는다 (오탐 제로)', async () => {
    const links = await annotateFileLinks('없는 src/gone.ts, 버전 1.2.3, https://a.com/b.ts 참고', root);
    expect(links).toEqual([]);
  });

  it('중복 언급은 한 번만', async () => {
    const links = await annotateFileLinks('README.md 그리고 또 README.md', root);
    expect(links).toHaveLength(1);
  });

  it('경로 탈출은 무시한다', async () => {
    const links = await annotateFileLinks('../../etc/passwd 와 /etc/passwd', root);
    expect(links).toEqual([]);
  });

  it('백틱 코드 안 경로도 잡는다', async () => {
    const links = await annotateFileLinks('`src/auth.ts` 를 수정', root);
    expect(links).toEqual([{ text: 'src/auth.ts', rel: 'src/auth.ts' }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /home/ysj/docwatch && npx vitest run tests/unit/file-links.test.ts`
Expected: FAIL — "Cannot find module …file-links"

- [ ] **Step 3: file-links.ts 구현**

```ts
// src/server/agent/file-links.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileLink } from './types';

// 후보: `dir/name.ext` 꼴 상대경로 (+ 선택적 :줄번호). 앞은 공백/문장부호/백틱 경계.
const CANDIDATE_RE = /(?:^|[\s(`'"[])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][\w]{0,7})(:(\d{1,6}))?/g;
const MAX_LINKS = 20;

function isSafeRel(rel: string): boolean {
  if (!rel || path.isAbsolute(rel)) return false;
  const norm = path.posix.normalize(rel);
  return !(norm === '..' || norm.startsWith('../') || norm.includes('/../'));
}

/** 텍스트에서 rootDir에 실존하는 파일 경로만 FileLink로 추출한다. 오탐 제로 원칙. */
export async function annotateFileLinks(text: string, rootDir: string): Promise<FileLink[]> {
  const seen = new Set<string>();
  const links: FileLink[] = [];
  for (const m of text.matchAll(CANDIDATE_RE)) {
    if (links.length >= MAX_LINKS) break;
    const rel = m[1];
    const line = m[3] ? Number(m[3]) : undefined;
    const key = rel + (line ? `:${line}` : '');
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isSafeRel(rel)) continue;
    if (/^\d+(\.\d+)+$/.test(rel)) continue; // 1.2.3 같은 버전
    if (text.includes(`://${rel}`) || text.includes(`.com/${rel}`)) continue; // URL 잔여물 방어
    try {
      const stat = await fs.stat(path.join(rootDir, rel));
      if (!stat.isFile()) continue;
    } catch { continue; } // 실존 검사 = 핵심 필터
    links.push({ text: line ? `${rel}:${line}` : rel, rel, ...(line ? { line } : {}) });
  }
  return links;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /home/ysj/docwatch && npx vitest run tests/unit/file-links.test.ts && npm run typecheck`
Expected: PASS / tsc 에러 0

- [ ] **Step 5: Commit**

```bash
git add src/server/agent/file-links.ts tests/unit/file-links.test.ts
git commit -m "feat(agent): existence-checked file link annotator"
```

---

### Task 4: 세션 매니저 + mock 어댑터

**Files:**
- Create: `src/server/agent/manager.ts`
- Create: `src/server/agent/mock-adapter.ts`
- Test: `tests/integration/agent-manager.test.ts`

**Interfaces:**
- Consumes: Task 1–3 전부 (`AdapterFactory`, `parseTranscript`, `annotateFileLinks`)
- Produces: `AgentSessionManager` — `state: AgentState`, `sessionId: string|null`, `touched: Set<string>`, `history(): AgentEvent[]`, `subscribe(cb: (e: AgentEvent) => void): () => void`, `send(text): Promise<void>`, `stop(): Promise<void>`, `selectSession(id: string|null): Promise<void>` / `getAgentManager(rootDir): AgentSessionManager` (globalThis 싱글턴, `DOCWATCH_AGENT=mock`이면 mock 팩토리) / `createMockAdapter: AdapterFactory`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/integration/agent-manager.test.ts
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentSessionManager } from '../../src/server/agent/manager';
import type { AdapterFactory, AgentEvent } from '../../src/server/agent/types';

function scriptedFactory(script: (send: (text: string) => void) => void): { factory: AdapterFactory; spawns: number[] } {
  const spawns: number[] = [];
  const factory: AdapterFactory = ({ resumeSessionId, handlers }) => {
    spawns.push(Date.now());
    handlers.onSession(resumeSessionId ?? 'new-sess');
    return {
      send(text) {
        script(t => handlers.onEvent({ kind: 'assistant_text', text: t, links: [], ts: Date.now() }));
        handlers.onEvent({ kind: 'tool_use', tool: 'Edit', summary: 'Edit src/a.ts', filePath: 'src/a.ts', id: 't1', ts: Date.now() });
        handlers.onEvent({ kind: 'status', state: 'done', ts: Date.now() });
        void text;
      },
      async stop() {},
    };
  };
  return { factory, spawns };
}

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-mgr-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'x');
  return root;
}

function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  return vi.waitFor(() => { if (!check()) throw new Error('not yet'); }, { timeout: ms });
}

describe('AgentSessionManager', () => {
  it('send → user_text·running·어댑터 이벤트가 seq 순서로 쌓이고 구독자에 전달된다', async () => {
    const root = await makeRoot();
    const { factory } = scriptedFactory(send => send('src/a.ts 를 고쳤습니다'));
    const m = new AgentSessionManager(root, factory);
    const got: AgentEvent[] = [];
    m.subscribe(e => got.push(e));

    await m.send('고쳐줘');
    await waitFor(() => m.state === 'done');

    const kinds = m.history().map(e => e.kind);
    expect(kinds).toEqual(['user_text', 'status', 'assistant_text', 'tool_use', 'status']);
    expect(m.history().map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(got).toHaveLength(5);
    // assistant_text에 실존 파일 링크가 붙는다
    const at = m.history().find(e => e.kind === 'assistant_text');
    expect(at && at.kind === 'assistant_text' && at.links).toEqual([{ text: 'src/a.ts', rel: 'src/a.ts' }]);
    // touched에 편집/언급 파일이 기록된다
    expect([...m.touched]).toEqual(['src/a.ts']);
  });

  it('running 중 send는 거부한다', async () => {
    const root = await makeRoot();
    // done을 내지 않는 어댑터 → running 유지
    const factory: AdapterFactory = ({ handlers }) => ({
      send() { handlers.onEvent({ kind: 'status', state: 'running', ts: Date.now() }); },
      async stop() {},
    });
    const m = new AgentSessionManager(root, factory);
    await m.send('첫번째');
    await expect(m.send('두번째')).rejects.toThrow(/busy/i);
  });

  it('selectSession(null) → 히스토리 초기화, 이전 프로세스 stop', async () => {
    const root = await makeRoot();
    const { factory } = scriptedFactory(send => send('ok'));
    const m = new AgentSessionManager(root, factory);
    await m.send('x');
    await waitFor(() => m.state === 'done');
    await m.selectSession(null);
    expect(m.history().map(e => e.kind)).toEqual(['status']); // idle 리셋만
    expect(m.sessionId).toBeNull();
    expect(m.touched.size).toBe(0);
  });

  it('어댑터 사망(onExit) 후 다음 send는 sessionId로 재생성(resume)한다', async () => {
    const root = await makeRoot();
    const resumeIds: Array<string | null> = [];
    const factory: AdapterFactory = ({ resumeSessionId, handlers }) => {
      resumeIds.push(resumeSessionId);
      handlers.onSession('sess-9');
      return {
        send() {
          handlers.onEvent({ kind: 'status', state: 'done', ts: Date.now() });
          handlers.onExit({ code: 1, stderrTail: 'boom' }); // 턴 끝나고 죽음
        },
        async stop() {},
      };
    };
    const m = new AgentSessionManager(root, factory);
    await m.send('a');
    await waitFor(() => m.state === 'done');
    await m.send('b');
    expect(resumeIds).toEqual([null, 'sess-9']);
  });

  it('running 중 프로세스가 죽으면 status:error 카드를 낸다', async () => {
    const root = await makeRoot();
    const factory: AdapterFactory = ({ handlers }) => ({
      send() { setTimeout(() => handlers.onExit({ code: 137, stderrTail: 'OOM' }), 10); },
      async stop() {},
    });
    const m = new AgentSessionManager(root, factory);
    await m.send('x');
    await waitFor(() => m.state === 'error');
    const err = m.history().at(-1);
    expect(err && err.kind === 'status' && err.message).toMatch(/137[\s\S]*OOM/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /home/ysj/docwatch && npx vitest run tests/integration/agent-manager.test.ts`
Expected: FAIL — "Cannot find module …manager"

- [ ] **Step 3: manager.ts 구현**

```ts
// src/server/agent/manager.ts
import path from 'node:path';
import { annotateFileLinks } from './file-links';
import { parseTranscript } from './transcript';
import { createMockAdapter } from './mock-adapter';
import { createClaudeAdapter } from './claude-adapter';
import type { AdapterFactory, AgentAdapter, AgentEvent, AgentEventDraft, AgentState } from './types';

export class AgentSessionManager {
  state: AgentState = 'idle';
  sessionId: string | null = null;
  readonly touched = new Set<string>();

  private adapter: AgentAdapter | null = null;
  private events: AgentEvent[] = [];
  private seq = 0;
  private subs = new Set<(e: AgentEvent) => void>();
  private queue: Promise<void> = Promise.resolve(); // annotate 순서 보존

  constructor(readonly rootDir: string, private factory: AdapterFactory) {}

  history(): AgentEvent[] { return this.events; }

  subscribe(cb: (e: AgentEvent) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private push(draft: AgentEventDraft): void {
    const event = { ...draft, seq: ++this.seq } as AgentEvent;
    if (event.kind === 'status') this.state = event.state;
    if (event.kind === 'tool_use' && event.filePath) {
      const rel = path.isAbsolute(event.filePath) ? path.relative(this.rootDir, event.filePath) : event.filePath;
      if (rel && !rel.startsWith('..')) { event.filePath = rel; this.touched.add(rel); }
    }
    this.events.push(event);
    for (const cb of this.subs) { try { cb(event); } catch { /* 구독자 오류 무시 */ } }
  }

  private handleDraft = (draft: AgentEventDraft): void => {
    this.queue = this.queue.then(async () => {
      if (draft.kind === 'assistant_text') {
        const links = await annotateFileLinks(draft.text, this.rootDir).catch(() => []);
        for (const link of links) this.touched.add(link.rel);
        this.push({ ...draft, links });
        return;
      }
      this.push(draft);
    });
  };

  async selectSession(id: string | null): Promise<void> {
    await this.stop();
    this.sessionId = id;
    this.seq = 0;
    this.events = [];
    this.touched.clear();
    if (id) {
      const drafts = await parseTranscript(this.rootDir, id).catch(() => []);
      for (const d of drafts) {
        if (d.kind === 'tool_use' && d.filePath) this.touched.add(d.filePath);
        this.push(d);
      }
    }
    this.push({ kind: 'status', state: 'idle', ts: Date.now() });
  }

  async send(text: string): Promise<void> {
    if (this.state === 'running') throw new Error('agent is busy');
    if (!this.adapter) {
      this.adapter = this.factory({
        rootDir: this.rootDir,
        resumeSessionId: this.sessionId,
        handlers: {
          onEvent: this.handleDraft,
          onSession: id => { this.sessionId = id; },
          onExit: ({ code, stderrTail }) => {
            this.adapter = null;
            if (this.state === 'running') {
              this.push({ kind: 'status', state: 'error', message: `에이전트 프로세스 종료 (exit ${code})\n${stderrTail}`.trim(), ts: Date.now() });
            }
          },
        },
      });
    }
    this.push({ kind: 'user_text', text, ts: Date.now() });
    this.push({ kind: 'status', state: 'running', ts: Date.now() });
    this.adapter.send(text);
  }

  async stop(): Promise<void> {
    const adapter = this.adapter;
    this.adapter = null;
    if (adapter) await adapter.stop();
    if (this.state === 'running') this.push({ kind: 'status', state: 'idle', ts: Date.now() });
  }
}

const KEY = '__dw_agent_manager__';

export function getAgentManager(rootDir: string): AgentSessionManager {
  const g = globalThis as Record<string, unknown>;
  const existing = g[KEY] as AgentSessionManager | undefined;
  if (existing && existing.rootDir === rootDir) return existing;
  const factory: AdapterFactory = process.env.DOCWATCH_AGENT === 'mock' ? createMockAdapter : createClaudeAdapter;
  const manager = new AgentSessionManager(rootDir, factory);
  g[KEY] = manager;
  return manager;
}
```

- [ ] **Step 4: mock-adapter.ts 구현**

```ts
// src/server/agent/mock-adapter.ts
import type { AdapterFactory, AgentEventDraft } from './types';

/** e2e/데모용: 스크립트된 이벤트를 시간차로 방출한다. DOCWATCH_AGENT=mock 에서 사용. */
export const createMockAdapter: AdapterFactory = ({ resumeSessionId, handlers }) => {
  handlers.onSession(resumeSessionId ?? 'mock-session-1');
  let stopped = false;
  const emit = (draft: AgentEventDraft, delay: number) =>
    setTimeout(() => { if (!stopped) handlers.onEvent(draft); }, delay);
  return {
    send(text: string) {
      emit({ kind: 'tool_use', tool: 'Read', summary: 'Read src/app.ts', filePath: 'src/app.ts', id: 'mock-t1', ts: Date.now() }, 20);
      emit({ kind: 'tool_result', forId: 'mock-t1', excerpt: '// TODO: implement the thing', isError: false, ts: Date.now() }, 40);
      emit({ kind: 'tool_use', tool: 'Edit', summary: 'Edit src/app.ts', filePath: 'src/app.ts', id: 'mock-t2', ts: Date.now() }, 60);
      emit({ kind: 'tool_result', forId: 'mock-t2', excerpt: 'ok', isError: false, ts: Date.now() }, 80);
      emit({ kind: 'assistant_text', text: `요청 처리: ${text}\nREADME.md 와 src/app.ts 를 확인했습니다.`, links: [], ts: Date.now() }, 100);
      emit({ kind: 'status', state: 'done', costUsd: 0.01, durationMs: 120, ts: Date.now() }, 140);
    },
    async stop() { stopped = true; },
  };
};
```

- [ ] **Step 5: claude-adapter.ts 스텁 생성** (manager가 import — 실구현은 Task 5)

```ts
// src/server/agent/claude-adapter.ts
import type { AdapterFactory } from './types';

export const createClaudeAdapter: AdapterFactory = () => {
  throw new Error('not implemented — Task 5'); // Task 5에서 교체
};
```

- [ ] **Step 6: 통과 확인**

Run: `cd /home/ysj/docwatch && npx vitest run tests/integration/agent-manager.test.ts && npm run typecheck`
Expected: PASS (5 케이스) / tsc 에러 0

- [ ] **Step 7: Commit**

```bash
git add src/server/agent/manager.ts src/server/agent/mock-adapter.ts src/server/agent/claude-adapter.ts tests/integration/agent-manager.test.ts
git commit -m "feat(agent): session manager with single-process invariant and mock adapter"
```

---

### Task 5: Claude 어댑터 (spawn 배선)

**Files:**
- Modify: `src/server/agent/claude-adapter.ts` (Task 4 스텁 교체)
- Test: `tests/unit/claude-adapter.test.ts`

**Interfaces:**
- Consumes: `parseStreamLine` (Task 1), `AdapterFactory`
- Produces: `createClaudeAdapter: AdapterFactory`, `buildClaudeArgs(resumeSessionId: string | null): string[]`
- 실 프로세스 실행 검증은 Task 10 수동 스모크. 단위 테스트는 인자 빌더만 (spawn 자체는 얇은 배선).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/unit/claude-adapter.test.ts
import { describe, expect, it } from 'vitest';
import { buildClaudeArgs } from '../../src/server/agent/claude-adapter';

describe('buildClaudeArgs', () => {
  it('기본 플래그: stream-json 양방향 + acceptEdits + verbose', () => {
    expect(buildClaudeArgs(null)).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--verbose', '--permission-mode', 'acceptEdits',
    ]);
  });

  it('resume 세션이 있으면 --resume <id>를 붙인다', () => {
    expect(buildClaudeArgs('sess-1')).toEqual(expect.arrayContaining(['--resume', 'sess-1']));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /home/ysj/docwatch && npx vitest run tests/unit/claude-adapter.test.ts`
Expected: FAIL — buildClaudeArgs is not exported / not a function

- [ ] **Step 3: claude-adapter.ts 구현**

```ts
// src/server/agent/claude-adapter.ts
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { parseStreamLine } from './claude-stream';
import type { AdapterFactory } from './types';

export function buildClaudeArgs(resumeSessionId: string | null): string[] {
  return [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--permission-mode', 'acceptEdits',
    ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ];
}

/** claude CLI를 spawn해 stream-json 양방향으로 다회차 세션을 유지한다.
 *  프로세스는 stdin이 열려 있는 한 살아있고, result 이후에도 다음 send를 받는다.
 *  detached 금지: docwatch 서버가 죽으면 자식도 함께 정리된다. */
export const createClaudeAdapter: AdapterFactory = ({ rootDir, resumeSessionId, handlers }) => {
  const child = spawn('claude', buildClaudeArgs(resumeSessionId), {
    cwd: rootDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  let stderrTail = '';
  child.stderr.on('data', chunk => {
    stderrTail = (stderrTail + String(chunk)).split('\n').slice(-5).join('\n');
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', line => {
    const { drafts, sessionId } = parseStreamLine(line);
    if (sessionId) handlers.onSession(sessionId);
    for (const draft of drafts) handlers.onEvent(draft);
  });

  child.on('error', err => handlers.onExit({ code: null, stderrTail: String(err) })); // ENOENT 등 spawn 실패
  child.on('close', code => handlers.onExit({ code, stderrTail }));

  return {
    send(text: string) {
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGINT');
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 5000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
      });
    },
  };
};
```

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `cd /home/ysj/docwatch && npm run test:unit && npm run test:integration && npm run typecheck`
Expected: 전부 PASS / tsc 에러 0

- [ ] **Step 5: Commit**

```bash
git add src/server/agent/claude-adapter.ts tests/unit/claude-adapter.test.ts
git commit -m "feat(agent): claude CLI adapter (stream-json spawn wiring)"
```

---

### Task 6: API 라우트 (agent / agent-stream / sessions)

**Files:**
- Create: `src/pages/api/agent.ts`
- Create: `src/pages/api/agent-stream.ts`
- Create: `src/pages/api/agent/sessions.ts`

**Interfaces:**
- Consumes: `getAgentManager` (Task 4), `listSessions`, `renameSession` (Task 2), `targetRepoRoot` (`@/data/paths` 기존)
- Produces: HTTP 계약 —
  - `GET /api/agent` → `{ state, sessionId, events: AgentEvent[] }`
  - `POST /api/agent` body `{action: 'new'|'select'|'send'|'stop'|'rename', …}` → `{ok:true}` | `{error}` (400/409)
  - `GET /api/agent-stream` → SSE, 각 이벤트 `data: <AgentEvent JSON>`
  - `GET /api/agent/sessions` → `SessionInfo[]`

- [ ] **Step 1: agent.ts 작성**

```ts
// src/pages/api/agent.ts
import type { APIRoute } from 'astro';
import { targetRepoRoot } from '@/data/paths';
import { getAgentManager } from '@/server/agent/manager';
import { renameSession } from '@/server/agent/transcript';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const SESSION_ID_RE = /^[\w-]+$/;

export const GET: APIRoute = async () => {
  const m = getAgentManager(targetRepoRoot());
  return json({ state: m.state, sessionId: m.sessionId, events: m.history() });
};

export const POST: APIRoute = async ({ request }) => {
  const root = targetRepoRoot();
  const m = getAgentManager(root);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }

  switch (body?.action) {
    case 'new':
      await m.selectSession(null);
      return json({ ok: true });
    case 'select':
      if (typeof body.sessionId !== 'string' || !SESSION_ID_RE.test(body.sessionId)) return json({ error: 'bad sessionId' }, 400);
      await m.selectSession(body.sessionId);
      return json({ ok: true });
    case 'send':
      if (typeof body.text !== 'string' || !body.text.trim()) return json({ error: 'text required' }, 400);
      if (m.state === 'running') return json({ error: 'busy' }, 409);
      await m.send(body.text);
      return json({ ok: true });
    case 'stop':
      await m.stop();
      return json({ ok: true });
    case 'rename':
      if (typeof body.sessionId !== 'string' || !SESSION_ID_RE.test(body.sessionId)) return json({ error: 'bad sessionId' }, 400);
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) return json({ error: 'bad name' }, 400);
      try { await renameSession(root, body.sessionId, body.name.trim()); } catch { return json({ error: 'session not found' }, 404); }
      return json({ ok: true });
    default:
      return json({ error: 'unknown action' }, 400);
  }
};
```

- [ ] **Step 2: agent-stream.ts 작성** (기존 activity-stream.ts 패턴 미러)

```ts
// src/pages/api/agent-stream.ts
import type { APIRoute } from 'astro';
import { targetRepoRoot } from '@/data/paths';
import { getAgentManager } from '@/server/agent/manager';

export const prerender = false;

export const GET: APIRoute = async () => {
  const manager = getAgentManager(targetRepoRoot());
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };
      unsubscribe = manager.subscribe(event => enqueue(`data: ${JSON.stringify(event)}\n\n`));
      heartbeat = setInterval(() => enqueue(': ping\n\n'), 25_000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
};
```

- [ ] **Step 3: sessions.ts 작성**

```ts
// src/pages/api/agent/sessions.ts
import type { APIRoute } from 'astro';
import { targetRepoRoot } from '@/data/paths';
import { listSessions } from '@/server/agent/transcript';

export const prerender = false;

export const GET: APIRoute = async () => {
  const sessions = await listSessions(targetRepoRoot());
  return new Response(JSON.stringify(sessions), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
```

- [ ] **Step 4: 손 스모크 (mock 모드)**

Run:
```bash
cd /home/ysj/docwatch && rm -rf .astro && \
DOCWATCH_AGENT=mock node bin/cli.mjs "$PWD" --no-open --port 4399 & echo $! > /tmp/dw-agent-smoke.pid
sleep 8
curl -s localhost:4399/api/agent | head -c 200; echo
curl -s -X POST localhost:4399/api/agent -H 'content-type: application/json' -d '{"action":"send","text":"hi"}'; echo
sleep 1
curl -s localhost:4399/api/agent | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state'], [e['kind'] for e in d['events']])"
curl -s localhost:4399/api/agent/sessions; echo
kill $(cat /tmp/dw-agent-smoke.pid)
```
Expected: 첫 GET `{"state":"idle","sessionId":null,"events":[]}` / POST `{"ok":true}` / 둘째 GET `done ['user_text','status','tool_use','tool_result','tool_use','tool_result','assistant_text','status']` / sessions는 `[…]` (docwatch 자신의 세션 목록 또는 `[]`)

- [ ] **Step 5: typecheck 후 Commit**

Run: `npm run typecheck` → 에러 0
```bash
git add src/pages/api/agent.ts src/pages/api/agent-stream.ts src/pages/api/agent/sessions.ts
git commit -m "feat(agent): REST + SSE API routes for agent sessions"
```

---

### Task 7: rawpreview 확장 — 세션 터치 파일 + 소스 언어

**Files:**
- Modify: `src/pages/rawpreview/[...path].astro` (허용 판정 1줄 + langOf 맵 확장)

**Interfaces:**
- Consumes: `getAgentManager(root).touched: Set<string>` (Task 4)
- Produces: 없음 (라우트 동작 변경) — 에이전트가 언급/편집한 파일(`touched`)은 watchFiles 화이트리스트 밖이어도 열림. traversal 방어는 기존 그대로.

- [ ] **Step 1: 허용 판정 확장**

`src/pages/rawpreview/[...path].astro`의 frontmatter에서:

```astro
import { getAgentManager } from '@/server/agent/manager';
```
를 import에 추가하고, 기존
```ts
if (isWatchedRel(rel, watched)) {
```
를
```ts
if (isWatchedRel(rel, watched) || getAgentManager(root).touched.has(rel)) {
```
로 교체. (`safeRel` 선행검사와 `abs.startsWith(root + path.sep)` 심층 방어는 그대로 유지 — 순서 변경 금지.)

- [ ] **Step 2: langOf에 소스 언어 추가**

기존 `map` 객체에 다음 엔트리를 추가:

```ts
    '.tsx': 'tsx', '.jsx': 'jsx', '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.rb': 'ruby', '.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp',
    '.sh': 'shellscript', '.css': 'css', '.html': 'html', '.astro': 'astro',
```

- [ ] **Step 3: 검증 (Task 6 스모크 서버 재사용 패턴)**

Run:
```bash
cd /home/ysj/docwatch && rm -rf .astro && \
DOCWATCH_AGENT=mock node bin/cli.mjs "$PWD" --no-open --port 4399 & echo $! > /tmp/dw-agent-smoke.pid
sleep 8
echo "--- touched 전: 404 여야 함"
curl -s -o /dev/null -w '%{http_code}\n' localhost:4399/rawpreview/src/data/todos.ts
curl -s -X POST localhost:4399/api/agent -H 'content-type: application/json' -d '{"action":"send","text":"src/data/todos.ts 봐줘"}' > /dev/null
sleep 1
echo "--- 언급(touched) 후: 200 이어야 함"
curl -s -o /dev/null -w '%{http_code}\n' localhost:4399/rawpreview/src/data/todos.ts
echo "--- traversal은 여전히 404"
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:4399/rawpreview/../../etc/passwd'
kill $(cat /tmp/dw-agent-smoke.pid)
```
Expected: `404` → `200` → `404`
(참고: mock 어댑터는 assistant_text에 사용자 텍스트를 에코하므로 `src/data/todos.ts` 언급이 file-links를 통해 touched에 들어간다.)

- [ ] **Step 4: typecheck 후 Commit**

```bash
npm run typecheck
git add src/pages/rawpreview/
git commit -m "feat(agent): open agent-touched files via rawpreview + source langs"
```

---

### Task 8: ChatPanel UI + monitor.astro 탭 통합

**Files:**
- Create: `src/components/ChatPanel.astro`
- Modify: `src/pages/monitor.astro` (col2 탭 구조, relToUrl 맵, select() 완화, window 노출)
- Modify: `tests/e2e/monitor.spec.ts` (상세 패널 단정에 탭 클릭 추가)

**Interfaces:**
- Consumes: HTTP 계약(Task 6), `AgentEvent` 스키마(Task 1)
- Produces: 전역 함수 `window.dwSelect(url)` (기존 select 노출), `window.dwShowTab('chat'|'detail')`. ChatPanel은 prop `relMap: Record<string,string>` (rel → 프리뷰 URL; 미등록 rel은 `/rawpreview/<rel>` 폴백).

- [ ] **Step 1: monitor.astro — relToUrl 맵과 탭 마크업**

frontmatter 끝(`const docsTotal…` 근처)에 추가:

```ts
const relToUrl: Record<string, string> = {};
for (const d of docSources) relToUrl[d.rel] = `/preview/${d.id}`;
for (const w of watchedDetails) relToUrl[w.rel] = w.preview;
```

`<section class="monitor-col col-two">…</section>` 블록을 다음으로 교체 (ChatPanel import는 frontmatter에 `import ChatPanel from '@/components/ChatPanel.astro';`):

```astro
  <section class="monitor-col col-two">
    <div class="col2-tabs" role="tablist">
      <button id="tab-chat" class="col2-tab active" type="button" role="tab">대화<span id="chat-dot" class="chat-dot idle"></span></button>
      <button id="tab-detail" class="col2-tab" type="button" role="tab">상세</button>
    </div>
    <ChatPanel relMap={relToUrl} />
    <div id="detail-pane" hidden>
      <div class="empty-state">타임라인·트리에서 파일을 선택하세요</div>
    </div>
  </section>
```

- [ ] **Step 2: monitor.astro — 탭 스타일 추가** (`<style is:global>` 안)

```css
    .col2-tabs { flex: none; display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
    .col2-tab { border: 0; cursor: pointer; font: 600 11px/1 var(--md-sys-typescale-plain-font); letter-spacing: .5px; padding: 8px 14px; border-radius: 8px 8px 0 0; background: transparent; color: var(--md-sys-color-on-surface-variant); display: inline-flex; align-items: center; gap: 6px; }
    .col2-tab.active { background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); }
    .chat-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--md-sys-color-outline); }
    .chat-dot.running { background: var(--dw-green-dot); animation: dashBlink 1.4s ease-in-out infinite; }
    .chat-dot.error { background: var(--dw-red); }
    #detail-pane[hidden] { display: none; }
```

- [ ] **Step 3: monitor.astro — 클라이언트 스크립트 수정**

기존 `<script>` 안에서:

(a) `select` 함수를 아래로 교체 — 미등록 URL(세션 터치 소스 파일)도 열리게 하고, 열기 시 상세 탭으로 전환:

```js
    function select(url, target) {
      if (!url) return;
      if (!(url.startsWith('/preview/') || url.startsWith('/rawpreview/'))) return;
      document.querySelectorAll('[data-preview].sel').forEach(node => node.classList.remove('sel'));
      if (target instanceof HTMLElement) target.classList.add('sel');
      if (details[url]) {
        fillDetail(url);
        window.dwShowTab?.('detail');
      }
      if (frame instanceof HTMLIFrameElement && col3Empty) {
        frame.src = url;
        frame.hidden = false;
        col3Empty.hidden = true;
      }
      history.replaceState(null, '', '?doc=' + encodeURIComponent(url));
    }
```

(b) 스크립트 끝(DOMContentLoaded 리스너 앞)에 탭 로직 + 전역 노출 추가:

```js
    const tabChat = document.getElementById('tab-chat');
    const tabDetail = document.getElementById('tab-detail');
    const chatPane = document.getElementById('chat-pane');

    function showTab(name) {
      const isChat = name === 'chat';
      if (chatPane) chatPane.hidden = !isChat;
      if (detailPane) detailPane.hidden = isChat;
      tabChat?.classList.toggle('active', isChat);
      tabDetail?.classList.toggle('active', !isChat);
    }
    tabChat?.addEventListener('click', () => showTab('chat'));
    tabDetail?.addEventListener('click', () => showTab('detail'));

    window.dwSelect = select;
    window.dwShowTab = showTab;
```

(c) `?doc=` 재수화(DOMContentLoaded 내부)는 그대로 두되, select가 상세 탭 전환을 담당하므로 변경 불필요.

- [ ] **Step 4: ChatPanel.astro 작성**

```astro
---
// src/components/ChatPanel.astro — col2 대화 탭. 기본 표시(hidden 아님).
const { relMap = {} } = Astro.props as { relMap?: Record<string, string> };
const relJson = JSON.stringify(relMap).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
---
<div id="chat-pane">
  <div class="chat-sessions">
    <button id="session-toggle" type="button" title="세션 선택">
      <span id="session-name">세션 없음</span><span class="sess-caret">▾</span>
    </button>
    <button id="session-rename" type="button" title="세션 이름 변경">✎</button>
    <button id="session-new" type="button" title="새 세션">＋</button>
    <div id="session-menu" hidden></div>
  </div>
  <div id="chat-log">
    <div class="empty-state" id="chat-empty">첫 프롬프트를 보내면 세션이 시작됩니다.</div>
  </div>
  <form id="chat-form">
    <textarea id="chat-input" rows="2" placeholder="프롬프트 입력… (Enter 전송, Shift+Enter 줄바꿈)"></textarea>
    <div class="chat-actions">
      <button id="chat-stop" type="button" hidden>■ 중지</button>
      <button id="chat-send" type="submit">전송</button>
    </div>
  </form>
</div>

<script id="dw-rel-map" type="application/json" set:html={relJson}></script>

<style is:global>
  #chat-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  #chat-pane[hidden] { display: none; }
  .chat-sessions { flex: none; position: relative; display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
  #session-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; border: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); border-radius: 8px; padding: 6px 10px; cursor: pointer; font: 500 12px/1.2 var(--md-sys-typescale-mono-font); }
  #session-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .sess-caret { flex: none; opacity: .6; }
  #session-rename, #session-new { flex: none; border: 1px solid var(--md-sys-color-outline-variant); background: transparent; color: var(--md-sys-color-on-surface-variant); border-radius: 8px; width: 30px; height: 30px; cursor: pointer; }
  #session-rename:hover, #session-new:hover { background: var(--md-sys-color-surface-container-high); }
  #session-menu { position: absolute; top: 44px; left: 10px; right: 10px; z-index: 30; max-height: 40vh; overflow-y: auto; background: var(--md-sys-color-surface-container-high); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.25); padding: 4px; }
  #session-menu[hidden] { display: none; }
  .sess-item { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: var(--md-sys-color-on-surface); padding: 8px 10px; border-radius: 7px; cursor: pointer; text-align: left; }
  .sess-item:hover { background: var(--md-sys-color-surface-container-highest); }
  .sess-item.current { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
  .sess-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 12px/1.2 var(--md-sys-typescale-mono-font); }
  .sess-item-meta { flex: none; font-size: 10px; color: var(--md-sys-color-on-surface-variant); }
  #chat-log { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .bubble { max-width: 92%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .bubble.me { align-self: flex-end; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); border-bottom-right-radius: 4px; }
  .bubble.ai { align-self: flex-start; background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); border-bottom-left-radius: 4px; }
  .bubble.sys-error { align-self: stretch; background: var(--dw-red-bg); color: var(--dw-red); font-family: var(--md-sys-typescale-mono-font); font-size: 11.5px; }
  .tool-card { align-self: flex-start; max-width: 92%; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container-low); font-family: var(--md-sys-typescale-mono-font); font-size: 11.5px; overflow: hidden; }
  .tool-card-head { display: flex; align-items: center; gap: 7px; padding: 5px 10px; cursor: pointer; }
  .tool-icon { flex: none; }
  .tool-card.mod { border-color: var(--dw-orange-border); }
  .tool-card.mod .tool-card-head { background: var(--dw-orange-bg); color: var(--dw-orange); }
  .tool-card.bash .tool-card-head { color: var(--md-sys-color-primary); }
  .tool-card.task .tool-card-head { color: var(--md-sys-color-tertiary); }
  .tool-card.read .tool-card-head { color: var(--md-sys-color-on-surface-variant); }
  .tool-result { border-top: 1px dashed var(--md-sys-color-outline-variant); padding: 6px 10px; white-space: pre-wrap; word-break: break-word; color: var(--md-sys-color-on-surface-variant); max-height: 180px; overflow-y: auto; }
  .tool-result.error { color: var(--dw-red); background: var(--dw-red-bg); }
  .tool-result[hidden] { display: none; }
  .status-foot { align-self: center; font-size: 10.5px; color: var(--md-sys-color-on-surface-variant); font-family: var(--md-sys-typescale-mono-font); padding: 2px 0 6px; }
  .chat-spin { align-self: flex-start; color: var(--md-sys-color-on-surface-variant); font-size: 12px; animation: dashBlink 1.2s ease-in-out infinite; }
  .dw-link { color: inherit; text-decoration: none; border-bottom: 1px dotted var(--md-sys-color-outline); cursor: text; }
  .dw-link:hover { border-bottom-style: solid; }
  #chat-log.ctrl .dw-link:hover, #chat-log.ctrl [data-rel]:hover { cursor: pointer; text-decoration: underline; }
  #chat-form { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 10px; border-top: 1px solid var(--md-sys-color-outline-variant); }
  #chat-input { resize: none; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 10px; background: var(--md-sys-color-surface-container-lowest); color: var(--md-sys-color-on-surface); padding: 9px 12px; font: 13px/1.5 var(--md-sys-typescale-plain-font); }
  #chat-input:focus { outline: 2px solid var(--md-sys-color-primary); outline-offset: -1px; }
  #chat-input:disabled { opacity: .55; }
  .chat-actions { display: flex; justify-content: flex-end; gap: 8px; }
  #chat-send { border: 0; border-radius: 999px; padding: 7px 18px; background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); font-weight: 600; font-size: 12.5px; cursor: pointer; }
  #chat-send:disabled { opacity: .5; cursor: default; }
  #chat-stop { border: 1px solid var(--dw-red); border-radius: 999px; padding: 7px 14px; background: var(--dw-red-bg); color: var(--dw-red); font-weight: 600; font-size: 12.5px; cursor: pointer; }
  #chat-stop[hidden] { display: none; }
</style>

<script>
  const relMapEl = document.getElementById('dw-rel-map');
  const relMap = relMapEl?.textContent ? JSON.parse(relMapEl.textContent) : {};
  const log = document.getElementById('chat-log');
  const empty = document.getElementById('chat-empty');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const stopBtn = document.getElementById('chat-stop');
  const dot = document.getElementById('chat-dot');
  const sessName = document.getElementById('session-name');
  const sessToggle = document.getElementById('session-toggle');
  const sessMenu = document.getElementById('session-menu');
  const sessRename = document.getElementById('session-rename');
  const sessNew = document.getElementById('session-new');

  let lastSeq = 0;
  let currentSessionId = null;
  let spinner = null;
  const cards = new Map(); // tool_use id → card element

  const urlFor = rel => relMap[rel] ?? '/rawpreview/' + rel;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function openRel(rel, line) {
    void line; // v1: 줄 스크롤은 미지원 (프리뷰 문서 전체 표시)
    window.dwSelect?.(urlFor(rel));
  }

  function setState(state) {
    const running = state === 'running';
    if (input) input.disabled = running;
    if (sendBtn) sendBtn.disabled = running;
    if (stopBtn) stopBtn.hidden = !running;
    if (dot) dot.className = 'chat-dot ' + (running ? 'running' : state === 'error' ? 'error' : 'idle');
    if (running && log && !spinner) {
      spinner = el('div', 'chat-spin', '● 에이전트 작업 중…');
      log.append(spinner);
      log.scrollTop = log.scrollHeight;
    } else if (!running && spinner) {
      spinner.remove();
      spinner = null;
    }
  }

  function linkedText(text, links) {
    const wrap = el('span');
    let rest = text;
    const parts = [];
    for (const link of links ?? []) {
      const idx = rest.indexOf(link.text);
      if (idx === -1) continue;
      parts.push(document.createTextNode(rest.slice(0, idx)));
      const a = el('a', 'dw-link', link.text);
      a.dataset.rel = link.rel;
      if (link.line) a.dataset.line = String(link.line);
      a.title = 'Ctrl+클릭으로 열기';
      parts.push(a);
      rest = rest.slice(idx + link.text.length);
    }
    parts.push(document.createTextNode(rest));
    wrap.append(...parts);
    return wrap;
  }

  function toolClass(tool) {
    if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'mod';
    if (tool === 'Bash') return 'bash';
    if (tool === 'Task') return 'task';
    return 'read';
  }
  function toolIcon(cls) {
    return cls === 'mod' ? '✎' : cls === 'bash' ? '❯' : cls === 'task' ? '⚡' : '⚙';
  }

  function addEvent(e) {
    if (!log || e.seq <= lastSeq) return;
    lastSeq = e.seq;
    if (empty) empty.hidden = true;

    if (e.kind === 'user_text') {
      log.append(Object.assign(el('div', 'bubble me'), { textContent: e.text }));
    } else if (e.kind === 'assistant_text') {
      const b = el('div', 'bubble ai');
      b.append(linkedText(e.text, e.links));
      log.append(b);
    } else if (e.kind === 'tool_use') {
      const cls = toolClass(e.tool);
      const card = el('div', `tool-card ${cls}`);
      const head = el('div', 'tool-card-head');
      head.append(el('span', 'tool-icon', toolIcon(cls)), el('span', '', e.summary));
      if (e.filePath) { card.dataset.rel = e.filePath; head.title = 'Ctrl+클릭으로 열기 · 클릭으로 결과 펼치기'; }
      card.append(head);
      cards.set(e.id, card);
      log.append(card);
    } else if (e.kind === 'tool_result') {
      const card = cards.get(e.forId);
      if (card) {
        const body = el('div', `tool-result${e.isError ? ' error' : ''}`, e.excerpt || '(출력 없음)');
        body.hidden = true;
        card.append(body);
      }
    } else if (e.kind === 'status') {
      if (e.state === 'done') {
        const cost = e.costUsd !== undefined ? ` · $${e.costUsd.toFixed(2)}` : '';
        const dur = e.durationMs !== undefined ? ` · ${Math.round(e.durationMs / 1000)}s` : '';
        log.append(el('div', 'status-foot', `✔ 완료${dur}${cost}`));
      } else if (e.state === 'error' && e.message) {
        log.append(el('div', 'bubble sys-error', e.message));
      }
      setState(e.state);
    }
    log.scrollTop = log.scrollHeight;
  }

  function resetLog() {
    if (!log) return;
    log.replaceChildren();
    cards.clear();
    lastSeq = 0;
    spinner = null;
    const emptyNode = el('div', 'empty-state', '첫 프롬프트를 보내면 세션이 시작됩니다.');
    emptyNode.id = 'chat-empty';
    log.append(emptyNode);
  }

  async function loadState() {
    try {
      const res = await fetch('/api/agent', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      currentSessionId = data.sessionId;
      resetLog();
      data.events.forEach(addEvent);
      setState(data.state);
    } catch {}
  }

  async function post(body) {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res;
  }

  // ---- 세션 스위처 ----
  function agoText(ms) {
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
  }

  async function loadSessions() {
    if (!sessMenu) return;
    sessMenu.replaceChildren(el('div', 'sess-item-meta', '불러오는 중…'));
    try {
      const res = await fetch('/api/agent/sessions', { cache: 'no-store' });
      const sessions = await res.json();
      sessMenu.replaceChildren();
      if (!sessions.length) { sessMenu.append(el('div', 'sess-item-meta', '세션이 없습니다')); return; }
      for (const s of sessions) {
        const item = el('button', 'sess-item' + (s.id === currentSessionId ? ' current' : ''));
        item.type = 'button';
        item.dataset.sessionId = s.id;
        item.append(el('span', 'sess-item-name', s.name), el('span', 'sess-item-meta', `${agoText(s.mtime)} · ${s.messageCount}msg`));
        item.addEventListener('click', async () => {
          sessMenu.hidden = true;
          await post({ action: 'select', sessionId: s.id });
          if (sessName) sessName.textContent = s.name;
          await loadState();
        });
        sessMenu.append(item);
      }
    } catch {
      sessMenu.replaceChildren(el('div', 'sess-item-meta', '목록을 불러오지 못했습니다'));
    }
  }

  sessToggle?.addEventListener('click', async () => {
    if (!sessMenu) return;
    sessMenu.hidden = !sessMenu.hidden;
    if (!sessMenu.hidden) await loadSessions();
  });
  document.addEventListener('click', e => {
    if (sessMenu && !sessMenu.hidden && e.target instanceof Node && !sessMenu.contains(e.target) && !sessToggle?.contains(e.target)) sessMenu.hidden = true;
  });

  sessNew?.addEventListener('click', async () => {
    await post({ action: 'new' });
    currentSessionId = null;
    if (sessName) sessName.textContent = '새 세션';
    resetLog();
    setState('idle');
  });

  sessRename?.addEventListener('click', () => {
    if (!currentSessionId || !sessName) return;
    const inputEl = el('input');
    inputEl.value = sessName.textContent ?? '';
    inputEl.style.cssText = 'width:100%;font:inherit;background:transparent;color:inherit;border:1px solid var(--md-sys-color-primary);border-radius:4px;padding:1px 4px;';
    sessName.replaceChildren(inputEl);
    inputEl.focus();
    inputEl.select();
    const commit = async () => {
      const name = inputEl.value.trim();
      if (name && currentSessionId) {
        await post({ action: 'rename', sessionId: currentSessionId, name });
        sessName.textContent = name;
      } else {
        sessName.textContent = inputEl.defaultValue || '세션 없음';
      }
    };
    inputEl.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); void commit(); }
      if (ev.key === 'Escape') sessName.textContent = inputEl.defaultValue || '세션 없음';
    });
    inputEl.addEventListener('blur', () => void commit());
  });

  // ---- 전송/중지 ----
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
    if (!text) return;
    const res = await post({ action: 'send', text });
    if (res.status === 409) return; // busy — running 상태가 곧 SSE로 반영됨
    if (input instanceof HTMLTextAreaElement) input.value = '';
  });
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form?.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  stopBtn?.addEventListener('click', () => void post({ action: 'stop' }));

  // ---- Ctrl/Cmd+Click 파일 열기 (일반 클릭 = 결과 토글만) ----
  log?.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const linked = target.closest('[data-rel]');
    if (linked && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openRel(linked.getAttribute('data-rel'), linked.getAttribute('data-line'));
      return;
    }
    const head = target.closest('.tool-card-head');
    if (head) {
      const result = head.parentElement?.querySelector('.tool-result');
      if (result) result.hidden = !result.hidden;
    }
  });
  // Ctrl/Cmd 누른 동안 링크에 pointer 커서
  const setCtrl = on => log?.classList.toggle('ctrl', on);
  document.addEventListener('keydown', e => { if (e.key === 'Control' || e.key === 'Meta') setCtrl(true); });
  document.addEventListener('keyup', e => { if (e.key === 'Control' || e.key === 'Meta') setCtrl(false); });
  window.addEventListener('blur', () => setCtrl(false));

  // ---- 초기화 + SSE ----
  document.addEventListener('DOMContentLoaded', () => {
    void loadState().then(async () => {
      // 현재 세션 이름 표시
      if (currentSessionId) {
        try {
          const sessions = await (await fetch('/api/agent/sessions', { cache: 'no-store' })).json();
          const cur = sessions.find(s => s.id === currentSessionId);
          if (cur && sessName) sessName.textContent = cur.name;
        } catch {}
      }
    });
    if (typeof EventSource !== 'undefined') {
      const stream = new EventSource('/api/agent-stream');
      stream.onmessage = event => { try { addEvent(JSON.parse(event.data)); } catch {} };
      // 재연결 시 놓친 이벤트 보정
      stream.onopen = () => { if (lastSeq > 0) void loadState(); };
    }
  });
</script>
```

- [ ] **Step 5: 기존 e2e 단정 수정** — `tests/e2e/monitor.spec.ts`

`monitor loads` 테스트에서 `#detail-pane .empty-state` 단정 앞에 탭 클릭 추가:

```ts
test('monitor loads', async ({ page }) => {
  await page.goto('/monitor');

  await expect(page.locator('.monitor-col')).toHaveCount(3);
  expect(await page.locator('.stat-chip').count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#doc-frame')).toBeAttached();
  await expect(page.locator('#chat-pane')).toBeVisible();          // 대화 탭이 기본
  await page.locator('#tab-detail').click();
  await expect(page.locator('#detail-pane .empty-state')).toBeVisible();
  await expect(page.locator('#col3-empty')).toBeVisible();
});
```

다른 테스트는 파일 선택 시 select()가 상세 탭을 자동 활성화하므로 수정 불필요.

- [ ] **Step 6: 검증 — 기존 e2e 전체 (mock 모드 서버는 Task 9에서 배선; 여기선 일반 모드로 회귀만)**

Run:
```bash
cd /home/ysj/docwatch && bash tests/fixtures/setup-sample-repo.sh .spike/target && rm -rf .astro && npm run test:e2e
```
Expected: 기존 18 테스트 전부 PASS (대화 기능 e2e는 Task 9)

- [ ] **Step 7: typecheck 후 Commit**

```bash
npm run typecheck
git add src/components/ChatPanel.astro src/pages/monitor.astro tests/e2e/monitor.spec.ts
git commit -m "feat(agent): chat panel UI with tabs, ctrl-click file open"
```

---

### Task 9: e2e — mock 모드 배선 + 대화/세션 시나리오

**Files:**
- Modify: `playwright.config.ts` (webServer에 mock env)
- Modify: `tests/fixtures/setup-sample-repo.sh` (가짜 세션 jsonl 픽스처 생성)
- Create: `tests/e2e/agent.spec.ts`

**Interfaces:**
- Consumes: Task 1–8 전부 (전체 파이프라인 e2e)
- Produces: 없음 (검증)

- [ ] **Step 1: playwright.config.ts webServer 명령에 env 추가**

```ts
    command: `DOCWATCH_AGENT=mock DOCWATCH_CLAUDE_DIR=tests/fixtures/claude-projects node bin/cli.mjs ${target} --no-open --port 4321`,
```

- [ ] **Step 2: setup-sample-repo.sh에 세션 픽스처 생성 추가**

스크립트 상단 `DEST="${1:-…}"` 다음 줄에 `ROOT="$PWD"` 추가. 파일 끝에 append:

```bash
# --- claude 세션 픽스처 (agent e2e: DOCWATCH_CLAUDE_DIR=tests/fixtures/claude-projects) ---
ESC="$(printf '%s' "$PWD" | sed 's|[/.]|-|g')"
FIX="$ROOT/tests/fixtures/claude-projects/$ESC"
rm -rf "$FIX"; mkdir -p "$FIX"
cat > "$FIX/aaaa1111-0000-0000-0000-000000000001.jsonl" <<'EOF'
{"type":"custom-title","customTitle":"fix-login-bug","sessionId":"aaaa1111-0000-0000-0000-000000000001"}
{"type":"user","message":{"role":"user","content":"로그인 버그 고쳐줘"},"timestamp":"2026-07-09T01:00:00.000Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"src/app.ts 를 확인했습니다."}]},"timestamp":"2026-07-09T01:00:05.000Z"}
EOF
cat > "$FIX/bbbb2222-0000-0000-0000-000000000002.jsonl" <<'EOF'
{"type":"user","message":{"role":"user","content":"모니터 레이아웃 개선 논의"},"timestamp":"2026-07-08T01:00:00.000Z"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"네, 시작하겠습니다."}]},"timestamp":"2026-07-08T01:00:03.000Z"}
EOF
touch -d '1 day ago' "$FIX/bbbb2222-0000-0000-0000-000000000002.jsonl"
```

- [ ] **Step 3: agent.spec.ts 작성**

```ts
// tests/e2e/agent.spec.ts
import { expect, test } from '@playwright/test';

// 각 테스트를 깨끗한 세션에서 시작
test.beforeEach(async ({ page }) => {
  await page.request.post('/api/agent', { data: { action: 'new' } });
  await page.goto('/monitor');
});

test('대화 탭이 기본으로 보이고 placeholder가 있다', async ({ page }) => {
  await expect(page.locator('#chat-pane')).toBeVisible();
  await expect(page.locator('#detail-pane')).toBeHidden();
  await expect(page.locator('#chat-empty')).toBeVisible();
});

test('프롬프트 전송 → 버블·툴 카드·완료 푸터가 렌더된다', async ({ page }) => {
  await page.locator('#chat-input').fill('버그 고쳐줘');
  await page.locator('#chat-send').click();

  await expect(page.locator('.bubble.me')).toHaveText('버그 고쳐줘');
  await expect(page.locator('.tool-card.read .tool-card-head')).toContainText('Read src/app.ts');
  await expect(page.locator('.tool-card.mod .tool-card-head')).toContainText('Edit src/app.ts');
  await expect(page.locator('.bubble.ai')).toContainText('README.md');
  await expect(page.locator('.status-foot')).toContainText('완료');
});

test('Ctrl+클릭만 파일을 열고 일반 클릭은 열지 않는다', async ({ page }) => {
  await page.locator('#chat-input').fill('열기 테스트');
  await page.locator('#chat-send').click();
  const link = page.locator('.bubble.ai .dw-link', { hasText: 'src/app.ts' });
  await expect(link).toBeVisible();

  await link.click(); // 일반 클릭 — 아무 일도 없어야
  await expect(page.locator('#col3-empty')).toBeVisible();

  await link.click({ modifiers: ['Control'] });
  await expect(page.locator('#doc-frame')).toHaveAttribute('src', /\/rawpreview\/src\/app\.ts/);
  await expect(page.frameLocator('#doc-frame').locator('pre').first()).toBeVisible();
});

test('툴 카드: 일반 클릭 = 결과 토글, Ctrl+클릭 = 파일 열기', async ({ page }) => {
  await page.locator('#chat-input').fill('카드 테스트');
  await page.locator('#chat-send').click();
  const card = page.locator('.tool-card.mod');
  await expect(card).toBeVisible();
  await expect(card.locator('.tool-result')).toBeHidden();

  await card.locator('.tool-card-head').click();
  await expect(card.locator('.tool-result')).toBeVisible();

  await card.locator('.tool-card-head').click({ modifiers: ['Control'] });
  await expect(page.locator('#doc-frame')).toHaveAttribute('src', /\/rawpreview\/src\/app\.ts/);
});

test('세션 목록·전환·과거 대화 렌더', async ({ page }) => {
  await page.locator('#session-toggle').click();
  const items = page.locator('.sess-item');
  await expect(items).toHaveCount(2);
  await expect(items.first().locator('.sess-item-name')).toHaveText('fix-login-bug');
  // custom-title 없는 세션은 첫 프롬프트가 이름
  await expect(items.nth(1).locator('.sess-item-name')).toHaveText('모니터 레이아웃 개선 논의');

  await items.first().click();
  await expect(page.locator('#session-name')).toHaveText('fix-login-bug');
  await expect(page.locator('.bubble.me')).toHaveText('로그인 버그 고쳐줘');
  await expect(page.locator('.bubble.ai')).toContainText('src/app.ts');
});

test('rename이 UI와 세션 목록에 반영된다', async ({ page }) => {
  await page.locator('#session-toggle').click();
  await page.locator('.sess-item').first().click();
  await page.locator('#session-rename').click();
  const inputEl = page.locator('#session-name input');
  await inputEl.fill('로그인-수정-세션');
  await inputEl.press('Enter');
  await expect(page.locator('#session-name')).toHaveText('로그인-수정-세션');

  await page.locator('#session-toggle').click();
  await expect(page.locator('.sess-item').first().locator('.sess-item-name')).toHaveText('로그인-수정-세션');
});

test('새 세션 버튼이 대화를 비운다', async ({ page }) => {
  await page.locator('#chat-input').fill('안녕');
  await page.locator('#chat-send').click();
  await expect(page.locator('.bubble.me')).toBeVisible();

  await page.locator('#session-new').click();
  await expect(page.locator('.bubble.me')).toHaveCount(0);
  await expect(page.locator('#chat-empty')).toBeVisible();
});

test('레일에서 파일 선택 시 상세 탭으로 전환된다 (기존 흐름 보존)', async ({ page }) => {
  await page.locator('.tree-row.file[data-preview="/preview/readme"]').click();
  await expect(page.locator('#detail-pane')).toBeVisible();
  await expect(page.locator('#chat-pane')).toBeHidden();
  await page.locator('#tab-chat').click();
  await expect(page.locator('#chat-pane')).toBeVisible();
});
```

- [ ] **Step 4: 전체 게이트 실행**

Run:
```bash
cd /home/ysj/docwatch && bash tests/fixtures/setup-sample-repo.sh .spike/target && rm -rf .astro && \
npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e
```
Expected: typecheck 0 에러 / unit·integration 전부 PASS / e2e 18(기존)+8(신규)=26 PASS

주의: rename 테스트가 픽스처 jsonl에 append하므로 e2e 재실행 전 setup-sample-repo.sh를 다시 돌려 픽스처를 리셋할 것 (위 명령이 이미 포함).

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/fixtures/setup-sample-repo.sh tests/e2e/agent.spec.ts
git commit -m "test(agent): e2e for chat, ctrl-click open, and session navigation"
```

---

### Task 10: README + 실 claude 수동 스모크

**Files:**
- Modify: `README.md` (에이전트 대화 섹션 + 보안 경고)

**Interfaces:**
- Consumes: 완성된 전체 기능
- Produces: 문서 + 실기 검증 증거

- [ ] **Step 1: README에 섹션 추가** (Views 섹션 아래)

```markdown
## Agent chat (실험적)

`/monitor`의 가운데 컬럼 **대화 탭**에서 Claude Code 세션을 직접 실행합니다.
docwatch가 `claude` CLI를 spawn하고(타겟 레포 cwd, `--permission-mode acceptEdits`),
에이전트의 텍스트·툴 사용·결과를 실시간으로 보여줍니다. 에이전트가 파일을 고치면
좌측 타임라인/NEW/MOD가 즉시 반응합니다.

- **요구**: `claude` CLI 설치 + 로그인 (`claude login`)
- **세션**: `~/.claude/projects/`의 세션 풀을 터미널과 공유 — 웹에서 시작한 세션을
  `claude -r`로 잇거나, 터미널 세션을 웹에서 resume할 수 있습니다.
  드롭다운에서 세션 전환, ✎로 이름 변경, ＋로 새 세션.
- **파일 열기**: 대화에 언급된 파일·툴 카드는 **Ctrl+클릭**(mac: Cmd+클릭)으로
  우측 프리뷰에 열립니다.
- **중지**: 실행 중 ■ 중지 버튼 (SIGINT).

> ⚠️ **보안**: 대화 API에는 인증이 없습니다. `--host 0.0.0.0`으로 열면 네트워크의
> 누구나 이 레포에서 에이전트를 실행(= 파일 수정)할 수 있습니다. 기본값(localhost)
> 밖으로 열지 마세요. 사람의 UI는 여전히 읽기 전용이며, 파일 변경은 에이전트만
> 수행합니다.
```

- [ ] **Step 2: 실 claude 수동 스모크** (mock 아님 — 실제 연동 1회 검증)

Run:
```bash
cd /home/ysj/docwatch && rm -rf .astro && \
node bin/cli.mjs "$PWD" --no-open --port 4399 & echo $! > /tmp/dw-agent-smoke.pid
sleep 8
curl -s -X POST localhost:4399/api/agent -H 'content-type: application/json' \
  -d '{"action":"send","text":"README.md 의 첫 헤딩만 알려줘. 파일 수정은 하지 마."}'
sleep 30
curl -s localhost:4399/api/agent | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('state:', d['state'])
print('sessionId:', d['sessionId'])
for e in d['events']: print(' -', e['kind'], (e.get('summary') or e.get('text') or '')[:60])
"
kill $(cat /tmp/dw-agent-smoke.pid)
```
Expected: `state: done`, sessionId가 UUID, 이벤트에 user_text → status(running) → (tool_use Read README.md) → assistant_text → status(done). 실패 시 stderr 카드 내용으로 진단.

- [ ] **Step 3: 브라우저 수동 확인** — `http://localhost:4321/monitor` (일반 모드 서버)에서 대화 탭 열고 짧은 프롬프트 1회: 버블/카드/Ctrl+클릭/세션 드롭다운/rename이 눈으로 동작하는지. 터미널에서 `claude -r`을 열어 웹에서 만든 세션이 피커에 (rename된 이름으로) 보이는지 확인.

- [ ] **Step 4: Commit + 푸시**

```bash
git add README.md
git commit -m "docs: agent chat usage and security warning"
git push
```

---

## Self-Review 결과 (계획 작성 후 점검)

- **스펙 커버리지**: 섹션1(아키텍처)→Task 4·5, 섹션2(UI·링크)→Task 3·7·8, 섹션3(API·수명주기)→Task 5·6, 섹션4(에러·테스트)→Task 1·4·9, 섹션5(세션 관리)→Task 2·8·9. 스코프 아웃 항목은 어느 태스크에도 없음. ✔
- **의도적 스펙 편차 2건**은 문서 상단 "사전 확인된 사실"에 명시 (sessions/[id] 라우트 대체, status.message 필드). ✔
- **타입 일관성**: `AgentEventDraft`(seq 없음, ts 있음)를 파서·어댑터·트랜스크립트가 공유, seq는 manager.push만 부여. `filePath`는 어댑터에서 abs 가능 → manager가 rel로 정규화. e2e의 셀렉터가 Task 8 마크업의 id/class와 일치함을 교차 확인. ✔
