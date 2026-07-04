# 배포 확장 가이드 — 구글 시트 → Supabase

지금 버전은 **우리끼리(+1~2쌍) UX를 검증하는 MVP**입니다. 백엔드는 구글 시트지만,
동기화 계층이 **교체 가능한 어댑터**로 분리돼 있어 다른 부부들에게 배포할 때
**클라이언트 전체를 재작성하지 않고 백엔드만 교체**하면 됩니다.

## 왜 시트로는 배포가 어려운가

- **커플마다 시트+Apps Script 배포가 필요** → 비개발자에겐 비현실적
- **하나의 시트를 공유하면** Apps Script 일일 할당량 + `LockService` 전역 직렬화로 병목
- **인증·데이터 격리 없음** → 다수 사용자 제품엔 부적합

## 그대로 유지되는 것 (핵심 이점)

**"사진은 로컬, 점수만 동기화"** 설계는 배포 버전에서도 동일합니다.
→ 사진을 서버에 안 올리므로 **저장 비용 ≈ 0**, 프라이버시 유지, 커플이 늘어도 저렴.

바뀌지 않는 파일: `index.html`, `styles.css`, `src/fs.js`, `src/ratings.js`,
`src/ui-*.js`, `src/export.js`, `src/ui-common.js`.

## 교체 지점 (Backend 어댑터)

`src/sync.js`는 아래 인터페이스에만 의존합니다. 새 백엔드는 이 3개만 구현하면 됩니다:

```js
// Backend
pull(): Promise<Array<{filename, groom, bride}>>
push(role, items): Promise<void>
subscribe?(onRows: (rows) => void): () => void   // 있으면 실시간, 없으면 폴링
```

- 현재: `src/backends/sheets-backend.js` (subscribe 없음 → 폴링)
- 배포용: `src/backends/supabase-backend.js` 를 새로 만들고, `src/app.js`의
  `setBackend(createSheetsBackend(...))` 한 줄만 `setBackend(createSupabaseBackend(...))`로 교체.

`subscribe`를 구현하면 폴링 대신 **실시간**으로 자동 전환됩니다(`sync.js`가 감지).

## 추가로 필요한 것

1. **세션(방) 개념** — 커플별 데이터 격리. 접속 화면에 "방 코드 만들기/참여" 추가.
   백엔드는 `createSupabaseBackend({ sessionId, role })`처럼 세션을 주입받음.
2. **가벼운 인증** — Supabase 익명 인증 또는 매직링크. 방 코드만으로 시작도 가능.

## Supabase 스키마(예시)

```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- 부부가 공유하는 방 코드
  created_at timestamptz default now()
);

create table ratings (
  session_id uuid references sessions(id) on delete cascade,
  filename   text not null,
  groom      int  check (groom between 0 and 5),
  bride      int  check (bride between 0 and 5),
  updated_at timestamptz default now(),
  primary key (session_id, filename)
);

-- 실시간 활성화
alter publication supabase_realtime add table ratings;
```

- **격리**: RLS로 `session_id`가 자신이 참여한 방인 경우에만 read/write 허용.
- **역할별 컬럼 갱신**: `upsert`로 `groom` 또는 `bride`만 갱신(다른 컬럼 보존).
- **합계**: 조회 시 `groom + bride` 계산(또는 생성 컬럼).

## supabase-backend.js 스케치

```js
import { createClient } from '@supabase/supabase-js';

export function createSupabaseBackend({ url, anonKey, sessionId }) {
  const sb = createClient(url, anonKey);
  return {
    async pull() {
      const { data } = await sb.from('ratings')
        .select('filename, groom, bride').eq('session_id', sessionId);
      return data || [];
    },
    async push(role, items) {
      const rows = items.map(it => ({ session_id: sessionId, filename: it.filename, [role]: it.score }));
      await sb.from('ratings').upsert(rows, { onConflict: 'session_id,filename' });
    },
    subscribe(onRows) {                    // 실시간 → 폴링 대체
      const ch = sb.channel('r:' + sessionId)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'ratings', filter: `session_id=eq.${sessionId}` },
            async () => onRows(await this.pull()))
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}
```

## 마이그레이션 순서 (배포 결정 시)

1. Supabase 프로젝트 생성, 위 스키마 + RLS 적용, 실시간 활성화
2. `src/backends/supabase-backend.js` 작성(위 스케치 기반)
3. 접속 화면에 "방 코드 만들기/참여" 추가, 세션 id를 백엔드에 주입
4. `src/app.js`에서 `setBackend`만 Supabase로 교체
5. 배포(Netlify/Vercel 등) — 정적 파일 그대로, 한 번 배포로 모든 커플 수용

> 대안: Firebase(Firestore)도 동일한 어댑터 패턴으로 교체 가능. 실시간·인증·무료 티어 모두 충분.
