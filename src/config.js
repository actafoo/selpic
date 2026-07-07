// 배포 편의 설정.
// DEFAULT_SHEET_URL 에 Apps Script 웹앱 URL을 넣으면 접속 화면에서 URL 입력을 생략하고
// 자동으로 사용한다(역할 + 폴더 선택만). 비워두면('') 사용자가 직접 입력.
//
// ⚠️ 여기에 URL을 넣고 저장소가 public이면 URL이 공개된다(사실상 비밀키).
//    사용을 마치면 Apps Script를 보관취소/재배포해 이 URL을 무효화할 것.
export const DEFAULT_SHEET_URL =
  'https://script.google.com/macros/s/AKfycbw561TAA1lU4xSVyOy6rmxZ7Hvz7fX3b2VnMTqFNTQDy7UiYxsM9GRrlejJpFtogaXD/exec';

// 최종 픽 목표 장수 — 상단바 카운터(♥ n/20)의 분모. 스튜디오 계약 장수에 맞춰 조정.
export const PICK_TARGET = 20;
