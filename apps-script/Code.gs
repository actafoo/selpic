/**
 * Selpic 백엔드 — 구글 시트에 붙이는 Apps Script.
 * 시트에는 사진이 아니라 "파일명 + 점수"만 저장된다.
 *
 * 설치:
 *   1) 구글 시트 새로 만들기
 *   2) 확장 프로그램 → Apps Script → 이 코드 전체 붙여넣기 → 저장
 *   3) 배포 → 새 배포 → 유형 "웹 앱"
 *        - 실행 계정: 나
 *        - 액세스 권한: "모든 사용자(Anyone)"
 *   4) 발급된 웹앱 URL(.../exec)을 앱 접속 화면에 입력
 *
 * 시트 탭 'ratings' 는 없으면 자동 생성된다.
 */

var SHEET_NAME = 'ratings';

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['filename', 'groom', 'bride', 'total', 'updatedAt']);
  }
  return sh;
}

// 전체 점수를 JSON 배열로 반환: [{filename, groom, bride}, ...]
function doGet() {
  var sh = sheet_();
  var data = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var filename = data[i][0];
    if (!filename) continue;
    out.push({ filename: String(filename), groom: Number(data[i][1]) || 0, bride: Number(data[i][2]) || 0 });
  }
  return json_(out);
}

// 배치 점수 기록: body = {role:'groom'|'bride', items:[{filename, score}, ...]}
//
// ⚠️ 반드시 '일괄 읽기 1번 + 일괄 쓰기 1번'을 유지할 것.
// 예전 버전은 항목마다 setValue/setFormula를 호출(100장 청크 = 셀 API 300번, 수십 초)해서
// 락 타임아웃·6분 초과로 실패했고, 이것이 2026-07 대량 점수 유실 사고의 서버측 원인이었다.
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: '락 대기 시간 초과(잠시 후 자동 재시도됩니다)' });
  }
  try {
    var body  = JSON.parse(e.postData.contents);
    var role  = body.role === 'bride' ? 'bride' : 'groom';
    var ci    = role === 'groom' ? 1 : 2;   // 행 배열 인덱스: 1=groom, 2=bride
    var items = body.items || [];

    var sh   = sheet_();
    var data = sh.getDataRange().getValues();
    var rowOf = {};                          // 정규화 키 -> data 인덱스 (기기 간 확장자·대소문자 차이 흡수)
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) rowOf[canonKey_(String(data[i][0]))] = i;
    }

    var now = new Date().toISOString();
    for (var k = 0; k < items.length; k++) {
      var name  = canonKey_(String(items[k].filename || ''));
      if (!name) continue;
      var score = Number(items[k].score) || 0;
      // ⚠️ 미평가(0)는 반드시 '빈칸'으로 쓴다. 숫자 0을 쓰면 "0점을 줬다"로 보인다
      //    (2026-07-05 회귀: 신랑이 만든 행의 신부 칸이 전부 0으로 표기됐던 원인).
      var cell  = score > 0 ? score : '';
      var idx = rowOf[name];
      if (idx == null) {                     // 새 파일 → 메모리에서 행 추가(상대 칸은 빈칸 유지)
        var r = [name, '', '', score, now];
        r[ci] = cell;
        rowOf[name] = data.length;
        data.push(r);
      } else {
        var row = data[idx];
        row[ci] = cell;                      // 다른 역할의 칸은 절대 건드리지 않는다
        row[3] = (Number(row[1]) || 0) + (Number(row[2]) || 0);
        row[4] = now;
      }
    }
    if (data.length > 1) sh.getRange(2, 1, data.length - 1, 5).setValues(data.slice(1));
    return json_({ ok: true, count: items.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 파일명 정규화(앱과 동일): NFC + 소문자 + .jpeg/.JPG → .jpg
function canonKey_(name) {
  return String(name).normalize('NFC').toLowerCase().replace(/\.jpe?g$/, '.jpg');
}

/**
 * 일회용 정리: ① 대소문자·확장자만 다른 중복 행(NT..jpg / nt..jpg 등)을 정규화 키로 병합해
 * 중복 행을 제거하고, ② 미평가 칸에 잘못 기록된 숫자 0을 빈칸으로 되돌린다.
 * Apps Script 편집기에서 함수 목록에서 dedupe 선택 → 실행(▶).
 * (실행 전 시트 탭을 복제해 백업해두면 안전)
 */
function dedupe() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_();
    var data = sh.getDataRange().getValues();
    var merged = {}, order = [];
    for (var i = 1; i < data.length; i++) {
      var filename = data[i][0];
      if (!filename) continue;
      var k = canonKey_(String(filename));
      if (!merged[k]) { merged[k] = { groom: 0, bride: 0 }; order.push(k); }
      merged[k].groom = Math.max(merged[k].groom, Number(data[i][1]) || 0);
      merged[k].bride = Math.max(merged[k].bride, Number(data[i][2]) || 0);   // 같은 사진의 점수는 큰 값 채택
    }
    var out = [['filename', 'groom', 'bride', 'total', 'updatedAt']];
    var now = new Date().toISOString();
    for (var j = 0; j < order.length; j++) {
      var g = merged[order[j]].groom, b = merged[order[j]].bride;
      out.push([order[j], g > 0 ? g : '', b > 0 ? b : '', g + b, now]);   // 미평가는 빈칸
    }
    sh.clearContents();
    sh.getRange(1, 1, out.length, 5).setValues(out);
    return '정리 완료: ' + (data.length - 1) + '행 → ' + (out.length - 1) + '행';
  } finally {
    lock.releaseLock();
  }
}
