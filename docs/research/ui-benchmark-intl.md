# 해외 디지털 사이니지 UI/UX 벤치마크

- 작성일: 2026-11-24 (KST)
- 대상: Xibo, Yodeck, ScreenCloud, OptiSigns, Play Digital Signage, Anthias
- 보조 확인: Screenly, Signagelive (공개 문서만)
- 목적: 국립부산국악원 이미지 송출 시스템의 화면 구조·용어·피드백 패턴을 검증한다. 제품의 화면·아이콘·로고·독창적 디자인을 복제하지 않는다.

## 0. 먼저 읽을 결론

1. **다중 모니터 배치는 아직 제품 시장의 빈틈이다.** 대부분 “모니터 1대 = 플레이어 1대 = 화면 1개”를 기본으로 한다. 여러 모니터를 한 캔버스에서 다루는 기능은 OptiSigns의 2~4대 비디오월, ScreenCloud의 Windows 확장 데스크톱, Yodeck·Play의 외부 하드웨어 우회가 전부다. 임의의 N대, 서로 다른 해상도·방향, 자유 배치를 한 화면에서 다루는 제품은 확인하지 못했다.
2. **등록 흐름은 “짧은 코드 + 기기 종류 안내 + 테스트 화면”으로 수렴한다.** Yodeck·ScreenCloud·OptiSigns·Play 모두 6~9자리 코드를 쓰고, Yodeck·ScreenCloud·OptiSigns는 계정만으로 브라우저 테스트 화면을 제공한다. 초보자에게 실제 하드웨어를 요구하기 전에 “일단 화면에 띄워 보기”를 제공하는 패턴이 가장 재사용 가치가 높다.
3. **이미지 규격 검사는 대부분 “안내”에 그친다.** 화면 비율이 맞지 않으면 검정 여백·왜곡이 생긴다고 FAQ에서 설명하지만, 업로드 시 대상 모니터별로 “이 이미지가 이 화면에 맞는가”를 자동 검사하는 제품은 확인하지 못했다. Xibo·Yodeck·OptiSigns·Play는 Fit/Fill/Stretch 선택과 수동 점검에 의존한다. 이 프로젝트의 “업로드 즉시 규격 검사 + 화면별 안전 영역”은 차별화 지점이다.
4. **미리보기와 상태는 별개다.** ScreenCloud의 채널 미리보기, Yodeck의 레이아웃·플레이리스트 미리보기가 가장 쓸 만하지만, 여러 모니터의 시간축을 함께 돌리는 사이트 단위 시뮬레이션은 없다. 상태 화면은 온라인·오프라인·마지막 접속·저장 공간을 보여주는 수준이다. “가상 모니터 + 시간 이동 + 경고 + 게시 요약”은 직접 설계할 가치가 있다.
5. **초보자의 진짜 장벽은 기능 수가 아니라 용어와 숨은 규칙이다.** Channel/Playlist/Zone/Space/Workspace/Layout/Display Group이 서로 다른 뜻으로 쓰이고, “일정이 없으면 검은 화면”, “플레이리스트가 스케줄을 들고 있음”, “무료 플랜에서는 분할 화면을 저장만 하고 재생 불가” 같은 규칙이 문서 곳곳에 흩어져 있다. 한국어 과업 중심 문구와 “다음 할 일”을 화면에 고정하는 접근이 필요하다.

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

이 절은 UI 조사에서 확인한 범위의 요약이다. 최종 법적 판단은 기관의 라이선스 검토가 필요하며, 별도 `docs/research/licenses.md`(KR 담당)와 충돌하지 않도록 이 문서에서는 수정하지 않는다.

- **Xibo Community Edition**: CMS 코어와 Windows/Linux 플레이어가 AGPL-3.0으로 공개되어 있다. AGPL은 네트워크를 통해 수정본을 제공할 때 소스 공개 의무가 발생할 수 있으므로, 우리가 CMS를 수정해 원내 웹 서비스로 제공하는 경우 검토가 필요하다. Xibo Pro/Cloud, 상용 Android/webOS/Tizen 플레이어는 별도 라이선스다. 화면·아이콘·로고를 복제하지 않는다.
- **Anthias**: GPLv2 + Commercial dual license. 수정본을 배포하거나 기기 이미지로 제공할 때 GPLv2 소스 제공 의무가 문제될 수 있다. 내부 사용과 배포의 경계, 번들된 서드파티 구성요소의 라이선스는 별도 확인이 필요하다. Anthias의 화면 캡처·로고도 우리 제품 자산으로 재사용하지 않는다.
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

### ScreenCloud

- Pricing: <https://screencloud.com/pricing>
- Help Center: <https://help.screencloud.com/en/>
- Introduction: <https://help.screencloud.com/en/articles/10096578-an-introduction-to-screencloud-how-to-use-screencloud-for-digital-signage>
- Screens: <https://help.screencloud.com/en/articles/10119993-screencloud-studio-screens>
- Video Wall: <https://help.screencloud.com/en/articles/10121614-how-to-set-up-a-video-wall-with-screencloud>
- Sync/Unsync/Device Time: <https://help.screencloud.com/en/articles/10119801-synchronizing-screens-with-playback-modes-sync-unsync-and-device-time>
- Custom Resolutions: <https://help.screencloud.com/en/articles/10115219-custom-resolutions-and-image-dimensions-using-channels-in-screencloud>
- Add/Set Up/Delete Screen: <https://help.screencloud.com/en/articles/10097048-how-do-i-add-set-up-or-delete-a-screen-in-screencloud>

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

### 보조 확인

- Screenly Docs: <https://www.screenly.io/docs/>
- Screenly Dashboard docs: <https://www.screenly.io/docs/get-started/overview/the-dashboard/>
- Screenly Connect first screen: <https://www.screenly.io/docs/get-started/first-screen/connect-your-first-screen/>
- Screenly Pricing: <https://www.screenly.io/pricing/>
- Signagelive Help Center: <https://support.signagelive.com/en/>
- Signagelive Network creation: <https://support.signagelive.com/en/articles/137678-how-to-create-a-signagelive-by-navori-network>

## 9. 확인하지 못한 것 / 후속 조사

- Xibo의 현재 CMS 랜딩 대시보드, 실제 빈 상태, 등록 승인 모달은 공개 화면으로 확인하지 못했다. Displays 그리드와 문서 설명만 근거로 삼았다.
- Yodeck·ScreenCloud·OptiSigns·Play는 관리자 계정이 필요해 실제 화면 생성·업로드·게시를 수행하지 못했다. 문서와 공개 캡처의 단계 설명을 대조한 결과다.
- ScreenCloud의 일부 캡처는 2019·2021년 화면이고, OptiSigns도 구버전 UI가 섞여 있다. 현재 UI와 다를 수 있다.
- Play의 지원 문서는 화면 캡처가 거의 없어, “현재 화면 보기”와 관리자 UI를 라이브로 확인하지 못했다. 공식 마케팅 UI 이미지와 문서 텍스트로 대체했다.
- Anthias는 호스팅 데모가 없어 설정·자산 추가·컨트롤러 승인 흐름을 실제로 조작하지 못했다. 공식 사이트 캡처와 저장소 템플릿으로 확인했다.
- Xibo·Yodeck·ScreenCloud·OptiSigns·Play·Anthias의 한국어 UI 번역 품질은 이번 조사에서 검증하지 않았다. 모든 공식 문서는 영어로 읽었다.
- Screenly는 공개 문서의 내비게이션·용어·화면 흐름만 확인했고, 실제 관리자 UI 캡처는 확보하지 못했다. Signagelive는 네트워크 생성 절차와 라이선스 선행 조건만 확인했다.
- NoviSign, Mvix, Reach Media, ScreenTinker, Concerto의 화면 조사는 이번 라운드에서 완료하지 못했다. 다음 라운드에서 공개 데모/매뉴얼/저장소 화면을 추가 확인한다.

## 10. 이 프로젝트에 대한 권고

1. **홈은 “상태 + 다음 할 일”로 제한한다.** Play의 “1 of N screens live”, Yodeck의 상태 타일, Anthias의 Enabled/Inactive처럼 현재 상태와 다음 행동을 먼저 보여준다. 기능 목록은 뒤로 보낸다.
2. **2단계 화면 등록에 테스트 화면·확인 코드·승인을 넣는다.** Yodeck/Anthias의 장점을 결합해 “이 브라우저로 테스트”, “6자리 확인 코드”, “승인 대기”를 제공한다. 자동 발견은 후속 기능으로 두고, 수동 코드 흐름을 완성한다.
3. **3단계 배치를 자체 구현의 핵심으로 둔다.** 제품들이 못 하는 “임의 N대, 모니터별 해상도/방향, 가로·세로·격자·직접 배치”를 한 캔버스에서 제공한다. Xibo의 Sync Group, OptiSigns의 Merge Screens, Play의 Base Playlist를 개념적으로 참고하되 화면을 복제하지 않는다.
4. **4단계 이미지 업로드에 대상 모니터별 검사를 넣는다.** 업로드 즉시 “이 이미지는 A모니터에서 좌우 120px가 잘림”, “B모니터에는 세로 여백”처럼 보여주고, Fit/Fill/Stretch 선택과 안전 영역을 제공한다. 어느 제품도 이 지점을 완성하지 않았다.
5. **5단계 재생은 “방식 카드 + 패턴 표 + 자동 채우기”로 단순화한다.** 개별/순환/동시/통합 4가지를 카드로 보여주고, 이미지 수와 모니터 수가 다를 때 시작 위치·회전 방향·LCM 주기를 표로 미리 보여준다. Xibo/OptiSigns/Play의 동기화 용어를 그대로 쓰지 않는다.
6. **6단계 미리보기는 여러 모니터를 한 시간축으로 재생하고, 경고를 게시 전에 모은다.** ScreenCloud Channel Preview의 재생 컨트롤과 Yodeck Preview의 “하드웨어 없이 보기”를 참고하되, 시간 이동·화면별 경고·게시 요약까지 확장한다.
7. **용어는 한국어 과업어로 고정한다.** 화면, 모니터, 장소, 이미지, 이미지 순서, 재생 방식, 미리보기, 게시. 필요할 때만 괄호로 Display/Playlist/Channel을 병기한다. “동기화”는 “같은 시각에 전환”처럼 조건을 붙여 쓴다.
8. **기본 이미지와 오프라인 동작을 게시 흐름에 포함한다.** 일정이 없거나 서버가 끊겨도 마지막 콘텐츠를 계속 재생하고, 관리자에게 “오프라인·마지막 연결·복구 버튼”을 보여준다. Xibo의 기본 레이아웃, Play의 Base Playlist, Anthias의 오프라인 설명을 추상화한다.

이 보고서는 패턴 분석 자료다. 실제 화면·문구·색·아이콘을 설계할 때는 `docs/design/ui-ux.md`의 한국어·접근성 원칙과 KRDS 조사 결과를 우선 적용하고, 상용 제품의 시각 디자인을 복제하지 않는다.
