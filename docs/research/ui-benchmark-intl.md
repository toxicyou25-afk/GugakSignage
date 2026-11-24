# 해외 디지털 사이니지 UI/UX 벤치마크

- 작성일: 2026-11-24 (KST)
- 대상: Xibo, Yodeck, ScreenCloud, OptiSigns, Play Digital Signage, Anthias
- 2라운드 추가: NoviSign, Mvix, ScreenTinker, Concerto; Reach Media는 공개 제품 확인 실패
- 보조 확인: Screenly, Signagelive (공개 문서만)
- 목적: 국립부산국악원 이미지 송출 시스템의 화면 구조·용어·피드백 패턴을 검증한다. 제품의 화면·아이콘·로고·독창적 디자인을 복제하지 않는다.

## 0. 먼저 읽을 결론

1. **다중 모니터 배치는 아직 제품 시장의 빈틈이다.** 대부분 “모니터 1대 = 플레이어 1대 = 화면 1개”를 기본으로 한다. 여러 모니터를 한 캔버스에서 다루는 기능은 OptiSigns의 2~4대 비디오월, ScreenCloud의 Windows 확장 데스크톱, Yodeck·Play의 외부 하드웨어 우회가 전부다. 임의의 N대, 서로 다른 해상도·방향, 자유 배치를 한 화면에서 다루는 제품은 확인하지 못했다.
2. **등록 흐름은 “짧은 코드 + 기기 종류 안내 + 테스트 화면”으로 수렴한다.** Yodeck·ScreenCloud·OptiSigns·Play 모두 6~9자리 코드를 쓰고, Yodeck·ScreenCloud·OptiSigns는 계정만으로 브라우저 테스트 화면을 제공한다. 초보자에게 실제 하드웨어를 요구하기 전에 “일단 화면에 띄워 보기”를 제공하는 패턴이 가장 재사용 가치가 높다.
3. **이미지 규격 검사는 대부분 “안내”에 그친다.** 화면 비율이 맞지 않으면 검정 여백·왜곡이 생긴다고 FAQ에서 설명하지만, 업로드 시 대상 모니터별로 “이 이미지가 이 화면에 맞는가”를 자동 검사하는 제품은 확인하지 못했다. Xibo·Yodeck·OptiSigns·Play는 Fit/Fill/Stretch 선택과 수동 점검에 의존한다. 이 프로젝트의 “업로드 즉시 규격 검사 + 화면별 안전 영역”은 차별화 지점이다.
4. **미리보기와 상태는 별개다.** ScreenCloud의 채널 미리보기, Yodeck의 레이아웃·플레이리스트 미리보기가 가장 쓸 만하지만, 여러 모니터의 시간축을 함께 돌리는 사이트 단위 시뮬레이션은 없다. 상태 화면은 온라인·오프라인·마지막 접속·저장 공간을 보여주는 수준이다. “가상 모니터 + 시간 이동 + 경고 + 게시 요약”은 직접 설계할 가치가 있다.
5. **초보자의 진짜 장벽은 기능 수가 아니라 용어와 숨은 규칙이다.** Channel/Playlist/Zone/Space/Workspace/Layout/Display Group이 서로 다른 뜻으로 쓰이고, “일정이 없으면 검은 화면”, “플레이리스트가 스케줄을 들고 있음”, “무료 플랜에서는 분할 화면을 저장만 하고 재생 불가” 같은 규칙이 문서 곳곳에 흩어져 있다. 한국어 과업 중심 문구와 “다음 할 일”을 화면에 고정하는 접근이 필요하다.

2라운드에서 ScreenTinker가 비디오월 캔버스·Playlist 수준 Layout·시간 지정 미리보기로 가장 가까운 참조 구현임을 확인했고, Concerto의 콘텐츠 fit score는 이미지 비율 처리에 참고할 만한 새 패턴을 제공했다. 자세한 내용과 증거 신뢰도는 §9에 정리했다.

## 1. 조사 방법과 한계

- 공식 웹사이트, 공식 도움말 센터, 공식 매뉴얼, 공개 데모/마케팅 화면, 오픈소스 저장소만 사용했다.
- 유료 가입이나 계정 생성을 하지 않았다. 관리자 화면을 직접 조작한 것이 아니라, 제품이 공개한 화면 캡처와 문서의 단계 설명을 대조했다.
- Xibo·Yodeck·ScreenCloud·OptiSigns·Play의 관리자 계정 데모는 공개되어 있지 않거나 가입이 필요했다. Anthias도 호스팅 데모가 없어 공식 화면 캡처와 소스 템플릿으로 확인했다.
- 스크린샷은 조사 증거로만 `artifacts/research/screens/intl/<product>/`에 저장했고, `artifacts/`는 `.gitignore` 대상이다. 저장소·배포물에는 제3자 화면·로고·아이콘을 넣지 않는다.
- 이미지 캡처는 공식 문서에 실린 제품 화면이거나, 제품이 공개한 마케팅용 UI 이미지다. 화면의 실제 데이터·계정은 제품의 공개 예시이며 우리 기관 데이터가 아니다.
- ScreenCloud 문서에는 2019·2021년 캡처와 2024년 이후 캡처가 섞여 있다. 오래된 화면은 “당시 문서 기준”으로만 해석했다.
- 2026-11-24 접속 기준이다. 이후 UI·가격·기능이 바뀔 수 있다.

표기: ○ 공식 문서/화면에서 확인, △ 부분 지원·우회·제약 있음, × 지원하지 않거나 공개 문서에서 찾지 못함, ? 확인하지 못함.

## 2. 비교 매트릭스

### 2.1 사업·라이선스

| 제품 | 제공 형태 | 무료/체험 | 공개 화면 근거 |
|---|---|---|---|
| Xibo | 자체 호스팅 Community Edition(AGPL-3.0) + 유료 Xibo Pro/Cloud | CE 무료, Pro 14일 체험(2대, 카드 불필요) | 공식 매뉴얼 화면 3종, 라이브 데모 없음 |
| Yodeck | 호스팅 SaaS, 전용 플레이어/앱 | 무료 1대, 30일 전체 기능 체험(5대, 카드 불필요) | 공식 도움말 화면 6종, 라이브 데모 없음 |
| ScreenCloud | 호스팅 SaaS, 자체 OS/서드파티 플레이어 | 14일 Studio 체험, 가상 화면 3개 | 공식 도움말 화면 5종(일부 오래된 캡처) |
| OptiSigns | 호스팅 SaaS, 자체/서드파티 플레이어 | 무료 3대(1GB, 파일 25MB), 14일 전체 체험 | 공식 도움말 화면 6종 |
| Play Digital Signage | 호스팅 SaaS, 100+ 플레이어 | 첫 화면 30일 무료(30일 내 리뷰 시 계속 무료) | 공식 사이트 UI 이미지 3종 + 문서 |
| Anthias | 오픈소스 GPLv2 + 상용 듀얼, 기기 로컬 | 소프트웨어 무료, 하드웨어 별도 | 공식 사이트 화면 4종 + 소스 템플릿 |

### 2.2 UI·기능

| 질문 | Xibo | Yodeck | ScreenCloud | OptiSigns | Play | Anthias |
|---|---|---|---|---|---|---|
| 1~N 화면, 수량 비고정 | ○ Display 단위 | ○ 화면 단위(플레이어 1대=1화면) | ○ 라이선스 단위 | ○ 화면 단위 | ○ 화면 단위 | △ 컨트롤러 1대 + 미러 화면 |
| 장소·그룹 관리 | ○ Display Groups(동적·수동·중첩) | △ Workspaces(Enterprise) | ○ Screen Groups + Spaces | △ Teams(Pro Plus 이상) | ○ Groups + Teams | × 컨트롤러 1개 |
| 화면 자동 발견 | × 코드/CMS 키 등록 | × 코드/안내형 등록 | × 6자리 코드/QR | × 6자리 코드 | × 6자리 코드 | × 조인 정보 붙여넣기 |
| 화면별 해상도·방향 | ○ | ○ | ○ | ○ | ○ | △ 기기 설정 |
| 다중 모니터 자유 배치 | △ Sync Group/비디오월 | △ 외부 스트리머·크롭 | △ Windows 확장 데스크톱(대칭만) | ○ 2~4대(Pro/ProMax+애드온) | △ 외부 GPU/컨트롤러 | × 미러 전용 |
| 이미지 업로드 | ○ | ○ | ○ | ○ | ○ | ○ |
| 업로드 시 규격 자동 검사 | △ 리사이즈 임계값·방향 수동 | × 안내·검정 여백 | △ Fit/Fill 안내 | △ 형식·용량만 | △ 편집 도구 | △ MIME·코덱 오류 |
| 드래그 앤 드롭 구성 | ○ Layout Editor | ○ Layout Editor | ○ Channels/Canvas | ○ Designer/Split Screen | ○ Slide Editor | × 목록형 |
| 재생목록·스케줄 | ○ Daypart/Sync Event | ○ Playlist/Schedule | ○ Channel/Playlist | ○ Schedule/Recurrence | ○ Group Schedule | △ 자산별 시간창 |
| 미리보기·시뮬레이션 | △ Layout Play | ○ Layout/Playlist Preview | ○ Channel Preview + 실제 화면 캡처 | ○ Screen/Designer Preview | △ 현재 화면 보기 | △ 실제 화면/설정 |
| 온라인·오프라인 상태 | ○ | ○ | ○ | ○ | ○ | ○ |
| 오류·복구 안내 | ○ 상태 아이콘·기본 레이아웃 | ○ 화면 메시지·대시보드 | ○ 오프라인 알림·캐시 | ○ 30초 하트비트·10분 오프라인 | ○ 연결 점·최신 콘텐츠 표시 | ○ 하트비트·건강 경고 |
| 초보자 온보딩 | △ 기능 많음 | ○ 안내형 등록 | ○ 10단계 안내 | ○ 3단계 시작 | ○ 4단계 연결 | ○ 단순 목록 |

## 3. 제품별 조사

### 3.1 Xibo

**사업·라이선스와 공식 URL**

- Community Edition은 자체 호스팅 가능한 AGPL-3.0 오픈소스이고, Windows/Linux 플레이어도 오픈소스로 제공된다. 별도 유료 Xibo Pro/Cloud와 상용 플레이어가 있다.
- 공식: <https://xibosignage.com/open-source>, <https://xibosignage.com/pricing>, <https://xibosignage.com/self-hosted>
- 매뉴얼: <https://docs.xibosignage.com/user-manual/>
- GitHub: <https://github.com/xibosignage/xibo-cms>
- 공개 관리자 데모는 확인하지 못했다. 공식 14일 체험은 가입이 필요하다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | 현재 공개 매뉴얼에서 CMS 랜딩 대시보드 화면을 찾지 못했다. 운영의 중심은 Displays 그리드와 Layouts/Schedule 화면으로 설명된다. |
| 장소·그룹 | Display Groups를 산업·위치별로 만들 수 있고, 수동/동적 필터(`a, -b`), 중첩 그룹, 상위 그룹 일정 상속을 지원한다. |
| 화면 등록 | 플레이어 설치 → CMS에 코드 또는 CMS 키 입력 → Authorised 승인. 등록 화면에 상태·최근 접속 시각이 표시된다. 자동 네트워크 발견은 문서에서 확인하지 못했다. |
| 다중 모니터 | Sync Group에 Display를 묶고 Lead Display를 지정한다. 같은 LAN의 TCP 9590(기본)로 동기화하며, 미러 또는 비디오월은 Synchronised Event로 스케줄한다. 한 Display는 한 Sync Group에만 속한다. |
| 이미지 | Media > Add Media에서 드래그·파일 선택·URL 업로드. 큰 이미지는 해상도를 확인하라고 경고하지만, 대상 화면별 자동 비율 검사는 설명되지 않는다. Orientation은 이미지 편집에서 수동 설정한다. |
| 구성 | Layout Editor의 Toolbox·Canvas·Properties Panel. 드래그/리사이즈/회전, Snap to, 해상도 드롭다운, 레이어, 실행 취소, 전체 화면 Play 미리보기, Publish. |
| 재생·스케줄 | Daypart, Custom 기간, 반복, Interrupt Layout, Share of Voice, Synchronised Event. Lead Display의 콘텐츠 길이가 그룹 전환을 이끈다. |
| 상태·오류 | Displays 그리드의 상태, 클라우드/가위표/체크 아이콘으로 다운로드 상태를 보여준다. 기본 레이아웃이 있으면 일정이 없거나 다운로드 문제가 생겨도 대체 화면을 유지한다. 오프라인에서도 로컬 콘텐츠를 계속 재생한다. |

**UX 강점**

- Display Groups의 동적 필터·중첩·상속은 “센터 A/B, 층별, 대외/대내”처럼 장소 구조가 복잡해질 때 강력하다. 단순 태그보다 조직 구조를 그대로 옮길 수 있다.
- Lead Display와 Sync Group은 “모니터마다 다른 레이아웃, 같은 시각에 전환”이라는 요구에 가장 가까운 기본 기능이다.
- Layout Editor가 편집·레이어·해상도·미리보기·게시를 한 화면에 모은다. Publish 전에 Play로 확인하는 습관을 만들 수 있다.
- 기본 레이아웃이 오류 시의 안전망 역할을 한다. 오프라인 재생과 다운로드 상태 아이콘도 운영자에게 유용하다.

**초보자 마찰**

- CMS, Layout, Display, Display Group, Sync Group, Daypart, Campaign, Interrupt Layout, Share of Voice가 한 제품 안에서 서로 다른 계층으로 쓰인다. 처음 보는 직원에게는 “화면 묶음”과 “동기화 묶음”의 차이부터 어렵다.
- Layout Editor는 강력하지만 Toolbox·Properties·Layer·Publish가 동시에 보여 인지 부하가 크다. 빈 캔버스에서 시작하는 첫 사용자는 다음 행동을 놓치기 쉽다.
- 이미지 규격은 업로드 후 운영자가 판단해야 한다. “이 이미지가 이 모니터에서 잘릴 수 있다”는 사전 경고가 없다.
- 공개 관리자 데모가 없고, self-hosted CE는 Docker·DB 운영 부담이 있다. 문서와 실제 화면의 차이를 직접 확인할 수 없다.

**용어·빈 상태·온보딩**

- CMS/Library/Layout/Display/Display Group/Sync Group/Daypart가 핵심 용어다. 문서는 단계별로 친절하지만 제품 안의 첫 사용 안내 화면은 공개 자료로 확인하지 못했다.
- 공개된 빈 상태 화면은 없다. 등록 후 기본 레이아웃이 없으면 빈 화면이 될 수 있어, 문서가 기본 레이아웃 설정을 강조한다.

**참고할 패턴**

- 위치·용도별 **동적 화면 그룹**과 **중첩 그룹**, 상위 그룹 일정 상속.
- 그룹의 **Lead Display** 개념: 전환 시각의 기준을 하나 두고, 나머지는 그룹 규칙을 따른다.
- **기본 레이아웃**을 게시 전에 지정해 “아무것도 안 나오는 검은 화면”을 막는 안전망.
- Layout Editor의 **Publish 전 Play**, 상태 아이콘+텍스트, 사용 중 미디어 삭제 제한, 사용처 리포트.

**피할 패턴**

- 한 화면에 너무 많은 전문 용어와 설정을 노출하는 구성.
- “동기화 그룹”과 “일반 그룹”을 둘 다 만들게 하고 차이를 문서로만 설명하는 방식.
- 이미지 비율 문제를 업로드 후 FAQ로 돌리는 방식.
- 처음부터 Docker·DB·포트·플레이어 프로필을 이해해야 하는 설치 경험.

**증거 파일**

- `xibo/layout-editor.png` — Layout Editor 전체 구조(공식 매뉴얼)
- `xibo/media-library.png` — Media Library 표/뷰 전환(공식 매뉴얼)
- `xibo/playlist-timeline.png` — 플레이리스트 타임라인(공식 매뉴얼)

### 3.2 Yodeck

**사업·라이선스와 공식 URL**

- 호스팅 SaaS. 무료 1대, Basic $8/화면/월, Premium $12, Enterprise $16(연간 결제 기준), 30일 전체 기능 체험(5대, 카드 불필요). 전용 플레이어 하드웨어를 함께 판매한다.
- 공식: <https://www.yodeck.com/>, <https://www.yodeck.com/pricing/>
- 도움말: <https://help.yodeck.com/en/>
- 문서: <https://www.yodeck.com/docs/user-manual/playlists-introduction/>
- 공개 관리자 데모는 확인하지 못했다. 공식 대시보드 캡처에는 Staging 계정 예시가 있다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | Screen Status(Online/Offline/Registered/Unregistered), 구독 플랜, 지도, 최근 활동(Enterprise), Emergency Alerts, Rate Yodeck을 한 화면에 배치한다. |
| 장소·그룹 | Workspaces(Enterprise)로 매장·지역·부서·고객별 콘텐츠/화면/사용자를 분리한다. 최대 5단계 계층, 화면 수 제한, Working Hours, Emergency Alert 범위 지정이 가능하다. “All Workspaces”에서는 새 콘텐츠를 만들 수 없고 특정 Workspace를 먼저 고르게 한다. |
| 화면 등록 | Screens > Add Screen. “I have a player / smart TV / Try Yodeck on my browser” 중 선택하고, 기기 종류를 고른 뒤 화면에 뜬 8~9자리 코드를 입력한다. “Not sure”를 누르면 Android 여부를 물어 Web Player로 안내한다. 코드를 바로 입력하거나 Advanced setup으로 기기를 직접 고를 수도 있다. |
| 다중 모니터 | Yodeck 4K Player의 HDMI 2개를 동시에 쓰는 것은 지원하지 않는다. 같은 화면을 복제하려면 HDMI 스플리터를 쓰라고 안내한다. 다른 콘텐츠를 여러 모니터에 보내려면 화면마다 플레이어를 두는 구조다. |
| 비디오월 | 별도 가이드는 “화면마다 Yodeck Player 1대 + HDMI-to-IP 스트리머 + 마스터 플레이어”를 요구한다. 각 화면에 스트림용 Video를 만들고 Crop %를 수동 계산하며, 베젤 보정은 밀리미터 측정과 스프레드시트로 한다. 가이드의 LKV373A는 공급 중단·EOL 예정 장비다. |
| 이미지 | Full HD(1920×1080) 또는 TV 해상도에 맞춰 업로드하라고 안내한다. 낮은 해상도는 검은 여백이 생긴다고 설명하지만, 업로드 시 자동 규격 검사는 확인하지 못했다. |
| 구성 | Layout Editor는 Templates/Media/Apps/Playlists/Text/Elements/Settings의 좌측 메뉴, 중앙 캔버스, 상단 이름·해상도·확대·배경·Undo/Redo·Layers·Hand Tool, 선택 요소 도구막대로 구성된다. Snap-to-Grid 또는 Alignment Grid Lines를 선택한다. |
| 재생·스케줄 | Classic/Tag-based/Dropbox/OneDrive/CSV 플레이리스트. Filmstrip에 드래그, 기간 조정, 전체 시간 표시, 전환·랜덤·Sync Playback, 플레이리스트 Preview(새 창). |
| 상태·오류 | 대시보드의 Online/Offline/Registered/Unregistered, 화면 메시지, Player 경고 아이콘, 화면별 재부팅·원격 옵션. 화면 미리보기는 팝업 차단 시 안 열릴 수 있어 팝업 허용을 안내한다. |

**UX 강점**

- 등록 마법사가 “기기를 모르는 사용자”를 전제로 한다. 플레이어/스마트 TV/브라우저를 먼저 고르게 하고, “Not sure”와 “Try Yodeck on my browser”로 실패를 줄인다.
- 대시보드가 화면 상태·지도·구독·최근 활동을 한 화면에 모아 “오늘 무엇이 문제인가”를 빠르게 보여준다.
- Layout Editor에 Undo/Redo, Layers, Hand Tool, Snap/Alignment, 전체 화면 미리보기가 있어 편집 중 실수를 되돌리기 쉽다.
- 플레이리스트를 하드웨어 없이 미리 볼 수 있다는 점이 초보자에게 특히 좋다.

**초보자 마찰**

- Workspace 단위 사이트 분리는 Enterprise 전용이다. 작은 기관이 “센터 A/B”를 단순 그룹으로 나누려면 화면마다 콘텐츠를 따로 관리해야 할 수 있다.
- 화면 1대당 플레이어 1대가 기본이라, 기존 PC 1대로 모니터 4대를 운영하려는 현장과 맞지 않는다.
- 비디오월 가이드는 전문 네트워크·장비·측정·크롭 계산을 요구하고, 사용하는 스트리머가 단종됐다. 초보자용 기능이라 부르기 어렵다.
- 이미지 규격 문제를 “전체 화면용 해상도로 올려라”라는 문서 안내에 맡긴다.
- 메뉴가 매우 많고, 플랜별로 Workspace·브랜드 템플릿·SSO·세부 권한이 갈린다. 무료 사용자는 기능을 보지만 실제 운영에서는 유료 전환이 필요하다.

**용어·빈 상태·온보딩**

- Dashboard/Screen/Workspace/Layout/Playlist가 핵심 용어다. “Screen”은 실제 모니터와 등록된 플레이어를 함께 뜻해, 화면 1대와 기기 1대를 구분해야 한다.
- 온보딩은 문서가 아니라 **등록 마법사**가 담당한다. 대시보드의 Registered/Unregistered 숫자가 미등록 화면을 알려 주는 역할을 한다.
- 공개 캡처에서 별도의 “첫 화면 만들기” 빈 상태 CTA는 확인하지 못했다.

**참고할 패턴**

- 기기 종류를 모를 때의 **“Not sure” 탈출구**와 **브라우저 테스트 화면**.
- 코드 한 번으로 등록하고, 코드 입력 전에 “내 화면에 이 코드가 보이는가”를 확인시키는 단계.
- 대시보드의 **상태 숫자 타일 + 지도 + 최근 활동** 조합. 단, 우리 화면은 지도보다 “장소 카드”가 적합하다.
- 편집기의 **Undo/Redo·Layers·Snap/Alignment·전체 화면 미리보기**.

**피할 패턴**

- 한 PC에 여러 모니터를 붙이는 요구를 플레이어 추가 구매로 해결하게 만드는 구조.
- 비디오월을 “크롭 % 계산 + 측정 스프레드시트 + 단종 장비”로 구현하게 하는 방식.
- 무료 플랜에서 보여준 기능을 유료 플랜에서만 열어 주는 과도한 게이트.
- 팝업 차단으로 미리보기가 실패하는 구현. 미리보기는 같은 탭의 모달/패널로 열어야 한다.

**증거 파일**

- `yodeck/dashboard-official.png` — 대시보드(온라인/오프라인/등록/지도)
- `yodeck/register-device-choice.png` — 기기 종류 선택 카드와 “Not sure”
- `yodeck/register-code.png` — 화면에 표시되는 등록 코드 예시
- `yodeck/layout-editor-example.png` — 요소가 배치된 Layout Editor
- `yodeck/layouts-list.png` — Layouts 목록과 행 메뉴
- `yodeck/playlist-filmstrip.png` — 플레이리스트 Filmstrip과 전체 시간

### 3.3 ScreenCloud

**사업·라이선스와 공식 URL**

- 호스팅 SaaS. Core 플랜은 연간 결제 기준 $20/화면/월로 공개되어 있고 Pro/Enterprise는 별도다. 14일 Studio 체험과 3개의 가상 화면 라이선스를 제공한다.
- 공식: <https://www.screencloud.com/>, <https://screencloud.com/pricing>
- 도움말: <https://help.screencloud.com/en/>
- 공개 관리자 데모는 확인하지 못했다. 문서의 화면 캡처는 2019·2021·2024년이 섞여 있다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | 공개 문서에서 별도의 홈 대시보드 캡처는 확인하지 못했다. 좌측 내비게이션은 Screens, Channels, Playlists, Media, Links, Dashboards, Canvas, Apps, Metrics로 구성된다. Apps 빈 상태는 “This is where your apps will live”와 Browse App Store 버튼을 보여준다. |
| 장소·그룹 | 화면을 Screen Group으로 묶고, 화면을 그룹으로 드래그한다. Space는 별도의 콘텐츠/화면 영역이고, Screens Manager에서 전체 Space의 화면을 한 곳에서 본다. |
| 화면 등록 | 플레이어에 6자리 페어링 코드 또는 QR이 표시된다. Studio에서 New Screen을 누르고 코드를 입력하면 라이선스 잔여 수가 표시된다. Preview Mode로 무료 테스트 화면을 만들 수 있고, 활성화하면 라이선스를 사용한다. |
| 다중 모니터 | 다중 디스플레이는 Windows 플레이어의 확장 데스크톱/콜라주 모드 또는 비디오월 컨트롤러로만 지원한다. 화면은 **대칭 배치**(가로 일렬 또는 세로 일렬)여야 하고, 단일 Windows 기기에서는 2~6대, iBase/컨트롤러 구성에서는 4~24대가 안내된다. 두 화면을 붙이면 3840×1080처럼 **하나의 화면**으로 등록된다. 다른 모니터에 다른 콘텐츠를 보내려면 화면별 라이선스가 필요하다. |
| 이미지 | Media Library에서 드래그·업로드, 폴더·태그·목록/그리드 보기. 파일 종류·크기·업로드 사용자·Space는 보여주지만, 업로드 화면에서 픽셀 크기·비율을 자동 검사하는 흐름은 확인하지 못했다. Fit Zone/Fill Zone, 9:16 콘텐츠 권장, 1920×1080 등 해상도 가이드를 문서로 제공한다. |
| 구성 | Channel에 미리 정의된 Zone Layout 또는 Custom Layout을 적용하고, Main/Left Bar/Footer 같은 영역별로 콘텐츠를 넣는다. Canvas는 별도 디자인 도구이며, 템플릿·브랜드 자산·QR 코드를 지원한다. |
| 재생·스케줄 | Playlist는 콘텐츠 순서와 표시 시간을 관리하고, Channel은 화면/테마 단위로 Playlist·Media·Apps·Links를 묶는다. Channel의 각 항목에 요일·시간·기간 스케줄과 우선순위를 설정한다. Playback Mode는 Sync/Unsync/Device Time이며, Sync는 같은 콘텐츠를 여러 화면에 재생할 때만 쓴다. |
| 미리보기 | Channel Preview에서 Full HD 등 해상도 선택, Zone 선택, Now Playing 목록, 재생/일시정지, Full Screen을 제공한다. 실제 화면 캡처(Screenshot) 기능은 라이브 화면과 미리보기의 시점 차이를 확인하는 데 쓰인다. |
| 상태·오류 | 화면 온라인 상태, 마지막 연결, 오프라인 이메일 알림(Pro/Enterprise), 원격 캐시 삭제, 플레이어 재시작/기기 재부팅, 화면 교체. 캐시된 콘텐츠는 오프라인에서도 재생되며, 스트리밍 앱은 캐시되지 않는다. |

**UX 강점**

- 10단계 소개 문서와 첫 화면의 빈 상태가 “다음에 무엇을 할지”를 분명히 보여준다. 특히 가상/프리뷰 화면으로 하드웨어 없이 시작할 수 있다.
- Media/Playlist/Channel의 역할을 분리해 설명하고, Channel Preview에서 해상도와 Zone을 바꿔 보며 확인하게 한다.
- 화면 그룹을 드래그로 옮기는 단순한 상호작용, 화면별 메모, 실제 화면 캡처, 캐시 삭제가 운영자에게 실용적이다.
- “Set to screen”과 “Cast”로 즉시 공지/긴급 콘텐츠를 덮어쓰는 흐름이 명확하다.

**초보자 마찰**

- Space, Screen, Screen Group, Channel, Playlist, Zone, Canvas가 모두 등장한다. “화면에 무엇을 보여주는가”라는 한 질문에 여러 개념이 연결된다.
- Custom Resolution은 Channel에서만 가능하고, 단일 항목이나 Playlist에서는 쓸 수 없다. 화면 비율이 특이한 현장에서 예상 밖의 제약이 된다.
- 다중 모니터는 Windows 전용·대칭 배치·하드웨어 컨트롤러 전제라, “2대를 세로로 쌓고 1대를 옆에 두는” 비대칭 구성은 안내 범위를 벗어난다.
- 오프라인 알림과 일부 관리 기능은 Pro/Enterprise 게이트다.
- 문서 스크린샷의 연식이 달라 현재 화면과 다를 수 있다. 이 보고서는 캡처에 보이는 UI만 근거로 삼았다.

**용어·빈 상태·온보딩**

- Space/Screen/Screen Group/Channel/Playlist/Media/Canvas/Zone이 겹친다. 특히 Channel은 “화면에 재생할 콘텐츠 묶음”, Zone은 “한 화면 안의 구역”이다.
- 첫 사용 팝업과 10단계 문서가 온보딩을 맡고, Apps 빈 상태는 “This is where your apps will live”와 Browse App Store로 다음 행동을 준다.
- 화면·콘텐츠가 없을 때의 다른 빈 상태는 공개 문서에서 충분히 확인하지 못했다.

**참고할 패턴**

- 첫 로그인 **온보딩 팝업 + 빈 상태 CTA + 가상 화면**.
- 콘텐츠를 “보관함(Media) → 순서(Playlist) → 화면 단위 묶음(Channel)”으로 나누는 정보 구조. 우리말로는 “이미지 보관함 → 이미지 순서 → 화면 구성”에 해당한다.
- Channel Preview의 **해상도 선택 + Zone 선택 + 재생 컨트롤 + Now Playing**.
- 실제 화면 캡처와 “마지막 접속/온라인” 상태를 함께 보는 운영 화면.

**피할 패턴**

- 비슷한 이름의 객체를 계속 추가해 사용자가 “Playlist와 Channel의 차이”를 매번 찾아야 하는 구조.
- 특이 해상도 지원을 특정 객체(Channel)에만 넣는 제약.
- 다중 모니터를 Windows·대칭·컨트롤러 전제로 한정하는 방식.
- 오래된 스크린샷을 최신 문서에 그대로 두는 것. 제품 UI 변경 시 캡처도 갱신해야 한다.

**증거 파일**

- `screencloud/apps-empty-state.jpg` — 좌측 내비게이션과 Apps 빈 상태
- `screencloud/media-library.png` — Media Library 목록, 폴더, Create playlist 메뉴
- `screencloud/playlist-create.png` — New Playlist 모달
- `screencloud/channel-zone-layouts.png` — Zone Layout 선택
- `screencloud/channel-preview.png` — Channel Preview, 해상도·Zone·재생 컨트롤

### 3.4 OptiSigns

**사업·라이선스와 공식 URL**

- 호스팅 SaaS. 무료 플랜은 최대 3대, 1GB 저장, 파일 25MB, 앱 약 25개, 플레이리스트 30항목·200MB다. 일정·팀스페이스·분할 화면 재생·애드온은 유료다. 14일 전체 기능 체험이 별도로 있다.
- 공식: <https://www.optisigns.com/>, <https://www.optisigns.com/pricing>
- 도움말: <https://support.optisigns.com/hc/en-us>
- 공개 관리자 데모는 확인하지 못했다. 문서는 2026년에 갱신되었지만 일부 화면은 구버전 UI다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | 공개 문서의 홈 대시보드 캡처는 확인하지 못했다. Screens 목록과 Add Screen 모달, Edit Screen 모달이 주요 운영 화면이다. |
| 장소·그룹 | Team(Workspace와 유사)으로 화면·자산·사용자를 분리하고, 팀별 화면 쿼터를 배정한다. Pro Plus 이상에서만 Teams를 만들 수 있고, 사용자는 여러 팀을 전환할 수 있다. |
| 화면 등록 | 플레이어 앱이 6자리 코드를 표시하면 app.optisigns.com > Screens > Add Screen에서 Pair code를 입력한다. Windows/macOS 플레이어를 테스트 화면으로 쓸 수 있다. 소문자 코드는 “Use lowercase pairing code”를 체크한다. |
| 다중 모니터 | 기본은 화면 1대=플레이어 1대다. Pro Player는 2~3대, ProMax는 2~4대까지 Video Wall 앱으로 묶을 수 있다. 각 화면은 HDMI 포트 순서에 매핑되고, Merge Screens로 하나의 연속 이미지/영상 영역을 만든다. 더 큰 월은 Sync Play로 여러 플레이어를 맞추라고 하나, 영상 분할 가이드는 아직 준비 중이다. Windows/Linux/Raspberry Pi의 확장 데스크톱을 덮는 makeshift 방식도 안내한다. |
| 이미지 | Files/Assets에서 최대 50개, 각 1GB까지 업로드한다. JPG/PNG/BMP/GIF, MP4(H.264 권장), PDF/Office를 지원한다. 파일 형식·용량은 검사하지만, 화면별 비율 자동 검사는 확인하지 못했다. Split Screen FAQ에서 Main Zone의 16:9 불일치를 설명하고 Fit/Fill/Stretch를 권한다. |
| 구성 | Designer는 Top Menu/Canvas/Positioning/Side Menu의 4영역. 이미지·텍스트·도형·배경·프레임·필터·그리기·리사이즈·애니메이션·레이어·실행 취소·미리보기를 제공한다. Split Screen은 템플릿 선택 후 Zone 비율·위치·겹침·레이어·Undo/Redo·해상도·Preview를 제공하고, Split Screen 안에 Split Screen은 넣을 수 없다. |
| 재생·스케줄 | Playlist에 Asset을 추가하고 순서·표시 시간을 정한다. Schedule은 캘린더에서 이벤트를 추가하고 Daily/Weekly/Monthly/Custom 반복, 겹침 경고, 시간대별 재생, 기본 콘텐츠를 지원한다. 겹치면 “마지막으로 생성/수정한 일정”이 우선하고, 일정이 없으면 기본적으로 검은 화면이다. |
| 미리보기 | Screen Management에서 Edit > Preview, 또는 목록의 Preview 버튼. Designer의 Preview는 “하드웨어에 따라 실제와 약간 다를 수 있다”고 명시한다. 시간축 스크럽이나 사이트 단위 시뮬레이션은 확인하지 못했다. |
| 상태·오류 | 플레이어가 30초마다 상태를 갱신하고, 10분간 응답이 없으면 Offline으로 표시한다. 오프라인 중 변경은 다음 온라인 시 적용된다. OnHold Devices 폴더와 화면 메시지, 원격 명령이 있다. |

**UX 강점**

- “Add Screen → 6자리 코드 → Pair”가 단순하고, 코드 입력 전에 테스트 화면을 만들 수 있다.
- Split Screen 템플릿이 “2 Mains + 1 Ticker”, “4 Splits”, “Custom”처럼 결과를 그림으로 보여준다. Zone 크기를 %로 입력해 해상도에 독립적으로 설계한다.
- Video Wall에서 화면을 병합/분리하고, Audio Zone과 Primary Zone을 지정하는 개념은 “어느 화면의 시간에 맞출 것인가”를 푸는 좋은 추상화다.
- 일정 겹침을 경고하고, 기본 콘텐츠를 지정해 검은 화면을 피하게 하는 안전장치가 있다.

**초보자 마찰**

- 다중 모니터가 하드웨어(Pro/ProMax), 애드온($25/월/기기), HDMI 포트 순서, 2~4대 제한에 묶여 있다. “모니터 4대를 한 PC로”라는 요구와 “임의의 6대를 자유 배치”라는 요구 사이의 간극이 크다.
- Split Screen과 Video Wall은 둘 다 “화면을 나눈다”는 말을 쓰지만 대상이 다르다. 초보자는 어느 것을 선택해야 하는지 헷갈린다.
- 무료 플랜에서 Split Screen을 저장할 수는 있지만 재생은 유료다. 일정·팀스페이스도 유료라, 무료 사용자가 만든 결과물이 실제 송출 단계에서 멈출 수 있다.
- 일정이 없을 때 검은 화면이 기본이라는 규칙은 명시되어 있지만, 첫 사용자가 “왜 아무것도 안 나오지”라고 느끼기 쉽다.
- 앱·통합·디자이너 메뉴가 방대해 홈에서 “이미지 송출”이라는 핵심 과업이 묻힌다.

**용어·빈 상태·온보딩**

- Team/Screen/Asset/Playlist/Schedule/Designer/Split Screen/Video Wall이 핵심 용어다. “Asset”과 “Content”, “Screen”과 “Device”가 문맥에 따라 섞인다.
- 온보딩은 “하드웨어 준비 → 콘텐츠 업로드 → 화면에 밀어 넣기” 3단계 문서와 Add Screen 모달이 담당한다.
- 공개 문서에서 화면·자산이 없을 때의 빈 상태 화면은 확인하지 못했다. 무료 플랜의 기능 잠금은 별도 안내 문서로만 알 수 있다.

**참고할 패턴**

- 코드 입력 전 **테스트 화면**과 “Use lowercase pairing code” 같은 실제 실패 대비.
- Split Screen 템플릿 그리드, % 기반 Zone, 겹침 레이어, Undo/Redo, Preview.
- **Merge Screens**와 **Primary Zone**: 여러 화면을 하나의 콘텐츠로 묶는 개념과 전환 기준.
- 일정 겹침 경고, 기본 콘텐츠, “오프라인 중 변경은 다음 접속 시 적용” 문구.

**피할 패턴**

- 하드웨어 포트 순서와 애드온 구매를 사용자가 먼저 이해해야 하는 비디오월.
- “화면 분할”과 “비디오월”을 별도 제품처럼 나누고 선택 기준을 문서로만 설명하는 것.
- 무료 플랜에서 저장은 되지만 재생은 안 되는 반쪽짜리 흐름.
- “미리보기가 실제와 다를 수 있다”는 문구만 두고 차이의 원인·확인 방법을 주지 않는 것.

**증거 파일**

- `optisigns/getting-started-1.png` — 플레이어의 6자리 코드 화면
- `optisigns/getting-started-3.png` — Add Screen과 Pair code 입력
- `optisigns/split-screen-layout.png` — Split Screen 템플릿 선택
- `optisigns/split-screen-zones.png` — % 기반 Zone 편집과 Preview
- `optisigns/video-wall-merge.png` — HDMI Zone과 Merge Screens
- `optisigns/screen-preview.png` — Edit Screen의 Preview 버튼

### 3.5 Play Digital Signage

**사업·라이선스와 공식 URL**

- 호스팅 SaaS. 첫 프로덕션 화면은 30일 무료이고, 30일 안에 리뷰를 쓰면 계속 무료다. Essential $8, Pro $12, Ultimate $16/화면/월. Trial 화면은 워터마크가 있다.
- 공식: <https://playsignage.com/>, <https://playsignage.com/pricing/>
- 지원 문서: <https://playsignage.com/support/>
- 공개 관리자 데모는 확인하지 못했다. 문서는 텍스트 중심이고, 이 보고서의 화면 증거는 공식 사이트의 UI 이미지다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | Dashboard는 Ultimate 플랜에서 모든 팀의 화면을 한 표로 보여준다. Screen Name, UID, App Version, Status, Last Online, Team, Auto Launch, Last Known IP, Model, Player Time, Free Storage 열을 선택하고 리포트를 내려받는다. 화면 목록 상단에는 “1 of 1 screen live / All screens online” 같은 요약이 있다. |
| 장소·그룹 | Group은 화면과 콘텐츠를 잇는 단위다. Base Playlist를 정하고 화면을 드래그해 넣는다. Standby 그룹이 있으며, 화면이 남아 있는 그룹은 삭제할 수 없다. Team은 조직/고객 단위 분리다. |
| 화면 등록 | 앱이 표시하는 6자리 코드를 Add Screen에 입력한다. 화면 이름, 그룹/플레이리스트, 위치, 메모, 태그를 정하고 Production/Trial을 선택한다. 안내 스테퍼는 Screen type → Choose device → Install player → Enter code의 4단계이고, 코드는 10분마다 갱신된다. |
| 다중 모니터 | 기본은 화면 1대=플레이어 1대다. 화면 여러 대를 동기화하려면 그룹의 Synchronized를 켜고 같은 플레이리스트를 배포한다. 이는 슬라이드 시작 시각을 맞추는 수준이며, 영상은 프레임 단위로 잠기지 않는다. 진짜 비디오월은 AMD Eyefinity/Nvidia Surround, Matrox, 디지털 사이니지 데이지 체인, 외부 컨트롤러 같은 하드웨어로 해결하라고 안내한다. |
| 이미지 | Library에 업로드한 이미지를 슬라이드에 배치하고, Crop·Resize·Rotate·Flip·Opacity·Align·Lock·Layer·Group·Mask를 제공한다. 업로드 시 해상도/비율 자동 검사는 문서에서 확인하지 못했다. |
| 구성 | 슬라이드 편집기에서 Assets/Shapes/Text/Video 등 추가, 위치·크기·회전·레이어·잠금. Zone은 미리 정의된 레이아웃을 고르거나, Zone별 플레이리스트를 만들어 Master Playlist에 얹는다. 커스텀 Zone은 화면을 종이에 축척으로 그리고 mm→px 비율을 계산해 크기를 정하라고 안내한다. |
| 재생·스케줄 | Group에 Add Schedule. Base Playlist는 스케줄이 없을 때 24/7 재생되고, 스케줄은 요일·시간·기간·Shuffle 비율을 지원한다. 겹치면 “나중에 시작한 일정”이 이긴다. |
| 미리보기 | 화면 목록에서 현재 표시 중인 내용을 보는 “what is screen showing now” 흐름이 있다. 여러 모니터의 타임라인을 스크럽하는 시뮬레이션은 문서에서 확인하지 못했다. |
| 상태·오류 | 연결 점(녹색/빨강), 최신 콘텐츠 체크(빨간 느낌표면 Publish 필요), 마지막 온라인, 디스크 사용량. 오프라인 알림은 지연 시간·수신자·알림 시간대·웹훅을 지원한다. 오프라인이어도 재생은 멈추지 않는다고 명시한다. |

**UX 강점**

- 연결 스테퍼가 “화면 종류 → 기기 → 플레이어 설치 → 코드”로 나뉘고, 코드 갱신 시간까지 알려 준다. 기기를 모르는 사용자가 어느 단계에서 막히는지 파악하기 쉽다.
- 화면 상태 요약이 “1 of 1 screen live / All screens online”처럼 자연어로 되어 있어 숫자 표보다 빠르게 읽힌다.
- Group의 Base Playlist + Schedule 구조가 “평소에는 A, 특정 시간에는 B”를 이해하기 쉽게 만든다. 스케줄이 잘못되어도 Base Playlist로 돌아간다.
- Alert에 지연 시간과 수신 시간대를 둬 짧은 Wi-Fi 끊김을 걸러 낸다. 오프라인이 콘텐츠 중단을 뜻하지 않는다는 설명도 좋다.

**초보자 마찰**

- 커스텀 Zone을 만들려면 종이에 축척으로 그리고 밀리미터를 픽셀로 환산해야 한다. “화면 구성”을 하려는 일반 직원에게는 지나친 수작업이다.
- Playlist가 스케줄을 직접 들고 있다는 모델이 다른 제품과 다르다. “스케줄을 만든다”가 아니라 “플레이리스트에 스케줄이 붙는다”는 점이 처음에 혼란스럽다.
- 진짜 비디오월은 외부 GPU/컨트롤러가 필요하고, Synchronized는 영상 프레임 동기화가 아니다. “동기화”라는 말의 기대와 실제가 다르다.
- Dashboard는 Ultimate 플랜 전용이다. 작은 기관이 전체 상태를 한눈에 보려면 상위 플랜이 필요하다.
- Trial 화면은 워터마크가 있고, 첫 무료 화면은 리뷰 작성 조건이다. 비용은 낮지만 조건을 미리 읽어야 한다.

**용어·빈 상태·온보딩**

- Screen/Group/Playlist/Slide/Zone/Team이 핵심 용어다. “Playlist”가 재생 순서와 스케줄을 함께 들고 있다는 점이 다른 제품과 다르다.
- 4단계 연결 스테퍼가 온보딩 역할을 하고, 화면 목록 상단의 “1 of 1 screen live”가 첫 성공 상태를 보여준다.
- 화면·플레이리스트가 없을 때의 공개 빈 상태 캡처는 확인하지 못했다.

**참고할 패턴**

- 4단계 연결 스테퍼와 “코드는 10분마다 갱신” 안내.
- “1 of N screens live” 같은 **자연어 상태 요약**과 연결 점/최신 콘텐츠 상태의 분리.
- Base Playlist + Schedule fallback, 그룹 삭제 전 화면 이동 강제.
- 오프라인 알림 지연·수신 시간대·웹훅.

**피할 패턴**

- 커스텀 레이아웃을 mm·px 계산 노동으로 만드는 방식.
- “동기화”가 영상 프레임까지 맞춘다고 오해하게 만드는 표현.
- 전체 상태 Dashboard를 최상위 플랜에만 두는 것.
- Trial 워터마크·리뷰 조건을 가입 후에야 알게 하는 흐름.

**증거 파일**

- `play/link-screen.webp` — 4단계 연결 스테퍼와 6자리 코드
- `play/create-content.webp` — Add Content 템플릿 선택
- `play/publish.webp` — “1 of 1 screen live” 상태 요약과 좌측 내비게이션

### 3.6 Anthias

**사업·라이선스와 공식 URL**

- 오픈소스 GPLv2 + 상용 듀얼 라이선스. Raspberry Pi와 64비트 x86 Debian에서 기기 로컬로 동작하며, 클라우드 관리가 필수가 아니다.
- 공식: <https://anthias.screenly.io/>
- 문서: <https://anthias.screenly.io/docs/>, 다중 화면: <https://anthias.screenly.io/docs/multi-screen/>
- GitHub: <https://github.com/Screenly/Anthias>
- 공개 호스팅 데모는 확인하지 못했다. 화면 증거는 공식 사이트의 제품 캡처와 저장소 템플릿이다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | 홈은 Schedule Overview다. 상단 Previous/Next/Add Asset, Enabled/Inactive 두 표, Name·Schedule window·Duration·Enabled·Actions 열. 행을 드래그해 순서를 바꾸고, 5초마다 테이블을 갱신한다. |
| 장소·그룹 | 사이트/그룹 개념이 없다. 컨트롤러 1대가 관리 화면을 제공하고, 참여 화면들은 같은 플레이리스트를 미러링한다. 다른 콘텐츠가 필요한 화면은 컨트롤러에 넣을 수 없다. |
| 화면 등록 | 컨트롤러 Settings > Multi-screen management에서 `anthias-join:` 조인 정보를 복사해 참여 화면에 붙여넣는다. 참여 화면은 Waiting for approval과 체크 코드를 표시하고, 컨트롤러의 Screens 페이지에서 코드를 대조해 Approve/Reject한다. 조인 정보는 1시간 후 만료되고 Regenerate할 수 있다. |
| 다중 모니터 | 컨트롤러가 자기 플레이리스트를 모든 화면에 Publish한다. 자산·일정·순서가 동일해지는 **미러 모드**다. 화면별 다른 이미지, 여러 장소, 인터넷 원격 관리는 상용 Screenly를 쓰라고 안내한다. |
| 이미지 | Add asset 모달에서 From URL / Upload file / Apps 탭. URL은 웹페이지·호스팅 이미지·영상·스트리밍을 지원하고, 업로드는 이미지/영상을 복수 선택하면 즉시 시작한다. 자산별 Start/End, Duration, Advanced의 요일·시간대, No cache, Skip asset check, Skip SSL을 제공한다. 이미지 픽셀/비율 자동 검사는 템플릿에서 확인하지 못했다. |
| 구성 | 목록형 자산 관리만 있고, 여러 이미지를 한 화면에 배치하는 드래그 캔버스나 Zone 편집기는 확인하지 못했다. 화면 한 대에 한 자산/웹페이지가 순환하는 구조다. |
| 재생·스케줄 | 자산별 Start/End와 요일·시간대. Enabled 자산만 재생되고, 비활성 자산은 별도 섹션에 남는다. 플레이리스트 단위의 스케줄 객체는 확인하지 못했다. |
| 미리보기 | 각 자산/화면의 실제 상태를 보는 화면은 있지만, 여러 화면의 시간축을 돌리는 시뮬레이션은 확인하지 못했다. |
| 상태·오류 | 컨트롤러는 화면당 하트비트 1분, 건강 상태 15분(경고 발생/해제 시 즉시)을 받는다. 화면 종료·재시작은 수초, 네트워크 단절은 20~40초 안에 Offline으로 표시된다. 디스크 1GB 미만, 메모리 64MB 미만, SD카드 마모/오류, 저전압을 경고한다. System info에 load/memory/disk/version이 있다. |

**UX 강점**

- 내비게이션이 Schedule/Settings/System info(컨트롤러일 때 Screens 추가)로 단순하다. “관리할 것이 적은” 화면은 오히려 초보자에게 읽기 쉽다.
- Enabled/Inactive 분리와 “No active assets → Add an asset” 빈 상태가 명확하다.
- Add asset 모달이 URL/Upload/Apps를 탭으로 나누고, 업로드 진행률·여러 파일 순차 업로드를 보여준다.
- 조인 정보 한 번 붙여넣기 + 체크 코드 승인은 네트워크 자동 발견이 없어도 안전하게 기기를 추가하는 좋은 패턴이다.
- 디스크·메모리·저전압·SD카드 건강 상태를 운영자 언어로 경고한다. 오프라인에서도 재생이 계속된다는 점이 상태 설명에 있다.

**초보자 마찰**

- 모든 화면이 같은 플레이리스트를 미러링하므로, 센터 A/B나 모니터별 다른 이미지 요구에 맞지 않는다.
- 사이트·그룹·구역·자유 배치가 없다. 화면 수가 늘어나면 “어느 화면이 어느 그룹인가”를 관리할 구조가 없다.
- 관리 UI가 영어 중심이고, 컨트롤러 모드에서는 참여 화면의 로컬 웹 UI가 “Managed by …”로 바뀐다. 현장 직원이 화면을 직접 고치려면 Leave management를 알아야 한다.
- 컨트롤러 모드를 쓰려면 Authentication을 먼저 켜야 한다. 보안상 타당하지만 초보자에게는 추가 단계다.
- 이미지 비율/해상도 검사가 없고, 미리보기·시간 이동도 제한적이다.

**용어·빈 상태·온보딩**

- Schedule/Asset/Controller/Screen이 핵심 용어이고, 그 외 객체가 적어 어휘 부담은 가장 낮다. 대신 미러 모드의 한계를 설명하는 문구가 길다.
- Enabled/Inactive 빈 상태가 “No active assets”와 Add an asset 버튼으로 명확하다. 별도의 첫 사용 마법사는 확인하지 못했다.
- 컨트롤러 모드 진입은 Settings의 Multi-screen management에서 시작하며, Authentication을 먼저 켜야 한다는 설명이 온보딩 역할을 한다.

**참고할 패턴**

- 단순한 상단 내비게이션과 **Enabled/Inactive** 분리, 빈 상태의 단일 CTA.
- Add asset의 **URL / 파일 / 앱** 탭과 업로드 진행률, 자산별 시간창·요일 설정.
- **조인 정보 + 체크 코드 + Approve/Reject** 및 만료/재생성.
- **건강 신호**(디스크·메모리·저전압)와 오프라인 지속 재생 설명.

**피할 패턴**

- 미러 전용 구조를 “다중 화면 지원”이라고 부르는 것.
- 화면별 콘텐츠/그룹이 없는 목록 하나로 수십 대를 관리하게 하는 것.
- 관리 화면을 영어와 기술 용어에 의존시키는 것.

**증거 파일**

- `anthias/official-home-product.png` — Schedule Overview
- `anthias/add-asset.webp` — Add asset 모달(From URL/Upload/Apps)
- `anthias/settings.webp` — Settings
- `anthias/system-info.webp` — System info와 건강 지표

## 4. 초보자 6단계 흐름 관찰

우리 설계의 6단계와 제품들이 실제로 제공하는 흐름을 대조했다. “제품이 이 단계를 지원한다”는 뜻이 아니라, 그 단계에서 배울 패턴과 빈틈을 정리한 것이다.

| 우리 단계 | 제품에서 확인한 흐름 | 배울 점 | 남는 빈틈 |
|---|---|---|---|
| 1. 장소 만들기 | Xibo Display Group, ScreenCloud Space/Group, Play Team/Group, Yodeck Workspace, OptiSigns Team | 장소를 “화면 묶음 + 콘텐츠 범위 + 권한”으로 함께 정의 | 대부분 그룹 생성이 설정 깊숙이 있고, 첫 화면에서 “장소”를 고르게 하지 않는다. |
| 2. 화면 등록 | 6~9자리 코드, QR, 브라우저 테스트, 체크 코드 승인 | 코드+테스트 화면+“기기를 모르겠어요” 탈출구 | 자동 발견은 어느 제품도 공개 문서에서 확인되지 않았다. 수동 코드가 기본이다. |
| 3. 배치 정하기 | Xibo Sync Group, ScreenCloud Windows 확장, OptiSigns Video Wall, Yodeck/Play 외부 하드웨어 | 다중 모니터는 “한 캔버스”와 “화면별 독립”을 구분해야 한다 | 임의 N대·비대칭·모니터별 해상도/방향을 한 화면에서 다루는 제품이 없다. |
| 4. 이미지 올리기 | Media Library, 업로드 드래그, Fit/Fill, Crop, 썸네일·태그 | 보관함에서 한 번 올리고 여러 화면에서 재사용 | 대상 모니터별 비율·해상도 사전 검사와 “잘리는 위치” 안내가 없다. |
| 5. 재생 정하기 | Playlist/Channel/Group, Sync, Primary/Lead, Schedule fallback | “평소 콘텐츠 + 시간표 + 예외”를 분리 | 이미지 수≠모니터 수의 시작 위치·회전 패턴을 시각화하는 제품이 없다. |
| 6. 미리보기·송출 | Layout/Playlist Preview, Channel Preview, 실제 화면 캡처 | 재생 컨트롤·해상도 선택·현재 재생 목록 | 여러 모니터의 시간축을 함께 돌리는 사이트 단위 시뮬레이션이 없다. |

### 4.1 첫 사용에서 특히 중요한 관찰

- **등록 전에 “테스트 화면”을 제공하라.** Yodeck의 “Try Yodeck on my browser”, ScreenCloud의 Preview Mode, OptiSigns의 Windows/macOS 테스트 화면은 실제 하드웨어가 없어도 첫 성공을 만든다. 우리도 “이 브라우저를 테스트 화면으로 사용” 버튼을 2단계에 두는 것이 좋다.
- **기기 종류를 모를 때의 선택지를 만들어라.** Yodeck의 “Not sure”는 단순한 도움말이 아니라 등록 실패를 줄이는 분기다. 우리는 “모니터인지, PC인지, 브라우저인지 모르겠어요”를 제공하고, 자동 감지 결과를 나중에 보여줄 수 있다.
- **“등록”과 “승인”을 분리하라.** Anthias는 조인 정보를 붙여넣은 뒤 체크 코드를 대조해 Approve한다. 화면이 네트워크에 나타났다는 사실과 관리자가 승인했다는 사실을 구분하면 오등록을 줄인다.
- **상태를 색만으로 표현하지 마라.** Xibo의 클라우드/가위표/체크, Play의 연결 점+최신 콘텐츠 체크, Anthias의 건강 경고 모두 아이콘과 문장을 함께 쓴다.
- **기본 콘텐츠를 항상 정하라.** Xibo의 기본 레이아웃, Play의 Base Playlist, OptiSigns의 기본 콘텐츠 설정은 “일정이 없거나 잘못됐을 때 검은 화면”을 막는 장치다. 우리는 게시 전에 “비상/기본 이미지”를 필수 또는 강한 권장으로 둔다.
- **미리보기에서 실제 송출과 같은 자르기·회전을 보여라.** ScreenCloud는 채널 미리보기와 실제 화면 캡처를 별도로 제공하고, OptiSigns는 “하드웨어에 따라 다를 수 있다”고 경고한다. 우리 설계의 “미리보기=송출과 동일한 RenderPlan” 원칙이 이 문제를 해결해야 한다.

## 5. 참고할 패턴과 피할 패턴

### 5.1 참고할 패턴

| 패턴 | 확인한 제품 | 우리 화면에 적용할 추상화 |
|---|---|---|
| 짧은 코드 + 기기 종류 안내 + 브라우저 테스트 | Yodeck, ScreenCloud, OptiSigns, Play | 2단계 “화면 등록”에서 코드/QR, 자동 감지 결과, “이 브라우저로 테스트” 버튼 |
| 조인 정보 + 체크 코드 + 승인 | Anthias | 2단계에서 “대기 중 화면”과 “승인 필요”를 분리하고, 6자리 확인 코드를 대조 |
| 장소/그룹의 계층과 상속 | Xibo, ScreenCloud, Play | “장소 > 모니터” 2계층부터 시작하고, 필요할 때만 하위 그룹/동기화 그룹을 노출 |
| 기본 콘텐츠/플레이리스트 fallback | Xibo, Play, OptiSigns | 게시 전 기본 이미지·비상 이미지 설정, 오류 시 마지막 콘텐츠 유지 |
| 템플릿 그리드 + % 기반 Zone | OptiSigns, ScreenCloud, Xibo | “1대/가로/세로/격자/직접 배치”를 그림 카드로 제공하고, 직접 배치는 %로 내부 저장 |
| 레이어·Undo/Redo·Snap·전체 화면 미리보기 | Xibo, Yodeck, OptiSigns | 배치·재생 편집에 실행 취소, 스냅, 미리보기, “원래대로” 제공 |
| 자연어 상태 요약 | Play, Yodeck | “4대 중 3대 정상, 1대 확인 필요”처럼 문장으로 먼저, 숫자는 보조로 |
| 하트비트 + 마지막 접속 + 건강 경고 | OptiSigns, Anthias, Play | 모니터 상세에 마지막 연결, 현재 이미지, 저장 공간, 오류 원인·다음 행동 |
| 오프라인 알림 지연/수신 시간 | Play, ScreenCloud | 짧은 끊김과 실제 장애를 구분하는 지연 설정, 관리자에게만 알림 |

### 5.2 피할 패턴

| 피할 패턴 | 확인한 제품 | 이유 |
|---|---|---|
| 모니터 1대=플레이어 1대를 전제로 한 다중 모니터 | Yodeck, ScreenCloud, OptiSigns, Play | 기존 PC 1대에 모니터 4대를 붙이는 현장 요구와 충돌한다. |
| 비디오월을 크롭 %·측정·외부 스트리머로 해결 | Yodeck, Play | 초보자가 측정·계산·장비 호환성까지 떠안는다. |
| 이미지 비율 문제를 FAQ로만 안내 | Xibo, Yodeck, ScreenCloud, OptiSigns, Play | 업로드 후 검정 여백·왜곡을 발견하면 재작업이 발생한다. |
| “동기화”가 영상 프레임까지 맞춘다고 오해하게 함 | Play, ScreenCloud | 실제로는 슬라이드 시작 시각 수준이며, 영상은 하드웨어/플레이어에 따라 다르다. |
| 기본 콘텐츠 없이 검은 화면 | OptiSigns 등 | 첫 사용자가 “고장”으로 오해한다. |
| 특정 객체에서만 되는 해상도/레이아웃 | ScreenCloud(Channel만 Custom Resolution) | 같은 결과를 만들려면 사용자가 객체 종류를 먼저 이해해야 한다. |
| 무료 플랜에서 저장만 되고 재생은 안 됨 | OptiSigns | 만든 결과물이 마지막 단계에서 멈추면 학습 성과가 사라진다. |
| 너무 많은 전문 용어와 평면 메뉴 | Xibo, OptiSigns, ScreenCloud | “화면을 띄운다”는 목표가 기능 목록에 묻힌다. |
| 오래된 스크린샷을 최신 문서에 방치 | ScreenCloud, OptiSigns | 실제 화면과 문서가 달라져 지원 비용이 늘어난다. |

### 5.3 다크 패턴·과장 표현 검토

- 이번 조사에서 기만적 다크 패턴(숨은 결제, 강제 구독, 가짜 카운트다운 등)은 확인하지 못했다.
- 다만 OptiSigns의 “Free Plan”은 화면 3대까지지만 분할 화면 재생·일정·팀스페이스가 유료이고, Play의 첫 무료 화면은 리뷰 조건, ScreenCloud/Play의 일부 기능은 상위 플랜이다. 이는 사업 모델이지만, 가입 전에 “무엇이 실제로 재생되는가”를 분명히 해야 한다.
- “무제한”, “완벽 동기화”, “어디서나” 같은 표현은 하드웨어·네트워크·플랜 제약과 함께 읽어야 한다. 우리 제품 소개에서는 “같은 LAN, 같은 시계, 이미지 전환 기준”처럼 조건을 함께 쓴다.

## 6. 라이선스 노트(오픈소스 제품만)

이 보고서 자체는 저장소의 Apache-2.0 라이선스로 배포된다. 인용한 제품명·문서 URL·화면은 각 권리자에게 귀속되며, 제3자 스크린샷·로고·아이콘은 Apache-2.0 배포물에 포함하지 않고 `artifacts/`에만 보관한다. 인용 출처와 제품별 라이선스 표기는 유지한다.

이 절은 UI 조사에서 확인한 범위의 요약이다. 최종 법적 판단은 기관의 라이선스 검토가 필요하며, 별도 `docs/research/licenses.md`(KR 담당)와 충돌하지 않도록 이 문서에서는 수정하지 않는다.

- **Xibo Community Edition**: CMS 코어와 Windows/Linux 플레이어가 AGPL-3.0으로 공개되어 있다. AGPL은 네트워크를 통해 수정본을 제공할 때 소스 공개 의무가 발생할 수 있으므로, 우리가 CMS를 수정해 원내 웹 서비스로 제공하는 경우 검토가 필요하다. Xibo Pro/Cloud, 상용 Android/webOS/Tizen 플레이어는 별도 라이선스다. 화면·아이콘·로고를 복제하지 않는다.
- **Anthias**: GPLv2 + Commercial dual license. 수정본을 배포하거나 기기 이미지로 제공할 때 GPLv2 소스 제공 의무가 문제될 수 있다. 내부 사용과 배포의 경계, 번들된 서드파티 구성요소의 라이선스는 별도 확인이 필요하다. Anthias의 화면 캡처·로고도 우리 제품 자산으로 재사용하지 않는다.
- **ScreenTinker**: MIT. 셀프 호스팅과 수정·재배포가 허용된다. 저장소 문서는 프로덕션 의존성에 GPL/AGPL이 없고 SBOM을 배포한다고 밝히지만, 호스팅 서비스 약관·서드파티 템플릿·플러그인은 별도다. MIT 고지와 원저작자 표시를 유지한다.
- **Concerto**: Apache-2.0. 특허 허여·고지 유지 의무가 있으며, 3.0은 RC이므로 안정판 2.x와 라이선스 파일·의존성이 다를 수 있다. Docker 이미지에 포함된 서드파티 라이선스는 별도 확인한다.
- **공통**: 오픈소스 제품의 UI 패턴을 참고하는 것과 코드/화면/아이콘을 복제하는 것은 다르다. 이 보고서는 정보 구조·흐름·피드백 문구 수준의 추상화만 제안한다.

## 7. 스크린샷 증거 목록

모든 파일은 `artifacts/research/screens/intl/` 아래에 있으며 `.gitignore`로 커밋되지 않는다. 출처는 각 제품의 공식 문서/공식 사이트다.

| 제품 | 파일 | 보여주는 화면 | 출처 |
|---|---|---|---|
| Xibo | `xibo/layout-editor.png` | Layout Editor 캔버스·Toolbox·Properties | 공식 매뉴얼 Layout Editor |
| Xibo | `xibo/media-library.png` | Media Library 표·뷰 전환 | 공식 매뉴얼 Media Library |
| Xibo | `xibo/playlist-timeline.png` | Playlist 타임라인 | 공식 매뉴얼 Media Playlists |
| Yodeck | `yodeck/dashboard-official.png` | Dashboard 상태·지도·최근 활동 | 공식 도움말 The Dashboard |
| Yodeck | `yodeck/register-device-choice.png` | 기기 종류 선택·Not sure | 공식 도움말 How to Register a Screen |
| Yodeck | `yodeck/register-code.png` | 화면 등록 코드 예시 | 공식 도움말 How to Register a Screen |
| Yodeck | `yodeck/layout-editor-example.png` | Layout Editor 예시 | 공식 도움말 Layout Editor |
| Yodeck | `yodeck/layouts-list.png` | Layouts 목록·행 메뉴 | 공식 도움말 Layout Editor |
| Yodeck | `yodeck/playlist-filmstrip.png` | Playlist Filmstrip·전체 시간 | 공식 Yodeck Docs Playlists |
| ScreenCloud | `screencloud/apps-empty-state.jpg` | 좌측 내비게이션·Apps 빈 상태 | 공식 도움말 Introduction |
| ScreenCloud | `screencloud/media-library.png` | Media Library 목록·폴더 | 공식 도움말 Introduction |
| ScreenCloud | `screencloud/playlist-create.png` | New Playlist 모달 | 공식 도움말 Introduction |
| ScreenCloud | `screencloud/channel-zone-layouts.png` | Zone Layout 선택 | 공식 도움말 Introduction |
| ScreenCloud | `screencloud/channel-preview.png` | Channel Preview | 공식 도움말 Introduction |
| OptiSigns | `optisigns/getting-started-1.png` | 6자리 페어링 코드 | 공식 Getting Started Guide |
| OptiSigns | `optisigns/getting-started-3.png` | Add Screen·Pair code | 공식 Getting Started Guide |
| OptiSigns | `optisigns/split-screen-layout.png` | Split Screen 템플릿 | 공식 Split Screen Guide |
| OptiSigns | `optisigns/split-screen-zones.png` | Zone 편집·Preview | 공식 Split Screen Guide |
| OptiSigns | `optisigns/video-wall-merge.png` | HDMI Zone·Merge Screens | 공식 Video Wall Guide |
| OptiSigns | `optisigns/screen-preview.png` | Edit Screen·Preview | 공식 Preview Guide |
| Play | `play/link-screen.webp` | 4단계 연결·6자리 코드 | 공식 How it works(마케팅 UI 이미지) |
| Play | `play/create-content.webp` | Add Content 템플릿 | 공식 How it works(마케팅 UI 이미지) |
| Play | `play/publish.webp` | “1 of 1 screen live” | 공식 How it works(마케팅 UI 이미지) |
| Anthias | `anthias/official-home-product.png` | Schedule Overview | 공식 사이트 제품 캡처 |
| Anthias | `anthias/add-asset.webp` | Add asset 모달 | 공식 사이트 제품 캡처 |
| Anthias | `anthias/settings.webp` | Settings | 공식 사이트 제품 캡처 |
| Anthias | `anthias/system-info.webp` | System info | 공식 사이트 제품 캡처 |

보조 확인 제품의 화면은 실제 관리자 UI가 공개되지 않아 상세 증거 표에 넣지 않았다. Screenly는 공식 문서의 화면 구조 설명만, Signagelive는 공식 도움말의 네트워크 생성 절차만 읽었다.

## 8. 출처

모든 URL은 2026-11-24(KST)에 접속·확인했다.

### Xibo

- Open Source: <https://xibosignage.com/open-source>
- Pricing: <https://xibosignage.com/pricing>
- Self-hosted: <https://xibosignage.com/self-hosted>
- User Manual: <https://docs.xibosignage.com/user-manual/>
- Showing an Image: <https://docs.xibosignage.com/getting-started/getting_started_showing_an_image>
- Layout Editor: <https://docs.xibosignage.com/layouts/layouts_editor>
- Media Library: <https://docs.xibosignage.com/media/media_library>
- Media Playlists: <https://docs.xibosignage.com/media/media_playlists>
- Displays: <https://docs.xibosignage.com/displays/displays>
- Display Configuration: <https://docs.xibosignage.com/displays/displays_configuration>
- Display Groups: <https://docs.xibosignage.com/displays/displays_groups>
- Sync Groups: <https://docs.xibosignage.com/displays/displays_sync_groups>
- Scheduling/Synchronised Events: <https://docs.xibosignage.com/scheduling/scheduling_events>
- GitHub: <https://github.com/xibosignage/xibo-cms>

### Yodeck

- Pricing: <https://www.yodeck.com/pricing/>
- Help Center: <https://help.yodeck.com/en/>
- Dashboard: <https://help.yodeck.com/en/articles/455858-the-dashboard>
- Register a Screen: <https://help.yodeck.com/en/articles/682888-how-to-register-a-screen-in-yodeck>
- Layout Editor: <https://help.yodeck.com/en/articles/456268-getting-started-with-the-yodeck-layout-editor>
- Screens Overview: <https://help.yodeck.com/en/articles/455885-screens-overview>
- Dual HDMI FAQ: <https://help.yodeck.com/en/articles/456109-does-yodeck-support-dual-screens-monitors-using-the-two-hdmi-ports-on-the-player>
- Images don’t fit: <https://help.yodeck.com/en/articles/456096-why-my-images-don-t-fit-in-the-screen>
- Video Wall: <https://help.yodeck.com/en/articles/601510-creating-a-video-wall-with-yodeck>
- Workspaces: <https://help.yodeck.com/en/articles/669486-workspaces-introduction>
- Playlists Docs: <https://www.yodeck.com/docs/user-manual/playlists-introduction/>
- 공식 YouTube “How To Create A Classic Playlist”: <https://www.youtube.com/watch?v=PNGI6D62dUw>

### ScreenCloud

- Pricing: <https://screencloud.com/pricing>
- Help Center: <https://help.screencloud.com/en/>
- Introduction: <https://help.screencloud.com/en/articles/10096578-an-introduction-to-screencloud-how-to-use-screencloud-for-digital-signage>
- Screens: <https://help.screencloud.com/en/articles/10119993-screencloud-studio-screens>
- Video Wall: <https://help.screencloud.com/en/articles/10121614-how-to-set-up-a-video-wall-with-screencloud>
- Sync/Unsync/Device Time: <https://help.screencloud.com/en/articles/10119801-synchronizing-screens-with-playback-modes-sync-unsync-and-device-time>
- Custom Resolutions: <https://help.screencloud.com/en/articles/10115219-custom-resolutions-and-image-dimensions-using-channels-in-screencloud>
- Add/Set Up/Delete Screen: <https://help.screencloud.com/en/articles/10097048-how-do-i-add-set-up-or-delete-a-screen-in-screencloud>
- 공식 Canvas Wistia: <https://fast.wistia.net/embed/iframe/rm34ffgow3>

### OptiSigns

- Website: <https://www.optisigns.com/>
- Getting Started: <https://support.optisigns.com/hc/en-us/articles/18823504383891-OptiSigns-Getting-Started-Guide>
- Set Up/Add/Unpair a Screen: <https://support.optisigns.com/hc/en-us/articles/360016374813-Set-Up-Add-or-Unpair-a-Screen>
- Split Screen: <https://support.optisigns.com/hc/en-us/articles/360026559573-How-to-Create-and-Use-the-Split-Screen-App>
- Video Wall: <https://support.optisigns.com/hc/en-us/articles/33382537925267-Making-a-Video-Wall-with-OptiSigns-Video-Wall-App>
- Designer: <https://support.optisigns.com/hc/en-us/articles/42087942047379-Getting-Started-with-Designer>
- Preview: <https://support.optisigns.com/hc/en-us/articles/360035739414-How-to-Preview-a-Screen>
- Schedules: <https://support.optisigns.com/hc/en-us/articles/360016981853-Creating-and-Using-Schedules-with-OptiSigns>
- Supported Files: <https://support.optisigns.com/hc/en-us/articles/360016342373-What-types-of-files-are-supported>
- Offline status: <https://support.optisigns.com/hc/en-us/articles/360016484473-Why-Does-My-Screen-Show-as-Offline-on-the-Web-Portal>
- Free Plan: <https://support.optisigns.com/hc/en-us/articles/33940834613139-What-Do-I-Get-With-an-OptiSigns-Free-Plan>
- Teams: <https://support.optisigns.com/hc/en-us/articles/360034883113-Working-with-Teams-and-Security-Levels>
- 공식 YouTube “Managing Your Screens”: <https://www.youtube.com/watch?v=iP9DDMkRry8>
- 공식 YouTube “Creating & Managing Assets”: <https://www.youtube.com/watch?v=oPO9ksZnSdY>

### Play Digital Signage

- Website: <https://playsignage.com/>
- Pricing: <https://playsignage.com/pricing/>
- Support: <https://playsignage.com/support/>
- Screens: <https://playsignage.com/support/screens/>
- Groups: <https://playsignage.com/support/groups/>
- Dashboard: <https://playsignage.com/support/dashboard/>
- Video Wall: <https://playsignage.com/support/video-wall/>
- Content Synchronization: <https://playsignage.com/support/content-synchronization/>
- Images: <https://playsignage.com/support/images/>
- Zones: <https://playsignage.com/support/zones/>
- Scheduling: <https://playsignage.com/support/scheduling/>
- Alerts: <https://playsignage.com/support/alerts/>
- How it works: <https://playsignage.com/how-it-works/>
- 공식 Google Play 앱: <https://play.google.com/store/apps/details?id=com.playsignage.app>

### Anthias

- Website: <https://anthias.screenly.io/>
- Docs: <https://anthias.screenly.io/docs/>
- Multi-screen: <https://anthias.screenly.io/docs/multi-screen/>
- Asset Scheduling: <https://anthias.screenly.io/docs/asset-scheduling/>
- GitHub: <https://github.com/Screenly/Anthias>
- License: <https://github.com/Screenly/Anthias/blob/master/LICENSE>
- Asset modal template: <https://github.com/Screenly/Anthias/blob/master/src/anthias_server/app/templates/_asset_modal.html>
- Empty states: <https://github.com/Screenly/Anthias/blob/master/src/anthias_server/app/templates/_empty_assets.html>
- Asset table: <https://github.com/Screenly/Anthias/blob/master/src/anthias_server/app/templates/_asset_table.html>
- Controller screens: <https://github.com/Screenly/Anthias/blob/master/src/anthias_server/controller/templates/controller/screens.html>
- Screenshot slider data: <https://github.com/Screenly/Anthias/blob/master/website/data/screenshots.yaml>

### NoviSign(2라운드)

- 공식 사이트(2026-11-24 현재 이 네트워크에서 연결 재설정): <https://www.novisign.com/>
- Wayback 공식 홈페이지 캡처(2026-10-05): <https://web.archive.org/web/20261005154938/https://www.novisign.com/>
- Help Center(2026-10-05 캡처): <https://web.archive.org/web/20261005155040/https://www.novisign.com/help-center/>
- Screens Management: <https://www.novisign.com/help-center/studio/screen/introduction/>
- Playlists Management: <https://www.novisign.com/help-center/studio/playlist/over-view/>
- Creatives Management: <https://www.novisign.com/help-center/studio/creative/overview/>
- Quick Start: <https://www.novisign.com/help-center/getting-started/quick-start-digital-signage/>
- Best Practice for Media: <https://www.novisign.com/help-center/troubleshooting/best-practice-media/>
- Black Screen Troubleshooting: <https://www.novisign.com/help-center/troubleshooting/black-screen/>
- Pricing: <https://www.novisign.com/pricing/>
- 공식 YouTube “How to Create a Slideshow”: <https://www.youtube.com/watch?v=MszYkhhjdIY>

### Mvix(2라운드)

- Software: <https://www.mvix.com/digital-signage-software>
- Knowledgebase: <https://www.mvix.com/knowledgebase>
- Device Library: <https://www.mvix.com/knowledgebase/what-is-the-device-library>
- Device/Player Groups: <https://www.mvix.com/knowledgebase/device-groups>
- Create Playlist: <https://www.mvix.com/knowledgebase/how-do-i-create-a-playlist-faq>
- Device Preview: <https://www.mvix.com/knowledgebase/screen-preview>
- Video Wall: <https://www.mvix.com/knowledgebase/how-do-i-set-up-my-video-wall>
- Device Health: <https://www.mvix.com/knowledgebase/how-to-use-device-health>
- Upload Media: <https://www.mvix.com/knowledgebase/how-do-i-upload-media-faq>
- Supported Media Types: <https://www.mvix.com/knowledgebase/what-media-types-are-supported-by-mvix-cms-v3>
- Pricing: <https://www.mvix.com/pricing>

### ScreenTinker(2라운드)

- Hosted site: <https://screentinker.com/>
- GitHub(MIT): <https://github.com/screentinker/screentinker>
- Video walls: <https://github.com/screentinker/screentinker/blob/main/docs/video-walls.md>
- Layouts/campaigns: <https://github.com/screentinker/screentinker/blob/main/docs/layouts-and-campaigns.md>
- Preview at time: <https://github.com/screentinker/screentinker/blob/main/docs/preview-at-time.md>
- Web player pairing/link: <https://github.com/screentinker/screentinker/blob/main/docs/web-player.md>
- Licensing: <https://github.com/screentinker/screentinker/blob/main/docs/licensing.md>

### Concerto(2라운드)

- Public demo(읽기 전용 라이브): <https://demo.concerto-signage.org/>
- GitHub: <https://github.com/concerto/concerto>
- README: <https://github.com/concerto/concerto/blob/main/README.md>
- Content fit design: <https://github.com/concerto/concerto/blob/main/docs/content_fit_design.md>
- UI style guide: <https://github.com/concerto/concerto/blob/main/docs/concerto-style-guide.md>
- Version: 3.0.0.rc3(데모 푸터)

### Reach Media 확인 시도(2라운드)

- `reachmedia.co.nz`는 `reach.nz`(뉴질랜드 마케팅/레터박스 대행사)로 리다이렉트됨.
- `reachmedia.com.au`는 커피컵 광고 회사, `reachmedia.tv`는 영상 제작, `reachmedia.io`는 주차 도메인으로 확인됨.
- 이 이름으로 공개된 디지털 사이니지 관리자 제품을 확인하지 못해 비교표에서 제외했다. 동명의 다른 제품이 있다면 정확한 공식 도메인이 필요하다.

### 보조 확인

- Screenly Docs: <https://www.screenly.io/docs/>
- Screenly Dashboard docs: <https://www.screenly.io/docs/get-started/overview/the-dashboard/>
- Screenly Connect first screen: <https://www.screenly.io/docs/get-started/first-screen/connect-your-first-screen/>
- Screenly Pricing: <https://www.screenly.io/pricing/>
- Signagelive Help Center: <https://support.signagelive.com/en/>
- Signagelive Network creation: <https://support.signagelive.com/en/articles/137678-how-to-create-a-signagelive-by-navori-network>

## 9. 2라운드: 공개 화면 교차 검증과 추가 제품

### 9.1 증거 등급과 방법

- **A — 라이브**: 공개 데모 인스턴스를 계정 없이 직접 열어 화면과 상태를 확인했다. 조작은 읽기 전용 범위다.
- **B — 공식 캡처**: 제품이 공개한 도움말 스크린샷, 공식 데모 영상의 프레임, 공식 앱 스토어 스크린샷, 공식 저장소의 UI 캡처/템플릿을 확인했다. 영상은 제품이 공개한 공식 채널의 것만 사용했다.
- **C — 문서만**: 공식 문서의 텍스트·절차만 확인했고 현재 UI 캡처는 확보하지 못했다.

이번 라운드에서는 계정을 만들지 않았다. Yodeck·ScreenCloud·OptiSigns·Play는 공개 영상/스토어/도움말 캡처로 교차 검증했고, NoviSign은 공식 사이트가 이 네트워크에서 차단되어 Wayback 공식 캡처와 공식 YouTube로 보완했다. Mvix·ScreenTinker·Concerto는 공식 사이트/저장소/공개 데모를 사용했다.

| 제품 | A 라이브 | B 공식 캡처/영상 | C 문서만 | 종합 신뢰도 |
|---|---|---|---|---|
| Xibo | 없음 | 공식 매뉴얼 화면 3종 | CMS 대시보드·등록 모달 | B- |
| Yodeck | 없음 | 대시보드/등록/Layout 도움말 캡처, 공식 플레이리스트 영상(00:20, 00:45) | 일부 오류 문구·현재 대시보드 | B |
| ScreenCloud | 없음 | 공식 도움말 화면 5종, 공식 Canvas Wistia(00:15) | Channels·실시간 화면 흐름 | B |
| OptiSigns | 없음 | 공식 101 영상(스크린 목록·Add/Edit Screen·Push·Schedule), 도움말 화면 | Teams·일부 상태 | B |
| Play | 없음(데스크톱 관리자) | 공식 Google Play 앱 스크린샷 4장, 마케팅 UI 3장 | 데스크톱 관리자·알림 세부 | B- |
| Anthias | 없음 | 공식 사이트 4화면, 저장소 템플릿 | 실제 승인 조작 | B |
| NoviSign | 없음(사이트 차단) | Wayback 공식 Help Center 캡처 6장, 공식 YouTube(00:15) | Monitoring/Reports 세부 | B- |
| Mvix | 없음 | 공식 사이트 UI 5장 | 등록 코드·현재 CMS 일부 | B- |
| ScreenTinker | 없음(공개 데모 미로그인) | 공식 저장소 UI 10장, 문서/소스 | 일부 플레이어 실기 검증 | B |
| Concerto | 공개 데모 읽기 전용 | 공식 저장소·문서 | 편집/등록(로그인 필요) | A- |
| Reach Media | 없음 | 없음 | 동명 제품 확인 실패 | 확인 불가 |

### 9.2 4개 핵심 제품 실제 화면 교차 검증

| 제품 | 실제로 확인한 화면 | 1라운드 주장과 비교 | 남은 한계 |
|---|---|---|---|
| Yodeck | 공식 YouTube `PNGI6D62dUw`의 00:20 프레임에서 플레이리스트 필름스트립·미디어 탭·10초 길이 조절, 00:45 프레임에서 Transition/Playback Options와 `Sync Playback`·`Random Playback` 토글을 확인했다. | 1라운드의 “플레이리스트 편집·전체 시간·동기화 옵션” 주장과 모순 없음. 영상 UI는 도움말 캡처보다 헤더가 단순한 이전 버전이다. | 대시보드·화면 등록은 공식 도움말 캡처로만 확인했고, 영상에서는 재현하지 않았다. |
| ScreenCloud | 공식 Wistia `Canvas App - ScreenCloud`의 00:15 프레임에서 좌측 요소/템플릿 패널, 중앙 캔버스, 우측 속성 패널을 확인했다. | “Canvas가 별도 디자인 도구”라는 1라운드 설명과 일치. | 영상은 Canvas만 다룬다. Channels·Media·Preview는 공식 도움말 캡처로만 확인했다. |
| OptiSigns | 공식 “2: Managing Your Screens” 영상 00:45의 Screens 목록과 Add Folder/Add Screen, 01:15의 Edit Screen(Device Name/Tags/Type/Orientation/Operational Schedule), 02:00의 Add Screen·Pair code, 07:00의 Push To Screens·Schedule·Preview를 확인했다. “3: Creating & Managing Assets” 01:00의 Files/Assets도 확인했다. | 6자리 Pair code, Edit Screen, Push/Schedule, Preview라는 1라운드 설명과 일치. | 영상은 2022~2023년 UI로 보이며, 현재 Teams/Video Wall UI는 도움말 캡처로 보완했다. |
| Play | 공개 Google Play 앱 화면 4장에서 “Offline 0 of 2 / Needs publish 0”, QR과 `Enter pairing code`, 화면별 상태와 하단 내비게이션, 편집기의 좌표/애니메이션 패널, Group의 Base playlist·Synchronized·Schedule 타임라인을 확인했다. | “6자리 코드, 화면 상태, 그룹 기본 플레이리스트+스케줄, 동기화 토글” 주장과 일치한다. 스토어 화면은 `Enter pairing code`까지 보여 주고, 6자리 숫자 자체는 공식 문서·마케팅 캡처에서 확인했다. | 모바일 관리 앱의 공개 화면이며 데스크톱 관리자 전체 화면은 확인하지 못했다. |

**교차 검증 결론**: 네 제품의 핵심 주장은 뒤집히지 않았다. 다만 Yodeck·OptiSigns 영상은 현재 문서 캡처보다 오래된 UI이고, ScreenCloud 영상은 Canvas만, Play 스토어는 모바일 앱만 보여 준다. 따라서 “현재 데스크톱 UI 전체를 라이브로 검증했다”고 주장하지 않고, 위 표의 범위만 근거로 삼는다.

### 9.3 NoviSign

**사업·라이선스와 공식 URL**

- 호스팅 SaaS. 무료 평가판은 30일·카드 불필요로 안내된다. Business는 연간 결제 기준 $14/화면/월, Business Plus $17, Premium $25로 공개되어 있다. 플레이어 라이선스는 디스플레이마다 1개가 필요하다.
- 공식: <https://www.novisign.com/>, Help Center: <https://www.novisign.com/help-center/>, Pricing: <https://www.novisign.com/pricing/>
- 2026-11-24 현재 이 네트워크에서는 `www.novisign.com` 연결이 재설정되었다. Wayback의 2026-10-05 공식 캡처와 공식 YouTube, 이미지 프록시로 확보한 공식 스크린샷을 사용했다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | Studio 상단 내비게이션은 Creatives / Playlists / Screens. Screens 탭은 “Manage, schedule, and organize all your content”, 총 화면 수, 검색·내보내기·정렬·List/Tile 전환·Create를 제공한다. |
| 장소·그룹 | Advanced Settings > Groups에서 New Group을 만들고 Screens와 Playlists를 추가한다. 화면이 그룹에 들어가면 개별 플레이리스트 대신 그룹 콘텐츠만 재생한다. 장소(사이트) 계층은 별도로 확인하지 못했다. |
| 화면 등록 | Studio에서 화면을 먼저 만들고 이름·설명·플레이리스트를 지정한다. 플레이어 앱에서 계정으로 로그인한 뒤 Player Key를 직접 입력하거나, 확대경으로 계정의 화면 목록에서 선택하고 Go!를 누른다. 6자리 페어링 코드 방식은 사용하지 않는다. |
| 다중 모니터 | 플레이어 1개가 여러 화면에 같은 콘텐츠를 보낼 수 있다고 FAQ에 명시된다. 서로 다른 콘텐츠는 화면/플레이어별 라이선스가 필요하다. Business Plus의 Video Wall Editor가 Rows/Columns 기반 월을 제공하지만, 공개 화면으로 세부 조작을 확인하지 못했다. |
| 이미지 | Media Library에 업로드하고 Creative에서 사용한다. 공식 Best Practice는 대상 화면과 같은 픽셀 크기(예: 1920×1080), 화면 비율, 파일 2~3MB 이하, 과대 해상도 회피를 권한다. 업로드 시 자동 비율 검사는 확인하지 못했다. |
| 구성 | Creative Composer는 Widget Panel(20+ 위젯), Canvas, Properties, Preview의 4영역이다. Simple Creative(단일 이미지/영상)와 Composed Creative(Zone+Widget)를 구분한다. 템플릿·레이어·정렬·터치 버튼·외부 데이터·공유를 지원한다. |
| 재생·스케줄 | Creative를 Playlist에 넣고 순서·길이·Loop·일정을 정한다. 플레이리스트 Preview가 있고, Playlist 스케줄이 Creative 스케줄보다 우선한다. New Scheduling UI와 공유 기능이 별도 문서로 안내된다. |
| 미리보기 | Playlist Preview와 Template/Screen Preview, 실제 Player 화면이 있다. 1라운드 다른 제품처럼 시간축 스크럽이나 사이트 단위 시뮬레이션은 확인하지 못했다. |
| 상태·오류 | Monitoring & Reports의 Device Monitor가 Download Status를 보여준다. Black Screen 문서는 10단계(슬라이드 다운로드, Skip incomplete slides, 캐시, Display notifications, 기기/앱 정지, TV 절전, 코덱)를 제시한다. 단일 슬라이드 플레이리스트가 불완전 슬라이드를 건너뛰어 검은 화면이 되는 사례가 특히 유용하다. |

**UX 강점**

- Screens 표가 이름·플레이리스트 수·Screen Key·Config·Group을 한 행에 보여 주고, Preview/Copy Key/Set Configuration/Set Location/Export/Delete를 행 메뉴에 모은다. 운영자가 “이 화면이 무엇을 재생하고 어디에 있는가”를 빠르게 찾기 좋다.
- Simple Creative와 Composed Creative를 분리해, 이미지 한 장만 올리는 사용자와 Zone 디자인을 하는 사용자를 구분한다.
- Best Practice 문서가 “화면에서 실제로 차지할 픽셀 크기”를 기준으로 이미지를 준비하라고 설명한다. 업로드 검사는 없지만 원인 설명은 구체적이다.
- Black Screen 문서가 “단일 슬라이드 + Skip incomplete slides = 검은 화면”처럼 실제 초보자 오해를 집어낸다.

**초보자 마찰**

- 플레이어 앱에서 계정 아이디·비밀번호로 로그인하고 Player Key를 고르는 방식은 키오스크 설치 직원에게 부담이 된다. 코드/QR만으로 등록하는 제품과 비교되는 지점이다.
- Creative, Playlist, Screen, Player, Screen Key, Config, Group이 서로 다른 계층이다. “화면에 이미지를 띄운다”는 목표보다 “플레이어를 화면에 연결한다”는 기기 중심 언어가 먼저 보인다.
- 이미지 규격을 문서의 권장값에 맡기고, 대상 화면별 자동 검사·안전 영역을 제공하지 않는다.
- 공식 사이트가 지역/네트워크에 따라 차단되어 최신 UI를 직접 볼 수 없다. 이 보고서의 NoviSign 판단은 2026-10-05 캡처 기준이다.

**참고할 패턴**

- Screens 표의 **이름·플레이리스트 수·Screen Key·Config·Group** 열과 행 메뉴.
- **Copy Key / Preview / Set Configuration / Set Location**을 한 곳에 모은 운영 도구.
- Simple/Composed Creative 구분과 4영역 Creative Composer.
- Black Screen 문서의 **원인→확인→복구** 10단계.

**피할 패턴**

- 플레이어에 관리자 계정 자격 증명을 입력하게 하는 등록.
- “플레이어 1대가 여러 화면에 같은 콘텐츠”라는 설명을 다중 모니터 지원으로 오해하게 만드는 표현.
- 미디어 규격을 문서 권장값에만 맡기는 것.
- 단일 슬라이드에서 불완전 콘텐츠를 건너뛰어 검은 화면이 되는 기본값.

**증거 파일**

- `novisign/screens-tab.png` — Screens 표·Screen Key·Config·Group
- `novisign/screen-options.png` — 화면 행과 Preview/설정 진입
- `novisign/screen-popup-menu.png` — Edit/Preview/Copy Key/Set Configuration/Set Location/Export/Delete
- `novisign/screen-creation-select-playlist.png` — 화면 생성 시 플레이리스트 선택
- `novisign/screen-advanced-menu.png` — Advanced Settings/Groups 진입
- `novisign/demo-slideshow-editor.png` — 공식 YouTube의 Creative Composer

### 9.4 Mvix

**사업·라이선스와 공식 URL**

- SaaS CMS + 일회성 구매 하드웨어 모델. Core/Standard/Pro 플레이어가 각각 $500/$600/$750이고, 클라우드 CMS 라이선스는 플레이어에 포함된다. 월 구독이 없다. CMS는 50+ 언어를 지원한다고 안내한다.
- Software: <https://www.mvix.com/digital-signage-software>, Knowledgebase: <https://www.mvix.com/knowledgebase>, Pricing: <https://www.mvix.com/pricing>
- 공개 관리자 데모는 확인하지 못했다. 공식 사이트의 제품 UI 이미지와 Knowledgebase 절차를 대조했다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | CMS 대시보드는 Device Preview 블록(화면 미리보기 슬라이드쇼), 기기·콘텐츠 요약, 사용자 정의 대시보드로 구성된다. 공식 UI 이미지에서 Media/Playlist/Template/Content Deployment 화면을 확인했다. |
| 장소·그룹 | Device/Player Groups, Locations, Tags, User Groups를 별도로 제공한다. Device Library의 Location View는 위치별 묶음과 상태를 보여준다. |
| 화면 등록 | 플레이어의 HDMI·네트워크·전원을 연결한 뒤 CMS Device Library에서 관리한다. 공개 문서에서는 6자리 코드 등 셀프서비스 페어링 화면을 확인하지 못했다. Device Library는 Alias/System name, App/OS/Browser 버전, Package, Status를 보여준다. |
| 다중 모니터 | Template을 Video Wall 모드로 전환하고 Rows/Columns로 Zone 수를 정한다. 각 Zone은 모니터에 대응하며, 한 개의 큰 미디어를 모든 Zone에 걸치거나 Zone별 다른 미디어를 넣을 수 있다. 월은 한 방향(가로/세로)만 지원한다. 비디오월 플레이어가 여러 HDMI 출력을 구동하는 구성이 전제로 읽힌다. |
| 이미지 | Media Library에서 10개 파일, 총 1GB까지 업로드한다. JPEG는 1920×1080 권장, 더 큰 이미지는 화면에 맞게 축소된다. BMP/PNG/JPG/GIF, MP4(H.264), PDF, Office 등을 지원한다. 자동 비율 경고는 확인하지 못했다. |
| 구성 | Layout Designer/Template Canvas에서 Zone을 배치하고, Playlist Builder에서 미디어를 드래그·정렬한다. Template은 플랜별 2/6/10 Zone을 제공한다. |
| 재생·스케줄 | Playlist는 최대 250개 항목(권장 100개), 미디어별 재생 시간·유효 시간·순서·그룹을 지원한다. Schedule/Publish는 별도 모듈이며 Failover Content로 화면이 비지 않게 한다. |
| 미리보기 | Device Preview가 대시보드·Device Preview 페이지·Device Library에서 실제 화면 스크린샷을 보여준다. 전체 새로고침은 5분에 한 번으로 제한된다. 콘텐츠 시간축 시뮬레이션은 아니다. |
| 상태·오류 | Device Library 상태는 Active/Inactive/Dormant/Disabled. Dormant는 120일 이상 비활성, Disabled는 인증 실패다. OS가 오래되면 빨간 느낌표, Device Health는 연결/네트워크 속도, CPU 온도, 저장 공간, RAM을 보여준다. 오프라인 알림과 그룹/위치/태그가 있다. |

**UX 강점**

- Device Preview가 “지금 화면에 무엇이 보이는가”를 실제 스크린샷으로 보여 주고, 대시보드·전용 페이지·Device Library 세 곳에서 접근된다. 초보자가 “송출됐는지” 확인하기 쉽다.
- Device Health가 CPU 온도·저장 공간·RAM·Wi-Fi를 한 화면에 모아, 화면이 꺼진 이유를 콘텐츠와 분리해 진단하게 한다.
- Video Wall Template이 Rows/Columns와 Zone 번호를 화면에 직접 대응시켜, 복잡한 크롭 계산 없이 기본 월을 만들 수 있다.
- Failover Content와 Offline Playback을 기본 기능으로 안내해 검은 화면 위험을 줄인다.

**초보자 마찰**

- Active/Inactive/Dormant/Disabled의 의미가 많고, Dormant는 120일, Disabled는 인증 실패라는 별도 규칙이다. “오프라인” 하나로 이해하기 어렵다.
- Device, Player, Screen, Template, Zone, Playlist, Schedule, Publish가 문서마다 다른 문맥으로 쓰인다. Knowledgebase가 200개 이상이라 검색 없이 전체 구조를 파악하기 어렵다.
- 일회성 하드웨어 구매($500~$750)와 CMS 무료 모델은 매력적이지만, 기존 PC·모니터를 재사용하려는 현장에는 맞지 않는다.
- 이미지 규격을 “권장 1920×1080, 큰 이미지는 축소”로 처리해, 세로 모니터·비율 불일치에 대한 사전 경고가 약하다.
- 공개 관리자 데모가 없어 실제 버튼 위치·빈 상태·오류 문구를 확인하지 못했다.

**참고할 패턴**

- **Device Preview**를 대시보드·목록·상세에 중복 배치해 “실제 화면 확인”을 어디서든 가능하게 한 점.
- **Device Health**를 상태와 분리한 점.
- Video Wall의 Rows/Columns와 Zone 번호.
- Failover Content·Offline Playback을 기본값으로 안내하는 점.

**피할 패턴**

- Active/Inactive/Dormant/Disabled를 색과 문서로만 구분하는 상태 모델.
- 하드웨어 일회성 구매를 전제로 한 배포.
- 이미지 비율 문제를 “축소된다”는 설명으로 끝내는 것.
- 200개 문서를 기능별로 흩어 놓고 “초보자용 시작 경로”를 별도로 강하게 제시하지 않는 구조.

**증거 파일**

- `mvix/device-management.webp` — Device Management/상태 카드
- `mvix/media-library.webp` — Media Library
- `mvix/playlist-builder.webp` — Playlist Builder
- `mvix/layout-designer.webp` — Layout/Template Designer
- `mvix/content-deployment.webp` — Content Deployment

### 9.5 ScreenTinker

**사업·라이선스와 공식 URL**

- MIT 오픈소스. 셀프 호스팅은 무료·기기 수 제한 없음, 호스팅은 Free 1대, Home $9.99/월, Starter $39, Pro $99, Business $199. 14일 Pro 체험(15대, 카드 불필요).
- 공식: <https://screentinker.com/>, GitHub: <https://github.com/screentinker/screentinker>
- 공개 사이트에서 로그인 없이 관리자 전체를 조작하지는 못했고, 공식 저장소의 실제 UI 캡처와 공식 문서를 근거로 삼았다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | 좌측 내비게이션과 화면 카드/상태, 첫 사용 체크리스트(화면 연결, 콘텐츠 추가, 그룹 만들기, 일정 만들기 등)를 확인했다. |
| 장소·그룹 | Devices/Groups/Workspaces 구조. Group header에서 화면 수·온라인·재생 상태를 보여주고, 그룹에 플레이리스트·일정·명령을 적용한다. Workspace는 사이트/조직 경계다. |
| 화면 등록 | 플레이어 `/player`가 6자리 코드를 표시하고 대시보드에서 페어링한다. 브라우저 저장소가 지워지는 환경을 위해 `?k=` 디스플레이 링크도 제공한다. 링크가 유효하지 않고 저장된 신원도 없으면 페어링 코드로 돌아간다. |
| 다중 모니터 | Video Wall이 **하나의 화면**처럼 동작한다. Available displays를 캔버스에 드래그하고, 화면 가장자리·중심선·베젤 간격에 스냅하며, Alt로 자유 배치, 화살표로 1px/10px 이동. 패널별 장착 방향(가로/세로)을 지정하면 콘텐츠를 회전해 준다. |
| 이미지 | 미디어 업로드·썸네일·영상 길이 ffprobe·PDF 페이지→슬라이드·URL 콘텐츠를 지원한다. 화면 비율은 레이아웃 Zone %와 Portrait/4:3 버전으로 처리한다. 업로드 시 대상 모니터별 자동 규격 검사는 문서에서 확인하지 못했다. 텍스트 가독성 검사는 별도로 강하다. |
| 구성 | Layout Editor에서 Zone을 %로 배치. Playlist에 Layout을 지정하면 같은 플레이리스트를 재생하는 모든 화면이 그 Layout을 쓴다. Layout별 Portrait/4:3 버전, Campaign(전체 Layout을 Playlist 항목으로 재생), Zone별 Playlist를 지원한다. |
| 재생·스케줄 | Draft/Publish/Revert, 기기·그룹별 Schedule, 기기 일정이 그룹 일정을 이김, 우선순위 충돌 해결, 주간 캘린더·반복. |
| 미리보기 | “What will this screen show?”가 특정 날짜·시간의 재생 항목, 선택된 Schedule, 탈락 이유, 그룹 전체 비교, 7일 타임라인, 실제 Player 프레임을 보여준다. 로직은 실제 스케줄러와 같은 함수를 재사용한다. |
| 상태·오류 | Offline 카드, 마지막 접속, 원격 제어/스크린샷, 배터리·저장 공간·RAM·CPU·Wi-Fi·업타임 telemetry, 오프라인 알림, 복구 가이드. |

**UX 강점**

- 비디오월 캔버스가 “화면을 붙이는 행위”를 시각적으로 만들고, 베젤·회전·플레이어 박스·공유 시계까지 한 흐름에 둔다. 이번 조사에서 N대·가변 배치에 가장 가까운 구현이다.
- “What will this screen show?”가 결과뿐 아니라 **왜 그 Schedule이 이겼는지/왜 항목이 빠졌는지**를 설명한다. 초보자에게 가장 필요한 피드백이다.
- Layout의 Portrait/4:3 버전은 같은 Zone ID를 유지해, 한 플레이리스트를 가로·세로 화면에 함께 쓸 수 있다.
- 페어링 코드와 디스플레이 링크를 모두 제공해, 브라우저 저장소가 초기화되는 키오스크 환경까지 고려한다.

**초보자 마찰**

- 기능 표면이 매우 넓다. Workspace, Group, Wall, Layout, Playlist, Campaign, Trigger, Mesh, Node, E-paper, Plugin이 한 제품에 있다. 첫 화면 체크리스트가 이를 완화하지만, 메뉴 자체는 무겁다.
- Layout 결정 우선순위(본사 강제 → Schedule → Playlist → Screen → Full screen)가 강력하지만, 초보자가 “왜 이 Layout이 나오지?”를 이해하려면 미리보기의 설명을 읽어야 한다.
- Video Wall 문서는 일부 플랫폼에서 아직 실기 검증이 안 됐다고 명시한다(문서 기준 Samsung/BrightSign/Pi/Windows 미검증, Android 에뮬레이터 확인). “지원”과 “검증”을 구분해야 한다.
- 단일 개발자 유지보수라는 위험이 README에 명시되어 있다.

**참고할 패턴**

- **비디오월 캔버스 + 베젤 스냅 + 패널별 장착 방향 + 공유 시계**.
- **Playlist 수준 Layout**과 Portrait/4:3 버전.
- **Preview at time + Why + 그룹 전체 비교 + 타임라인**.
- **6자리 코드 + 대체 디스플레이 링크**.
- Draft/Publish/Revert와 “미리보기는 실제 스케줄러 함수를 재사용” 원칙.

**피할 패턴**

- 기능을 모두 첫 화면에 노출해 “이 제품은 무엇부터 해야 하나”를 다시 묻게 만드는 구성.
- Layout 우선순위를 문서로만 설명하고 화면에서 근거를 보여 주지 않는 것.
- 검증되지 않은 플랫폼을 “지원”과 동일하게 표시하는 것.

**증거 파일**

- `screentinker/dashboard.png` — 대시보드
- `screentinker/getting-started.webp` — 첫 사용 체크리스트
- `screentinker/player-pairing.webp` — 6자리 페어링 코드
- `screentinker/video-wall-canvas.webp` — 비디오월 캔버스
- `screentinker/video-wall-live.webp` — 월 전체 라이브 미리보기
- `screentinker/group-header.webp` — 그룹 상태 헤더
- `screentinker/layout-editor.webp` — Zone/Layout 편집
- `screentinker/preview-at.webp` — 시간 지정 미리보기
- `screentinker/offline-card.webp` — 오프라인 상태 카드
- `screentinker/verify.webp` — 화면 검증/상태

### 9.6 Concerto

**사업·라이선스와 공식 URL**

- Apache-2.0 오픈소스. Rails 기반, Docker 실행, SQLite 저장. 공개 데모는 읽기 전용으로 열려 있고 3.0.0.rc3이다.
- 공식 데모: <https://demo.concerto-signage.org/>, GitHub: <https://github.com/concerto/concerto>
- 데모는 공개 데이터(뉴스 피드, 샘플 콘텐츠)이며 로그인하지 않으면 생성·편집은 할 수 없다.

**확인한 화면·흐름**

| 영역 | 확인 내용 |
|---|---|
| 대시보드 | Content / Dashboard, Add Content, Browse Content, Feeds, Screens의 좌측 내비게이션. Active 30 / Upcoming 1 / Expired 8 카드와 콘텐츠 카드 그리드, 검색. |
| 장소·그룹 | Group이 화면·피드·사용자 권한의 단위다. 공개 데모에서는 사이트 계층을 노출하지 않는다. 화면은 하나의 Group에 속한다. |
| 화면 등록 | 화면은 Template과 Group을 선택해 만들고, 각 Position(Field)에 Feed를 구독시킨다. 공개/비공개 화면은 URL/토큰으로 접근한다. 공개 데모의 두 화면은 모두 Offline·마지막 접속 시각 표시다. |
| 다중 모니터 | 화면별 Template/Player 구조이며, 여러 모니터를 한 캔버스로 묶는 기능이나 재생 동기화는 공개 UI·문서에서 확인하지 못했다. |
| 이미지 | Graphic은 Player에서 `object-fit: contain`으로 letterbox된다. Content Fit 설계는 이미지 비율과 Position 비율의 fit score를 계산해 가장 잘 맞는 Position에 배치하고, 최소 점수 미만이면 해당 Position을 탈락시킨다. 업로드 시 사용자에게 “이 화면에서 잘린다”고 경고하는 UI는 확인하지 못했다. |
| 구성 | Template Canvas에서 Position/Field와 배경 이미지·CSS를 정의한다. 화면 상세의 Template Preview가 Main/Ticker/Sidebar/Time Zone을 시각화하고, 각 Zone의 Feed Subscription을 오른쪽 패널에 보여준다. |
| 재생·스케줄 | 전통적 Playlist보다 Feed/Subscription 모델이다. 콘텐츠 Start/End, Feed 순서·가중치·Random/Weighted/Strict Priority, 승인 워크플로를 지원한다. |
| 미리보기 | “View in Player”가 실제 Player 화면을 새 탭으로 열어 Template+Feed 결과를 보여준다. 시간 이동·사이트 단위 시뮬레이션은 확인하지 못했다. |
| 상태·오류 | Screens 카드에 Offline과 “Last seen about 16 hours ago”가 표시된다. 데모는 두 화면 모두 Offline이라 정상 재생 상태·오류 복구 UI를 관찰하지 못했다. |

**UX 강점**

- 화면 상세가 **Template Preview(공간 구조)**와 **Feed Subscriptions(데이터 연결)**를 나란히 보여 준다. “이 구역에 어떤 피드가 들어가는가”가 한눈에 보인다.
- Content Fit은 단순 중앙 정렬이 아니라 콘텐츠 비율과 Position 비율을 점수화해 가장 읽기 좋은 구역을 고른다. 잘못 맞는 콘텐츠를 조용히 버리지 않고 “가장 덜 나쁜 위치”에 두는 원칙도 좋다.
- 공개 데모가 로그인 없이 콘텐츠·화면·플레이어를 읽기 전용으로 보여 줘, 제품의 결과물을 바로 평가할 수 있다.
- 콘텐츠 승인과 Feed 권한이 분리되어 공공기관의 “담당자 제출 → 관리자 승인” 흐름에 참고할 만하다.

**초보자 마찰**

- Feed, Template, Position, Field, Subscription, Group, Content라는 용어가 이미지 중심 관리자에게 낯설다. “이미지 순서”나 “재생목록”이 전면에 없다.
- 화면을 등록하려면 Template과 Group, 각 Position의 Feed를 먼저 이해해야 한다. 등록 코드/QR로 바로 시작하는 제품과 진입 장벽이 다르다.
- 다중 모니터 동기화, 화면별 해상도/방향, 시간축 미리보기가 없다. 이 프로젝트의 핵심 요구에는 직접 맞지 않는다.
- 3.0 RC라 안정판 2.x와 기능·UI가 다를 수 있고, 공개 데모는 편집 권한이 없어 생성 흐름을 검증하지 못했다.

**참고할 패턴**

- **Template Preview + Zone별 Feed Subscription** 매트릭스.
- **Fit score**로 콘텐츠와 구역의 비율을 비교하고, 최소 점수·탈락 이유를 계산하는 방식.
- 콘텐츠 승인·Feed 권한 분리.
- 로그인 없는 **공개 상태/결과 대시보드**.

**피할 패턴**

- 이미지 중심 운영에 Feed/Template/Subscription을 먼저 배우게 하는 정보 구조.
- 화면 등록에 여러 객체를 선행 요구하는 흐름.
- 동기화·가변 배치가 없는 구조를 “다중 화면” 요구에 그대로 쓰는 것.
- RC 버전을 검증 없이 운영에 투입하는 것.

**증거 파일**

- `concerto/dashboard-live.png` — 공개 데모 Content 대시보드
- `concerto/screens-live.png` — 화면 카드와 Offline/Last seen
- `concerto/feeds-live.png` — Feed 목록
- `concerto/screen-detail-live.png` — Template Preview + Feed Subscriptions
- `concerto/player-live.png` — 실제 Player 결과

### 9.7 Reach Media

이 이름으로 공개된 **디지털 사이니지 관리자 제품**을 확인하지 못했다. `reachmedia.co.nz`는 뉴질랜드 마케팅/레터박스 대행사 `reach.nz`로 리다이렉트되고, `reachmedia.com.au`는 커피컵 광고, `reachmedia.tv`는 영상 제작, `reachmedia.io`는 주차 도메인이었다. 동명의 다른 제품이 있다면 정확한 공식 URL 확인이 필요하다. 따라서 화면·기능·스크린샷을 만들지 않고 비교에서 제외했다.

### 9.8 2라운드가 바꾼 판단

1. **ScreenTinker가 우리 요구에 가장 가까운 참조 구현으로 올라왔다.** 비디오월 캔버스, 베젤/방향, Playlist 수준 Layout, Portrait/4:3 버전, 시간 지정 미리보기와 “왜” 설명은 1라운드의 빈틈을 직접 메운다. 단, 기능 표면과 플랫폼 검증 한계는 그대로 경계해야 한다.
2. **Concerto의 fit score는 이미지 규격 검사에 새로운 선택지를 준다.** “대상 모니터별로 잘림/여백을 경고”하는 대신, “이 이미지가 가장 잘 맞는 구역은 어디인가”를 점수로 보여 줄 수 있다. 다만 자동 배치가 사용자의 의도를 덮지 않도록 “추천 + 이유 + 직접 선택”으로 설계해야 한다.
3. **NoviSign/Mvix는 “운영 콘솔의 완성도”는 높지만 초보자용 제품은 아니다.** NoviSign은 Creative/Playlist/Screen/Player Key, Mvix는 Device/Template/Zone/Health가 계층을 이루고, 둘 다 이미지 규격을 문서 권장값에 맡긴다. 우리 제품은 이 두 제품의 운영 정보 밀도를 그대로 가져오면 안 된다.
4. **Play의 공개 모바일 화면은 “현장에서 상태를 보는 관리자” 요구를 잘 보여 준다.** 데스크톱 전체를 검증하지 못했지만, Offline/Needs publish/QR/Enter pairing code/Group Schedule이 모바일에서 어떻게 요약되는지는 참고할 만하다.
5. **1라운드의 “다중 모니터 자유 배치 공백” 결론은 유지된다.** ScreenTinker가 가장 가깝지만, 여전히 비디오월은 “한 화면으로 취급”하는 모델이고, 서로 다른 해상도·방향의 독립 모니터를 한 사이트 캔버스에서 자유 배치하는 제품은 확인하지 못했다.

### 9.9 2라운드 스크린샷 증거

| 제품 | 파일 | 보여주는 화면 | 출처 |
|---|---|---|---|
| Yodeck | `yodeck/demo-playlist-editor.png` | 플레이리스트 필름스트립·미디어 탭·길이 | 공식 YouTube 00:20 프레임 |
| Yodeck | `yodeck/demo-playlist-options.png` | Transition/Playback/Sync/Random 옵션 | 공식 YouTube 00:45 프레임 |
| ScreenCloud | `screencloud/demo-canvas-editor.png` | Canvas 편집기 | 공식 Wistia 00:15 프레임 |
| OptiSigns | `optisigns/demo-screens-list.png` | Screens 목록·Add Screen | 공식 “Managing Your Screens” 00:45 프레임 |
| OptiSigns | `optisigns/demo-edit-screen.png` | Edit Screen·방향/운영 스케줄 | 같은 영상 01:15 프레임 |
| OptiSigns | `optisigns/demo-add-screen.png` | Add Screen·Pair code | 같은 영상 02:00 프레임 |
| OptiSigns | `optisigns/demo-push-preview.png` | Push To Screens·Schedule·Preview | 같은 영상 07:00 프레임 |
| OptiSigns | `optisigns/demo-operational-schedule.png` | 운영 스케줄 편집 | 같은 영상 10:00 프레임 |
| Play | `play/store-screen-qr.png` | 모바일 화면 상태·Add screen·QR/Enter pairing code | 공식 Google Play 스크린샷 |
| Play | `play/store-screen-status.png` | 화면 목록·Offline/Needs publish | 공식 Google Play 스크린샷 |
| Play | `play/store-editor.png` | 모바일 편집기·좌표/애니메이션 | 공식 Google Play 스크린샷 |
| Play | `play/store-group-schedule.png` | Group Base playlist·Synchronized·Schedule timeline | 공식 Google Play 스크린샷 |
| NoviSign | `novisign/screens-tab.png` | Screens 표·Screen Key·Config·Group | 공식 Help Center 캡처(Wayback) |
| NoviSign | `novisign/screen-options.png` | 화면 행과 설정 진입 | 공식 Help Center 캡처(Wayback) |
| NoviSign | `novisign/screen-popup-menu.png` | Preview/Copy Key/Set Config/Set Location/Export/Delete | 공식 Help Center 캡처(Wayback) |
| NoviSign | `novisign/screen-creation-select-playlist.png` | 화면 생성 시 Playlist 선택 | 공식 Help Center 캡처(Wayback) |
| NoviSign | `novisign/screen-advanced-menu.png` | Advanced Settings/Groups | 공식 Help Center 캡처(Wayback) |
| NoviSign | `novisign/demo-slideshow-editor.png` | Creative Composer | 공식 YouTube 00:15 프레임 |
| Mvix | `mvix/device-management.webp` | Device Management/상태 | 공식 제품 UI 이미지 |
| Mvix | `mvix/media-library.webp` | Media Library | 공식 제품 UI 이미지 |
| Mvix | `mvix/playlist-builder.webp` | Playlist Builder | 공식 제품 UI 이미지 |
| Mvix | `mvix/layout-designer.webp` | Layout Designer | 공식 제품 UI 이미지 |
| Mvix | `mvix/content-deployment.webp` | Content Deployment | 공식 제품 UI 이미지 |
| ScreenTinker | `screentinker/dashboard.png` | 대시보드 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/getting-started.webp` | 첫 사용 체크리스트 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/player-pairing.webp` | 6자리 페어링 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/video-wall-canvas.webp` | 비디오월 캔버스 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/video-wall-live.webp` | 월 라이브 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/group-header.webp` | 그룹 상태 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/layout-editor.webp` | Layout/Zone | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/preview-at.webp` | 시간 지정 미리보기 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/offline-card.webp` | 오프라인 카드 | 공식 저장소 UI 캡처 |
| ScreenTinker | `screentinker/verify.webp` | 화면 검증 | 공식 저장소 UI 캡처 |
| Concerto | `concerto/dashboard-live.png` | 공개 데모 대시보드 | 라이브 읽기 전용 |
| Concerto | `concerto/screens-live.png` | 화면 카드·Offline | 라이브 읽기 전용 |
| Concerto | `concerto/feeds-live.png` | Feed 목록 | 라이브 읽기 전용 |
| Concerto | `concerto/screen-detail-live.png` | Template Preview·Feed Subscriptions | 라이브 읽기 전용 |
| Concerto | `concerto/player-live.png` | 실제 Player 결과 | 라이브 읽기 전용 |

## 10. 확인하지 못한 것 / 후속 조사

- Xibo의 현재 CMS 랜딩 대시보드, 실제 빈 상태, 등록 승인 모달은 공개 화면으로 확인하지 못했다. Displays 그리드와 문서 설명만 근거로 삼았다.
- Yodeck·ScreenCloud·OptiSigns·Play는 관리자 계정이 필요해 실제 화면 생성·업로드·게시를 수행하지 못했다. 공개 영상/스토어 화면으로 핵심 흐름을 교차 검증했지만, 현재 데스크톱 관리자 전체를 라이브로 조작한 것은 아니다.
- ScreenCloud의 일부 캡처는 2019·2021년 화면이고, OptiSigns도 구버전 UI가 섞여 있다. 현재 UI와 다를 수 있다.
- Play는 공개 Google Play 앱 화면으로 모바일 관리자·화면 상태·Group Schedule을 확인했지만, 데스크톱 관리자 전체와 “현재 화면 보기”를 라이브로 조작하지는 못했다.
- Anthias는 호스팅 데모가 없어 설정·자산 추가·컨트롤러 승인 흐름을 실제로 조작하지 못했다. 공식 사이트 캡처와 저장소 템플릿으로 확인했다.
- Xibo·Yodeck·ScreenCloud·OptiSigns·Play·Anthias의 한국어 UI 번역 품질은 이번 조사에서 검증하지 않았다. 모든 공식 문서는 영어로 읽었다.
- Screenly는 공개 문서의 내비게이션·용어·화면 흐름만 확인했고, 실제 관리자 UI 캡처는 확보하지 못했다. Signagelive는 네트워크 생성 절차와 라이선스 선행 조건만 확인했다.
- NoviSign은 공식 사이트가 이 네트워크에서 차단되어 2026-10-05 Wayback 캡처 기준이다. Mvix는 공개 관리자 데모가 없고 공식 UI 이미지·문서만 확인했다.
- ScreenTinker는 공식 저장소 캡처·문서를 사용했고 공개 데모 관리자 전체를 조작하지 못했다. Concerto는 공개 데모를 읽기 전용으로 확인했을 뿐 생성·편집은 하지 못했다.
- Reach Media는 동명의 디지털 사이니지 관리자 제품을 확인하지 못해 비교에서 제외했다. 정확한 공식 도메인이 확보되면 다음 라운드에서 보완한다.

## 11. 이 프로젝트에 대한 권고

1. **홈은 “상태 + 다음 할 일”로 제한한다.** Play의 “1 of N screens live”, Yodeck의 상태 타일, Anthias의 Enabled/Inactive처럼 현재 상태와 다음 행동을 먼저 보여준다. 기능 목록은 뒤로 보낸다.
2. **2단계 화면 등록에 테스트 화면·확인 코드·승인을 넣는다.** Yodeck/Anthias의 장점을 결합해 “이 브라우저로 테스트”, “6자리 확인 코드”, “승인 대기”를 제공한다. 자동 발견은 후속 기능으로 두고, 수동 코드 흐름을 완성한다.
3. **3단계 배치를 자체 구현의 핵심으로 둔다.** 제품들이 못 하는 “임의 N대, 모니터별 해상도/방향, 가로·세로·격자·직접 배치”를 한 캔버스에서 제공한다. Xibo의 Sync Group, OptiSigns의 Merge Screens, Play의 Base Playlist를 개념적으로 참고하되 화면을 복제하지 않는다.
4. **4단계 이미지 업로드에 대상 모니터별 검사를 넣는다.** 업로드 즉시 “이 이미지는 A모니터에서 좌우 120px가 잘림”, “B모니터에는 세로 여백”처럼 보여주고, Fit/Fill/Stretch 선택과 안전 영역을 제공한다. 어느 제품도 이 지점을 완성하지 않았다.
5. **5단계 재생은 “방식 카드 + 패턴 표 + 자동 채우기”로 단순화한다.** 개별/순환/동시/통합 4가지를 카드로 보여주고, 이미지 수와 모니터 수가 다를 때 시작 위치·회전 방향·LCM 주기를 표로 미리 보여준다. Xibo/OptiSigns/Play의 동기화 용어를 그대로 쓰지 않는다.
6. **6단계 미리보기는 여러 모니터를 한 시간축으로 재생하고, 경고를 게시 전에 모은다.** ScreenCloud Channel Preview의 재생 컨트롤과 Yodeck Preview의 “하드웨어 없이 보기”를 참고하되, 시간 이동·화면별 경고·게시 요약까지 확장한다.
7. **용어는 한국어 과업어로 고정한다.** 화면, 모니터, 장소, 이미지, 이미지 순서, 재생 방식, 미리보기, 게시. 필요할 때만 괄호로 Display/Playlist/Channel을 병기한다. “동기화”는 “같은 시각에 전환”처럼 조건을 붙여 쓴다.
8. **기본 이미지와 오프라인 동작을 게시 흐름에 포함한다.** 일정이 없거나 서버가 끊겨도 마지막 콘텐츠를 계속 재생하고, 관리자에게 “오프라인·마지막 연결·복구 버튼”을 보여준다. Xibo의 기본 레이아웃, Play의 Base Playlist, Anthias의 오프라인 설명을 추상화한다.

이 보고서는 패턴 분석 자료다. 실제 화면·문구·색·아이콘을 설계할 때는 `docs/design/ui-ux.md`의 한국어·접근성 원칙과 KRDS 조사 결과를 우선 적용하고, 상용 제품의 시각 디자인을 복제하지 않는다.
