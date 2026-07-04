# CLAUDE.md

Claude Code(및 기여자)를 위한 이 저장소 안내. 상세 사용법은 `README.md`, 배포 확장은 `MIGRATION.md` 참고.

## 프로젝트 개요

신랑·신부가 **각자 기기에서** 동일한 웨딩 사진(1000장+ jpg)을 넘겨보며 1~5점으로 매기고,
**두 사람 점수 합계가 높은 사진의 파일명만** 최종 수합하는 브라우저 웹앱.

핵심 원칙 두 가지 (절대 훼손 금지):
1. **사진은 로컬에만.** 브라우저가 File System Access API로 로컬 폴더를 읽어 표시만 하고,
   네트워크로는 `파일명 + 점수`(수십 KB)만 오간다. → 저장비용 ≈ 0, 프라이버시 유지.
2. **빌드 없음.** 순수 HTML + ES 모듈 JS. 번들러/프레임워크 없이 정적 파일로 실행·배포.

대상 브라우저: **크롬/엣지 데스크톱**. 그 외에는 `<input webkitdirectory>` 폴백으로 보기·평점만.
UI 문구는 한국어.

## 명령어

```bash
npm run serve     # npx serve . (정적 서버, 크롬으로 http://localhost:3000)
npm test          # test/verify.mjs   — 로직·동기화 계약(브라우저 없이, 빠름)
npm run test:ui   # test/ui-verify.mjs — 실제 크롬(Playwright) UI end-to-end + 스크린샷
SELPIC_URL='https://script.google.com/macros/s/.../exec' node test/real-verify.mjs
                  # 실제 배포한 시트로 브라우저 CORS 왕복(POST/GET) 검증
```

UI 테스트 최초 1회: `npm i && npx playwright install chromium`.

## 아키텍처

```
로컬 사진 폴더 ─(File System Access)─ 브라우저 앱 ─(파일명+점수)→ 백엔드 어댑터 → 구글 시트
                                                   ↑ 폴링 GET으로 상대 점수 갱신(near-real-time)
```

- **상태/로직**: `src/ratings.js` — 단일 스토어(state) + pub/sub(subscribe/emit).
  점수 병합(myScore/otherScore/groom/bride/total), 필터·정렬(navList), 로컬 영속화(localStorage).
- **동기화**: `src/sync.js` 는 **백엔드 어댑터** 위에서 pull/push 타이밍만 관리(교체 가능).
  어댑터 인터페이스: `pull()`, `push(role, items)`, 선택적 `subscribe(onRows)`.
  현재 어댑터: `src/backends/sheets-backend.js`(구글 시트, subscribe 없음 → 폴링).
- **로컬 파일**: `src/fs.js` — 폴더 선택, jpg 나열(자연 정렬), 이미지 lazy 로드(오브젝트 URL LRU),
  폴더 핸들 IndexedDB 저장/복원. 폴백 `useFileList`.
- **UI**: `src/app.js`(오케스트레이터: 화면전환/툴바/뷰 라우팅) + 뷰 모듈.
  각 뷰 모듈은 `render(root)` 후 `{ update, dispose }` 를 반환한다. 스토어 변경 시 `update()`,
  뷰 전환 시 `dispose()` 후 재렌더. DOM 헬퍼·별점은 `src/ui-common.js`.
- **백엔드 코드**: `apps-script/Code.gs` — 구글 시트에 붙이는 Apps Script(doGet/doPost, LockService).

## 뷰 모듈

| 파일 | 역할 |
|---|---|
| `src/ui-rate.js` | 1장 모드. 키보드(←→ / 1~5 / 0), 확대(휠·드래그·더블클릭·버튼·+/-/f) |
| `src/ui-grid.js` | 썸네일 그리드. IntersectionObserver 지연 로딩, 점수/합계 뱃지 |
| `src/ui-compare.js` | 2~4장 나란히 비교 |
| `src/export.js` | 필터된 목록을 txt(파일명)·csv(filename,groom,bride,total)로 저장 |

## 규칙 / 주의

- 새 코드는 주변 스타일에 맞춘다: 프레임워크·빌드 도입 금지, 순수 ESM.
- 상대 import는 `.js` 확장자 포함(브라우저 ESM 요건).
- 두 축(로컬 사진 / 점수만 동기화)을 깨는 변경 금지.
- 점수 큐(pending)는 localStorage에 영속 → 오프라인·연결 끊김에도 유실 없이 재전송.
- 기능 추가/수정 시 해당 테스트(특히 `test:ui`)도 갱신. 시각적 문제는 스크린샷 확인 필수.

## 과거에 겪은 버그(회귀 주의)

- **화면 전환**: `hidden` 속성만으로는 안 됨 — `display`를 지정하는 CSS가 UA의 `[hidden]{display:none}`을
  덮어쓴다. `styles.css`에 `[hidden]{display:none !important}` 유지.
- **상대 점수 미갱신**: 브라우저가 GET 응답을 캐시 → `sheets-backend.pull()`에 캐시버스터 쿼리 +
  `cache:'no-store'` 유지.
- **세로 사진 잘림**: 1장 모드는 flex 컬럼 + `.stage{flex:1;min-height:0}` 로 사진을 화면에 맞춤
  (퍼센트 height 계산 금지).
- **확대 중 버튼 클릭 씹힘**: 스테이지 팬(pointer capture)이 클릭을 가로챔 → 줌 컨트롤 위에서는
  pointerdown으로 팬 시작 안 함(`e.target.closest('.zoom-bar')` 가드).
- **한글 파일명 분리(NFD/NFC)**: 맥(NFD)·아이폰/윈도우(NFC) 간 같은 한글 파일명이 다른 문자열로
  인식돼 시트에 2행으로 분리됨 → `fs.js`에서 파일명을 `normalize('NFC')`로 통일(양쪽 기기 일치).
  영문 파일명은 무관. (검증: test/dup-verify.mjs — 실 백엔드로 순차·동시·한글 케이스)

## 배포(다른 부부용) 확장

구글 시트는 다중 사용자 배포엔 부적합(부부별 배포·할당량·격리 없음). 클라이언트는 그대로 두고
**백엔드 어댑터만** `supabase-backend.js` 등으로 교체(+ 방/세션 개념·가벼운 인증). 상세: `MIGRATION.md`.
