---
name: docview
date: 2026-07-03
status: draft
authors:
  - user (product)
  - Claude Opus 4.8 (spec)
tags: [design, spec, mvp]
---

# docview — Claude Code 프로젝트를 위한 로컬 라이브 문서 뷰어

## Summary (한 문단)

**docview** 는 Claude Code 로 개발할 때 프로젝트 곳곳에 흩어지는 문서(ADR/PRD/plans/AGENTS·CLAUDE.md 등)와 개발 흐름을 **로컬 브라우저에서 실시간으로** 조망하기 위한 뷰어다. Astro + Starlight 스택을 사용하고, `astro dev` 를 프로덕트 자체로 상시 실행한다. 파일이 저장되는 순간 브라우저에 즉시 반영된다. 별도 배포는 MVP 범위 밖이다.

## Problem

프롬프트 중심으로 개발하는 사용자에게서 관찰된 페인 포인트:

1. **코드는 거의 안 봄** — Claude Code 가 코드를 쓰므로 코드 에디터가 사실상 불필요.
2. **개발 흐름 시각화 불가** — 터미널·에디터 UI 에서는 "지금 뭐가 일어나는가"·"어디까지 왔는가" 를 한눈에 볼 수 없다.
3. **생성된 문서 열람 번거로움** — 마크다운을 에디터에서 raw 로 읽는 UX 가 나쁨.
4. **문서 분산** — `docs/`, `.omc/`, `.claude/plans/`, 루트 `AGENTS.md`/`README.md`/`CLAUDE.md` 등에 흩어져 통합 파악이 어렵다.

**docview 는 이 네 가지를 해결하는 로컬 라이브 뷰어다.**

## Non-goals (YAGNI 명시)

- 브라우저 내 코드 편집.
- 다중 사용자 / 실서비스 호스팅 / 인증.
- 자동 생성 아키텍처 다이어그램 (repo scan → mermaid). v1.2 이후 검토.
- 프로덕션 정적 배포 (GitHub Pages 등). v1.1 이후 검토.
- 실시간 협업.
- 코드 인덱싱 (심볼 검색 등). 문서 전용 뷰어.

## Architecture

### 전략

- **로컬 라이브 서버 = 프로덕트**. `astro dev` 를 지속 실행하고 브라우저 탭을 상시 열어둔다.
- **파일 워칭 기반 실시간 갱신**. chokidar 로 md · `.git` 변화를 감지해 캐시를 무효화하고 Vite HMR 을 통해 브라우저를 갱신.
- **임베드 모델**. target repo (예: Glance) 안에 `docview/` 폴더로 존재. 다른 repo 에는 폴더 복사로 이식.

### 스택

- **Astro 4+** — 정적 사이트 생성기이자 dev 서버.
- **Starlight** — 문서 사이드바 · 검색(pagefind) · 다크모드 등 문서 UX 기본 제공.
- **chokidar** — 파일 워칭.
- **Vitest** — 유닛/통합 테스트.
- **Playwright** — E2E.
- Node 18+ 요구.

### Target repo 관점의 디렉터리 구조

```
<any-project>/                      ← target repo (e.g. Glance)
├── apps/                           ← 기존
├── docs/                           ← 기존 (ADR 소스)
├── AGENTS.md · README.md · CLAUDE.md
├── .omc/*.md                       ← 기존
├── .claude/plans/*.md              ← 기존
│
└── docview/                        ← ★ docview 임베드
    ├── package.json
    ├── astro.config.mjs
    ├── docview.config.ts           ← 유저 편집: glob · 카테고리 규칙
    ├── src/
    │   ├── content/config.ts       ← Collection + glob loader
    │   ├── data/
    │   │   ├── config.ts           ← docview.config.ts 로드 + 기본값 병합
    │   │   ├── scan.ts             ← git log · 체크박스 · 카테고리 집계
    │   │   └── watcher.ts          ← chokidar (dev only)
    │   ├── components/
    │   │   ├── LiveActivityBanner.astro
    │   │   ├── RecentTimeline.astro
    │   │   ├── CategoryCard.astro
    │   │   └── FilterPanel.astro
    │   ├── pages/
    │   │   ├── index.astro         ← /dashboard 리디렉트
    │   │   ├── dashboard.astro     ← 배너 + 2컬럼
    │   │   └── api/activity.json.ts ← Live activity endpoint
    │   └── layouts/
    ├── public/
    └── dist/                       ← gitignored
```

**이식 절차** (신규 repo X 도입):
1. `cp -r <docview-home>/docview X/`
2. `cd X/docview && npm install`
3. `docview.config.ts` 열어 glob 조정 (기본값이 대부분 그대로 통함)
4. `npm run dev`

## Components

### `data/config.ts`
- 목적: `docview.config.ts` 를 로드해 기본값과 병합, 다른 모듈에 타입 안전한 config 제공.
- 기본 include: `docs/**/*.md`, `AGENTS.md`, `README.md`, `CLAUDE.md`, `.omc/**/*.md`, `.claude/plans/*.md`.
- 기본 exclude: `**/node_modules/**`, `docview/**`, `.git/**`.
- 기본 카테고리 규칙 (순서대로 매치):
  ```ts
  [
    { name: 'ADR',   match: 'docs/adr/**',                       icon: '📐' },
    { name: 'PRD',   match: ['docs/prd*', '.omc/prd-*'],         icon: '📋' },
    { name: 'Plans', match: '.claude/plans/**',                  icon: '🗺' },
    { name: 'Root',  match: ['AGENTS.md','README.md','CLAUDE.md'], icon: '📄' },
  ]
  ```
  매치 없으면 target-repo 루트 기준 상대 경로의 **첫 세그먼트**로 fallback (예: `docs/foo/bar.md` → `docs`, `apps/backend/AGENTS.md` → `apps`, 루트의 `notes.md` → `Root`).

### `content/config.ts`
- Astro Content Collection + `glob` loader (Astro 4).
- Base = 상위 디렉터리 (`../`). Pattern = config.include.
- Frontmatter 스키마:
  ```ts
  z.object({
    title: z.string().optional(),
    status: z.enum(['draft','in-progress','done']).optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  ```
- Frontmatter 없는 md 는 auto-infer: title=H1 or 파일명, category=경로 규칙.

### `data/scan.ts`
순수 함수 4개.
- `scanGitLog(paths, opts)` — `git log --follow --pretty=format:%H|%an|%ar|%s -- <path>`, 파일별 최근 N개 커밋.
- `scanCheckboxes(mdContent)` → `{ total, checked }`. 코드블록 내 `- [ ]` 는 무시. 중첩 리스트 지원.
- `scanDirtyFiles()` — `git status --porcelain` 파싱.
- `aggregateByCategory(docs, rules)` — 문서 집합을 카테고리별로 그룹화, 체크박스 합계·비율 계산.
- 결과는 인메모리 Map 캐시 (파일 경로 → 결과).

### `data/watcher.ts`
- dev 모드에서만 활성 (Astro dev hook).
- chokidar 로 `../**/*.md` (include 패턴 준수), `../.git/HEAD`, `../.git/index` 워칭.
- 변경 감지 → 해당 캐시 엔트리 무효화 → Astro/Vite 재렌더 트리거.
- 옵션: `followSymlinks: false`, `awaitWriteFinish: { stabilityThreshold: 200 }`.

### `components/LiveActivityBanner.astro`
- 대시보드 최상단. 3섹션:
  1. **Dirty files** — `git status --porcelain` 결과, 파일별 상태 배지 (M/A/D/??). `config.include` 매치 여부와 무관하게 모든 dirty entry 표시 (문서 외 변경도 흐름 파악에 유용).
  2. **Recently modified** — `config.include` 매치 문서 중, 파일시스템 mtime 이 **지난 5분 이내** 인 것. 최대 10개, mtime 내림차순.
  3. **Active plan** — 우선순위대로 첫 매치:
     (a) `.claude/plans/*.md` 중 mtime 이 **지난 30분 이내** 인 최신 파일.
     (b) 위 (a) 가 없으면, `config.include` 매치 문서 중 mtime 이 지난 30분 이내인 최신 파일.
     (c) 둘 다 없으면 `null` (배너 이 섹션 숨김).
- 초기 SSR + 클라이언트 `fetch('/api/activity.json')` 5초 폴링.
- 각 항목 클릭 → 해당 문서 페이지로 이동.

### `components/RecentTimeline.astro`
- 좌측 컬럼. 최근 30-90일 커밋을 날짜별 그룹으로 표시.
- 커밋별: 짧은 메시지 + 관련 파일 링크.
- 정적 (HMR 로 갱신).

### `components/CategoryCard.astro`
- 우측 컬럼. 카테고리별 카드 하나:
  - 아이콘 + 이름
  - 문서 수
  - 진행률 프로그레스 바 (체크박스 집계 결과)
  - 클릭 → 필터 상태 = 이 카테고리로 문서 리스트 이동.

### `components/FilterPanel.astro`
- Starlight 사이드바 확장. 다중 필터: status · category · tags.
- 상태는 URL query string + LocalStorage 동기화.

### `pages/api/activity.json.ts`
- Astro server endpoint. dev 서버 프로세스 상에서 매 요청 실행.
- 반환:
  ```ts
  {
    dirty: Array<{ path: string; status: 'M'|'A'|'D'|'??' }>;
    recentlyModified: Array<{ path: string; mtime: number }>;
    activePlan: { path: string; title: string } | null;
    generatedAt: number;
  }
  ```
- 캐시 없음. `scan.ts` 함수 직접 호출.

### `pages/dashboard.astro`
- 레이아웃: 상단 `LiveActivityBanner`, 하단 2컬럼 (`RecentTimeline` 좌 · `CategoryCard` 카드 그리드 우).
- SSR 로 초기 데이터 확보 후 클라이언트 폴링으로 배너만 갱신.

### Starlight 사이드바에 `FilterPanel` 통합
- Starlight 의 `Sidebar` 슬롯 override.
- 상단에 필터 컨트롤, 아래에 자동 생성된 문서 트리 (카테고리별).

## Data flow

### 부팅

```
$ cd docview && npm run dev
   │
   ▼
Astro dev 부팅
   ├─ data/config.ts     → docview.config.ts 병합
   ├─ content/config.ts  → glob loader가 md 파일 인덱싱
   ├─ data/scan.ts       → git log · 체크박스 · 카테고리 초기 스캔 (인메모리)
   └─ data/watcher.ts    → chokidar 워칭 시작
   │
   ▼
http://localhost:4321 ready (~1-3초)
```

### 요청 (`/dashboard`)

```
Browser GET /dashboard
   │
   ▼
dashboard.astro (SSR)
   ├─ Content Collection에서 문서 메타 (캐시)
   ├─ scan.aggregateByCategory()   → 우측 카드
   ├─ scan.getRecentCommits()      → 좌측 타임라인
   └─ scan.getLiveActivity()       → 배너 초기값
   │
   ▼
HTML → Browser
   │
   ▼
Client: <LiveActivityBanner> 5초 폴링 시작
   → GET /api/activity.json → { dirty, recentlyMod, activePlan }
```

### 파일 변경 (핵심)

```
사용자/Claude가 md 파일 저장
   │
   ▼
chokidar 감지
   ├─ scan 캐시 항목 무효화 (해당 파일)
   ├─ Vite HMR 트리거
   │
   ▼
Astro dev: 페이지 재렌더링 데이터 갱신
   │
   ▼
브라우저 HMR: 대시보드 즉시 갱신 (~200-500ms)
   │
   ▼
다음 5초 폴링 시 dirty/recent 도 반영
```

### 카테고리 매칭

문서 파일 경로 → `config.categories` 배열 순서대로 검사 → 첫 매치 승리 → 매치 없으면 target-repo 루트 기준 상대 경로의 첫 세그먼트로 fallback (자세한 정의는 위 `data/config.ts` 절 참조).

### 체크박스 집계

```
문서마다:
  scanCheckboxes(content) → { total, checked }
  category = resolveCategory(path)

카테고리마다:
  checked = Σ(문서.checked)
  total   = Σ(문서.total)
  percent = checked / total * 100
```

## 캐싱

| 데이터 | 위치 | 무효화 |
|---|---|---|
| 문서 메타 (frontmatter) | Astro Content Collection | md 변경 자동 |
| 파일별 git log | `scan.ts` in-memory Map | `.git/HEAD` 또는 `.git/index` 변경 |
| 체크박스 카운트 | `scan.ts` in-memory Map | 해당 파일 변경 |
| 카테고리 집계 | 요청 시 재계산 | 하위 캐시 무효화로 자연 갱신 |
| Live activity | 캐시 없음, 매 요청 실행 | 매 폴링 fresh |

## 성능 예상 (문서 100-500개, 커밋 수천 개)

| 연산 | 목표 지연 |
|---|---|
| 초기 전체 스캔 | ≤ 3초 |
| 개별 파일 재스캔 (HMR) | ≤ 100ms |
| `/api/activity.json` | ≤ 100ms |
| Dashboard SSR (캐시 warm) | ≤ 50ms |
| 파일 저장 → 브라우저 반영 | ≤ 500ms |

## Error handling

원칙: **dev 모드에서 loud 하게, 그러나 부분 저하만. dev 서버는 죽지 않는다.**

| 실패 모드 | 대응 |
|---|---|
| target 폴더가 git 리포지토리 아님 | 배너 경고, git 의존 기능(타임라인/dirty) 비활성. 문서 뷰어는 정상 |
| `git` CLI 미설치 | 위와 동일 |
| `docview.config.ts` 문법 에러 | 부팅 실패 (loud fail). 에러 위치 표시 |
| Config의 glob가 매치 0 | 부팅 성공, 배너에 "no docs found" 경고 |
| md 파일 frontmatter 스키마 위반 | Astro 기본 동작: 파일 경로와 함께 콘솔·배너에 표시. 해당 파일만 스킵 |
| Non-UTF-8 md 파일 | 스킵, warn |
| 심볼릭 링크 / 순환 디렉터리 | chokidar `followSymlinks: false` 기본 |
| Very large repo (>10k md) | 부팅 배너 경고, exclude 제안 |
| chokidar 실패 | polling 모드 fallback |
| `.git` 접근 불가 (권한/submodule) | git 기능만 비활성, warn |
| 스캔 중 동시 write (EAGAIN) | 1회 retry, 실패 시 스킵 |
| Port 4321 사용 중 | Astro 기본: 다음 포트 자동 |

**배너 UI**: 대시보드 상단 warnings 스택, dismissable. 재부팅 시 다시 표시.

## Testing

**TDD 모드 (활성) 준수**: failing test → 최소 구현 → refactor.

### 스택
- **Vitest** — 유닛/통합
- **Playwright** — E2E

### 계층별

| 계층 | 대상 | 대표 케이스 |
|---|---|---|
| Unit | `scan.scanCheckboxes` | 빈 파일, 코드블록 내 체크박스 무시, 중첩 리스트, mixed 상태 |
| Unit | `scan.resolveCategory` | 순서 매치, 폴백, glob 배열 매치 |
| Unit | `config` 병합 | 유저 config × 기본값 |
| Integration | Scanner + 실제 git | tmp 리포 생성, 커밋, `scanGitLog` 검증. chokidar 트리거 검증 |
| Integration | Content Collection + glob loader | fixture 트리에서 인덱싱 결과 |
| Component | `LiveActivityBanner` | props → 렌더. 폴링 mock 갱신 |
| Component | `CategoryCard` | progress 수학, icon |
| E2E | 해피 패스 | dev 부팅 → `/dashboard` → 데이터 표시 |
| E2E | 라이브 반영 | 파일 수정 → HMR → 대시보드 반영 (≤ 1초) |

### MVP 필수 (YAGNI)

1. `scanCheckboxes` 유닛 스위트 (6-10 케이스)
2. `resolveCategory` 유닛 스위트 (3-5 케이스)
3. Scanner + 실제 git 통합 1 스위트
4. E2E 해피 패스 1 케이스
5. E2E 라이브 반영 1 케이스

### 픽스처
`tests/fixtures/sample-repo/` — ADR 2-3개, PRD 1개, plan 1개를 담은 미리 준비된 소형 git 리포.

## MVP scope

MVP 릴리스에 포함되는 기능:

| # | 기능 | 스킬/기술 |
|---|---|---|
| ① | Starlight 통합 뷰어 (Glob loader 로 흩어진 md 모음) | Starlight + Content Collection |
| ② | 2컬럼 대시보드 (좌: 최근 수정 타임라인 · 우: 카테고리 진행률) | 커스텀 Astro 페이지 |
| ②-b | **Live Activity 배너** (git status + 최근 fs 변경 + active plan) | 클라이언트 폴링 + `/api/activity.json` |
| ③ | In-doc mermaid 렌더링 | `@astrojs/mdx` + `rehype-mermaid` |
| ④ | Frontmatter 기반 필터 (status/category/tags) | `FilterPanel` + URL/LocalStorage |

## Roadmap

- **v1.1** (사용 피드백 후)
  - 문서별 git 히스토리 미니뷰 (해당 문서 하단에 최근 커밋 3-5개)
  - Backlinks (역방향 링크 인덱스)
  - (선택) 정적 빌드 + 배포 옵션 (GitHub Actions / Netlify)
- **v1.2**
  - 문서 그래프 뷰 (Obsidian 스타일 노드-엣지)

## Success criteria

- 부팅 후 3초 내 대시보드 첫 렌더.
- 파일 저장 → 브라우저 반영 500ms 내.
- 100~500 문서 규모에서 인터랙션 부드러움.
- 새 repo 도입: 폴더 복사 + `npm install` + config 조정 5분 내.
- Live Activity 배너로 "지금 뭘 하고 있는지" 한눈에 파악 가능.

## Open questions

- v1.1 배포 옵션 결정 (사용 감상 후).
- Backlinks 파싱 규칙 (v1.1 브레인스토밍 시).
- 대시보드에 통계 위젯 (예: 지난 7일 커밋 수) 추가 여부 — 현 시점 YAGNI.

## Assumptions

- Node 18+ 실행 환경.
- target repo 는 git 리포지토리 (권장). 아닐 시 git 기능만 저하.
- 문서 규모 100~500 (실측 후 재검토).
- 사용자는 한 번에 하나의 target repo 를 대상으로 dev 서버 실행.
