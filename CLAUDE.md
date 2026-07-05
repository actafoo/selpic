# CLAUDE.md

Claude Code(및 기여자)를 위한 이 저장소 안내. 상세 사용법은 `README.md`, 배포 확장은 `MIGRATION.md` 참고.

## 프로젝트 개요

신랑·신부가 **각자 기기에서** 동일한 웨딩 사진(1000장+ jpg)을 넘겨보며 1~5점으로 매기고,
**두 사람 점수 합계가 높은 사진의 파일명만** 최종 수합하는 브라우저 웹앱.

핵심 원칙 두 가지 (절대 훼손 금지):
1. **사진은 로컬에만.** 브라우저가 File System Access API로 로컬 폴더를 읽어 표시만 하고,
   네트워크로는 `파일명 + 점수`(수십 KB)만 오간다. → 저장비용 ≈ 0, 프라이버시 유지.
2. **빌드 없음.** 순수 HTML + ES 모듈 JS. 번들러/프레임워크 없이 정적 파일로 실행·배포.

대상: **크롬/엣지 데스크톱** 우선 + **아이폰/모바일 지원**(다중 파일 선택 폴백, 스와이프·핀치·
전체화면, 반응형 레이아웃, 페이지 확대 차단). 파폭/사파리 데스크톱은 `webkitdirectory` 폴더 폴백.
UI 문구는 한국어.

**배포**: GitHub Pages(`actafoo/selpic`, main 브랜치). `git push origin main` → 자동 재빌드(~1분,
가끔 느림). `sw.js`(network-first 서비스워커)로 브라우저 캐시 무력화 → 사용자는 새로고침만으로 최신.
앱 접속 URL·Apps Script URL은 [[deployment-github-pages]] 메모리 참조.

## 명령어

```bash
npm run serve     # npx serve . (정적 서버, 크롬으로 http://localhost:3000)
npm test          # test/verify.mjs   — 로직·필터·동기화·정규화 병합(브라우저 없이, 빠름)
npm run test:ui   # test/ui-verify.mjs — 실제 크롬(Playwright) UI e2e + 확대/통계/스크린샷
npm run test:ios  # test/ios-verify.mjs — 아이폰 시뮬(다중선택·스와이프·핀치·모바일 레이아웃·사진추가)
SELPIC_URL='.../exec' node test/real-verify.mjs   # 실배포 시트로 브라우저 CORS 왕복 검증
SELPIC_URL 자동                node test/dup-verify.mjs    # 실배포로 같은 파일명 병합(순차·동시·확장자)
```

UI/iOS 테스트 최초 1회: `npm i && npx playwright install chromium`.

## 아키텍처

```
로컬 사진 폴더 ─(File System Access)─ 브라우저 앱 ─(파일명+점수)→ 백엔드 어댑터 → 구글 시트
                                                   ↑ 폴링 GET으로 상대 점수 갱신(near-real-time)
```

- **상태/로직**: `src/ratings.js` — 단일 스토어(state) + pub/sub(subscribe/emit).
  점수 병합(myScore/otherScore/groom/bride/total), 필터·정렬(navList), 로컬 영속화(localStorage).
- **동기화**: `src/sync.js` 는 **백엔드 어댑터** 위에서 pull/push 타이밍만 관리(교체 가능).
  `flush`는 **겹침 방지(flushing 가드) + 100장 청크(PUSH_CHUNK)** 로 보내고, 각 청크 성공 시에만 큐에서 제거.
  `pushChunked(b, role, items, onProgress)` 는 복구 재업로드용(큰 목록을 청크로 순차 전송).
  visibilitychange/online/pagehide 때 즉시 flush(iOS 백그라운드 타이머 정지 대응).
  어댑터 인터페이스: `pull()`, `push(role, items)`, 선택적 `subscribe(onRows)`.
  현재 어댑터: `src/backends/sheets-backend.js`(구글 시트, subscribe 없음 → 폴링).
- **자기치유(유실 자동 복구)**: `ratings.applyRemote`가 폴링 때마다 "내 로컬 확정 점수(mine>0)인데
  시트에 없음(0)"인 항목을 pending에 자동 재등록 → 다음 flush로 복구. 값이 다른 경우(같은 역할
  다른 기기)는 건드리지 않음(핑퐁 방지). 상단바 `#pendState`가 `⏳ 저장 대기 n / ✓ 저장됨` 표시.
- **로컬 파일**: `src/fs.js` — 폴더 선택, jpg 나열(자연 정렬), 이미지 lazy 로드(오브젝트 URL LRU),
  폴더 핸들 IndexedDB 저장/복원. 폴백 `useFileList`. **썸네일**: `getThumbURL`/`peekThumbURL` —
  320px 축소본을 만들어 캐시(동시 생성 3개 제한). 그리드는 반드시 썸네일 사용(원본 디코드는
  1000장+에서 스크롤 멈춤).
- **UI**: `src/app.js`(오케스트레이터: 화면전환/툴바/필터/뷰 라우팅/통계·사진추가 배선) + 뷰 모듈.
  각 뷰 모듈은 `render(root)` 후 `{ update, dispose }` 를 반환한다. 스토어 변경 시 `update()`,
  뷰 전환 시 `dispose()` 후 재렌더. DOM 헬퍼·별점은 `src/ui-common.js`.
- **설정**: `src/config.js` — `DEFAULT_SHEET_URL`(있으면 접속 화면 URL 입력 생략).
- **서비스워커**: `sw.js`(루트) — network-first, 캐시로 인한 구버전 방지.
- **백엔드 코드**: `apps-script/Code.gs` — 구글 시트 Apps Script(doGet/doPost, LockService,
  `dedupe()` 일회용 중복행 병합 함수).

## 뷰 모듈 / 기능

| 파일 | 역할 |
|---|---|
| `src/ui-rate.js` | 1장 모드. 키보드(←→ / 1~5 / 0), 확대(휠·핀치·드래그·더블클릭·버튼·+/-/f), 전체화면(⤢), **스와이프로 넘기기(터치)**. 이웃 4장 미리 디코드 + 썸네일 우선 표시 + 150ms 넘으면 스피너 |
| `src/ui-grid.js` | 썸네일 그리드(320px 축소본). IntersectionObserver 지연 로딩, 점수/합계 뱃지 |
| `src/ui-compare.js` | 2~4장 나란히 비교 |
| `src/ui-stats.js` | 별점 분포 통계 패널(신랑·신부 1~5점 장수·평균, 📊 토글, 상단바 아래 고정). **모바일은 기본 숨김**(사진을 가림), 패널 탭하면 닫힘 |
| `src/export.js` | 필터된 목록을 txt(원래 파일명)·csv(filename,groom,bride,total)로 저장 |

필터(app.js↔ratings.navList): **내 점수/상대 점수** 각각 정확·이상(ge)·매김·미평가 + **합계≥**·합계순.
사진 추가(＋ 버튼): 기존 선택에 덧붙이기(데스크톱 폴더 / 아이폰 다중파일).

**복구(접속 화면)**: 역할 선택 시 `selpic:mine:<role>`(지워지지 않는 로컬 원본) 장수를 표시하고,
`⤴ 시트에 다시 올리기` 버튼으로 폴더/개발자도구 없이 `pushChunked`로 재업로드(app.js `onRecover`).
시트 유실분 복구용. push가 멱등이라 중복 눌러도 안전.

## 규칙 / 주의

- 새 코드는 주변 스타일에 맞춘다: 프레임워크·빌드 도입 금지, 순수 ESM.
- 상대 import는 `.js` 확장자 포함(브라우저 ESM 요건).
- 두 축(로컬 사진 / 점수만 동기화)을 깨는 변경 금지.
- 점수 큐(pending)는 localStorage에 영속 → 오프라인·연결 끊김에도 유실 없이 재전송.
- 기능 추가/수정 시 해당 테스트(특히 `test:ui`)도 갱신. 시각적 문제는 스크린샷 확인 필수.

## 과거에 겪은 버그(회귀 주의)

- **대량 점수 유실(치명적, 2026-07 실사고)**: `sheets-backend.push`가 응답을 안 보고 fetch resolve만으로
  성공 처리 → 서버 실패(LockService 락 타임아웃·6분 초과)도 성공으로 착각해 `markFlushed`가 큐를 비움 →
  점수가 시트에 안 써진 채 영구 소실. 게다가 3초 flush 타이머가 이전 flush 끝나기 전에 또 쏴서 **큰
  pending을 통째로 중복 전송** → 겹친 요청들이 서로 락을 못 잡아 대량 실패. 밤새 백그라운드(탭 스로틀·
  절전·iOS 사파리)로 backlog가 쌓인 사용자가 특히 심각(신부 ~650장 소실). 수정: push는 **`res.ok` +
  `{ok:true}` 확인, 실패면 throw**(→ 큐 유지·재전송; push는 멱등이라 재전송 안전). flush는 **flushing
  가드 + PUSH_CHUNK(100) 청크**. 유실분은 `selpic:mine:<role>`(안 지워짐)에서 접속 화면 복구 버튼으로
  재업로드. (검증: test/ui-verify.mjs [복구])
  **서버측 원인도 제거(2026-07-05)**: 예전 doPost는 항목마다 setValue/setFormula(청크 100장 =
  셀 API 300번, 수십 초)라 락이 밀렸다 → **일괄 읽기 1번 + setValues 일괄 쓰기 1번**으로 재작성.
  Code.gs 수정 시 이 구조를 절대 되돌리지 말 것. 또한 클라이언트 **자기치유**(applyRemote가
  시트에 없는 내 점수를 자동 재큐잉)로 어떤 경로의 유실도 폴링 주기 안에 복구된다.
  (검증: test/verify.mjs [10]) ⚠️ Code.gs 변경은 자동 배포 안 됨 — Apps Script 편집기에서
  붙여넣고 "배포 관리 → 수정 → 새 버전"으로 수동 재배포해야 반영(URL은 유지됨).
- **화면 전환**: `hidden` 속성만으로는 안 됨 — `display`를 지정하는 CSS가 UA의 `[hidden]{display:none}`을
  덮어쓴다. `styles.css`에 `[hidden]{display:none !important}` 유지.
- **상대 점수 미갱신**: 브라우저가 GET 응답을 캐시 → `sheets-backend.pull()`에 캐시버스터 쿼리 +
  `cache:'no-store'` 유지.
- **세로 사진 잘림**: 1장 모드는 flex 컬럼 + `.stage{flex:1;min-height:0}` 로 사진을 화면에 맞춤
  (퍼센트 height 계산 금지).
- **확대 중 버튼 클릭 씹힘**: 스테이지 팬(pointer capture)이 클릭을 가로챔 → 줌 컨트롤 위에서는
  pointerdown으로 팬 시작 안 함(`e.target.closest('.zoom-bar')` 가드).
- **모바일 페이지 전체 확대**: iOS는 `user-scalable=no`를 무시 → `styles.css` `* { touch-action: pan-y }`
  + `.stage{touch-action:none}` + `gesturestart` preventDefault로 페이지 핀치·더블탭 확대 차단(사진만 확대).
- **iOS 사파리 100vh**: 하단 툴바 뒤 영역까지 포함해 별점 바가 화면 밖으로 밀림 →
  `height:100vh; height:100dvh;` 이중 선언(+ `viewport-fit=cover`, statusbar에 safe-area 패딩) 유지.
- **1000장+ 그리드 버퍼링**: 썸네일 없이 원본(수천만 화소)을 셀마다 디코드하면 스크롤이 멈춤 →
  그리드는 `fs.getThumbURL`(320px, 동시 3개 제한)만 사용. (검증: test/ui-verify.mjs [대량] 1400장)
- **미평가가 0점으로 표기(2026-07-05 회귀)**: doPost 배치쓰기 첫 버전이 새 행을 `[이름,0,0,…]`으로
  만들고 갱신 행의 빈칸을 `Number(x)||0`으로 0으로 굳혀, 신랑만 매긴 행 600여 개의 신부 칸이
  전부 숫자 0으로 보였음("신부가 0점 줬다" 오해). → **미평가는 반드시 빈칸('')**: 점수 0은 ''로
  쓰고, 상대 역할 칸은 절대 건드리지 않는다. 기존 0은 `dedupe()` 실행이 빈칸으로 되돌림.
- **배포 반영 착시**: GitHub Pages 빌드가 느릴 때가 있음 + 브라우저 캐시. "라이브"라 말하기 전
  `gh api repos/OWNER/REPO/pages/builds/latest`로 `built` 확인하고, 라이브 파일을 `?x=rand`로 grep해 검증.
- **같은 사진이 2행으로 분리(파일명 불일치)**: 기기마다 확장자·대소문자·유니코드 정규화가 달라
  (`.jpg` vs `.jpeg`, `.JPG`, NFD vs NFC) 같은 사진이 다른 파일명으로 인식돼 시트에 2행으로 분리,
  서로 점수가 안 보임 → **정규화 키**(`canon()` in ratings.js: NFC+소문자+`.jpe?g`→`.jpg`)를
  식별자로 사용. `applyRemote`가 키로 병합해 **기존에 갈라진 행도 읽을 때 자동 합쳐짐**.
  표시·내보내기는 원래 파일명(`state.names`/`nameOf`) 유지. 내 점수는 로컬 없으면 시트값으로 폴백.
  (검증: test/verify.mjs [7]~[9], test/dup-verify.mjs)

## 배포(다른 부부용) 확장

구글 시트는 다중 사용자 배포엔 부적합(부부별 배포·할당량·격리 없음). 클라이언트는 그대로 두고
**백엔드 어댑터만** `supabase-backend.js` 등으로 교체(+ 방/세션 개념·가벼운 인증). 상세: `MIGRATION.md`.
