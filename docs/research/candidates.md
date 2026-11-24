# 오픈소스 디지털 사이니지 후보 조사

- 확인일: 2026-11-24 (KST)
- 방법: GitHub API로 저장소·릴리스·최근 커밋·라이선스를 확인하고, 각 프로젝트의 공식 README와 문서를 직접 읽었다. 웹 검색 도구는 이 환경에서 오류가 나서 사용하지 못했고, 1차 자료만 근거로 삼았다.
- 평가 기준: 라이선스, 유지보수 상태, 플레이어 운영체제, 다중 모니터 동기화, 한글 관리 화면, 설치 난이도, 오프라인·자동 복구, 국가기관 적용성.

## 한눈에 보기

| 후보 | 라이선스 | 최신 릴리스 | 최근 커밋 | 플레이어 | 다중 모니터 동기화 | 한글 UI | 판정 |
|---|---|---|---|---|---|---|---|
| Xibo | AGPL-3.0 (상용 라이선스 별도) | CMS 2026.11.71 (2026-11-23) | 2026-11-23 | Windows .NET, Windows/Linux Electron, 상용 Android·webOS·Tizen | 있음: Sync Group + Synchronised Event, 리드 디스플레이 | 있음 (ko.mo) | 조건부 최우선 검토 |
| ScreenTinker | MIT | v3.2.5 (2026-11-22) | 2026-11-24 | 웹 브라우저, Android, Tizen, webOS, Roku, Pi/Windows 네이티브(개발 중) | 있음: 공유 시계 기반 비디오월·존 | 없음 (10개 언어, ko 없음) | 기술 검증용 파일럿 |
| Anthias | GPLv2 + 상용 듀얼 | v2026.11.1 (2026-11-19) | 2026-11-23 | Raspberry Pi, 64비트 x86 Linux | 미러 전용 (같은 재생목록) | 없음 | 단순 미러용 |
| Concerto | Apache-2.0 | 3.0.0.rc3 (태그), 안정판 2.3.6 (2017) | 2026-11-24 | 웹 브라우저 (Chrome 53+) | 명시적 동기화 없음 | 없음 (영문만) | 동기화 요구에 부적합 |
| Screenlite | MIT | 릴리스 없음 | 2026-01-08 | 웹 | 확인되지 않음 | 확인되지 않음 | 제작 중, 제외 |
| Garlic Hub | AGPL-3.0 | v1.2.0 (2026-11-02) | 2026-11-22 | SMIL 플레이어 생태계 | 명시적 다중 화면 동기화 없음 | 없음 | 후보에서 제외 |

## 1. Xibo

**저장소와 상태**

- CMS: `xibosignage/xibo-cms`, 518 stars, AGPL-3.0, 최신 릴리스 2026.11.71 (2026-11-23), 최근 커밋 2026-11-23.
- Windows .NET 플레이어: `xibosignage/xibo-dotnetclient`, AGPL-3.0, 최신 릴리스 4R407 (2026-06-04).
- Electron 플레이어: `xibosignage/electron-player`, AGPL-3.0, 최신 릴리스 v4.0.13 (2026-10-09). Windows MSI와 Linux DEB/Snap을 제공한다.
- Xibo는 2009년부터 이어진 프로젝트이고, CMS와 Windows 플레이어를 오픈소스로 제공한다. Android·LG webOS·Samsung Tizen 플레이어는 상용 옵션이다.

**구성과 요구사항**

- CMS는 PHP·MySQL 기반이며, 공식적으로 자체 호스팅은 **Docker만 지원**한다. README 기준 호스트 RAM 최소 2GB, Docker Compose v2.20 이상이 필요하다.
- .NET 플레이어는 **Windows 10 이상**, .NET Framework 4.7.2 이상이 필요하다.
- CMS는 Docker가 실행되는 Linux·Windows·macOS 호스트에 올릴 수 있다. Windows에서 Docker Desktop을 쓰려면 WSL2/Hyper-V가 필요하므로, 기관 PC 보안 정책에 따라 막힐 수 있다.

**다중 모니터 동기화**

- `Sync Group`에 디스플레이를 묶고, `Synchronised Event`를 예약하면 2대 이상의 화면을 미러 또는 비디오월로 동기화할 수 있다.
- 그룹마다 **리드 디스플레이(Lead Display)** 를 지정한다. 화면별로 다른 레이아웃을 선택할 수 있고, 전체 재생 시간은 리드 디스플레이의 콘텐츠가 결정한다.
- 동기화는 같은 LAN에서 TCP 9590 포트(변경 가능)로 이뤄진다. 문서는 유선 네트워크와 성능이 비슷한 장비를 권장한다.
- 즉, “모니터마다 다른 이미지 + 같은 시각에 다음 이미지로 전환”이라는 이번 요구사항을 제품 기능만으로 구현할 수 있다. 별도 개조가 필요 없다.

**한글과 운영**

- CMS `locale/`에 `ko.mo`가 포함되어 있다(전체 49개 로케일). 관리 화면을 한국어로 쓸 수 있다.
- 스케줄, 레이아웃, 재생 증명(Proof of Play), 원격 명령, 사용자 권한 등 기능이 성숙하다.
- CMS 업데이트·백업·MySQL·Docker 운영 부담이 있고, AGPL-3.0이므로 수정 후 네트워크로 제공할 때 소스 공개 의무를 검토해야 한다. Xibo는 별도 상용 라이선스도 판매한다.

**적용 판단**

- 기존 PC가 Windows 10/11이고, 원내에 Docker를 돌릴 Linux 서버나 VM이 있으면 **가장 성숙한 턴키 후보**다.
- 기존 PC가 Windows 7/8.1이거나 Docker/WSL2를 쓸 수 없으면 현재 Xibo 플레이어로는 적용이 어렵다. 억지로 구버전 플레이어를 쓰는 것은 보안·호환성 면에서 권장하지 않는다.
- Windows 플레이어는 PC 1대당 1개 화면을 전제로 한다. 한 PC에 모니터 4대를 붙이는 구성은 Xibo보다 별도 다중 창 플레이어가 적합하다.

## 2. ScreenTinker

**저장소와 상태**

- `screentinker/screentinker`, 277 stars, MIT, 최신 릴리스 v3.2.5 (2026-11-22), 최근 커밋 2026-11-24.
- Node.js·Express·SQLite 기반이며, Docker 이미지 또는 systemd 설치를 지원한다. README는 “single-developer maintained”라고 스스로 밝힌다.
- 서버·대시보드·웹 플레이어가 한 저장소에 있고, Android·Tizen·webOS·Roku·Pi/Windows 네이티브 플레이어를 별도로 제공한다.

**다중 모니터 동기화**

- `docs/video-walls.md`에 비디오월 기능이 설명되어 있다. 화면을 캔버스에 배치하고, 존(zone)별 재생목록과 Hold 아이템을 설정한다.
- 각 존은 **서버와 동기화된 같은 시계**로 재생 위치를 계산한다. 문서 표현대로 “No screen is in charge”이며, 플레이리스트를 받은 뒤에는 서버가 없어도 각 화면이 같은 시간축으로 계속 재생한다.
- 존의 합계 시간을 맞추면 화면이 번갈아 나타나는 패턴도 만들 수 있다. 예: 화면1은 A 30초 + Hold 60초, 화면2는 Hold 30초 + B 60초.
- 다만 이 기능은 **비디오월(하나의 큰 화면을 여러 패널로 나누는 구성)** 을 전제로 한다. 서로 떨어진 2개 인포메이션센터의 독립 모니터를 “A/B/C/D → D/A/B/C”로 돌리는 용도로 바로 맞는지는 추가 검증이 필요하다.

**Windows·한글**

- 웹 플레이어는 최신 브라우저와 키오스크 브라우저에서 동작하고, 구형 엔진용 `/player/legacy`도 있다.
- Windows 네이티브 플레이어는 “서버·대시보드 쪽은 구현됐고 Windows OS 백엔드를 만드는 중”이라고 문서에 적혀 있다. 비디오월 문서도 “Windows/Pi에서는 아직 실행해 보지 않았고 Android 에뮬레이터만 확인했다”고 명시한다.
- i18n 파일은 덴마크어·독일어·영어·스페인어·프랑스어·힌디어·이탈리아어·일본어·네덜란드어·포르투갈어·중국어가 있고 한국어는 없다.

**적용 판단**

- MIT라 기관 적용과 수정이 쉽고, 기능도 이번 요구에 가깝다. 다만 단일 개발자 유지보수, 큰 기능 표면(멀티테넌시·과금·라이브 비디오·메시 등), Windows 비디오월 미검증이라는 위험이 있다.
- 전면 도입보다는 **1개 화면 또는 2개 화면 파일럿**으로 웹 플레이어의 동기화·오프라인·키오스크 동작을 직접 확인한 뒤 판단하는 것이 맞다.

## 3. Anthias (구 Screenly OSE)

**저장소와 상태**

- `Screenly/Anthias`, 3,742 stars, GPLv2 + 상용 듀얼 라이선스, 최신 릴리스 v2026.11.1 (2026-11-19), 최근 커밋 2026-11-23.
- Raspberry Pi 2/3/4/5, 64비트 x86 Linux, 일부 Armbian 보드를 지원한다. Windows용 플레이어는 없다.

**다중 화면**

- 최근 `website/content/docs/multi-screen.md`가 추가되었다. 한 대를 컨트롤러로 삼아 같은 재생목록을 여러 화면에 배포한다.
- 문서가 명시하기를 “Every screen shows the same playlist (mirror mode)”이며, “다른 화면에 다른 콘텐츠가 필요하면 상용 Screenly를 쓰라”고 안내한다. 즉, 화면별 오프셋 순환은 지원하지 않는다.
- 컨트롤러와 화면은 같은 LAN, TCP 8443, 정확한 NTP 시계가 필요하다.

**한글·적용 판정**

- 저장소에서 i18n/로케일 구조를 찾지 못했다. 관리 화면은 영어 중심으로 보인다.
- 라즈베리파이를 새로 들이거나 Linux로 전환해도 된다면 단순 미러 송출에는 좋은 선택이다. 이번처럼 모니터마다 다른 이미지를 돌리는 요구에는 맞지 않는다.

## 4. Concerto

**저장소와 상태**

- `concerto/concerto`, 485 stars, Apache-2.0, 최근 커밋 2026-11-24.
- `VERSION`은 `3.0.0.rc3`이고, GitHub 최신 정식 릴리스는 2.3.6(2017-12-31)이다. 3.0은 아직 RC 단계다.
- Ruby on Rails·SQLite 기반이며 Docker 이미지를 제공한다. 프런트엔드는 Vue/Vite 브라우저 플레이어다.

**기능과 한계**

- 화면(screen)마다 템플릿과 필드를 두고, 피드(feed)를 구독해 이미지·텍스트·iframe·영상·RSS를 표시한다. 콘텐츠 승인·스케줄·순서·전환 효과가 있다.
- 플레이어는 Chrome 53+, Firefox 69+, Safari 13.1+를 허용한다. IE는 차단한다. 오래된 Windows PC에 Chrome 109를 설치할 수 있다면 브라우저 플레이어로 쓸 수 있다.
- 여러 화면의 재생 위치를 맞추는 명시적 동기화 기능은 코드와 문서에서 확인되지 않았다. 화면별 독립 콘텐츠에는 적합하지만, “같은 순간에 다음 이미지로 전환” 요구에는 별도 개조가 필요하다.
- `config/locales`에는 영어만 있다. 한글 관리 화면을 만들려면 번역 작업이 필요하다.

**적용 판단**

- 3.0 RC와 2017년 안정판이라는 간극, 동기화 부재, 영문 UI 때문에 이번 프로젝트의 주 후보에서는 제외한다. 단순히 화면별로 다른 콘텐츠를 보여주는 용도라면 가벼운 대안이 될 수 있다.

## 5. 그 밖의 후보

| 후보 | 확인 결과 | 판정 |
|---|---|---|
| Screenlite | MIT, 368 stars, 최근 커밋 2026-01-08. README가 “public development, not ready for production use”라고 명시 | 제외 |
| Garlic Hub | AGPL-3.0, v1.2.0, PHP·SMIL 기반 CMS. 플레이어 생태계는 있으나 Windows 브라우저 동기화가 명확하지 않고 한글 UI 없음 | 제외 |
| FullPageOS | GPL-3.0, 0.14.0. 라즈베리파이 부팅 시 전체 화면 브라우저를 띄우는 배포판. CMS가 아님 | 구성 요소로만 참고 |
| MagicMirror² | MIT, v2.38.0. 모듈형 스마트 미러 플랫폼. CMS·동기화 기능 없음 | 구성 요소로만 참고 |
| info-beamer | 핵심 저장소는 2020년 아카이브. 상용 호스팅 제품이 중심 | 무료 자체 호스팅 후보에서 제외 |
| LibreSignage | BSD-3-Clause, 2021년 아카이브 | 제외 |
| piSignage | 라이선스 없음(저장소에 라이선스 파일 없음) | 제외 |

## 범용 요구 관점의 격차

2026-11-24 추가 요구(1~N 모니터, 장소별 그룹, 가변 배치, 이미지 수≠모니터 수, 4가지 재생 모드, 자동 등록, 가상 미리보기, 관리/엔진/송출 분리, 한글 초보자 UX)를 기준으로 다시 비교했다.

| 요구 | Xibo | ScreenTinker | Anthias | Concerto |
|---|---|---|---|---|
| 1~N 모니터, 수량 비고정 | O | O | △ (미러 위주) | △ (화면별 독립) |
| 장소별 독립 그룹 | O | O | △ (컨트롤러 1대) | △ |
| 가로·세로·격자·사용자 지정 배치 | △ (레이아웃 영역은 자유, 모니터 배치는 제약) | O (캔버스 드래그) | X | △ (템플릿 CSS) |
| 모니터별 해상도·방향 | O | O | △ | △ |
| 자동 인식·수동 등록 | △ (CMS 주소·키 등록 후 승인) | O (페어링 코드/링크) | O (조인 정보) | △ |
| 이미지 규격 검사·비율 유지 | O | O | △ | △ |
| 개별·순환·동시·통합 재생 | O | O | △ (미러) | X (동기화 없음) |
| 이미지 수≠모니터 수 | O | O | △ | △ |
| 모니터 추가·해제 대응 | O | O | O | △ |
| 가상 모니터 미리보기 | O (레이아웃 미리보기) | O (라이브/미리보기) | △ | △ |
| 송출 모듈 분리·장비별 선택 | △ (플레이어 앱은 여러 개, 구조는 모놀리식) | O (웹/Android/Tizen/Pi/Windows, 네이티브는 개발 중) | X (Linux 전용) | △ (브라우저 전용) |
| 한글 UI | O (ko.mo) | X | X | X |
| 매뉴얼 없이 쓰는 초보자 UX | △ (기능이 많아 복잡) | △ (기능이 많아 복잡) | △ | △ |
| 라이선스 | AGPL-3.0 | MIT | GPLv2+상용 | Apache-2.0 |

- **Xibo**는 범용 요구를 가장 많이 제품 기능으로 덮는다. 다만 모니터 자유 배치·자동 발견·초보자 UX는 기대만큼 단순하지 않고, Docker와 Windows 10+가 전제다.
- **ScreenTinker**는 가변 배치·비디오월·다중 송출 모듈·MIT라는 점에서 기술적으로 가장 가깝다. 그러나 한글 UI가 없고, 단일 개발자 유지보수이며, Windows 비디오월은 아직 검증되지 않았다.
- **Anthias**는 미러 전용, **Concerto**는 동기화 부재·RC 단계라 범용 요구의 핵심을 충족하지 못한다.
- **경량 자체 개발**은 이 표의 요구를 처음부터 맞출 수 있지만, 개발·테스트 공수가 가장 크다. 그래서 UI·UX를 먼저 검증하고, 엔진 범위를 이미지 중심으로 좁힌다.

## UI·UX 벤치마킹 대상

기능 비교와 별도로, 실제 서비스 화면·매뉴얼·공개 데모를 조사한다. 특정 제품의 화면·아이콘·로고를 복제하지 않고, 정보 구조·흐름·피드백 패턴만 추상화한다.

- 해외: Xibo, Yodeck, ScreenCloud, OptiSigns, Play Digital Signage, Anthias, ScreenTinker, Concerto, Screenly, NoviSign, Signagelive, Mvix, Reach Media.
- 국내: Samsung MagicINFO, LG SuperSign, 국내 사이니지 CMS·공공 납품 사례. 실제 공개 화면이 없으면 공식 매뉴얼·데모·소개 영상으로 보완한다.
- 공공: KRDS(한국형 웹 콘텐츠 접근성 지침, 디지털 정부서비스 UI/UX 가이드라인).
- 조사 항목: 대시보드, 장소·그룹 관리, 화면 등록, 가변 배치, 이미지 등록·규격, 드래그 앤 드롭, 재생목록·시간, 미리보기, 상태·오류, 초보자 편의성.
- 산출물: `docs/research/ui-benchmark-intl.md`, `docs/research/ui-benchmark-kr.md`, `docs/research/krds.md`, `docs/research/licenses.md`.

## 결론

1. **턴키 오픈소스 도입**만 놓고 보면 Xibo가 가장 앞선다. 동기화 그룹, 화면별 레이아웃, 한글 CMS, Windows 플레이어를 모두 갖췄다. 조건은 Windows 10 이상 플레이어 PC와 Docker를 돌릴 서버·VM이다.
2. **MIT·가벼운 비디오월**을 원하면 ScreenTinker가 기술적으로 가장 가깝다. 그러나 단일 개발자 유지보수와 Windows 비디오월 미검증을 파일럿으로 확인해야 한다.
3. **기존 Windows 장비를 그대로 쓰고, 2개 센터·소수 모니터·이미지 중심·한글 UI**라는 범위에 맞추면 경량 자체 개발이 총비용과 호환성 면에서 가장 효율적이다.
4. Anthias는 미러 전용, Concerto는 동기화 없음·RC 단계, 나머지는 제작 중이거나 유지보수가 끝났다.

## 출처

- Xibo CMS: https://github.com/xibosignage/xibo-cms (README, 2026-11-24 확인)
- Xibo Windows .NET player: https://github.com/xibosignage/xibo-dotnetclient
- Xibo Electron player: https://github.com/xibosignage/electron-player
- Xibo Sync Groups: https://github.com/xibosignage/xibo-manual/blob/main/source/en/displays_sync_groups.md
- Xibo Synchronised Events: https://github.com/xibosignage/xibo-manual/blob/main/source/en/scheduling_events.md
- ScreenTinker: https://github.com/screentinker/screentinker
- ScreenTinker video walls: https://github.com/screentinker/screentinker/blob/main/docs/video-walls.md
- ScreenTinker Windows native player: https://github.com/screentinker/screentinker/blob/main/docs/windows-native-player.md
- ScreenTinker web player: https://github.com/screentinker/screentinker/blob/main/docs/web-player.md
- Anthias: https://github.com/Screenly/Anthias
- Anthias multi-screen: https://github.com/Screenly/Anthias/blob/master/website/content/docs/multi-screen.md
- Concerto: https://github.com/concerto/concerto
- Concerto player controller: https://github.com/concerto/concerto/blob/main/app/controllers/frontend/player_controller.rb
- Screenlite: https://github.com/screenlite/screenlite
- Garlic Hub: https://github.com/garlic-signage/garlic-hub
- FullPageOS: https://github.com/guysoft/FullPageOS
- MagicMirror: https://github.com/MagicMirrorOrg/MagicMirror

모든 별 수·릴리스·커밋 날짜는 2026-11-24 GitHub API 조회 값이다. 이후 변동될 수 있다.
