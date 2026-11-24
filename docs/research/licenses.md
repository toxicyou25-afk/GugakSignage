# 라이선스·출처·재사용 범위

- 작성·확인일: 2026-11-24 (KST)
- 대상: KRDS, 한글 폰트, 아이콘 세트, 오픈소스 자산, 조사 참고자료
- 관련 문서: [국내 UI·UX 벤치마크](ui-benchmark-kr.md), [KRDS 실무 정리](krds.md)

## 0. 원칙

이 문서는 “조사 참고자료”와 “제품에 넣을 수 있는 자산”을 구분한다.

- **조사 참고자료**: 상용 제품의 화면·매뉴얼·브로셔·영상. 패턴을 분석하고 출처를 인용하기 위해서만 쓴다. 저장소·배포물에 넣지 않는다.
- **제품 자산**: 폰트·아이콘·오픈소스 코드·KRDS 자료처럼 라이선스가 허용하는 범위에서 제품에 포함할 수 있는 자산. 라이선스 고지와 출처를 함께 보관한다.
- **확인 불가**: 공개 자료로 라이선스 조건을 확정할 수 없는 항목. 배포 전에 권리자에게 확인한다.

상용 제품의 화면·소스·아이콘·로고·독창적 디자인을 복제하지 않는다. 제품명과 상표는 각 권리자에게 있으며, 우리 제품의 이름·로고로 쓰지 않는다.

## 1. 한눈에 보기

| 자산 | 라이선스 | 상업적 사용 | 수정 | 출처 표시 | 제품 포함 |
|---|---|---|---|---|---|
| KRDS 사이트·가이드·컴포넌트 | 공공누리 제1유형(출처표시) | 허용 | 허용 | 필수 | 가능(고지) |
| KRDS GitHub HTML 컴포넌트 킷 | package.json은 ISC, README는 KRDS 이용약관 | 확인 필요 | 확인 필요 | 필수 | 보수적 고지 후 가능 |
| Pretendard·Pretendard GOV | SIL Open Font License 1.1 | 허용 | 허용(예약 이름 주의) | 라이선스 포함 | 가능 |
| Noto Sans KR | SIL Open Font License 1.1 | 허용 | 허용(예약 이름 주의) | 라이선스 포함 | 가능 |
| 나눔고딕·나눔스퀘어 | OFL(버전은 배포 패키지 확인) | 허용 | 허용 | 라이선스 포함 | 가능 |
| Spoqa Han Sans Neo | SIL Open Font License 1.1 | 허용 | 허용(예약 이름 주의) | 라이선스 포함 | 가능 |
| KRDS 시스템 아이콘 | KRDS 공공누리 제1유형 | 허용 | 허용 | 필수 | 가능(고지) |
| Lucide | ISC | 허용 | 허용 | 고지 필수 | 가능 |
| Heroicons | MIT | 허용 | 허용 | 고지 필수 | 가능 |
| Material Symbols | Apache License 2.0 | 허용 | 허용 | 라이선스·NOTICE | 가능 |
| Swiper | MIT | 허용 | 허용 | 고지 필수 | 가능 |
| Xibo | AGPL-3.0 | 허용 | 허용(네트워크 소스 공개 의무) | 소스 제공 | 조건부 |
| 삼성·LG·국내 제품 화면·매뉴얼 | 각 권리자 저작권 | 해당 없음 | 불가 | 인용만 | 불가(조사용) |
| 정부 상징·공식 배너·기관 식별자 | 별도 상표·공식 서비스 정책 | 기관 승인 필요 | 불가 | 해당 없음 | 원칙 불가 |

## 2. KRDS

### 2.1 공식 저작권정책

KRDS 저작권정책은 다음과 같이 안내한다.

- KRDS의 자료(디자인, 코드, 문서 등)를 상업적·비상업적 목적으로 자유롭게 사용할 수 있다.
- 사용 시 반드시 출처를 표기하고, “KRDS(Korea Design System)” 또는 제공 기관명을 명시해야 한다.
- 모든 자료는 공공누리 제1유형에 따라 제공된다.
- 상업적·비상업적 이용, 변경·가공, 2차적 저작물 제작·배포가 허용된다.
- 잘못된 방식으로 변형한 공공저작물로 인한 손해·불이익에 대해서는 책임지지 않는다.

공식 출처 표기 예시:

> 본 저작물은 행정안전부에서 2024년 작성하여 공공누리 제1유형으로 개방한 ‘범정부 UI/UX 디자인시스템(KRDS)’을 이용하였으며, 해당 저작물은 ‘KRDS 디자인시스템 홈페이지(www.krds.go.kr)’에서 무료로 다운받으실 수 있습니다.

출처: [KRDS 저작권정책](https://www.krds.go.kr/html/site/utility/utility_06.html) — 2025-05-13 최종 수정.

### 2.2 코드 패키지의 라이선스 불일치

2026-11-24에 확인한 KRDS HTML 컴포넌트 킷은 다음처럼 서로 다른 표기를 함께 가진다.

- GitHub 저장소: https://github.com/KRDS-uiux/krds-uiux
- package.json: “license”: “ISC”
- README: “본 패키지는 대한민국 디지털 정부 디자인 시스템(KRDS)의 이용약관을 따름” + KRDS 저작권 링크
- 공식 사이트: 모든 자료는 공공누리 제1유형

이 불일치는 코드 재사용 시 해석이 갈릴 수 있다. 우리는 **가장 보수적으로 두 조건을 모두 만족**시킨다.

1. KRDS 출처 표기를 넣는다.
2. ISC 라이선스 고지와 허가 문구를 포함한다.
3. KRDS 킷에 포함된 제3자 자산(Swiper MIT 등)의 고지를 유지한다.
4. 배포 전 필요하면 KRDS 운영기관(krds@nia.or.kr)에 서면 확인을 요청한다.

이 문서는 법률 자문이 아니다. 공개 배포 전에는 기관 법무·계약 담당의 검토를 받는다.

### 2.3 정부 상징·공식 배너

KRDS에는 공식 배너(Masthead), 운영기관 식별자, 정부 상징 관련 컴포넌트가 포함되어 있다. 저작권 허락과 별개로 다음 문제가 있다.

- 내부 관리 도구에 “대한민국 정부 공식 서비스” 배너를 붙이면 공식 서비스로 오인될 수 있다.
- 정부 상징·기관 로고는 상표·공식 표장 정책의 적용을 받을 수 있다.
- 공공누리 제1유형은 저작권 이용 허락이며, 상표권·공식 서비스 지위를 자동으로 허락하지 않는다.

따라서 우리 관리자 화면에는 정부 공식 배너·정부 상징을 넣지 않는다. 필요하면 국립부산국악원의 공식 로고·명칭 사용 범위를 기관에 확인한다.

## 3. 한글 폰트

### 3.1 Pretendard·Pretendard GOV

- Pretendard는 SIL Open Font License 1.1로 배포된다.
- 라이선스에는 “Reserved Font Name ‘Pretendard’”가 명시되어 있다. 수정본을 배포할 때 예약 이름을 그대로 쓰지 않는다.
- KRDS 표준형 스타일은 Pretendard를 기반으로 만든 **Pretendard GOV**를 기본 서체로 쓴다.
- KRDS HTML 컴포넌트 킷에는 PretendardGOV Regular·Medium·Bold의 subset woff/woff2가 포함되어 있다.
- KRDS 킷 안에 PretendardGOV 전용 LICENSE 파일은 확인하지 못했다. 업스트림 Pretendard의 OFL과 KRDS의 공공누리 표기를 함께 보수적으로 적용한다.

출처:

- [Pretendard LICENSE](https://github.com/orioncactus/pretendard/blob/main/LICENSE)
- [KRDS 타이포그래피](https://www.krds.go.kr/html/site/style/style_03.html)
- [KRDS GitHub](https://github.com/KRDS-uiux/krds-uiux)

**허용**

- 웹·앱·문서에 포함해 사용.
- 소프트웨어와 함께 번들·재배포.
- 수정·가공(예약 이름을 피해 새 이름 사용).
- 상업적 사용.

**금지·주의**

- 폰트 파일만 단독으로 판매하지 않는다.
- 수정본에 “Pretendard” 예약 이름을 쓰지 않는다.
- 라이선스 문구를 제거하지 않는다.
- CDN에 의존하지 말고 자체 호스팅한다(외부 클라우드 미의존 요구).

### 3.2 Noto Sans KR

- Noto Sans KR은 SIL Open Font License 1.1로 배포된다.
- Noto Sans CJK의 Sans 라이선스 파일이 OFL 1.1임을 확인했다.
- 본문 16~17px, 줄 간격 150% 이상에서 안정적이다.
- Pretendard GOV를 쓰기 어려운 환경의 대안으로 적합하다.

출처: [Noto Sans CJK LICENSE](https://github.com/googlefonts/noto-cjk/blob/main/Sans/LICENSE).

**주의**: Noto 계열은 예약 글꼴 이름이 있을 수 있으므로, 수정본 배포 시 라이선스의 예약 이름 조항을 확인한다.

### 3.3 나눔고딕·나눔스퀘어

- 네이버 한글한글아름답게에서 오픈 라이선스(상업적 사용 허용)로 배포한다.
- 나눔고딕코딩 저장소 README는 “OFL 라이선스 하에서 재배포”라고 명시한다.
- 정확한 OFL 버전과 예약 이름은 배포 패키지의 LICENSE 파일로 확인한다.

출처:

- [네이버 나눔 글꼴](https://hangeul.naver.com/font/nanum)
- [나눔고딕코딩 GitHub](https://github.com/naver/nanumfont)
- [Open Font License 안내](https://github.com/naver/nanumfont/wiki/Open-Font-License)

**주의**: 저장소에는 README만 있고 폰트별 LICENSE 파일이 없을 수 있다. 실제 배포 전 다운로드한 폰트 패키지의 라이선스 파일을 보관한다.

### 3.4 Spoqa Han Sans Neo

- SIL Open Font License 1.1.
- 예약 이름: “Spoqa Han Sans”, “Spoqa Han Sans JP”, “Spoqa Han Sans Neo”.
- 본문·UI에 쓸 수 있지만, 우리 제품의 기본 서체는 Pretendard GOV 또는 Noto Sans KR로 통일한다.

출처: [Spoqa Han Sans LICENSE](https://github.com/spoqa/spoqa-han-sans/blob/master/LICENSE).

### 3.5 폰트 운용 원칙

- 본문 17px, 줄 간격 1.6, regular 400·bold 700 중심.
- 13px 미만 금지. 표 보조 정보도 15px 이상 권장.
- 폰트 파일은 자체 서버에서 제공하고, 외부 CDN을 런타임에 호출하지 않는다.
- WOFF2 우선, 구형 브라우저용 WOFF 대체.
- 라이선스 파일을 licenses/fonts/에 보관하고, 배포물의 “오픈소스 고지” 화면에서 확인할 수 있게 한다.
- 폰트 이름·버전·출처를 자산 대장에 기록한다.

## 4. 아이콘

### 4.1 KRDS 시스템 아이콘

- KRDS 시스템 아이콘은 KRDS 자료의 일부로 공공누리 제1유형이 적용된다.
- 24px 기준, 16·20·24·32·40px, 1.6px 선 두께.
- 사용 시 KRDS 출처를 표시한다.
- KRDS 아이콘을 변형해 우리 제품의 고유 아이콘인 것처럼 재배포하지 않는다.

출처: [KRDS 아이콘](https://www.krds.go.kr/html/site/style/style_06.html).

### 4.2 Lucide

- ISC License.
- Copyright (c) 2026 Lucide Icons and Contributors.
- Feather에서 파생된 아이콘이 포함되어 있으며, 해당 부분은 MIT 고지가 함께 제공된다.
- 상업적 사용·수정·재배포 가능. 저작권·허가 문구를 모든 복사본에 포함한다.

출처: [Lucide LICENSE](https://github.com/lucide-icons/lucide/blob/main/LICENSE).

**추천**: 우리 관리자 화면의 기본 아이콘 세트로 Lucide를 쓴다. 24px, 1.6~2px 선 두께로 통일하고, 상태 아이콘은 모양을 다르게 한다.

### 4.3 Heroicons

- MIT License.
- Copyright (c) Tailwind Labs, Inc.
- 상업적 사용·수정·재배포 가능. 라이선스와 저작권 고지를 포함한다.

출처: [Heroicons LICENSE](https://github.com/tailwindlabs/heroicons/blob/master/LICENSE).

### 4.4 Material Symbols

- Apache License 2.0.
- 상업적 사용·수정·재배포 가능.
- Apache 2.0의 라이선스 사본과 NOTICE(있는 경우)를 포함한다.
- Google 브랜드·로고를 우리 제품의 출처로 오인시키지 않는다.

출처: [Material Design Icons LICENSE](https://github.com/google/material-design-icons/blob/master/LICENSE).

### 4.5 아이콘 공통 원칙

- 상용 제품의 아이콘을 복제하지 않는다.
- 로고·브랜드 아이콘은 해당 상표 정책을 따른다.
- 아이콘만으로 의미를 전달하지 않는다. 텍스트 레이블 또는 접근 이름을 제공한다.
- 아이콘과 배경은 3:1 이상, 고대비 모드에서는 7:1 이상.
- 같은 크기에서는 한 가지 선 두께만 쓴다.
- SVG 원본과 라이선스 파일을 함께 보관한다.

## 5. 오픈소스 라이브러리

### 5.1 Swiper

- KRDS HTML 컴포넌트 킷에 Swiper가 포함되어 있다.
- MIT License, Copyright 2014-2024 Vladimir Kharlampidi.
- MIT 고지를 유지하면 상업적 사용·수정·재배포가 가능하다.

출처: [Swiper LICENSE](https://github.com/nolimits4web/swiper/blob/master/LICENSE).

### 5.2 Xibo

- Xibo CMS는 AGPL-3.0이다. 별도 상용 라이선스도 판매한다.
- AGPL은 네트워크로 서비스를 제공할 때 수정본의 Corresponding Source를 사용자에게 제공해야 한다.
- 우리 저장소의 [후보 조사](candidates.md)는 Xibo를 “조건부 최우선 검토”로 평가했다.
- **연구·비교 목적으로만** 읽고, 코드를 우리 제품에 복사·통합하려면 법무 검토와 AGPL 준수 설계를 먼저 한다.
- Xibo의 화면·아이콘·로고를 복제하지 않는다.

출처: [Xibo CMS](https://github.com/xibosignage/xibo-cms), [Xibo LICENSE](https://github.com/xibosignage/xibo-cms/blob/develop/LICENSE).

### 5.3 그 밖의 라이브러리

새 라이브러리를 추가할 때마다 다음을 기록한다.

- 이름·버전·저장소 URL
- 라이선스 종류·버전
- 저작권 고지
- 수정 여부
- 배포 방식(번들·서버·CDN)
- 소스 공개 의무 여부
- 보안 취약점·유지보수 상태

MIT·ISC·BSD는 고지 유지, Apache 2.0은 라이선스·NOTICE, AGPL은 소스 제공 의무를 확인한다.

## 6. 조사 참고자료: 상용 제품

아래 자료는 **조사 참고자료**다. 저장소·배포물·공개 자료에 넣지 않는다.

| 자료 | 권리자 | 사용 범위 | 저장소 |
|---|---|---|---|
| Samsung MagicINFO 제품 페이지·이미지 | Samsung Electronics | 패턴 분석·출처 인용 | 넣지 않음 |
| Samsung QM43C 사용자 매뉴얼 | Samsung Electronics | 내용 확인·페이지 인용 | PDF 커밋 금지 |
| Samsung MagicINFO 캠페인 영상 | Samsung Electronics | 시청·요약 | 다운로드·재배포 금지 |
| LG SuperSign CMS·Cloud·Control+ 페이지·브로셔 | LG Electronics | 패턴 분석·출처 인용 | PDF·이미지 커밋 금지 |
| LG SuperSign 공식 영상 | LG Electronics | 시청·요약 | 다운로드·재배포 금지 |
| 위캐스트 ONE-DS 페이지·구성도 | 위캐스트 | 기능 분석·출처 인용 | 이미지 커밋 금지 |
| Y_BOARD 제품 페이지·매뉴얼 | 와이브로드 | 흐름 분석·페이지 인용 | PDF 커밋 금지 |
| 시스메이트 설치사례·사진 | 시스메이트 | 사례 분석·출처 인용 | 사진 커밋 금지 |
| 스마트너 CMS 페이지 | 스마트너 | 시장 구조 분석 | 이미지 커밋 금지 |
| 잇다디지털사이니지 페이지·화면 이미지 | 잇다 | 사례 분석 | 이미지 커밋 금지 |
| 스마트 사이니지 공공기관 사례 | 노크 | 사례 분석 | 사진 커밋 금지 |

공통 원칙:

- 화면 캡처는 artifacts/research/screens/kr/에만 두고, .gitignore의 artifacts/ 규칙으로 커밋하지 않는다.
- 매뉴얼·브로셔 PDF도 artifacts/research/에만 두고 커밋하지 않는다.
- 문서에는 URL, 페이지 번호, 짧은 사실 요약만 쓴다. 화면 이미지를 문서에 삽입하지 않는다.
- 제품 로고·아이콘·고유 일러스트를 우리 UI에 쓰지 않는다.
- 제품명은 비교·출처 표시에만 쓰고, 우리 제품 이름·도메인·로고에 쓰지 않는다.
- “삼성 MagicINFO 스타일”, “LG SuperSign 스타일” 같은 브랜드 결합 명칭을 만들지 않는다.

## 7. 정부 상징·공식 서비스 표장

- KRDS의 공식 배너(Masthead)와 운영기관 식별자는 정부 공식 누리집을 위한 것이다.
- 내부 관리자 화면에 붙이면 공식 정부 서비스로 오인될 수 있다.
- 정부 상징, 기관 로고, “대한민국 정부” 표장은 저작권과 별도의 상표·공식 표장 정책을 확인해야 한다.
- 국립부산국악원의 로고·명칭을 쓰려면 기관의 사용 규정을 확인한다.
- 우리 제품의 기본 브랜드는 “국악원 사이니지” 같은 가상의 내부 이름으로 하고, 공개 전에 기관 승인을 받는다.

## 8. 자산 대장

| ID | 자산 | 버전·파일 | 라이선스 | 고지 방식 | 상태 |
|---|---|---|---|---|---|
| A1 | KRDS 가이드·컴포넌트 | 2026-11-24 확인 | 공공누리 1유형 | 문서·앱 고지 | 사용 가능 |
| A2 | KRDS HTML Kit | GitHub main | ISC + KRDS 약관 | LICENSE·README 고지 | 보수적 검토 |
| A3 | Pretendard GOV | KRDS subset woff2 | OFL 1.1 + KRDS | 폰트 LICENSE | 사용 가능 |
| A4 | Noto Sans KR | Google Fonts | OFL 1.1 | 폰트 LICENSE | 대안 |
| A5 | 나눔고딕 | 네이버 배포 | OFL(버전 확인) | 폰트 LICENSE | 대안 |
| A6 | Spoqa Han Sans Neo | GitHub | OFL 1.1 | 폰트 LICENSE | 대안 |
| A7 | Lucide | 최신 | ISC | LICENSE | 기본 아이콘 |
| A8 | Heroicons | 최신 | MIT | LICENSE | 대안 |
| A9 | Material Symbols | 최신 | Apache 2.0 | LICENSE·NOTICE | 대안 |
| A10 | Swiper | KRDS 동봉 | MIT | LICENSE | KRDS 사용 시 |
| A11 | Xibo | 조사 대상 | AGPL-3.0 | 소스 제공 | 연구만 |
| A12 | 우리 SVG 아이콘 | 자체 제작 | 자체 라이선스 | 저작권 표시 | 사용 가능 |

## 9. 고지 문구 예시

### KRDS

> 본 저작물은 행정안전부에서 2024년 작성하여 공공누리 제1유형으로 개방한 ‘범정부 UI/UX 디자인시스템(KRDS)’을 이용하였으며, 해당 저작물은 ‘KRDS 디자인시스템 홈페이지(www.krds.go.kr)’에서 무료로 다운받으실 수 있습니다.

### Pretendard

> Pretendard © 2021 Kil Hyung-jin, with Reserved Font Name ‘Pretendard’. Licensed under the SIL Open Font License, Version 1.1.

### Noto Sans KR

> Noto Sans CJK © Google, licensed under the SIL Open Font License, Version 1.1.

### Lucide

> Lucide Icons © 2026 Lucide Icons and Contributors. ISC License. Portions derived from Feather, MIT License.

### Heroicons

> Heroicons © Tailwind Labs, Inc. MIT License.

### Material Symbols

> Material Symbols © Google. Apache License 2.0.

### Swiper

> Swiper © 2014-2024 Vladimir Kharlampidi. MIT License.

고지 문구는 배포물의 “오픈소스 라이선스” 화면과 저장소의 licenses/ 디렉터리에 함께 둔다. 폰트·아이콘 파일을 수정하면 수정 사실과 날짜를 기록한다.

## 10. 재사용 가능·불가

### 재사용 가능

- KRDS의 정보 구조·패턴·토큰·컴포넌트를 출처와 함께 사용.
- Pretendard GOV·Noto Sans KR·나눔·Spoqa를 OFL 조건으로 자체 호스팅.
- Lucide·Heroicons·Material Symbols를 각 라이선스 고지와 함께 사용.
- Swiper를 MIT 고지와 함께 사용.
- 우리가 직접 만든 SVG·화면·문구.

### 재사용 불가

- 삼성·LG·위캐스트·와이브로드·시스메이트·스마트너·잇다의 화면·매뉴얼·브로셔·영상·로고·아이콘·고유 디자인.
- 상용 제품의 화면을 “우리 디자인”으로 재배포.
- 정부 상징·공식 배너·기관 식별자를 승인 없이 사용.
- 폰트 파일만 단독 판매.
- 예약 이름이 있는 폰트의 수정본을 같은 이름으로 배포.
- Xibo AGPL 코드를 소스 공개 없이 폐쇄형 네트워크 서비스에 통합.
- 제품명·상표를 우리 브랜드로 사용.

## 11. 확인이 필요한 것

| 항목 | 왜 확인해야 하는가 | 조치 |
|---|---|---|
| KRDS 코드의 ISC vs 공공누리 | package.json과 사이트·README 표기가 다름 | 배포 전 KRDS 운영기관 문의, 두 고지 모두 유지 |
| Pretendard GOV 전용 라이선스 | KRDS 킷에 별도 LICENSE 없음 | 업스트림 OFL + KRDS 출처 유지, 필요 시 문의 |
| 나눔 폰트 정확한 OFL 버전 | 저장소 README만 확인 | 배포 패키지 LICENSE 보관 |
| 상용 제품 화면 재사용 범위 | 브로셔·매뉴얼은 “All images illustrative”, 저작권 표시 | 조사용으로만 사용, 이미지 커밋 금지 |
| 정부 상징·기관 로고 | 저작권과 별도 상표·공식 표장 정책 | 기관 담당 부서 확인 |
| Xibo 통합 | AGPL 네트워크 소스 공개 의무 | 법무 검토 전 코드 복사 금지 |
| 최종 배포 라이선스 | 프로젝트 라이선스 미정 | 공개 전 기관·법무 검토 |

## 12. 출처

모든 URL 확인일은 2026-11-24(KST)이다.

| ID | 자료 | URL | 비고 |
|---|---|---|---|
| L1 | KRDS 저작권정책 | https://www.krds.go.kr/html/site/utility/utility_06.html | 공공누리 1유형, 2025-05-13 수정 |
| L2 | KRDS GitHub | https://github.com/KRDS-uiux/krds-uiux | HTML 컴포넌트 킷 |
| L3 | KRDS 타이포그래피 | https://www.krds.go.kr/html/site/style/style_03.html | Pretendard GOV |
| L4 | Pretendard LICENSE | https://github.com/orioncactus/pretendard/blob/main/LICENSE | OFL 1.1 |
| L5 | Noto Sans CJK LICENSE | https://github.com/googlefonts/noto-cjk/blob/main/Sans/LICENSE | OFL 1.1 |
| L6 | 네이버 나눔 글꼴 | https://hangeul.naver.com/font/nanum | 오픈 라이선스 |
| L7 | 나눔고딕 GitHub | https://github.com/naver/nanumfont | OFL 안내 |
| L8 | Spoqa Han Sans LICENSE | https://github.com/spoqa/spoqa-han-sans/blob/master/LICENSE | OFL 1.1 |
| L9 | Lucide LICENSE | https://github.com/lucide-icons/lucide/blob/main/LICENSE | ISC |
| L10 | Heroicons LICENSE | https://github.com/tailwindlabs/heroicons/blob/master/LICENSE | MIT |
| L11 | Material Design Icons LICENSE | https://github.com/google/material-design-icons/blob/master/LICENSE | Apache 2.0 |
| L12 | Swiper LICENSE | https://github.com/nolimits4web/swiper/blob/master/LICENSE | MIT |
| L13 | Xibo CMS | https://github.com/xibosignage/xibo-cms | AGPL-3.0 |
| L14 | Xibo LICENSE | https://github.com/xibosignage/xibo-cms/blob/develop/LICENSE | AGPL-3.0 |
| L15 | Samsung MagicINFO 제품 페이지 | https://www.samsung.com/sec/business/display-solution/display-solution-bwmip70pa/BW-MIP70PA/ | 조사 참고 |
| L16 | LG SuperSign CMS 페이지 | https://www.lg.com/global/business/commercial-display/software-services/lg-supersign-cms/ | 조사 참고 |
| L17 | 위캐스트 ONE-DS | https://wecast.co.kr/digitalsignage | 조사 참고 |
| L18 | 와이브로드 Y_BOARD | https://ybroad.net/yboard/ | 조사 참고 |
| L19 | 시스메이트 국립부산국악원 사례 | https://www.sysmate.co.kr/reference/0000001995 | 조사 참고 |
| L20 | 스마트너 CMS | http://www.smartner.co.kr/default/solution/cms.php | 조사 참고 |
| L21 | 잇다디지털사이니지 | https://itda.ai.kr/products/itda-signage.html | 조사 참고 |
| L22 | 개인정보 보호법 | https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4%EB%B3%B4%ED%98%B8%EB%B2%95 | 법적 맥락 |
| L23 | 저작권법 | https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EC%A0%80%EC%9E%91%EA%B6%8C%EB%B2%95 | 법적 맥락 |

## 13. 1차 MVP 자산(2026-11-24)

### 13.1 직접 제작한 샘플 포스터

- `seed/poster-autumn.png`, `seed/poster-welcome.png`, `seed/poster-class.png`와 `seed/source/*.svg`는 이 저장소를 위해 제작한 **가상 예시**입니다.
- 실제 국립부산국악원의 공식 공연 정보·포스터·로고가 아니며, 프로젝트와 같은 Apache-2.0으로 배포합니다.
- 생성 방법: `seed/source/`의 SVG를 Edge 헤드리스로 1920×1080 또는 1080×1920 PNG로 렌더링했습니다. 원본 SVG를 함께 보관합니다.

### 13.2 샘플 동영상

| 자산 | 권리자 | 라이선스 | 출처·고지 |
|---|---|---|---|
| `seed/sample-video.mp4` (10초, 360p) | Blender Foundation | CC BY 3.0 | “Big Buck Bunny”, © 2008 Blender Foundation, <https://www.bigbuckbunny.org/>, <https://creativecommons.org/licenses/by/3.0/> |

- 재생기 동영상 재생·캐시·오프라인 검증에만 사용합니다. 샘플 영상은 실제 운영 콘텐츠가 아닙니다.
- 배포 시 저작자 표시와 라이선스 링크를 유지합니다. `seed/README.md`와 루트 `NOTICE`에도 같은 고지를 두었습니다.

### 13.3 런타임·개발 의존성

- `express`(MIT), `multer`(MIT), `image-size`(MIT), `tsx`(MIT), `playwright-core`(Apache-2.0), `typescript`(Apache-2.0). 각 패키지의 LICENSE는 `node_modules` 배포물에 포함됩니다.
- 프로젝트는 GPL/AGPL 코드를 새 MVP 소스에 복사하지 않았습니다. `poc/`는 별도로 Apache-2.0으로 공개된 자체 PoC이며, MVP는 그 코드를 직접 가져오지 않고 용어·계약만 비교했습니다.
- 웹 화면은 외부 폰트·아이콘·CDN을 불러오지 않고 시스템 한글 글꼴과 직접 만든 CSS/문자 아이콘을 사용합니다.
