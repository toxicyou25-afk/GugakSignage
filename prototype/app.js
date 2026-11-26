/* SPDX-License-Identifier: Apache-2.0 */
/* 열린안내판 — 의사결정용 관리 화면 프로토타입
   Plain HTML/CSS/JS. No backend, no external assets. */

(() => {
  'use strict';

  const STORAGE_KEY = 'gugak-signage-prototype-v1';
  const SCHEMA = 3;
  const app = document.getElementById('app');
  const live = document.getElementById('live');
  const toastRegion = document.getElementById('toast-region');
  const modalRoot = document.getElementById('modal-root');

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const STATUS = {
    online: { label: '온라인', icon: 'check-circle', className: 'online' },
    offline: { label: '오프라인', icon: 'wifi-off', className: 'offline' },
    pending: { label: '대기', icon: 'clock', className: 'pending' },
    error: { label: '오류', icon: 'alert', className: 'error' }
  };

  const MODES = {
    individual: {
      name: '개별 재생',
      short: '개별',
      desc: '화면마다 시작 위치와 흐름을 따로 정합니다.',
      long: '각 화면이 자기 위치에서 다음 이미지를 이어서 보여 줍니다. 같은 목록을 쓰되 화면마다 출발점을 다르게 둘 때 알맞습니다.'
    },
    cycle: {
      name: '순환 동기화',
      short: '순환',
      desc: '같은 주기로 돌면서 화면마다 다른 이미지를 보여 줍니다.',
      long: '모든 화면이 같은 시각에 다음 이미지로 넘어갑니다. 시작 위치와 이동 방향으로 이미지를 고르게 나눌 수 있습니다.'
    },
    mirror: {
      name: '동시 재생',
      short: '동시',
      desc: '모든 화면에 같은 이미지를 동시에 보여 줍니다.',
      long: '여러 화면이 한 몸처럼 같은 이미지를 보여 줍니다. 같은 안내를 크게 전할 때 알맞습니다.'
    },
    canvas: {
      name: '통합 화면',
      short: '통합',
      desc: '큰 이미지 한 장을 여러 화면에 나누어 보여 줍니다.',
      long: '모니터 사이 간격을 띄우고 한 장의 이미지를 이어 붙입니다. 큰 행사 포스터를 여러 화면으로 펼칠 때 알맞습니다.'
    }
  };

  const LAYOUTS = {
    single: { name: '1대', desc: '한 화면 가득' },
    row: { name: '가로', desc: '옆으로 나란히' },
    column: { name: '세로', desc: '위아래로 차곡차곡' },
    grid: { name: '격자', desc: '같은 크기로 나눔' },
    custom: { name: '직접 배치', desc: '끌어서 자유롭게' }
  };

  const ui = {
    tab: 'layout',
    statusFilter: 'all',
    libraryQuery: '',
    registrationError: '',
    manualCode: '',
    browserTestCode: '',
    uploadMessage: '',
    uploadTone: '',
    wizardErrors: [],
    focusAfterRender: null,
    focusHeading: false,
    previewClock: null,
    layoutHistory: new Map(),
    selectedStatus: null,
    toastTimer: null,
    savedUploadNotice: false
  };

  const modalState = {
    open: false,
    previousFocus: null
  };

  function icon(name, className = '') {
    return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, '&#96;');
  }

  function mod(value, divisor) {
    if (!divisor) return 0;
    return ((value % divisor) + divisor) % divisor;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) [a, b] = [b, a % b];
    return a || 1;
  }

  function lcm(a, b) {
    if (!a || !b) return 0;
    return Math.abs(a * b) / gcd(a, b);
  }

  function sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function formatCount(value) {
    return new Intl.NumberFormat('ko-KR').format(value);
  }

  function formatDateTime(iso, withYear = false) {
    if (!iso) return '기록 없음';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '기록 없음';
    return new Intl.DateTimeFormat('ko-KR', {
      ...(withYear ? { year: 'numeric' } : {}),
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function relativeTime(iso) {
    if (!iso) return '기록 없음';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '기록 없음';
    const diff = Date.now() - date.getTime();
    if (diff < 0) return '곧';
    if (diff < 60 * 1000) return '방금 전';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}시간 전`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}일 전`;
    return formatDateTime(iso);
  }

  function todayLabel() {
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    }).format(new Date());
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function agoISO(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.round(seconds));
    return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
  }

  function formatDuration(ms) {
    return `${Math.max(0, Math.round(ms / 1000))}초`;
  }

  function uid(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function statusBadge(status, extra = '') {
    const meta = STATUS[status] || STATUS.offline;
    return `<span class="badge badge--${meta.className} ${extra}">${icon(meta.icon)}${meta.label}</span>`;
  }

  function modeLabel(mode) {
    return (MODES[mode] || MODES.cycle).name;
  }

  function orientationLabel(display) {
    return display.orientation === 'portrait' ? '세로' : '가로';
  }

  function aspectOf(width, height) {
    return width && height ? width / height : 16 / 9;
  }

  function displayAspect(display) {
    if (!display) return 16 / 9;
    if (!display.width || !display.height) {
      return display.orientation === 'portrait' ? 9 / 16 : 16 / 9;
    }
    return display.width / display.height;
  }

  function siteTargetDisplay(site) {
    if (!site || !site.displays.length) return null;
    return site.displays.find((display) => display.orientation === 'landscape') || site.displays[0];
  }

  function aspectMismatch(asset, targetAspect) {
    if (!asset || !targetAspect) return false;
    const difference = Math.abs(asset.width / asset.height - targetAspect) / targetAspect;
    return difference > 0.1;
  }

  function layoutRectStyle(display) {
    return `left:${(display.x * 100).toFixed(4)}%;top:${(display.y * 100).toFixed(4)}%;width:${(display.w * 100).toFixed(4)}%;height:${(display.h * 100).toFixed(4)}%`;
  }

  function svgData(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
  }

  function makePosters() {
    const autumn = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#17313d"/><circle cx="1288" cy="222" r="190" fill="none" stroke="#6f9488" stroke-width="2" opacity=".65"/><circle cx="1288" cy="222" r="132" fill="none" stroke="#6f9488" stroke-width="2" opacity=".45"/><circle cx="1288" cy="222" r="74" fill="#b6503d" opacity=".9"/><path d="M104 704 C 360 570, 612 764, 868 602 S 1322 690, 1500 500" fill="none" stroke="#e9dfcc" stroke-width="1.5" opacity=".42"/><text x="104" y="146" fill="#acc9bc" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="23" font-weight="600" letter-spacing="5">2026 가을 기획공연</text><text x="100" y="316" fill="#fffaf0" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="94" font-weight="700" letter-spacing="-4">가을 문화</text><text x="100" y="426" fill="#fffaf0" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="94" font-weight="700" letter-spacing="-4">행사</text><line x1="104" y1="500" x2="410" y2="500" stroke="#b6503d" stroke-width="5"/><text x="104" y="574" fill="#e1d8c8" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="30">10.24 — 11.15 · 대공연장</text><text x="104" y="806" fill="#99b2a8" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="21" letter-spacing="2">예시 기관</text><rect x="1208" y="728" width="288" height="1" fill="#99b2a8" opacity=".55"/><text x="1208" y="774" fill="#c7d8d0" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="18">예매 문의 000.000.0000</text></svg>`;

    const desk = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#f0e6d4"/><path d="M0 0h1600v170H0z" fill="#17313d"/><circle cx="1348" cy="570" r="258" fill="#b6503d" opacity=".92"/><circle cx="1348" cy="570" r="196" fill="none" stroke="#f0e6d4" stroke-width="2" opacity=".55"/><text x="96" y="108" fill="#c6d9d0" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="22" font-weight="600" letter-spacing="4">INFORMATION · 안내</text><text x="96" y="352" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="92" font-weight="700" letter-spacing="-4">안내 데스크</text><text x="96" y="428" fill="#556563" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="34">오늘도 편하게 물어보세요.</text><line x1="96" y1="500" x2="460" y2="500" stroke="#17313d" stroke-width="2"/><text x="96" y="574" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="25">운영 시간 09:00 — 18:00</text><text x="96" y="618" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="25">점심시간 12:00 — 13:00</text><text x="96" y="806" fill="#6d7a75" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="18">공연장 · 전시실 · 편의시설 위치를 알려 드립니다.</text><text x="1250" y="586" fill="#fff5e9" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="30" font-weight="700" text-anchor="middle">도움이</text><text x="1250" y="626" fill="#fff5e9" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="30" font-weight="700" text-anchor="middle">필요하신가요?</text></svg>`;

    const schedule = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#182d3b"/><rect x="0" y="0" width="34" height="900" fill="#b6503d"/><text x="106" y="126" fill="#a8c5b8" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="22" font-weight="600" letter-spacing="4">이번 달 공연</text><text x="102" y="242" fill="#fffaf1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="72" font-weight="700" letter-spacing="-3">공연 일정</text><line x1="104" y1="290" x2="1496" y2="290" stroke="#496274"/><g fill="#e9e0d0" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif"><text x="106" y="386" font-size="53" font-weight="700">11.28</text><text x="106" y="422" font-size="18" fill="#9bb5aa">금요일 · 19:30</text><text x="380" y="378" font-size="31">시민 문화 행사</text><text x="380" y="414" font-size="19" fill="#aabdb7">대공연장 · 전석 20,000원</text><text x="106" y="556" font-size="53" font-weight="700">12.03</text><text x="106" y="592" font-size="18" fill="#9bb5aa">수요일 · 19:30</text><text x="380" y="548" font-size="31">겨울 문화 교실</text><text x="380" y="584" font-size="19" fill="#aabdb7">소공연장 · 전석 15,000원</text><text x="106" y="726" font-size="53" font-weight="700">12.12</text><text x="106" y="762" font-size="18" fill="#9bb5aa">토요일 · 15:00</text><text x="380" y="718" font-size="31">가족 체험 행사</text><text x="380" y="754" font-size="19" fill="#aabdb7">야외마당 · 무료</text></g><text x="1496" y="838" fill="#809c91" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="17" text-anchor="end">일정은 사정에 따라 바뀔 수 있습니다.</text></svg>`;

    const exhibition = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#dce8e1"/><path d="M0 0h1080v380H0z" fill="#17313d"/><circle cx="840" cy="860" r="330" fill="none" stroke="#17313d" stroke-width="2" opacity=".28"/><circle cx="840" cy="860" r="236" fill="none" stroke="#17313d" stroke-width="2" opacity=".2"/><path d="M120 1240 C 260 1080, 560 1340, 940 1130" fill="none" stroke="#b6503d" stroke-width="5"/><text x="84" y="120" fill="#a9c7ba" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="24" font-weight="600" letter-spacing="5">특별전</text><text x="80" y="306" fill="#fffaf1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="76" font-weight="700" letter-spacing="-3">결, 머물다</text><text x="84" y="356" fill="#b7ccc3" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="25">한지와 소리 사이</text><text x="84" y="560" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="100" font-weight="700" letter-spacing="-5">결,</text><text x="84" y="674" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="100" font-weight="700" letter-spacing="-5">머물다</text><line x1="88" y1="750" x2="480" y2="750" stroke="#b6503d" stroke-width="4"/><text x="88" y="824" fill="#415452" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="27">2026.11.08 — 2027.02.28</text><text x="88" y="872" fill="#415452" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="27">기획전시실</text><text x="88" y="1720" fill="#4d615d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="22">관람 시간 10:00 — 18:00 · 월요일 휴관</text></svg>`;

    const closure = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#f7f1e6"/><rect x="0" y="0" width="1600" height="118" fill="#17313d"/><text x="94" y="76" fill="#c9dbd2" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="21" font-weight="600" letter-spacing="4">운영 안내</text><text x="92" y="322" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="94" font-weight="700" letter-spacing="-4">정기 휴관 안내</text><rect x="92" y="378" width="652" height="8" fill="#b6503d"/><text x="92" y="500" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="48" font-weight="700">매주 월요일</text><text x="92" y="570" fill="#5a6967" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="28">전시실과 안내 데스크를 쉽니다.</text><text x="92" y="674" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="23">공연이 있는 월요일에는 공연 시작 한 시간 전부터 엽니다.</text><circle cx="1310" cy="514" r="215" fill="#e3dfd2"/><path d="M1170 520c40-70 100-110 168-110s128 40 168 110" fill="none" stroke="#17313d" stroke-width="3" opacity=".7"/><path d="M1214 500h248" stroke="#b6503d" stroke-width="4"/><text x="92" y="810" fill="#89918b" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="18">자세한 운영 일정은 안내 데스크에 문의해 주세요.</text></svg>`;

    const instruments = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#1b303c"/><circle cx="1176" cy="440" r="280" fill="#b6503d" opacity=".9"/><circle cx="1176" cy="440" r="210" fill="none" stroke="#f2e8d6" stroke-width="2" opacity=".55"/><circle cx="1176" cy="440" r="118" fill="none" stroke="#f2e8d6" stroke-width="2" opacity=".35"/><path d="M786 630h780" stroke="#f2e8d6" stroke-width="2" opacity=".35"/><text x="98" y="132" fill="#a7c3b7" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="22" font-weight="600" letter-spacing="4">시설 안내</text><text x="94" y="340" fill="#fffaf1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="88" font-weight="700" letter-spacing="-4">시설 이용 안내</text><text x="98" y="428" fill="#d9cfbe" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="38">편리한 시설 이용</text><line x1="98" y1="490" x2="568" y2="490" stroke="#6f9488" stroke-width="3"/><text x="98" y="552" fill="#b9cbc3" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="23">이용 방법은 안내 데스크에 문의하세요</text><text x="98" y="594" fill="#b9cbc3" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="23">시설 이용 안내 예시</text><text x="98" y="814" fill="#92ad9f" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="17">전시 해설 14:00 · 16:00</text><text x="1430" y="820" fill="#f2e8d6" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="17" text-anchor="end">예시 기관 기획전시</text></svg>`;

    const classes = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#e9dfcf"/><path d="M0 0h1080v370H0z" fill="#17313d"/><path d="M0 1450h1080v470H0z" fill="#17313d"/><rect x="86" y="520" width="908" height="1" fill="#b8aa94"/><text x="84" y="118" fill="#a9c7ba" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="23" font-weight="600" letter-spacing="4">겨울 강좌</text><text x="80" y="290" fill="#fffaf1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="75" font-weight="700" letter-spacing="-3">시민 배움터</text><text x="84" y="345" fill="#b8ccc3" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="25">직접 듣고, 배우고, 나누는 두 달</text><text x="86" y="672" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="66" font-weight="700">수강 신청</text><text x="86" y="786" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="25">독서 · 문화 · 생활 · 체험</text><text x="86" y="834" fill="#17313d" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="25">12.01 — 12.14 · 선착순</text><circle cx="816" cy="970" r="186" fill="#b6503d" opacity=".9"/><path d="M696 1004c48-58 82-88 122-88s74 30 122 88" fill="none" stroke="#f5ecde" stroke-width="2" opacity=".6"/><text x="84" y="1520" fill="#fffaf1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="30" font-weight="700">예시 기관 교육팀</text><text x="84" y="1572" fill="#b9cdc4" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="22">000.000.0000 · 평일 10:00 — 17:00</text><text x="84" y="1730" fill="#92af9f" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="18">강좌 일정과 인원은 안내에 따라 달라질 수 있습니다.</text></svg>`;

    const greeting = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#6f9488"/><circle cx="1320" cy="170" r="330" fill="#f4efe5" opacity=".1"/><circle cx="1320" cy="170" r="216" fill="none" stroke="#f4efe5" stroke-width="2" opacity=".28"/><path d="M90 700 C 300 580, 510 760, 720 630 S 1100 740, 1510 560" fill="none" stroke="#f4efe5" stroke-width="2" opacity=".36"/><text x="96" y="146" fill="#dbe9e1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="22" font-weight="600" letter-spacing="5">2027 새해 인사</text><text x="92" y="354" fill="#fffaf1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="88" font-weight="700" letter-spacing="-4">새해 복 많이</text><text x="92" y="462" fill="#fffaf1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="88" font-weight="700" letter-spacing="-4">받으세요</text><text x="96" y="560" fill="#dce9e2" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="29">좋은 소리와 함께하는 한 해가 되기를 바랍니다.</text><rect x="96" y="634" width="328" height="4" fill="#f1dfcf"/><text x="96" y="812" fill="#dbe9e1" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="19">예시 기관 · 2027</text></svg>`;

    return [
      {
        id: 'img-autumn', title: '가을 문화 행사', filename: 'autumn-sori-2026.svg',
        width: 1600, height: 900, size: 48620, mime: 'image/svg+xml',
        dataUrl: svgData(autumn), createdAt: agoISO(60 * 24 * 12), sample: true,
        kind: 'landscape', alt: '남색 배경에 가을 공연 제목과 둥근 청자색 무늬가 있는 포스터'
      },
      {
        id: 'img-desk', title: '안내 데스크 운영 안내', filename: 'desk-hours.svg',
        width: 1600, height: 900, size: 38210, mime: 'image/svg+xml',
        dataUrl: svgData(desk), createdAt: agoISO(60 * 24 * 9), sample: true,
        kind: 'landscape', alt: '베이지 배경에 안내 데스크 운영 시간과 주홍색 원이 있는 안내 이미지'
      },
      {
        id: 'img-schedule', title: '이번 달 공연 일정', filename: 'november-schedule.svg',
        width: 1600, height: 900, size: 52140, mime: 'image/svg+xml',
        dataUrl: svgData(schedule), createdAt: agoISO(60 * 24 * 7), sample: true,
        kind: 'landscape', alt: '남색 배경에 이번 달 공연 날짜와 공연명을 정리한 일정표'
      },
      {
        id: 'img-exhibition', title: '결, 머물다', filename: 'exhibition-gyeol.svg',
        width: 1080, height: 1920, size: 44980, mime: 'image/svg+xml',
        dataUrl: svgData(exhibition), createdAt: agoISO(60 * 24 * 5), sample: true,
        kind: 'portrait', alt: '연한 청자색 배경에 특별전 결, 머물다를 알리는 세로 포스터'
      },
      {
        id: 'img-closure', title: '정기 휴관 안내', filename: 'monday-closure.svg',
        width: 1600, height: 900, size: 35340, mime: 'image/svg+xml',
        dataUrl: svgData(closure), createdAt: agoISO(60 * 24 * 4), sample: true,
        kind: 'landscape', alt: '한지색 배경에 매주 월요일 정기 휴관을 알리는 안내 이미지'
      },
      {
        id: 'img-instruments', title: '시설 이용 안내', filename: 'jangu-two-faces.svg',
        width: 1600, height: 900, size: 47110, mime: 'image/svg+xml',
        dataUrl: svgData(instruments), createdAt: agoISO(60 * 24 * 3), sample: true,
        kind: 'landscape', alt: '남색 배경과 주홍색 둥근 무늬로 시설 안내을 알리는 포스터'
      },
      {
        id: 'img-classes', title: '겨울 시민 배움터', filename: 'winter-classes.svg',
        width: 1080, height: 1920, size: 41860, mime: 'image/svg+xml',
        dataUrl: svgData(classes), createdAt: agoISO(60 * 24 * 2), sample: true,
        kind: 'portrait', alt: '베이지 배경에 겨울 시민 강좌 수강 신청을 안내하는 세로 포스터'
      },
      {
        id: 'img-greeting', title: '2027 새해 인사', filename: 'new-year-2027.svg',
        width: 1600, height: 900, size: 33120, mime: 'image/svg+xml',
        dataUrl: svgData(greeting), createdAt: agoISO(60 * 24), sample: true,
        kind: 'landscape', alt: '청자색 배경에 새해 복 많이 받으세요라고 적힌 인사 이미지'
      }
    ];
  }

  function imageIdsForCount(count) {
    const order = ['img-autumn', 'img-schedule', 'img-exhibition', 'img-desk', 'img-greeting', 'img-instruments', 'img-closure', 'img-classes'];
    return order.slice(0, clamp(count, 0, 8));
  }

  const DISPLAY_NAMES = ['로비 왼쪽', '로비 오른쪽', '안내 데스크', '계단 앞', '공연장 입구', '중앙 홀', '전시실 앞', '기념품점'];
  const DISPLAY_STATUSES = ['online', 'online', 'offline', 'error', 'pending', 'online', 'online', 'offline'];

  function makeSlots(count, type) {
    if (count <= 0) return [];
    if (type === 'single' && count > 1) type = 'grid';
    const gap = count === 1 ? 0 : 0.018;
    const margin = count === 1 ? 0.06 : 0.035;
    const innerWidth = 1 - margin * 2;
    const innerHeight = 1 - margin * 2;

    if (type === 'single' || count === 1) {
      return [{ x: margin, y: margin, w: innerWidth, h: innerHeight }];
    }

    if (type === 'row') {
      const width = (innerWidth - gap * (count - 1)) / count;
      const height = Math.min(innerHeight, width * 0.62);
      const y = (1 - height) / 2;
      return Array.from({ length: count }, (_, index) => ({
        x: margin + index * (width + gap), y, w: width, h: height
      }));
    }

    if (type === 'column') {
      const height = (innerHeight - gap * (count - 1)) / count;
      const width = Math.min(innerWidth, height * 1.4);
      const x = (1 - width) / 2;
      return Array.from({ length: count }, (_, index) => ({
        x, y: margin + index * (height + gap), w: width, h: height
      }));
    }

    const columns = count === 2 ? 2 : count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const cellW = (innerWidth - gap * (columns - 1)) / columns;
    const cellH = (innerHeight - gap * (rows - 1)) / rows;
    return Array.from({ length: count }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const usedInRow = Math.min(columns, count - row * columns);
      const offset = (columns - usedInRow) * (cellW + gap) / 2;
      return {
        x: margin + offset + column * (cellW + gap),
        y: margin + row * (cellH + gap),
        w: cellW,
        h: cellH
      };
    });
  }

  function makeDisplays(siteId, count, statusProfile = 'main') {
    const slots = makeSlots(count, count === 1 ? 'single' : count === 2 ? 'row' : 'grid');
    const statuses = statusProfile === 'secondary'
      ? ['online', 'offline']
      : DISPLAY_STATUSES;

    return Array.from({ length: count }, (_, index) => {
      const portrait = count >= 3 && index === 2;
      const status = statuses[index % statuses.length];
      const minutesAgo = status === 'offline' ? 7 + index : status === 'error' ? 3 : status === 'online' ? 0.2 + index : 18;
      return {
        id: `${siteId}-d${index + 1}`,
        name: DISPLAY_NAMES[index % DISPLAY_NAMES.length],
        status,
        orientation: portrait ? 'portrait' : 'landscape',
        width: portrait ? 1080 : 1920,
        height: portrait ? 1920 : 1080,
        rotation: portrait ? 90 : 0,
        fit: 'contain',
        lastSeen: status === 'pending' ? null : agoISO(minutesAgo),
        browser: index === 3 ? '구형 Chromium 92' : 'Chrome 141',
        ip: `192.168.0.${31 + index}`,
        hardwareId: `GUK-${siteId.slice(-1).toUpperCase()}-${String(index + 1).padStart(2, '0')}-A7`,
        capabilities: index === 3 ? ['브라우저', '구형 브라우저'] : ['브라우저', '다중 창', '오프라인 저장'],
        errorCode: status === 'error' ? 'E-204' : '',
        startOffset: 0,
        step: 1,
        x: slots[index].x, y: slots[index].y, w: slots[index].w, h: slots[index].h
      };
    });
  }

  function autoOffsets(site) {
    const count = site.playlistIds.length;
    site.displays.forEach((display, index) => {
      display.startOffset = count ? mod(index, count) : 0;
      display.step = 1;
    });
  }

  function seedPublications(siteName, version, mode, imageCount, displayCount) {
    return [
      {
        version, at: agoISO(176 + (version % 3) * 12), actor: '박서윤', mode,
        imageCount, displayCount, note: `${siteName} 정기 게시`
      },
      {
        version: version - 1, at: agoISO(60 * 24 * 2 + 44), actor: '김하늘', mode,
        imageCount: Math.max(1, imageCount - 1), displayCount, note: '공연 일정 이미지 교체'
      },
      {
        version: version - 2, at: agoISO(60 * 24 * 6), actor: '김하늘', mode,
        imageCount: Math.max(1, imageCount), displayCount, note: '주간 공지 갱신'
      }
    ].slice(0, 3);
  }

  function makeSite(config) {
    const displays = makeDisplays(config.id, config.displayCount, config.statusProfile);
    const layoutType = config.displayCount === 1 ? 'single' : config.displayCount === 2 && config.statusProfile === 'secondary' ? 'row' : 'grid';
    const site = {
      id: config.id,
      letter: config.letter,
      name: config.name,
      location: config.location,
      hours: config.hours,
      displays,
      layoutType,
      mode: config.mode,
      playlistIds: config.playlistIds.slice(),
      durations: Object.fromEntries(config.playlistIds.map((id) => [id, 8])),
      fallbackAssetId: config.fallbackAssetId || 'img-closure',
      publishedVersion: config.version,
      lastPublishedAt: agoISO(176),
      pending: config.pending || [],
      publications: seedPublications(config.name, config.version, config.mode, config.playlistIds.length, displays.length),
      notes: config.notes || ''
    };
    const pending = (config.pending || []).slice();
    displays.forEach((display) => {
      if (display.status === 'pending') {
        pending.unshift({
          id: `${display.id}-registration`, name: display.name, code: '394561', ip: display.ip,
          resolution: `${display.width}×${display.height}`, orientation: display.orientation,
          browser: display.browser, capabilities: display.capabilities.slice(), foundAt: agoISO(6), displayId: display.id
        });
      }
    });
    site.pending = pending;
    autoOffsets(site);
    return site;
  }

  function makePendingDevices(siteId) {
    const base = [
      {
        id: `${siteId}-pending-1`, name: '로비 오른쪽 화면', code: '482913', ip: '192.168.0.71',
        resolution: '1920×1080', orientation: 'landscape', browser: 'Chrome 141',
        capabilities: ['브라우저', '다중 창', '오프라인 저장'], foundAt: agoISO(2)
      },
      {
        id: `${siteId}-pending-2`, name: '계단 앞 안내 화면', code: '710264', ip: '192.168.0.72',
        resolution: '1080×1920', orientation: 'portrait', browser: 'Chrome 139',
        capabilities: ['브라우저', '오프라인 저장'], foundAt: agoISO(8)
      }
    ];
    return siteId.includes('b') ? base.slice(0, 1) : base;
  }

  function seedActivities(sites) {
    const first = sites[0]?.name || '인포메이션센터';
    const second = sites[1]?.name || first;
    return [
      { id: uid('act'), kind: 'publish', actor: '박서윤', text: `${first}에 새 이미지 순서를 게시했습니다.`, at: agoISO(18), siteId: sites[0]?.id || null },
      { id: uid('act'), kind: 'check', actor: '시스템', text: '화면 연결 상태를 확인했습니다. 오프라인 1대를 찾았습니다.', at: agoISO(42), siteId: sites[0]?.id || null },
      { id: uid('act'), kind: 'edit', actor: '김하늘', text: `${second}의 세로 화면에 맞춤 방식을 조정했습니다.`, at: agoISO(94), siteId: sites[1]?.id || null },
      { id: uid('act'), kind: 'upload', actor: '김하늘', text: '겨울 시민 배움터 이미지를 보관함에 올렸습니다.', at: agoISO(60 * 4 + 12), siteId: null }
    ];
  }

  function buildDefaultState(options = {}) {
    const siteCount = options.sites == null ? 2 : options.sites;
    const displayCount = options.displays || 4;
    const images = options.images == null ? 3 : options.images;
    const mode = options.mode || 'cycle';
    const assets = makePosters();
    const imageIds = imageIdsForCount(images);
    const sites = [];

    if (siteCount > 0) {
      sites.push(makeSite({
        id: 'site-a', letter: 'A', name: 'A 인포메이션센터', location: '1층 로비', hours: '09:00 — 18:00',
        displayCount, mode, playlistIds: imageIds, version: 12, statusProfile: 'main',
        pending: makePendingDevices('site-a')
      }));
      sites.push(makeSite({
        id: 'site-b', letter: 'B', name: 'B 인포메이션센터', location: '지하 1층 안내홀', hours: '09:30 — 17:30',
        displayCount: 2, mode: 'mirror', playlistIds: imageIds, version: 5, statusProfile: 'secondary',
        pending: makePendingDevices('site-b')
      }));
    }

    return {
      schema: SCHEMA,
      createdAt: nowISO(),
      activeSiteId: sites[0]?.id || null,
      sites,
      assets,
      activities: seedActivities(sites),
      wizard: null,
      scenario: {
        sites: siteCount > 0 ? 2 : 0,
        displays: displayCount,
        images,
        mode
      }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return buildDefaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schema !== SCHEMA || !Array.isArray(parsed.sites) || !Array.isArray(parsed.assets)) {
        return buildDefaultState();
      }
      parsed.activities = Array.isArray(parsed.activities) ? parsed.activities : [];
      parsed.scenario = parsed.scenario || { sites: 2, displays: 4, images: 3, mode: 'cycle' };
      return parsed;
    } catch (error) {
      return buildDefaultState();
    }
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      if (!ui.savedUploadNotice) {
        ui.savedUploadNotice = true;
        announce('브라우저 저장 공간이 부족해 이번 화면에서만 변경 내용을 유지합니다. 이미지를 줄이거나 다시 시작해 주세요.', 'error');
      }
      return false;
    }
  }

  function activeSite() {
    return state.sites.find((site) => site.id === state.activeSiteId) || state.sites[0] || null;
  }

  function assetById(id) {
    return state.assets.find((asset) => asset.id === id) || null;
  }

  function siteById(id) {
    return state.sites.find((site) => site.id === id) || null;
  }

  function displayById(site, id) {
    return site?.displays.find((display) => display.id === id) || null;
  }

  function playlistAssets(site) {
    if (!site) return [];
    return site.playlistIds.map(assetById).filter(Boolean);
  }

  function fallbackAsset(site) {
    return site ? assetById(site.fallbackAssetId) : null;
  }

  function addActivity(text, kind = 'edit', siteId = null, actor = '김하늘') {
    state.activities.unshift({ id: uid('act'), text, kind, siteId, actor, at: nowISO() });
    state.activities = state.activities.slice(0, 12);
  }

  function ensureActiveSite() {
    if (!state.sites.length) {
      state.activeSiteId = null;
      return;
    }
    if (!state.sites.some((site) => site.id === state.activeSiteId)) {
      state.activeSiteId = state.sites[0].id;
    }
  }

  function announce(message, tone = 'polite') {
    live.textContent = '';
    window.setTimeout(() => {
      live.textContent = message;
    }, 30);
    if (tone !== 'silent') toast(message, tone);
  }

  function toast(message, tone = 'success') {
    if (!toastRegion) return;
    if (ui.toastTimer) window.clearTimeout(ui.toastTimer);
    const iconName = tone === 'error' ? 'alert' : tone === 'info' ? 'info' : 'check-circle';
    toastRegion.innerHTML = `<div class="toast toast--${tone}">${icon(iconName)}<span>${escapeHTML(message)}</span></div>`;
    ui.toastTimer = window.setTimeout(() => {
      toastRegion.innerHTML = '';
    }, 5200);
  }

  function refreshLive() {
    // Keeps announcements available when the main view is re-rendered.
    if (live && !live.textContent) live.textContent = '';
  }

  /* ---------- playback engine (shared by editor preview and simulator) ---------- */

  function playlistEntries(site) {
    if (!site) return [];
    return site.playlistIds.map((id) => {
      const asset = assetById(id);
      if (!asset) return null;
      const seconds = Number(site.durations?.[id] ?? 8);
      return { asset, seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 8 };
    }).filter(Boolean);
  }

  function cycleLength(entries) {
    return sum(entries.map((entry) => entry.seconds * 1000));
  }

  function timelineAt(entries, timeMs) {
    const cycleMs = cycleLength(entries);
    if (!entries.length || cycleMs <= 0) {
      return { index: 0, cycleMs: 0, elapsedMs: 0, remainingMs: 0, entry: entries[0] || null };
    }
    const elapsed = mod(timeMs, cycleMs);
    let cursor = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const duration = entries[index].seconds * 1000;
      if (duration > 0 && elapsed < cursor + duration) {
        return {
          index,
          cycleMs,
          elapsedMs: elapsed,
          remainingMs: cursor + duration - elapsed,
          entry: entries[index]
        };
      }
      cursor += duration;
    }
    return {
      index: Math.max(0, entries.length - 1),
      cycleMs,
      elapsedMs: elapsed,
      remainingMs: 0,
      entry: entries[entries.length - 1]
    };
  }

  function resolveSiteAt(site, timeMs) {
    const entries = playlistEntries(site);
    const timeline = timelineAt(entries, timeMs);
    if (!site || !entries.length) {
      return { entries, timeline, perDisplay: [], cycleMs: 0 };
    }

    const count = entries.length;
    const perDisplay = site.displays.map((display, index) => {
      let imageIndex = timeline.index;
      if (site.mode === 'cycle' || site.mode === 'individual') {
        imageIndex = mod(timeline.index * Number(display.step ?? 1) + Number(display.startOffset ?? index), count);
      }
      return { display, imageIndex, entry: entries[imageIndex] };
    });

    return { entries, timeline, perDisplay, cycleMs: timeline.cycleMs };
  }

  function countStatuses(site) {
    const counts = { online: 0, offline: 0, pending: 0, error: 0 };
    (site?.displays || []).forEach((display) => {
      counts[display.status] = (counts[display.status] || 0) + 1;
    });
    return counts;
  }

  function aggregateStatuses() {
    return state.sites.reduce((counts, site) => {
      const siteCounts = countStatuses(site);
      Object.keys(counts).forEach((key) => { counts[key] += siteCounts[key] || 0; });
      return counts;
    }, { online: 0, offline: 0, pending: 0, error: 0 });
  }

  function overlaps(a, b) {
    const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (width <= 0 || height <= 0) return false;
    return (width * height) / Math.min(a.w * a.h, b.w * b.h) > 0.03;
  }

  function layoutCoverage(site) {
    if (!site.displays.length) return 0;
    return clamp(sum(site.displays.map((display) => display.w * display.h)), 0, 1);
  }

  function siteWarnings(site) {
    if (!site) return [];
    const warnings = [];
    const entries = playlistEntries(site);
    const target = siteTargetDisplay(site);
    const targetAspect = target ? displayAspect(target) : 16 / 9;

    if (!site.displays.length) {
      warnings.push({ severity: 'error', title: '화면이 아직 없습니다.', body: '화면을 한 대 이상 추가해야 이미지를 보여 줄 수 있습니다.', action: 'register' });
      return warnings;
    }

    const counts = countStatuses(site);
    if (counts.offline) {
      warnings.push({
        severity: 'warning',
        title: `오프라인 화면 ${counts.offline}대`,
        body: '연결이 끊긴 화면은 마지막 이미지를 계속 보여 줄 수 있습니다. 네트워크를 확인해 주세요.',
        action: 'status'
      });
    }
    if (counts.error) {
      warnings.push({
        severity: 'error',
        title: `오류가 난 화면 ${counts.error}대`,
        body: '이미지를 불러오지 못한 화면이 있습니다. 상태 점검에서 원인과 다음 행동을 확인하세요.',
        action: 'status'
      });
    }
    if (counts.pending) {
      warnings.push({
        severity: 'info',
        title: `등록을 기다리는 화면 ${counts.pending}대`,
        body: '연결은 되었지만 아직 게시 승인을 하지 않았습니다.',
        action: 'register'
      });
    }

    if (!entries.length) {
      warnings.push({
        severity: 'error',
        title: '재생할 이미지가 없습니다.',
        body: '이미지 보관함에서 이미지를 고르거나 새로 올려 주세요.',
        action: 'library'
      });
    } else {
      const mismatches = entries.filter((entry) => aspectMismatch(entry.asset, targetAspect));
      if (mismatches.length) {
        const portrait = targetAspect < 1 ? '가로' : '세로';
        warnings.push({
          severity: 'warning',
          title: `화면 비율과 다른 이미지 ${mismatches.length}장`,
          body: `${portrait} 이미지가 있습니다. '맞추기' 방식이면 빈 여백이 생길 수 있어요. 재생 화면에서 확인해 주세요.`,
          action: 'playback'
        });
      }
      if (entries.length < site.displays.length) {
        warnings.push({
          severity: 'info',
          title: '이미지가 화면보다 적습니다.',
          body: '이미지가 모자란 자리는 처음 이미지부터 다시 보여 주게 됩니다. 순환 순서를 확인해 보세요.',
          action: 'playback'
        });
      }
      if (entries.some((entry) => entry.seconds === 0)) {
        warnings.push({
          severity: 'warning',
          title: '표시 시간이 0초인 이미지가 있습니다.',
          body: '0초 이미지는 재생에서 건너뜁니다. 표시 시간을 다시 확인해 주세요.',
          action: 'playback'
        });
      }
    }

    const overlappingIds = new Set();
    for (let first = 0; first < site.displays.length; first += 1) {
      for (let second = first + 1; second < site.displays.length; second += 1) {
        if (overlaps(site.displays[first], site.displays[second])) {
          overlappingIds.add(site.displays[first].id);
          overlappingIds.add(site.displays[second].id);
        }
      }
    }
    if (overlappingIds.size) {
      warnings.push({
        severity: 'error',
        title: '화면 배치가 겹칩니다.',
        body: '겹친 화면은 실제 화면에서 일부가 가려질 수 있습니다. 배치를 조금 떼어 놓아 주세요.',
        action: 'layout'
      });
    }

    if (!fallbackAsset(site)) {
      warnings.push({
        severity: 'warning',
        title: '비상 이미지가 없습니다.',
        body: '이미지를 갑자기 불러오지 못할 때 화면이 비지 않도록 재생 화면에서 비상 이미지를 골라 주세요.',
        action: 'playback'
      });
    }

    const outOfBounds = site.displays.some((display) => display.x < -0.001 || display.y < -0.001 || display.x + display.w > 1.001 || display.y + display.h > 1.001);
    if (outOfBounds) {
      warnings.push({
        severity: 'error',
        title: '화면이 배치판 밖으로 나갔습니다.',
        body: '배치판 안으로 화면을 옮겨 주세요.',
        action: 'layout'
      });
    }

    if (site.displays.length > 1 && layoutCoverage(site) < 0.55) {
      warnings.push({
        severity: 'info',
        title: '화면 주변에 빈 공간이 많습니다.',
        body: '의도한 배치라면 괜찮습니다. 화면을 조금 크게 키우면 실제 게시 화면과 미리보기가 비슷해져요.',
        action: 'layout'
      });
    }

    return warnings;
  }

  function warningIcon(severity) {
    return severity === 'error' ? 'alert' : severity === 'warning' ? 'alert' : 'info';
  }

  function warningRow(warning, withLink = false) {
    const severity = warning.severity || 'info';
    const actionHref = warning.action === 'layout' ? '#/site' : warning.action === 'library' ? '#/library' : warning.action === 'playback' ? '#/playback' : warning.action === 'register' ? '#/register' : warning.action === 'status' ? '#/status' : null;
    return `<div class="warning-row warning-row--${severity === 'warning' ? 'warning' : severity}">
      ${icon(warningIcon(severity))}
      <div><strong>${escapeHTML(warning.title)}</strong><br>${escapeHTML(warning.body)}</div>
      ${withLink && actionHref ? `<a class="btn btn--xs btn--secondary warning-row__link" href="${actionHref}">확인</a>` : ''}
    </div>`;
  }

  /* ---------- routing and shell ---------- */

  function parseRoute() {
    const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    const [pathPart] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const name = parts[0] || 'dashboard';
    if (name === 'site' && parts[1]) {
      return { name: 'site', siteId: parts[1] };
    }
    if (['dashboard', 'library', 'playback', 'preview', 'status', 'register', 'setup'].includes(name)) {
      return { name };
    }
    return { name: 'dashboard' };
  }

  function routeKey(route) {
    return `${route.name}:${route.siteId || state.activeSiteId || ''}`;
  }

  let lastRenderedRoute = '';

  function brandMark() {
    return `<svg class="brand__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="46" height="46" rx="13" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.18)"/>
      <path d="M12 31.5c4.8 0 7.8-15 11.2-15 3.7 0 5.7 15 12.8 15" fill="none" stroke="#93b8a9" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M12 36.2h24" stroke="#93b8a9" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>
      <circle cx="33.8" cy="14.4" r="4.2" fill="#b6503d"/>
    </svg>`;
  }

  function sitePicker() {
    if (!state.sites.length) {
      return `<span class="chip chip--navy" style="background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.2);color:#dce9e2">${icon('site', 'icon--sm')}장소 없음</span>`;
    }
    return `<div class="site-picker">${icon('site')}<label class="sr-only" for="site-picker">작업할 장소</label><select id="site-picker" data-role="site-picker">${state.sites.map((site) => `<option value="${site.id}" ${site.id === state.activeSiteId ? 'selected' : ''}>${escapeHTML(site.name)}</option>`).join('')}</select></div>`;
  }

  function navLink(key, label, iconName, href, active) {
    return `<a class="nav-link" href="${href}" ${active ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${label}</span></a>`;
  }

  function shell(route, content) {
    const site = activeSite();
    const siteHref = site ? `#/site/${site.id}` : '#/dashboard';
    const activeKey = route.name === 'site' ? 'sites' : route.name === 'setup' ? 'setup' : route.name;
    const sidebar = `<aside class="sidebar" aria-label="주요 메뉴">
      <nav aria-label="둘러보기">
        <div class="nav-group">
          <span class="nav-label">운영</span>
          ${navLink('dashboard', '홈', 'home', '#/dashboard', activeKey === 'dashboard')}
          ${navLink('sites', '장소', 'monitor', siteHref, activeKey === 'sites')}
          ${navLink('library', '이미지', 'image', '#/library', activeKey === 'library')}
          ${navLink('playback', '재생', 'play', '#/playback', activeKey === 'playback')}
          ${navLink('preview', '미리보기', 'eye', '#/preview', activeKey === 'preview')}
        </div>
        <div class="nav-group">
          <span class="nav-label">점검</span>
          ${navLink('status', '화면 상태', 'activity', '#/status', activeKey === 'status')}
          ${navLink('register', '화면 등록', 'monitor-add', '#/register', activeKey === 'register')}
        </div>
      </nav>
      <div class="sidebar__note"><strong>프로토타입 안내</strong>모든 장소와 이미지는 모의 데이터입니다. 변경 내용은 이 브라우저에만 저장됩니다.</div>
    </aside>`;

    return `<div class="topbar">
      <div class="topbar__inner">
        <a class="brand" href="#/dashboard" aria-label="열린안내판 홈">${brandMark()}
          <span class="brand__copy"><span class="brand__name">열린안내판</span><span class="brand__sub">인포메이션센터 관리</span></span>
        </a>
        <div class="topbar__tools">
          <span class="proto-chip">로컬 프로토타입</span>
          ${sitePicker()}
          <button class="btn btn--sm btn--light" type="button" data-action="open-scenario">${icon('sliders', 'icon--sm')}시나리오</button>
          <button class="icon-btn icon-btn--light" type="button" data-action="open-help" aria-label="도움말과 키보드 사용법">${icon('help')}</button>
        </div>
      </div>
    </div>
    <div class="shell">
      ${sidebar}
      <main class="main" id="main" tabindex="-1">
        ${content}
        <footer style="max-width:1240px;margin:42px auto 0;padding-top:16px;border-top:1px solid var(--line-soft);color:var(--muted);font-size:.74rem;line-height:1.6">
          열린안내판 · 의사결정용 작동형 프로토타입<br>
          실제 운영 시스템이 아니며, 모든 장소·화면·활동 기록은 예시입니다.
        </footer>
      </main>
    </div>`;
  }

  function renderPage(route) {
    switch (route.name) {
      case 'site': return renderSitePage();
      case 'library': return renderLibraryPage();
      case 'playback': return renderPlaybackPage();
      case 'preview': return renderPreviewPage();
      case 'status': return renderStatusPage();
      case 'register': return renderRegistrationPage();
      case 'setup': return renderWizardPage();
      default: return renderDashboard();
    }
  }

  function render(options = {}) {
    ensureActiveSite();
    const route = parseRoute();
    if (route.name === 'site' && route.siteId) {
      const targetSite = siteById(route.siteId);
      if (targetSite && state.activeSiteId !== targetSite.id) {
        state.activeSiteId = targetSite.id;
        saveState();
      }
    }

    if (route.name !== 'preview') stopPreviewClock();

    app.innerHTML = shell(route, renderPage(route));
    document.title = pageTitle(route);
    lastRenderedRoute = routeKey(route);
    ui.focusHeading = Boolean(options.focusHeading);

    window.requestAnimationFrame(() => {
      if (ui.focusHeading) {
        const title = document.getElementById('page-title');
        if (title) {
          title.setAttribute('tabindex', '-1');
          title.focus({ preventScroll: true });
        }
        window.scrollTo({ top: 0, behavior: 'auto' });
        ui.focusHeading = false;
      }
      if (ui.focusAfterRender) {
        const target = document.querySelector(ui.focusAfterRender);
        if (target) target.focus();
        ui.focusAfterRender = null;
      }
      if (route.name === 'site' && ui.tab === 'layout') initLayoutCanvas();
      if (route.name === 'preview') startPreviewClock();
      if (route.name === 'library') initLibraryPage();
      if (route.name === 'playback') initPlaybackDnD();
      if (route.name === 'setup') initWizardUpload();
    });
  }

  function pageTitle(route) {
    const site = activeSite();
    const map = {
      dashboard: '홈', site: site?.name || '장소', library: '이미지 보관함', playback: '재생 설정',
      preview: '미리보기', status: '화면 상태', register: '화면 등록', setup: '첫 게시 준비'
    };
    return `${map[route.name] || '홈'} · 열린안내판`;
  }

  function goTo(hash, siteId = null) {
    if (siteId && siteById(siteId)) {
      state.activeSiteId = siteId;
      saveState();
    }
    if (location.hash === hash) render({ focusHeading: true });
    else location.hash = hash;
  }

  /* ---------- dashboard ---------- */

  function siteHealth(site) {
    const counts = countStatuses(site);
    const total = site.displays.length;
    return { ...counts, total };
  }

  function siteImagePreview(site) {
    return playlistAssets(site)[0] || null;
  }

  function miniLayout(site) {
    const resolved = resolveSiteAt(site, 0);
    if (!site.displays.length) {
      return `<div class="mini-stage"><div class="empty-inline" style="position:absolute;inset:0;border:0;background:transparent;display:grid;place-content:center;color:#a9c0b7">화면 없음</div></div>`;
    }
    const monitors = site.displays.map((display, index) => {
      const entry = resolved.perDisplay[index];
      const asset = entry?.entry?.asset || null;
      return `<div class="mini-monitor" style="${layoutRectStyle(display)}" title="${escapeAttr(display.name)}">
        ${asset ? `<img src="${escapeAttr(asset.dataUrl)}" alt="">` : '<div class="mini-monitor__empty"></div>'}
        <span class="mini-monitor__dot status-dot--${display.status}"></span>
      </div>`;
    }).join('');
    return `<div class="mini-stage" aria-hidden="true">${monitors}</div>`;
  }

  function siteCard(site) {
    const health = siteHealth(site);
    const cover = siteImagePreview(site);
    const resolved = resolveSiteAt(site, 0);
    const firstEntry = resolved.perDisplay[0]?.entry?.asset || cover;
    const issueCount = health.offline + health.error;
    return `<article class="site-card">
      <div class="site-card__top">
        <div>
          <h3 class="site-card__name"><span class="site-letter">${site.letter}</span>${escapeHTML(site.name)}</h3>
          <p class="site-card__meta">${escapeHTML(site.location)} · ${escapeHTML(site.hours)}</p>
        </div>
        ${onlineSummaryBadge(health)}
      </div>
      <div class="site-card__visual">
        ${miniLayout(site)}
        <div class="site-glance">
          <span class="site-glance__label">현재 첫 화면</span>
          <div class="site-glance__image">
            ${firstEntry ? `<img class="site-glance__thumb" src="${escapeAttr(firstEntry.dataUrl)}" alt="">` : `<div class="site-glance__thumb" aria-hidden="true"></div>`}
            <span class="site-glance__title">${firstEntry ? escapeHTML(firstEntry.title) : '표시할 이미지 없음'}</span>
          </div>
          <span class="site-glance__foot">${modeLabel(site.mode)} · 이미지 ${site.playlistIds.length}장 · ${relativeTime(site.lastPublishedAt)} 게시</span>
        </div>
      </div>
      <div class="site-card__stats">
        <span class="chip">${icon('monitor', 'icon--sm')}화면 ${health.total}대</span>
        <span class="chip chip--celadon">온라인 ${health.online}</span>
        ${issueCount ? `<span class="chip chip--vermilion">확인 필요 ${issueCount}</span>` : ''}
        ${health.pending ? `<span class="chip chip--amber">대기 ${health.pending}</span>` : ''}
      </div>
      <div class="site-card__actions">
        <a class="btn btn--sm btn--secondary" href="#/site/${site.id}">배치 보기${icon('chevron-right', 'icon--sm')}</a>
        <button class="btn btn--sm btn--ghost" type="button" data-action="go" data-href="#/preview" data-site-id="${site.id}">미리보기</button>
        <button class="btn btn--sm btn--ghost" type="button" data-action="go" data-href="#/library" data-site-id="${site.id}">이미지 바꾸기</button>
      </div>
    </article>`;
  }

  function onlineSummaryBadge(health) {
    if (!health.total) return `<span class="badge badge--offline">${icon('monitor')}화면 없음</span>`;
    if (health.online === health.total) return `<span class="badge badge--online">${icon('check-circle')}모두 온라인</span>`;
    return `<span class="badge badge--offline">${icon('wifi-off')}${health.online}/${health.total} 온라인</span>`;
  }

  function nextActions() {
    const actions = [];
    if (state.wizard) {
      actions.push({
        tone: 'draft', icon: 'save', title: '작성 중인 첫 게시가 있습니다.',
        desc: `${state.wizard.siteName || '새 장소'} · ${state.wizard.step || 1}단계에서 이어서 할 수 있어요.`,
        cta: '이어서 설정', action: 'resume-wizard'
      });
    }
    state.sites.forEach((site) => {
      const counts = countStatuses(site);
      if (counts.error) {
        actions.push({ tone: 'error', icon: 'alert', title: `${site.name}에 오류 화면이 있습니다.`, desc: '원인과 다음 행동을 확인해 주세요.', cta: '상태 보기', action: 'go', href: '#/status', siteId: site.id });
      }
      if (counts.offline) {
        actions.push({ tone: 'warn', icon: 'wifi-off', title: `${site.name}에 오프라인 화면이 있습니다.`, desc: '마지막 이미지를 계속 보여 주고 있을 수 있습니다.', cta: '연결 확인', action: 'go', href: '#/status', siteId: site.id });
      }
      if (!site.playlistIds.length) {
        actions.push({ tone: 'error', icon: 'image', title: `${site.name}에 보여 줄 이미지가 없습니다.`, desc: '이미지를 고르면 바로 미리 볼 수 있습니다.', cta: '이미지 고르기', action: 'go', href: '#/library', siteId: site.id });
      }
      if (site.pending?.length) {
        actions.push({ tone: 'wait', icon: 'monitor-add', title: `${site.name}에 새 화면 ${site.pending.length}대가 기다립니다.`, desc: '확인 코드를 보고 등록을 승인해 주세요.', cta: '등록하기', action: 'go', href: '#/register', siteId: site.id });
      }
    });
    if (!actions.length) {
      const aspectTarget = siteTargetDisplay(activeSite());
      const mismatched = activeSite() && playlistAssets(activeSite()).filter((asset) => aspectMismatch(asset, aspectTarget ? displayAspect(aspectTarget) : 16 / 9));
      if (mismatched?.length) {
        actions.push({ tone: 'warn', icon: 'image', title: '화면 비율과 다른 이미지가 있습니다.', desc: '미리보기에서 여백이 생기는지 확인해 보세요.', cta: '확인하기', action: 'go', href: '#/playback', siteId: activeSite().id });
      } else if (activeSite()?.pending?.length) {
        actions.push({ tone: 'wait', icon: 'monitor-add', title: '등록을 기다리는 화면이 있습니다.', desc: '새 화면을 확인하고 승인해 주세요.', cta: '등록하기', action: 'go', href: '#/register', siteId: activeSite().id });
      }
    }
    return actions.slice(0, 5);
  }

  function actionToneClass(tone) {
    if (tone === 'error') return 'action-row__icon--error';
    if (tone === 'wait' || tone === 'warn') return '';
    if (tone === 'draft') return 'action-row__icon--info';
    return 'action-row__icon--info';
  }

  function renderDashboard() {
    const totals = aggregateStatuses();
    const totalDisplays = state.sites.reduce((count, site) => count + site.displays.length, 0);
    const totalImages = state.sites.reduce((count, site) => count + site.playlistIds.length, 0);
    const actions = nextActions();
    const site = activeSite();
    const draft = state.wizard;

    const head = `<header class="page-head">
      <div class="page-head__copy">
        <p class="eyebrow">${todayLabel()} · 대시보드</p>
        <h1 id="page-title">오늘의 게시 상태</h1>
        <p class="page-subtitle">장소별 화면과 다음에 할 일을 한눈에 확인하세요.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn--secondary" type="button" data-action="open-scenario">${icon('sliders')}시나리오 바꾸기</button>
        <button class="btn btn--primary" type="button" data-action="start-wizard">${icon('plus')}새 장소 만들기</button>
      </div>
    </header>`;

    if (!state.sites.length) {
      return `<div class="page">${head}
        <section class="empty-state" aria-labelledby="empty-title">
          <div class="empty-state__mark">${icon('site')}</div>
          <h2 id="empty-title">아직 등록된 장소가 없습니다.</h2>
          <p>장소 이름을 정하고 화면을 연결하면 첫 이미지를 게시할 수 있습니다. 모든 과정은 이 브라우저 안에서 연습할 수 있어요.</p>
          <div class="empty-state__actions">
            <button class="btn btn--primary" type="button" data-action="start-wizard">첫 장소 만들기${icon('arrow-right')}</button>
            <button class="btn btn--secondary" type="button" data-action="scenario-reset">기본 시나리오 불러오기</button>
          </div>
          <div class="empty-steps" aria-label="첫 게시 여섯 단계">
            ${[['장소','이름과 운영 시간'],['화면','연결 확인'],['배치','화면 순서'],['이미지','규격 확인'],['재생','방식과 순서'],['게시','미리보기']].map((item, index) => `<div class="empty-step"><span class="empty-step__num">${index + 1}</span><span class="empty-step__label">${item[0]}<br><span class="muted" style="font-weight:500">${item[1]}</span></span></div>`).join('')}
          </div>
        </section>
      </div>`;
    }

    const onlinePercent = totalDisplays ? Math.round((totals.online / totalDisplays) * 100) : 0;
    const issueCount = totals.offline + totals.error;
    const heroHeadline = issueCount
      ? `${totalDisplays}대 중 ${totals.online}대 정상, ${issueCount}대 확인 필요.`
      : totals.pending
        ? `${totalDisplays}대 중 ${totals.online}대 정상, ${totals.pending}대 등록 대기.`
        : `${totalDisplays}대 모두 정상입니다.`;

    const draftBanner = draft ? `<div class="draft-banner">
      <span class="draft-banner__icon">${icon('save')}</span>
      <div><div class="draft-banner__title">초안이 저장되어 있습니다.</div><div class="draft-banner__desc">${escapeHTML(draft.siteName || '새 장소')} · ${draft.step || 1}단계에서 이어서 설정할 수 있어요.</div></div>
      <div class="draft-banner__actions">
        <button class="btn btn--sm btn--secondary" type="button" data-action="discard-wizard">초안 버리기</button>
        <button class="btn btn--sm btn--primary" type="button" data-action="resume-wizard">이어서 하기</button>
      </div>
    </div>` : '';

    return `<div class="page">
      ${head}
      ${draftBanner}
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero__copy">
          <span class="hero__kicker">지금 게시 중</span>
          <h2 id="hero-title">${escapeHTML(heroHeadline)}</h2>
          <p>${state.sites.length}개 장소, 화면 ${totalDisplays}대에서 이미지 ${totalImages}장이 순서를 기다리고 있습니다. 다음 할 일을 먼저 살펴보세요.</p>
          <div class="hero__actions">
            <button class="btn btn--celadon" type="button" data-action="go" data-href="#/preview" data-site-id="${site?.id || ''}">${icon('eye')}미리보기</button>
            <button class="btn btn--light" type="button" data-action="go" data-href="#/library">${icon('image')}이미지 바꾸기</button>
          </div>
        </div>
        <div class="status-ring" style="--pct:${onlinePercent}" role="img" aria-label="전체 ${totalDisplays}대 중 ${totals.online}대 온라인">
          <div class="status-ring__inner"><span class="status-ring__num">${totals.online}<small> / ${totalDisplays}</small></span><span class="status-ring__label">온라인 화면</span></div>
        </div>
      </section>
      <section class="metric-strip" aria-label="화면 상태 요약">
        ${metric('check-circle', '온라인', totals.online, '')}
        ${metric('wifi-off', '오프라인', totals.offline, 'metric__icon--soft')}
        ${metric('monitor-add', '등록 대기', totals.pending, 'metric__icon--wait')}
        ${metric('alert', '게시 오류', totals.error, 'metric__icon--warn')}
      </section>
      <div class="section-head">
        <div><h2>장소별 상태</h2><p>카드를 누르면 배치를 바로 볼 수 있습니다.</p></div>
        <div class="section-head__right"><button class="text-link" type="button" data-action="start-wizard">장소 추가 ${icon('plus', 'icon--sm')}</button></div>
      </div>
      <div class="site-grid">${state.sites.map(siteCard).join('')}</div>
      <div class="dashboard-split">
        <section class="card" aria-labelledby="next-title">
          <div class="card__head"><div><h2 id="next-title">다음 할 일</h2><p class="small muted">지금 처리하면 좋은 일을 모았습니다.</p></div><span class="chip">${actions.length}개</span></div>
          ${actions.length ? `<div class="action-list">${actions.map((item) => actionRow(item)).join('')}</div>` : `<div class="empty-inline" style="margin:0 18px 18px"><span class="badge badge--online">${icon('check-circle')}처리할 일 없음</span><p style="margin-top:8px">오늘은 확인할 일이 없습니다. 새 이미지가 준비되면 교체해 보세요.</p></div>`}
        </section>
        <section class="card" aria-labelledby="activity-title">
          <div class="card__head"><div><h2 id="activity-title">최근 활동</h2><p class="small muted">마지막 변경과 게시 기록입니다.</p></div></div>
          <div class="activity-list">${state.activities.slice(0, 5).map(activityRow).join('') || '<div class="empty-inline">아직 활동 기록이 없습니다.</div>'}</div>
          <div class="card__footer"><span class="tiny muted">감사 로그 · 직원 이름과 작업 내용만 기록합니다.</span></div>
        </section>
      </div>
    </div>`;
  }

  function metric(iconName, label, value, extra) {
    return `<div class="metric"><span class="metric__icon ${extra}">${icon(iconName)}</span><div><span class="metric__value">${formatCount(value)}</span><span class="metric__label">${label}</span></div></div>`;
  }

  function actionRow(item) {
    let button;
    if (item.action === 'resume-wizard') {
      button = `<button class="btn btn--xs btn--primary" type="button" data-action="resume-wizard">${escapeHTML(item.cta)}</button>`;
    } else {
      button = `<button class="btn btn--xs btn--secondary" type="button" data-action="go" data-href="${item.href}" data-site-id="${item.siteId || ''}">${escapeHTML(item.cta)}</button>`;
    }
    return `<div class="action-row"><span class="action-row__icon ${actionToneClass(item.tone)}">${icon(item.icon)}</span><div><div class="action-row__title">${escapeHTML(item.title)}</div><div class="action-row__desc">${escapeHTML(item.desc)}</div></div>${button}</div>`;
  }

  function activityRow(activity) {
    const iconName = activity.kind === 'publish' ? 'send' : activity.kind === 'alert' ? 'alert' : activity.kind === 'check' ? 'activity' : activity.kind === 'upload' ? 'upload' : 'edit';
    const className = activity.kind === 'publish' ? 'activity-row__icon--publish' : activity.kind === 'alert' ? 'activity-row__icon--alert' : '';
    return `<div class="activity-row"><span class="activity-row__icon ${className}">${icon(iconName, 'icon--sm')}</span><div class="activity-row__text"><strong>${escapeHTML(activity.actor)}</strong>님이 ${escapeHTML(activity.text)}</div><time class="activity-row__time" datetime="${activity.at}">${relativeTime(activity.at)}</time></div>`;
  }

  /* ---------- site detail and layout canvas ---------- */

  function ensureSelectedDisplay(site) {
    if (!site) return null;
    let display = displayById(site, ui.selectedDisplayId);
    if (!display) {
      display = site.displays[0] || null;
      ui.selectedDisplayId = display?.id || null;
    }
    return display;
  }

  function getLayoutHistory(siteId) {
    if (!ui.layoutHistory.has(siteId)) ui.layoutHistory.set(siteId, { past: [], future: [] });
    return ui.layoutHistory.get(siteId);
  }

  function captureLayout(site) {
    return { layoutType: site.layoutType, displays: deepClone(site.displays), pending: deepClone(site.pending || []) };
  }

  function pushLayoutHistory(site) {
    const history = getLayoutHistory(site.id);
    history.past.push(captureLayout(site));
    if (history.past.length > 25) history.past.shift();
    history.future = [];
  }

  function restoreLayout(site, snapshot) {
    site.layoutType = snapshot.layoutType;
    site.displays = deepClone(snapshot.displays);
    site.pending = deepClone(snapshot.pending || []);
    ensureSelectedDisplay(site);
    saveState();
    render();
    announce('배치를 되돌렸습니다.');
  }

  function undoLayout() {
    const site = activeSite();
    if (!site) return;
    const history = getLayoutHistory(site.id);
    if (!history.past.length) return;
    history.future.push(captureLayout(site));
    restoreLayout(site, history.past.pop());
  }

  function redoLayout() {
    const site = activeSite();
    if (!site) return;
    const history = getLayoutHistory(site.id);
    if (!history.future.length) return;
    history.past.push(captureLayout(site));
    restoreLayout(site, history.future.pop());
  }

  function setLayoutType(type) {
    const site = activeSite();
    if (!site || site.layoutType === type) return;
    if (type === 'single' && site.displays.length > 1) {
      announce('1대 배치는 화면이 한 대일 때만 고를 수 있습니다.', 'info');
      return;
    }
    pushLayoutHistory(site);
    site.layoutType = type;
    if (type !== 'custom') {
      const slots = makeSlots(site.displays.length, type);
      site.displays.forEach((display, index) => {
        if (slots[index]) {
          display.x = slots[index].x;
          display.y = slots[index].y;
          display.w = slots[index].w;
          display.h = slots[index].h;
        }
      });
    }
    saveState();
    render();
    announce(`${LAYOUTS[type].name} 배치로 바꿨습니다.`);
  }

  function nextDisplayName(site) {
    const used = new Set(site.displays.map((display) => display.name));
    const candidate = DISPLAY_NAMES.find((name) => !used.has(name));
    return candidate || `새 화면 ${site.displays.length + 1}`;
  }

  function addDisplayToSite(site, options = {}) {
    if (!site) return;
    pushLayoutHistory(site);
    const count = site.displays.length + 1;
    const landscape = options.orientation !== 'portrait';
    const display = {
      id: uid(`${site.id}-d`),
      name: options.name || nextDisplayName(site),
      status: options.status || 'pending',
      orientation: landscape ? 'landscape' : 'portrait',
      width: landscape ? 1920 : 1080,
      height: landscape ? 1080 : 1920,
      rotation: landscape ? 0 : 90,
      fit: 'contain',
      lastSeen: options.status === 'online' ? nowISO() : options.status === 'pending' ? null : agoISO(4),
      browser: options.browser || 'Chrome 141',
      ip: options.ip || `192.168.0.${90 + count}`,
      hardwareId: `GUK-${uid('HW').slice(-8).toUpperCase()}`,
      capabilities: options.capabilities || ['브라우저', '다중 창', '오프라인 저장'],
      errorCode: '',
      startOffset: 0,
      step: 1,
      x: 0.35,
      y: 0.35,
      w: 0.3,
      h: 0.3
    };
    site.displays.push(display);
    display.startOffset = site.playlistIds.length ? mod(site.displays.length - 1, site.playlistIds.length) : 0;
    display.step = 1;
    site.pending = site.pending || [];
    if (display.status === 'pending') {
      site.pending.unshift({
        id: uid(`${site.id}-pending`), name: display.name, code: String(300000 + Math.floor(Math.random() * 699999)),
        ip: display.ip, resolution: `${display.width}×${display.height}`, orientation: display.orientation,
        browser: display.browser, capabilities: display.capabilities.slice(), foundAt: nowISO(), displayId: display.id
      });
    }
    if (site.layoutType !== 'custom') {
      if (count === 1) site.layoutType = 'single';
      else if (site.layoutType === 'single') site.layoutType = 'row';
      const slots = makeSlots(count, site.layoutType);
      site.displays.forEach((item, index) => {
        Object.assign(item, slots[index]);
      });
    } else {
      const safeX = 0.36;
      const safeY = 0.36;
      const safeW = 0.28;
      const safeH = 0.28;
      Object.assign(display, { x: safeX, y: safeY, w: safeW, h: safeH });
    }
    ui.selectedDisplayId = display.id;
    saveState();
    render();
    announce(`${display.name} 화면을 추가했습니다. 승인 전에는 대기 상태로 표시됩니다.`);
  }

  function removeDisplayFromSite(site, displayId) {
    const display = displayById(site, displayId);
    if (!display) return;
    pushLayoutHistory(site);
    const name = display.name;
    site.displays = site.displays.filter((item) => item.id !== displayId);
    site.pending = (site.pending || []).filter((item) => item.displayId !== displayId);
    clampDisplayOffsets(site);
    if (site.layoutType !== 'custom') {
      const slots = makeSlots(site.displays.length, site.layoutType === 'single' && site.displays.length > 1 ? 'grid' : site.layoutType);
      site.displays.forEach((item, index) => { if (slots[index]) Object.assign(item, slots[index]); });
    }
    ui.selectedDisplayId = site.displays[0]?.id || null;
    addActivity(`${site.name}에서 ${name} 화면 연결을 해제했습니다.`, 'edit', site.id);
    saveState();
    render();
    announce(`${name} 화면을 연결 해제했습니다.`);
  }

  function clampDisplayOffsets(site) {
    const count = site.playlistIds.length;
    site.displays.forEach((display) => {
      display.startOffset = count ? clamp(Number(display.startOffset) || 0, 0, count - 1) : 0;
      display.step = [1, -1, 0].includes(Number(display.step)) ? Number(display.step) : 1;
    });
  }

  function modeGlyph(mode, className = '') {
    const base = 'viewBox="0 0 120 58"';
    if (mode === 'individual') {
      return `<svg class="mode-glyph ${className}" ${base} aria-hidden="true"><rect x="4" y="12" width="45" height="32" rx="2" class="accent"/><rect x="56" y="12" width="45" height="32" rx="2"/><path class="line" d="M12 22h28M12 28h20M64 22h28M64 28h20"/><circle cx="41" cy="37" r="3" fill="#b6503d" stroke="none"/><circle cx="93" cy="37" r="3" fill="#6f9488" stroke="none"/></svg>`;
    }
    if (mode === 'cycle') {
      return `<svg class="mode-glyph ${className}" ${base} aria-hidden="true"><rect x="7" y="13" width="35" height="30" rx="2" class="accent"/><rect x="48" y="13" width="24" height="30" rx="2"/><rect x="78" y="13" width="35" height="30" rx="2" class="accent"/><path class="line" d="M15 23h20M56 23h9M86 23h20M94 36c-3 4-9 4-12 0"/><path d="m93 33 2 3-4 1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
    }
    if (mode === 'mirror') {
      return `<svg class="mode-glyph ${className}" ${base} aria-hidden="true"><rect x="9" y="13" width="32" height="30" rx="2" class="accent"/><rect x="46" y="13" width="28" height="30" rx="2" class="accent"/><rect x="79" y="13" width="32" height="30" rx="2" class="accent"/><circle cx="25" cy="28" r="7" fill="none" stroke="#3f6c5f"/><circle cx="60" cy="28" r="7" fill="none" stroke="#3f6c5f"/><circle cx="95" cy="28" r="7" fill="none" stroke="#3f6c5f"/></svg>`;
    }
    return `<svg class="mode-glyph ${className}" ${base} aria-hidden="true"><rect x="7" y="13" width="32" height="30" rx="2" class="accent"/><rect x="44" y="13" width="32" height="30" rx="2" class="accent"/><rect x="81" y="13" width="32" height="30" rx="2" class="accent"/><path d="M7 20c24 15 52-15 74 0s23 9 32 1M7 37c24-15 52 15 74 0s23-9 32-1" fill="none" stroke="#3f6c5f" stroke-width="1.2" opacity=".75"/></svg>`;
  }

  function renderSitePage() {
    const site = activeSite();
    if (!site) return noSiteView('장소를 찾을 수 없습니다.', '새 장소를 만들거나 기본 시나리오를 불러와 주세요.');
    ensureSelectedDisplay(site);
    const counts = countStatuses(site);
    const siteIssueCount = counts.offline + counts.error;
    const tab = ui.tab;

    return `<div class="page">
      <nav class="breadcrumb" aria-label="현재 위치"><a href="#/dashboard">홈</a>${icon('chevron-right')}<span>${escapeHTML(site.name)}</span></nav>
      <header class="page-head">
        <div class="page-head__copy">
          <p class="eyebrow">장소 · ${escapeHTML(site.letter)}센터</p>
          <h1 id="page-title">${escapeHTML(site.name)}</h1>
          <div class="site-head-meta">
            <span class="meta-item">${icon('site', 'icon--sm')}${escapeHTML(site.location)}</span>
            <span class="meta-item">${icon('clock', 'icon--sm')}${escapeHTML(site.hours)}</span>
            <span class="meta-item">${icon('monitor', 'icon--sm')}${site.displays.length}대 중 ${counts.online}대 정상${siteIssueCount ? `, ${siteIssueCount}대 확인 필요` : ''}${counts.pending ? `, ${counts.pending}대 등록 대기` : ''}</span>
            ${site.playlistIds.length ? `<span class="badge badge--online">${icon('send')}게시 중</span>` : `<span class="badge badge--error">${icon('alert')}이미지 없음</span>`}
          </div>
        </div>
        <div class="head-actions">
          <button class="btn btn--secondary" type="button" data-action="go" data-href="#/register" data-site-id="${site.id}">${icon('monitor-add')}화면 등록</button>
          <button class="btn btn--primary" type="button" data-action="go" data-href="#/preview" data-site-id="${site.id}">${icon('eye')}미리보기</button>
        </div>
      </header>
      <div class="tabs" role="tablist" aria-label="장소 상세 보기">
        <button class="tab" type="button" role="tab" id="tab-layout" aria-controls="panel-layout" aria-selected="${tab === 'layout'}" tabindex="${tab === 'layout' ? '0' : '-1'}" data-action="set-tab" data-tab="layout">모니터 배치</button>
        <button class="tab" type="button" role="tab" id="tab-displays" aria-controls="panel-displays" aria-selected="${tab === 'displays'}" tabindex="${tab === 'displays' ? '0' : '-1'}" data-action="set-tab" data-tab="displays">화면 목록 <span class="muted">${site.displays.length}</span></button>
        <button class="tab" type="button" role="tab" id="tab-history" aria-controls="panel-history" aria-selected="${tab === 'history'}" tabindex="${tab === 'history' ? '0' : '-1'}" data-action="set-tab" data-tab="history">게시 이력</button>
      </div>
      ${tab === 'layout' ? renderLayoutTab(site, counts) : tab === 'displays' ? renderDisplaysTab(site) : renderHistoryTab(site)}
    </div>`;
  }

  function renderLayoutTab(site, counts) {
    const selected = displayById(site, ui.selectedDisplayId);
    const history = getLayoutHistory(site.id);
    const warnings = siteWarnings(site);
    const nodes = site.displays.map((display) => renderMonitorNode(display, selected?.id)).join('');
    const toolbar = `<div class="canvas-toolbar">
      <div class="canvas-toolbar__group">
        <span class="canvas-toolbar__label">배치</span>
        <div class="segmented" role="group" aria-label="배치 방식">
          ${Object.entries(LAYOUTS).map(([key, item]) => `<button class="segmented__btn" type="button" data-action="set-layout" data-layout="${key}" aria-pressed="${site.layoutType === key}" title="${key === 'single' && site.displays.length !== 1 ? '화면이 한 대일 때 고를 수 있습니다' : item.desc}" ${key === 'single' && site.displays.length !== 1 ? 'disabled' : ''}>${item.name}</button>`).join('')}
        </div>
      </div>
      <div class="canvas-toolbar__group">
        <button class="btn btn--sm btn--secondary" type="button" data-action="add-display">${icon('plus', 'icon--sm')}화면 추가</button>
        <button class="icon-btn icon-btn--bordered" type="button" data-action="undo-layout" aria-label="배치 실행 취소" title="실행 취소" ${history.past.length ? '' : 'disabled'}>${icon('rewind')}</button>
        <button class="icon-btn icon-btn--bordered" type="button" data-action="redo-layout" aria-label="배치 다시 실행" title="다시 실행" ${history.future.length ? '' : 'disabled'}>${icon('refresh')}</button>
      </div>
    </div>`;
    return `<div id="panel-layout" role="tabpanel" aria-labelledby="tab-layout">
      <div class="editor-grid">
        <section class="card canvas-panel" aria-labelledby="canvas-title">
          <div class="card__head" style="padding-bottom:12px"><div><h2 id="canvas-title">모니터 배치</h2><p class="small muted">${site.displays.length}대 · ${LAYOUTS[site.layoutType]?.name || '직접 배치'} · 화면을 끌어 옮기고 오른쪽 아래 손잡이로 크기를 바꾸세요.</p></div>${counts.offline || counts.error ? statusBadge(counts.error ? 'error' : 'offline') : statusBadge('online', '')}</div>
          ${toolbar}
          <div class="canvas-stage">
            <div class="layout-canvas" id="layout-canvas" aria-label="모니터 배치판. 화면을 선택한 뒤 방향키로 옮기고, Alt와 방향키로 크기를 바꿀 수 있습니다.">
              ${nodes || `<div class="canvas-empty">${icon('monitor')}<strong>아직 연결된 화면이 없습니다.</strong><span class="small">화면 등록에서 새 화면을 찾거나 추가해 주세요.</span><button class="btn btn--sm btn--secondary" type="button" data-action="go" data-href="#/register" data-site-id="${site.id}">화면 등록으로 이동</button></div>`}
            </div>
          </div>
          <div class="canvas-hint">${icon('keyboard', 'icon--sm')}<span>마우스로 끌어서 이동하고 오른쪽 아래 모서리로 크기를 바꿉니다. 키보드는 <kbd>방향키</kbd> 이동, <kbd>Alt</kbd>+<kbd>방향키</kbd> 크기 조절입니다. 화면 밖으로 나가거나 겹치면 아래에 경고가 표시됩니다.</span></div>
          <div class="warning-list" aria-label="배치 경고">
            ${warnings.length ? warnings.map((warning) => warningRow(warning, false)).join('') : `<div class="warning-row warning-row--info">${icon('check-circle')}<div><strong>배치에서 발견된 문제가 없습니다.</strong><br>화면이 겹치지 않고 배치판 안에 있습니다.</div></div>`}
          </div>
        </section>
        ${renderInspector(site, selected)}
      </div>
    </div>`;
  }

  function renderMonitorNode(display, selectedId) {
    const compact = display.w < 0.19 || display.h < 0.2;
    return `<div class="monitor-node ${compact ? 'is-compact' : ''} ${selectedId === display.id ? 'is-selected' : ''}" style="${layoutRectStyle(display)}" tabindex="0" role="button" data-display-id="${display.id}" aria-pressed="${selectedId === display.id}" aria-label="${escapeAttr(display.name)}, ${display.width} 곱하기 ${display.height}, ${STATUS[display.status].label}. 선택하고 방향키로 이동하거나 Alt 더하기 방향키로 크기를 바꿀 수 있습니다.">
      <div class="node-top"><span class="status-dot status-dot--${display.status}"></span><span class="node-name">${escapeHTML(display.name)}</span></div>
      <div class="node-meta">${display.width}×${display.height}<br><span class="node-orient">${display.orientation === 'portrait' ? '세로' : '가로'} · ${STATUS[display.status].label}</span></div>
      <span class="resize-handle" data-role="resize" aria-hidden="true" title="크기 조절"></span>
    </div>`;
  }

  function renderInspector(site, display) {
    if (!display) {
      return `<aside class="card inspector" aria-label="선택한 화면 설정"><div class="inspector-empty">${icon('monitor')}<p>배치판에서 화면을 선택하면<br>이름, 해상도, 방향을 바꿀 수 있습니다.</p></div></aside>`;
    }
    return `<aside class="card inspector" aria-label="선택한 화면 설정">
      <div class="inspector__head"><h2>선택한 화면</h2><p>${STATUS[display.status].label} · ${display.capabilities?.length || 0}개 기능</p></div>
      <div class="inspector__body">
        <div class="field"><label class="field__label" for="display-name">화면 이름</label><input class="input" id="display-name" data-field="display-name" data-display-id="${display.id}" value="${escapeAttr(display.name)}" maxlength="24"></div>
        <div class="field"><label class="field__label" for="display-resolution">해상도</label><select class="select" id="display-resolution" data-field="display-resolution" data-display-id="${display.id}">${['1920×1080', '1080×1920', '2560×1440', '3840×2160', '1280×720'].map((value) => `<option value="${value}" ${value === `${display.width}×${display.height}` ? 'selected' : ''}>${value.replace('×', ' × ')}</option>`).join('')}</select></div>
        <div class="field"><label class="field__label" for="display-orientation">방향</label><select class="select" id="display-orientation" data-field="display-orientation" data-display-id="${display.id}"><option value="landscape" ${display.orientation === 'landscape' ? 'selected' : ''}>가로 방향</option><option value="portrait" ${display.orientation === 'portrait' ? 'selected' : ''}>세로 방향</option></select></div>
        <div class="field"><label class="field__label" for="display-fit">이미지 맞춤</label><select class="select" id="display-fit" data-field="display-fit" data-display-id="${display.id}"><option value="contain" ${display.fit === 'contain' ? 'selected' : ''}>맞추기 · 잘리지 않음</option><option value="cover" ${display.fit === 'cover' ? 'selected' : ''}>채우기 · 가장자리가 잘릴 수 있음</option><option value="stretch" ${display.fit === 'stretch' ? 'selected' : ''}>늘이기 · 비율이 바뀔 수 있음</option></select></div>
        <div><div class="coord-grid"><div class="coord">가로 위치<strong>${Math.round(display.x * 100)}%</strong></div><div class="coord">세로 위치<strong>${Math.round(display.y * 100)}%</strong></div><div class="coord">너비<strong>${Math.round(display.w * 100)}%</strong></div><div class="coord">높이<strong>${Math.round(display.h * 100)}%</strong></div></div></div>
        <div class="divider" style="margin:2px 0"></div>
        <div class="inspector-actions"><button class="btn btn--sm btn--secondary" type="button" data-action="test-image" data-display-id="${display.id}">${icon('send', 'icon--sm')}테스트 이미지</button><button class="btn btn--sm btn--danger-quiet" type="button" data-action="remove-display" data-display-id="${display.id}">${icon('trash', 'icon--sm')}연결 해제</button></div>
        <p class="tiny muted" style="margin:0">기능: ${(display.capabilities || []).join(' · ')}</p>
      </div>
    </aside>`;
  }

  function renderDisplaysTab(site) {
    const resolved = resolveSiteAt(site, 0);
    return `<div id="panel-displays" role="tabpanel" aria-labelledby="tab-displays">
      <section class="card">
        <div class="card__head"><div><h2>연결된 화면</h2><p class="small muted">상태와 현재 이미지를 확인하세요. 이름과 위치는 배치에서 바꿀 수 있습니다.</p></div><button class="btn btn--sm btn--secondary" type="button" data-action="add-display">${icon('plus', 'icon--sm')}화면 추가</button></div>
        ${site.displays.length ? `<div class="table-wrap"><table class="data-table status-table"><caption class="sr-only">장소에 연결된 화면 목록</caption><thead><tr><th scope="col">화면</th><th scope="col">상태</th><th scope="col">해상도·방향</th><th scope="col">현재 이미지</th><th scope="col">마지막 연결</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead><tbody>
          ${site.displays.map((display, index) => {
            const entry = resolved.perDisplay[index]?.entry?.asset;
            const current = display.status === 'error' && fallbackAsset(site) ? fallbackAsset(site) : entry;
            const isFallback = Boolean(display.status === 'error' && fallbackAsset(site));
            return `<tr><td data-label="화면"><div class="cell-title">${escapeHTML(display.name)}</div><div class="cell-sub">${escapeHTML(display.ip || '주소 없음')}</div></td><td data-label="상태">${statusBadge(display.status)}</td><td data-label="해상도·방향">${display.width}×${display.height}<div class="cell-sub">${orientationLabel(display)} 방향</div></td><td data-label="현재 이미지">${current ? escapeHTML(current.title) : '<span class="muted">표시할 이미지 없음</span>'}${isFallback ? ' <span class="chip">비상</span>' : ''}</td><td data-label="마지막 연결">${display.lastSeen ? relativeTime(display.lastSeen) : '연결 전'}</td><td data-label="동작"><div class="table-actions"><button class="btn btn--xs btn--secondary" type="button" data-action="open-status" data-display-id="${display.id}">상세</button><button class="btn btn--xs btn--danger-quiet" type="button" data-action="remove-display" data-display-id="${display.id}">해제</button></div></td></tr>`;
          }).join('')}
        </tbody></table></div>` : `<div class="empty-inline" style="margin:0 18px 18px">연결된 화면이 없습니다. 화면 등록에서 새 화면을 찾아 주세요.</div>`}
      </section>
    </div>`;
  }

  function renderHistoryTab(site) {
    return `<div id="panel-history" role="tabpanel" aria-labelledby="tab-history">
      <section class="card">
        <div class="card__head"><div><h2>게시 이력</h2><p class="small muted">최근에 만든 게시 버전을 확인합니다. 실제 버전 관리는 서버 연결 뒤 동작합니다.</p></div><span class="chip">현재 버전 ${site.publishedVersion}</span></div>
        <div class="timeline">
          ${site.publications?.length ? site.publications.map((publication) => `<div class="timeline__row"><span class="timeline__dot">${icon(publication.version === site.publishedVersion ? 'send' : 'check', 'icon--sm')}</span><div><div class="timeline__title">버전 ${publication.version} · ${moLabel(publication.mode)} · 이미지 ${publication.imageCount}장</div><div class="timeline__sub">${escapeHTML(publication.actor)} · 화면 ${publication.displayCount}대 · ${escapeHTML(publication.note || '')}</div></div><time class="timeline__time" datetime="${publication.at}">${formatDateTime(publication.at)}</time></div>`).join('') : '<div class="empty-inline">아직 게시 이력이 없습니다.</div>'}
        </div>
        <div class="card__footer"><span class="tiny muted">감사 로그 · 게시자 이름과 작업 내용만 남기고, 개인 연락처는 저장하지 않습니다.</span></div>
      </section>
    </div>`;
  }

  function moLabel(mode) {
    return modeLabel(mode);
  }

  function initLayoutCanvas() {
    const canvas = document.getElementById('layout-canvas');
    const site = activeSite();
    if (!canvas || !site) return;
    const nodes = $$('.monitor-node', canvas);

    nodes.forEach((node) => {
      const displayId = node.dataset.displayId;
      const display = displayById(site, displayId);
      if (!display) return;

      node.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const isResize = Boolean(event.target.closest('[data-role="resize"]'));
        const bounds = canvas.getBoundingClientRect();
        const start = { x: display.x, y: display.y, w: display.w, h: display.h };
        let moved = false;
        let historyPushed = false;
        let cancelled = false;
        const startX = event.clientX;
        const startY = event.clientY;
        event.preventDefault();
        node.classList.add('is-selected');

        const move = (moveEvent) => {
          const dx = (moveEvent.clientX - startX) / bounds.width;
          const dy = (moveEvent.clientY - startY) / bounds.height;
          if (!moved && (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004)) {
            moved = true;
            if (!historyPushed) {
              pushLayoutHistory(site);
              historyPushed = true;
            }
          }
          if (!moved) return;
          if (isResize) {
            display.w = clamp(Math.round((start.w + dx) * 200) / 200, 0.08, 1 - display.x);
            display.h = clamp(Math.round((start.h + dy) * 200) / 200, 0.06, 1 - display.y);
          } else {
            display.x = clamp(Math.round((start.x + dx) * 200) / 200, 0, 1 - display.w);
            display.y = clamp(Math.round((start.y + dy) * 200) / 200, 0, 1 - display.h);
          }
          node.setAttribute('style', layoutRectStyle(display));
        };

        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('keydown', cancel);
          if (cancelled) return;
          ui.selectedDisplayId = displayId;
          if (moved) saveState();
          render();
          if (moved) announce(isResize ? '화면 크기를 바꿨습니다.' : '화면 위치를 바꿨습니다.');
        };

        const cancel = (keyEvent) => {
          if (keyEvent.key !== 'Escape') return;
          keyEvent.preventDefault();
          cancelled = true;
          display.x = start.x;
          display.y = start.y;
          display.w = start.w;
          display.h = start.h;
          if (historyPushed) {
            const history = getLayoutHistory(site.id);
            history.past.pop();
          }
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('keydown', cancel);
          render();
          announce('배치 변경을 취소했습니다.', 'info');
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
        window.addEventListener('keydown', cancel);
      });

      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          ui.selectedDisplayId = displayId;
          ui.focusAfterRender = `.monitor-node[data-display-id="${displayId}"]`;
          render();
          return;
        }
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const amount = event.shiftKey ? 0.05 : 0.01;
        const resizing = event.altKey;
        pushLayoutHistory(site);
        if (resizing) {
          if (event.key === 'ArrowRight') display.w = clamp(display.w + amount, 0.08, 1 - display.x);
          if (event.key === 'ArrowLeft') display.w = clamp(display.w - amount, 0.08, 1 - display.x);
          if (event.key === 'ArrowDown') display.h = clamp(display.h + amount, 0.06, 1 - display.y);
          if (event.key === 'ArrowUp') display.h = clamp(display.h - amount, 0.06, 1 - display.y);
        } else {
          if (event.key === 'ArrowLeft') display.x = clamp(display.x - amount, 0, 1 - display.w);
          if (event.key === 'ArrowRight') display.x = clamp(display.x + amount, 0, 1 - display.w);
          if (event.key === 'ArrowUp') display.y = clamp(display.y - amount, 0, 1 - display.h);
          if (event.key === 'ArrowDown') display.y = clamp(display.y + amount, 0, 1 - display.h);
        }
        ui.selectedDisplayId = displayId;
        ui.focusAfterRender = `.monitor-node[data-display-id="${displayId}"]`;
        saveState();
        render();
      });
    });
  }

  function noSiteView(title, body) {
    return `<div class="page"><header class="page-head"><div class="page-head__copy"><p class="eyebrow">장소</p><h1 id="page-title">${escapeHTML(title)}</h1><p class="page-subtitle">${escapeHTML(body)}</p></div></header><section class="empty-state"><div class="empty-state__mark">${icon('site')}</div><h2>장소를 먼저 만들어 주세요.</h2><p>장소를 만들면 화면 배치, 이미지, 재생 설정과 미리보기를 이어서 사용할 수 있습니다.</p><div class="empty-state__actions"><button class="btn btn--primary" type="button" data-action="start-wizard">첫 장소 만들기</button><button class="btn btn--secondary" type="button" data-action="scenario-reset">기본 시나리오 불러오기</button></div></section></div>`;
  }

  /* ---------- display registration ---------- */

  function registrationLink(site) {
    const code = site?.id === 'site-b' ? 'GUK-B2K7' : 'GUK-A9F4';
    return `http://192.168.0.12:8080/player?site=${code}`;
  }

  function uniqueDisplayName(site, base, exceptId = null) {
    const names = new Set(site.displays.filter((display) => display.id !== exceptId).map((display) => display.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  function renderRegistrationPage() {
    const site = activeSite();
    if (!site) return noSiteView('등록할 장소가 없습니다.', '먼저 장소를 만든 뒤 화면을 연결해 주세요.');
    const pending = site.pending || [];
    return `<div class="page">
      <header class="page-head">
        <div class="page-head__copy">
          <p class="eyebrow">${escapeHTML(site.name)} · 화면 등록</p>
          <h1 id="page-title">화면을 연결하세요</h1>
          <p class="page-subtitle">같은 네트워크에서 찾은 화면을 승인하거나, 화면에 표시된 숫자를 입력해 연결할 수 있습니다.</p>
        </div>
        <div class="head-actions"><button class="btn btn--secondary" type="button" data-action="scan-displays">${icon('scan')}다시 찾기</button><a class="btn btn--primary" href="#/site/${site.id}">배치로 돌아가기</a></div>
      </header>
      <section class="browser-test" aria-labelledby="browser-test-title">
        <span class="browser-test__icon">${icon('monitor-check')}</span>
        <div>
          <h2 id="browser-test-title">이 브라우저로 먼저 테스트해 보세요</h2>
          <p>화면이 될 브라우저에서 크기와 표시를 확인하고 6자리 확인 코드를 받습니다. 코드를 보낸 화면은 등록 대기 목록에서 관리자가 따로 승인합니다.</p>
          <div class="browser-test__steps"><span>1 화면에서 코드 확인</span><span>2 등록 대기</span><span>3 관리자 승인</span></div>
        </div>
        <button class="btn btn--primary" type="button" data-action="open-browser-test">${icon('monitor-check')}이 브라우저로 테스트</button>
      </section>
      <div class="split-grid">
        <section class="card" aria-labelledby="pending-title">
          <div class="card__head"><div><h2 id="pending-title">자동으로 찾은 화면</h2><p class="small muted">네트워크에서 연결을 기다리는 화면입니다. 이름과 방향을 확인한 뒤 승인하세요.</p></div><span class="badge ${pending.length ? 'badge--pending' : 'badge--offline'}">${pending.length ? `대기 ${pending.length}대` : '찾은 화면 없음'}</span></div>
          ${pending.length ? `<div class="pending-list">${pending.map((device) => pendingCard(device)).join('')}</div>` : `<div class="empty-inline" style="margin:0 18px 18px"><span class="badge badge--online">${icon('check-circle')}모두 등록됨</span><p style="margin-top:8px">지금 등록을 기다리는 화면이 없습니다. 새 화면의 전원과 연결을 확인한 뒤 다시 찾아 주세요.</p><button class="btn btn--sm btn--secondary" type="button" data-action="scan-displays" style="margin-top:11px">${icon('refresh', 'icon--sm')}다시 찾기</button></div>`}
        </section>
        <div class="stack register-side">
          <section class="card" aria-labelledby="code-title">
            <div class="card__head" style="padding-bottom:8px"><div><h2 id="code-title">코드로 등록</h2><p class="small muted">화면에 크게 표시된 6자리 숫자를 입력하세요.</p></div></div>
            <div class="card__body">
              <form id="manual-code-form" novalidate>
                ${ui.registrationError ? `<div class="error-summary" role="alert" tabindex="-1" id="registration-error"><div class="error-summary__title">${icon('alert')}코드를 확인해 주세요.</div><ul><li><button class="text-link" type="button" data-action="focus-field" data-target="#manual-code">${escapeHTML(ui.registrationError)}</button></li></ul></div>` : ''}
                <div class="field"><label class="field__label" for="manual-code">6자리 확인 코드</label><input class="input input--code" id="manual-code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" value="${escapeAttr(ui.manualCode || '')}" aria-describedby="manual-code-help${ui.registrationError ? ' registration-error' : ''}" ${ui.registrationError ? 'aria-invalid="true"' : ''} placeholder="000000"><span class="field__help" id="manual-code-help">화면에 표시된 6자리 확인 코드를 입력하세요. 연습용 코드는 482913과 135790입니다.</span></div>
                <button class="btn btn--primary btn--block" type="submit" style="margin-top:12px">${icon('link')}이 코드로 등록 대기 보내기</button>
              </form>
              <div class="code-help" style="margin-top:13px">${icon('info', 'icon--sm')}<span>코드가 맞지 않으면 화면을 다시 확인해 주세요. 이미 연결된 화면은 다시 등록하지 않아도 됩니다.</span></div>
            </div>
          </section>
          <section class="card" aria-labelledby="link-title">
            <div class="card__head" style="padding-bottom:8px"><div><h2 id="link-title">링크로 등록</h2><p class="small muted">브라우저 저장 정보가 지워지는 환경에 알맞습니다.</p></div></div>
            <div class="card__body">
              <div class="field"><label class="field__label" for="registration-link">화면에서 열 주소</label><div class="link-box"><input class="input" id="registration-link" readonly value="${escapeAttr(registrationLink(site))}"><button class="btn btn--secondary" type="button" data-action="copy-registration-link">${icon('copy')}<span class="sr-only">등록 링크 </span>복사</button></div></div>
              <p class="field__help">모니터를 켠 브라우저에서 이 주소를 열면 화면이 연결을 기다립니다. 외부 인터넷이 아닌 원내 네트워크 주소입니다.</p>
            </div>
          </section>
          <section class="card"><div class="card__body"><div class="wizard-note" style="margin:0">${icon('help', 'icon--sm')}<span>등록한 화면은 배치에 추가됩니다. 승인 전에는 ‘대기’ 상태로 표시되고, 테스트 이미지를 보낸 뒤 실제 게시를 시작할 수 있습니다.</span></div></div></section>
        </div>
      </div>
    </div>`;
  }

  function pendingCard(device) {
    return `<article class="pending-card" data-pending-id="${device.id}">
      <span class="pending-card__icon">${icon('monitor')}</span>
      <div>
        <div class="pending-card__title">${escapeHTML(device.name)}${statusBadge('pending')}</div>
        <div class="pending-card__meta">${escapeHTML(device.ip)} · ${escapeHTML(device.resolution)} · ${device.orientation === 'portrait' ? '세로' : '가로'} · ${escapeHTML(device.browser)}</div>
        <div class="pending-card__code" aria-label="확인 코드 ${device.code}">${icon('keyboard', 'icon--sm')}<span>${device.code}</span></div>
        <div class="capabilities" aria-label="화면 기능">${(device.capabilities || []).map((capability) => `<span class="chip">${escapeHTML(capability)}</span>`).join('')}${device.browserTest ? '<span class="chip chip--celadon">브라우저 테스트</span>' : ''}</div>
      </div>
      <button class="btn btn--sm btn--primary" type="button" data-action="approve-pending" data-pending-id="${device.id}">${icon('check', 'icon--sm')}승인</button>
    </article>`;
  }

  function browserTestCode() {
    return String(100000 + Math.floor(Math.random() * 900000));
  }

  function openBrowserTestModal() {
    const site = activeSite();
    if (!site) return;
    const code = browserTestCode();
    ui.browserTestCode = code;
    const width = window.screen?.width || 1920;
    const height = window.screen?.height || 1080;
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">이 브라우저로 테스트</h2><p class="modal__sub">화면이 될 브라우저에서 코드와 표시 상태를 확인합니다.</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body">
        <div class="browser-test__screen"><img src="${escapeAttr(testPatternDataUrl())}" alt="테스트 화면과 6자리 확인 코드"><div class="browser-test__code"><span>화면에 표시되는 6자리 확인 코드</span><strong>${code}</strong><span>${width} × ${height} · ${width >= height ? '가로' : '세로'} 화면</span></div></div>
        <div class="browser-test__steps" style="margin-top:12px"><span>1 코드 확인</span><span>2 등록 대기</span><span>3 관리자 승인</span></div>
        <div class="wizard-note">${icon('info', 'icon--sm')}<span>이 브라우저를 “등록 대기”로 보내면 오른쪽 목록에 새 화면이 나타납니다. 실제 관리자는 그 화면의 코드를 보고 마지막 단계에서 승인합니다.</span></div>
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="copy-browser-code">${icon('copy')}확인 코드 복사</button><button class="btn btn--primary" type="button" data-action="add-browser-pending">${icon('monitor-check')}등록 대기로 보내기</button></div>`;
    openModal(dialog, { label: '이 브라우저로 화면 테스트' });
  }

  function addBrowserPending() {
    const site = activeSite();
    if (!site) return;
    const code = ui.browserTestCode || browserTestCode();
    const pendingNames = new Set(site.pending.map((item) => item.name));
    let name = '이 브라우저 화면';
    let suffix = 2;
    while (pendingNames.has(name)) name = `이 브라우저 화면 ${suffix++}`;
    const width = window.screen?.width || 1920;
    const height = window.screen?.height || 1080;
    const orientation = width >= height ? 'landscape' : 'portrait';
    site.pending.unshift({
      id: uid(`${site.id}-pending`), name, code, ip: '127.0.0.1', resolution: `${width}×${height}`,
      orientation, browser: '이 브라우저 · Chrome', capabilities: ['브라우저', '단일 창', '오프라인 저장'],
      foundAt: nowISO(), browserTest: true
    });
    ui.browserTestCode = '';
    saveState();
    closeModal();
    render();
    ui.focusAfterRender = `.pending-card[data-pending-id="${site.pending[0].id}"] .btn`;
    announce(`${name}을 등록 대기 목록에 보냈습니다. 코드를 확인한 뒤 승인해 주세요.`, 'success');
  }

  function openApprovalModal(pendingId) {
    const site = activeSite();
    const device = site?.pending?.find((item) => item.id === pendingId);
    if (!site || !device) return;
    const dialog = `<form id="approve-display-form" data-site-id="${site.id}" data-pending-id="${device.id}" novalidate>
      <div class="modal__head">
        <div><h2 class="modal__title" id="modal-title">${escapeHTML(device.name)}을 연결할까요?</h2><p class="modal__sub">승인하면 ${escapeHTML(site.name)} 배치에서 바로 게시할 수 있습니다.</p></div>
        <button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button>
      </div>
      <div class="modal__body">
        <div id="approve-error-slot"></div>
        <div class="field"><label class="field__label" for="approve-name">화면 이름</label><input class="input" id="approve-name" name="name" value="${escapeAttr(uniqueDisplayName(site, device.name, device.displayId || null))}" maxlength="24" required aria-describedby="approve-name-help" data-autofocus><span class="field__help" id="approve-name-help">직원이 알아보기 쉬운 이름으로 적어 주세요.</span></div>
        <div class="field" style="margin-top:13px"><label class="field__label" for="approve-orientation">화면 방향</label><select class="select" id="approve-orientation" name="orientation"><option value="landscape" ${device.orientation === 'landscape' ? 'selected' : ''}>가로 방향</option><option value="portrait" ${device.orientation === 'portrait' ? 'selected' : ''}>세로 방향</option></select><span class="field__help">화면이 인식한 방향입니다. 실제 설치 방향과 같은지 확인하세요.</span></div>
        <div class="confirm-meta"><div><span>주소</span><strong>${escapeHTML(device.ip)}</strong></div><div><span>해상도</span><strong>${escapeHTML(device.resolution)}</strong></div><div><span>브라우저</span><strong>${escapeHTML(device.browser)}</strong></div><div><span>기능</span><strong>${escapeHTML((device.capabilities || []).join(' · '))}</strong></div></div>
        <p class="field__help" style="margin-top:11px">승인한 사람과 시각은 활동 기록에 남습니다.</p>
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">취소</button><button class="btn btn--primary" type="submit">${icon('check')}승인하고 연결하기</button></div>
    </form>`;
    openModal(dialog, { label: '화면 등록 승인' });
  }

  function approvePending(site, pendingId, name, orientation) {
    const device = site.pending.find((item) => item.id === pendingId);
    if (!device) return;
    site.pending = site.pending.filter((item) => item.id !== pendingId);
    closeModal();
    const existing = device.displayId ? displayById(site, device.displayId) : null;
    if (existing) {
      existing.name = uniqueDisplayName(site, name || device.name, existing.id);
      existing.orientation = orientation;
      existing.width = orientation === 'portrait' ? 1080 : 1920;
      existing.height = orientation === 'portrait' ? 1920 : 1080;
      existing.rotation = orientation === 'portrait' ? 90 : 0;
      existing.status = 'online';
      existing.lastSeen = nowISO();
      existing.errorCode = '';
      addActivity(`${existing.name} 화면의 등록을 승인했습니다.`, 'check', site.id);
      saveState();
      render();
      announce(`${existing.name} 화면의 등록을 마쳤습니다. 이제 온라인 상태로 게시할 수 있습니다.`);
      return;
    }
    addDisplayToSite(site, {
      name: uniqueDisplayName(site, name || device.name),
      status: 'online',
      orientation,
      browser: device.browser,
      ip: device.ip,
      capabilities: device.capabilities
    });
    addActivity(`${device.name} 화면을 ${site.name}에 등록했습니다.`, 'check', site.id);
    saveState();
    announce(`${device.name} 화면을 등록했습니다. 대기 상태에서 온라인으로 바뀌었습니다.`);
  }

  function submitManualCode(event) {
    event.preventDefault();
    const site = activeSite();
    if (!site) return;
    const input = document.getElementById('manual-code');
    const raw = String(input?.value || '').replace(/\D/g, '');
    ui.manualCode = raw;
    if (!/^\d{6}$/.test(raw)) {
      ui.registrationError = '6자리 숫자를 모두 입력해 주세요.';
      render();
      ui.focusAfterRender = '#manual-code';
      announce('코드를 확인해 주세요. 6자리 숫자를 모두 입력해야 합니다.', 'error');
      return;
    }
    if (!['482913', '135790'].includes(raw)) {
      ui.registrationError = '입력한 코드와 연결된 화면을 찾지 못했습니다. 화면에 표시된 숫자를 다시 확인해 주세요.';
      render();
      ui.focusAfterRender = '#manual-code';
      announce('입력한 코드와 연결된 화면을 찾지 못했습니다.', 'error');
      return;
    }
    ui.registrationError = '';
    const pending = site.pending.find((item) => item.code === raw);
    if (pending) {
      ui.manualCode = '';
      render();
      ui.focusAfterRender = `.pending-card[data-pending-id="${pending.id}"] .btn`;
      announce(`${pending.name}은 이미 등록 대기 목록에 있습니다. 승인만 남았습니다.`, 'info');
      return;
    }
    const name = uniqueDisplayName(site, '코드로 연결한 화면');
    const device = {
      id: uid(`${site.id}-pending`), name, code: raw, ip: '192.168.0.110', resolution: '1920×1080',
      orientation: 'landscape', browser: 'Chrome 141', capabilities: ['브라우저', '오프라인 저장'], foundAt: nowISO()
    };
    site.pending.unshift(device);
    addActivity(`확인 코드 ${raw}로 ${name}을 등록 대기에 보냈습니다.`, 'check', site.id);
    ui.manualCode = '';
    saveState();
    render();
    ui.focusAfterRender = `.pending-card[data-pending-id="${device.id}"] .btn`;
    announce(`${name}을 등록 대기 목록에 보냈습니다. 내용을 확인한 뒤 승인해 주세요.`);
  }

  function scanForDisplays() {
    const site = activeSite();
    if (!site) return;
    site.pending = site.pending || [];
    if (site.pending.length >= 3) {
      announce('이미 연결을 기다리는 화면을 모두 확인했습니다. 화면 전원을 다시 확인한 뒤 시도해 주세요.', 'info');
      return;
    }
    const names = ['중앙 안내 화면', '매표소 옆 화면', '공연장 입구 화면'];
    const existing = new Set(site.pending.map((item) => item.name));
    const name = names.find((candidate) => !existing.has(candidate)) || `새 화면 ${site.pending.length + 1}`;
    const device = {
      id: uid(`${site.id}-pending`), name, code: String(640000 + Math.floor(Math.random() * 90000)), ip: `192.168.0.${120 + site.pending.length}`,
      resolution: '1920×1080', orientation: 'landscape', browser: 'Chrome 141',
      capabilities: ['브라우저', '다중 창'], foundAt: nowISO()
    };
    site.pending.push(device);
    saveState();
    render();
    announce(`${name} 화면을 찾았습니다. 내용을 확인한 뒤 승인해 주세요.`, 'info');
  }

  async function copyText(text, successMessage) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { copied = document.execCommand('copy'); } catch (copyError) { copied = false; }
      area.remove();
    }
    announce(copied ? successMessage : '복사하지 못했습니다. 주소를 직접 선택해 주세요.', copied ? 'success' : 'error');
  }

  /* ---------- content library ---------- */

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function assetUsage(assetId) {
    return state.sites.filter((site) => site.playlistIds.includes(assetId) || site.fallbackAssetId === assetId);
  }

  function fallbackUsage(assetId) {
    return state.sites.filter((site) => site.fallbackAssetId === assetId);
  }

  function renderLibraryPage() {
    const site = activeSite();
    const target = siteTargetDisplay(site);
    const targetAspect = target ? displayAspect(target) : 16 / 9;
    const warningCount = state.assets.filter((asset) => aspectMismatch(asset, targetAspect)).length;
    const query = ui.libraryQuery.trim().toLowerCase();
    const visibleAssets = state.assets.filter((asset) => !query || `${asset.title} ${asset.filename}`.toLowerCase().includes(query));
    return `<div class="page">
      <header class="page-head">
        <div class="page-head__copy">
          <p class="eyebrow">이미지 · 보관함</p>
          <h1 id="page-title">이미지 보관함</h1>
          <p class="page-subtitle">게시에 쓸 이미지를 올리고, 화면 비율과 사용 중인 장소를 확인하세요.</p>
        </div>
        <div class="head-actions"><button class="btn btn--secondary" type="button" data-action="restore-samples">${icon('palette')}샘플 이미지 복원</button><button class="btn btn--primary" type="button" data-action="go" data-href="#/playback">${icon('play')}재생 순서 짜기</button></div>
      </header>

      <section aria-labelledby="upload-title">
        <label class="upload-zone" id="upload-zone" for="asset-upload">
          <input type="file" id="asset-upload" accept="image/jpeg,image/png,image/webp" multiple aria-label="이미지 파일 선택" aria-describedby="upload-help">
          <span class="upload-zone__icon">${icon('upload', 'icon--lg')}</span>
          <span><span class="h1" id="upload-title" style="font-size:1.08rem;display:block">이미지를 끌어다 놓거나 파일을 선택하세요</span><span class="small muted" id="upload-help">JPEG · PNG · WebP · 파일당 8MB까지 · 올리면 바로 미리 볼 수 있습니다</span></span>
          <span class="btn btn--secondary btn--sm" aria-hidden="true">파일 선택</span>
        </label>
        ${ui.uploadMessage ? `<div class="upload-result ${ui.uploadTone === 'error' ? 'upload-result--error' : ''}" role="status" style="margin-top:10px">${icon(ui.uploadTone === 'error' ? 'alert' : 'check-circle', 'icon--sm')}<span>${escapeHTML(ui.uploadMessage)}</span></div>` : ''}
      </section>

      <div class="library-toolbar">
        <div class="library-toolbar__meta"><strong class="strong" id="library-count">${visibleAssets.length}</strong>장의 이미지${warningCount ? ` · <span class="badge badge--pending" style="min-height:22px;padding:1px 7px">${icon('alert')}비율 확인 ${warningCount}</span>` : ''}${site ? ` · ${escapeHTML(site.name)} 기준` : ''}</div>
        <div class="library-toolbar__actions">
          <div class="search-field">${icon('search')}<label class="sr-only" for="library-search">이미지 이름으로 찾기</label><input class="input" id="library-search" type="search" placeholder="이미지 이름으로 찾기" value="${escapeAttr(ui.libraryQuery)}"></div>
        </div>
      </div>

      ${state.assets.length ? `<div class="asset-grid" id="asset-grid">${visibleAssets.map((asset) => assetCard(asset, targetAspect)).join('')}</div>
        <div class="empty-inline" id="search-empty" ${visibleAssets.length ? 'hidden' : ''} style="margin-top:12px">검색어와 맞는 이미지가 없습니다.</div>` : `<section class="card library-empty"><div class="empty-state" style="border:0;background:transparent;padding:16px"><div class="empty-state__mark">${icon('image')}</div><h2>보관함이 비어 있습니다.</h2><p>이미지를 올리면 화면 비율과 크기를 확인한 뒤 재생 순서에 넣을 수 있습니다.</p><div class="empty-state__actions"><button class="btn btn--primary" type="button" data-action="restore-samples">샘플 이미지 불러오기</button></div></div></section>`}

      <div class="section-head"><div><h2>어떻게 보이나요?</h2><p>‘맞추기’는 이미지 전체를 보여 주고, ‘채우기’는 화면을 가득 채우며 가장자리가 잘릴 수 있습니다.</p></div></div>
      <section class="card" style="padding:16px 18px"><div class="wizard-note" style="margin:0">${icon('info', 'icon--sm')}<span>세로 이미지를 가로 화면에 넣으면 양옆에 여백이 생깁니다. 화면을 세로로 세웠다면 해당 모니터의 방향을 ‘세로’로 바꾸는 편이 좋습니다.</span></div></section>
    </div>`;
  }

  function assetCard(asset, targetAspect) {
    const usage = assetUsage(asset.id);
    const fallbackSites = fallbackUsage(asset.id);
    const mismatch = aspectMismatch(asset, targetAspect);
    return `<article class="asset-card" data-asset-card data-search="${escapeAttr(`${asset.title} ${asset.filename}`.toLowerCase())}">
      <div class="asset-card__thumb"><img src="${escapeAttr(asset.dataUrl)}" alt="${escapeAttr(asset.alt || asset.title)}" loading="lazy"><div class="asset-card__badges">${asset.kind === 'portrait' ? '<span class="badge">세로</span>' : '<span class="badge">가로</span>'}${mismatch ? `<span class="badge badge--error">${icon('alert')}비율 확인</span>` : ''}</div></div>
      <div class="asset-card__body">
        <h3 class="asset-card__name">${escapeHTML(asset.title)}</h3>
        <p class="asset-card__meta">${asset.width}×${asset.height} · ${formatBytes(asset.size)}</p>
        <div class="asset-card__usage">${usage.length ? usage.map((site) => `<span class="chip">${escapeHTML(site.letter)}센터 ${fallbackSites.includes(site) ? '비상 이미지' : '사용 중'}</span>`).join('') : '<span class="chip">사용 안 함</span>'}</div>
      </div>
      <div class="asset-card__actions"><button class="btn btn--xs btn--ghost" type="button" data-action="asset-detail" data-asset-id="${asset.id}">자세히${icon('chevron-right', 'icon--sm')}</button><button class="icon-btn" type="button" data-action="delete-asset" data-asset-id="${asset.id}" aria-label="${escapeAttr(asset.title)} 삭제">${icon('trash', 'icon--sm')}</button></div>
    </article>`;
  }

  function targetChecks(asset, site) {
    if (!site || !site.displays.length) {
      return '<div class="empty-inline">화면을 등록하면 화면별로 비율과 잘림을 확인할 수 있습니다.</div>';
    }
    return `<div class="target-checks">${site.displays.map((display) => {
      const targetAspect = displayAspect(display);
      const mismatch = aspectMismatch(asset, targetAspect);
      const fit = display.fit || 'contain';
      const fitCss = fit === 'cover' ? 'cover' : fit === 'stretch' ? 'fill' : 'contain';
      const issue = !mismatch
        ? { label: '잘 맞음', className: 'badge--online' }
        : fit === 'cover'
          ? { label: '잘림 가능', className: 'badge--error' }
          : fit === 'stretch'
            ? { label: '비율 왜곡', className: 'badge--error' }
            : { label: '여백 생김', className: 'badge--pending' };
      return `<div class="target-check"><div class="target-check__preview" style="aspect-ratio:${display.width}/${display.height}"><img src="${escapeAttr(asset.dataUrl)}" alt="" style="object-fit:${fitCss}"><span class="safe-area" aria-hidden="true"></span></div><div class="target-check__name"><span>${escapeHTML(display.name)}</span><span class="badge ${issue.className}">${escapeHTML(issue.label)}</span></div><div class="target-check__meta">${display.width}×${display.height} · ${orientationLabel(display)} · ${fit === 'cover' ? '채우기' : fit === 'stretch' ? '늘이기' : '맞추기'}</div></div>`;
    }).join('')}</div>`;
  }

  function openAssetDetail(assetId) {
    const asset = assetById(assetId);
    if (!asset) return;
    const site = activeSite();
    const target = siteTargetDisplay(site);
    const targetAspect = target ? displayAspect(target) : 16 / 9;
    const usage = assetUsage(asset.id);
    const fallbackSites = fallbackUsage(asset.id);
    const mismatch = aspectMismatch(asset, targetAspect);
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">${escapeHTML(asset.title)}</h2><p class="modal__sub">${escapeHTML(asset.filename)}</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body">
        <div class="asset-detail">
          <div class="asset-detail__preview"><img src="${escapeAttr(asset.dataUrl)}" alt="${escapeAttr(asset.alt || asset.title)}"></div>
          <div class="asset-detail__info">
            <dl class="meta-list"><div class="meta-list__row"><dt>크기</dt><dd>${asset.width} × ${asset.height} px</dd></div><div class="meta-list__row"><dt>비율</dt><dd>${(asset.width / asset.height).toFixed(2)} : 1 · ${asset.kind === 'portrait' ? '세로 이미지' : '가로 이미지'}</dd></div><div class="meta-list__row"><dt>파일</dt><dd>${formatBytes(asset.size)} · ${escapeHTML(asset.mime)}</dd></div><div class="meta-list__row"><dt>올린 날</dt><dd>${formatDateTime(asset.createdAt)}</dd></div><div class="meta-list__row"><dt>사용 중</dt><dd>${usage.length ? usage.map((item) => `${escapeHTML(item.name)}${fallbackSites.includes(item) ? ' (비상 이미지)' : ''}`).join(', ') : '사용하지 않음'}</dd></div></dl>
            ${mismatch ? `<div class="warning-row warning-row--error">${icon('alert')}<div><strong>현재 화면 비율과 다릅니다.</strong><br>‘맞추기’로 보여 주면 빈 여백이 생길 수 있습니다. 미리보기에서 확인해 주세요.</div></div>` : `<div class="warning-row warning-row--info">${icon('check-circle')}<div><strong>현재 화면 비율과 잘 맞습니다.</strong><br>${site ? `${escapeHTML(site.name)}의 가로 화면 기준입니다.` : '장소를 선택하면 화면 기준으로 확인합니다.'}</div></div>`}
            <div class="inspector-actions"><button class="btn btn--sm btn--secondary" type="button" data-action="go" data-href="#/playback" data-site-id="${site?.id || ''}">${icon('play', 'icon--sm')}재생 순서 편집</button><button class="btn btn--sm btn--danger-quiet" type="button" data-action="delete-asset" data-asset-id="${asset.id}">${icon('trash', 'icon--sm')}삭제</button></div>
          </div>
        </div>
        <div style="margin-top:20px"><div class="section-head" style="margin:0 0 4px"><div><h3 style="font-size:.9rem">화면별 확인</h3><p class="small muted">대상 화면마다 비율, 잘림, 안전 영역을 확인하세요. 점선 안쪽이 안전 영역입니다.</p></div></div>${targetChecks(asset, site)}</div>
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">닫기</button></div>`;
    openModal(dialog, { label: asset.title, wide: true });
  }

  function openDeleteAssetModal(assetId) {
    const asset = assetById(assetId);
    if (!asset) return;
    const usage = assetUsage(asset.id);
    const fallbackSites = fallbackUsage(asset.id);
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">이 이미지를 삭제할까요?</h2><p class="modal__sub">${escapeHTML(asset.title)}</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body">
        <div class="confirm-callout">${icon('alert')}<div><strong>삭제하면 되돌릴 수 없습니다.</strong><br>${usage.length ? `이 이미지는 ${usage.map((site) => escapeHTML(site.name)).join(', ')}에서 빠집니다.` : '현재 재생 순서에서 사용하지 않는 이미지입니다.'}${fallbackSites.length ? ' 비상 이미지로 지정된 장소는 다른 이미지로 바뀝니다.' : ''}</div></div>
        ${usage.length ? `<div class="confirm-meta">${usage.map((site) => `<div><span>영향 받는 장소</span><strong>${escapeHTML(site.name)} · ${site.playlistIds.includes(asset.id) ? `이미지 ${site.playlistIds.length}장 중 1장` : ''}${site.playlistIds.includes(asset.id) && fallbackSites.includes(site) ? ' · ' : ''}${fallbackSites.includes(site) ? '비상 이미지' : ''}</strong></div>`).join('')}</div>` : ''}
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">취소</button><button class="btn btn--danger" type="button" data-action="confirm-delete-asset" data-asset-id="${asset.id}">${icon('trash')}삭제하기</button></div>`;
    openModal(dialog, { label: '이미지 삭제 확인' });
  }

  function deleteAsset(assetId) {
    const asset = assetById(assetId);
    if (!asset) return;
    state.assets = state.assets.filter((item) => item.id !== assetId);
    const replacement = state.assets.find((item) => item.id === 'img-closure') || state.assets[0] || null;
    state.sites.forEach((site) => {
      site.playlistIds = site.playlistIds.filter((id) => id !== assetId);
      if (site.durations) delete site.durations[assetId];
      if (site.fallbackAssetId === assetId) site.fallbackAssetId = replacement?.id || null;
      clampDisplayOffsets(site);
    });
    addActivity(`${asset.title} 이미지를 보관함에서 삭제했습니다.`, 'edit', null);
    saveState();
    closeModal();
    render();
    announce('이미지를 삭제했습니다. 재생 순서에서도 빠졌습니다.');
  }

  function restoreSamples() {
    const samples = makePosters();
    const existing = new Set(state.assets.map((asset) => asset.id));
    let added = 0;
    samples.forEach((asset) => {
      if (!existing.has(asset.id)) {
        state.assets.push(asset);
        added += 1;
      }
    });
    saveState();
    render();
    announce(added ? `샘플 이미지 ${added}장을 복원했습니다.` : '샘플 이미지가 이미 모두 있습니다.', 'info');
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.readAsDataURL(file);
    });
  }

  function imageDimensions(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('이미지 크기를 확인하지 못했습니다.'));
      image.src = dataUrl;
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const accepted = ['image/jpeg', 'image/png', 'image/webp'];
    let added = 0;
    const errors = [];
    const warnings = [];
    const site = activeSite();
    ui.uploadMessage = '이미지를 확인하고 있습니다…';
    ui.uploadTone = '';
    render();
    for (const file of files) {
      if (!accepted.includes(file.type)) {
        errors.push(`${file.name}: JPEG, PNG, WebP만 올릴 수 있습니다.`);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        errors.push(`${file.name}: 파일이 8MB를 넘습니다.`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataURL(file);
        const dimensions = await imageDimensions(dataUrl);
        const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '이름 없는 이미지';
        const asset = {
          id: uid('img'), title: cleanName, filename: file.name, width: dimensions.width, height: dimensions.height,
          size: file.size, mime: file.type, dataUrl, createdAt: nowISO(), sample: false,
          kind: dimensions.height > dimensions.width ? 'portrait' : 'landscape', alt: cleanName, uploaded: true
        };
        state.assets.unshift(asset);
        added += 1;
        const mismatchedTargets = site ? site.displays.filter((display) => aspectMismatch(asset, displayAspect(display))).length : 0;
        if (mismatchedTargets) {
          warnings.push(`${cleanName}은(는) ${dimensions.width}×${dimensions.height}로 현재 화면 ${site.displays.length}대 중 ${mismatchedTargets}대에서 비율이 다릅니다. 여백이나 잘림을 확인해 주세요.`);
        }
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    if (added) addActivity(`이미지 ${added}장을 보관함에 올렸습니다.`, 'upload', null);
    const parts = [];
    if (added) parts.push(`${added}장을 올렸습니다.`);
    if (warnings.length) parts.push(warnings.join(' '));
    if (added) parts.push('중요한 글자는 가장자리 10% 안쪽에 두세요.');
    if (errors.length) parts.push(errors.join(' '));
    ui.uploadMessage = parts.join(' ') || '올릴 수 있는 이미지가 없습니다.';
    ui.uploadTone = errors.length && !added ? 'error' : '';
    saveState();
    render();
    announce(ui.uploadMessage, ui.uploadTone === 'error' ? 'error' : 'success');
  }

  function initLibraryPage() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('asset-upload');
    if (zone && input) {
      input.addEventListener('change', () => {
        handleFiles(input.files);
        input.value = '';
      });
      ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.add('is-dragover');
      }));
      ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        zone.classList.remove('is-dragover');
      }));
      zone.addEventListener('drop', (event) => {
        if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files);
      });
    }
    const search = document.getElementById('library-search');
    if (search) {
      search.addEventListener('input', () => {
        ui.libraryQuery = search.value;
        const query = search.value.trim().toLowerCase();
        let count = 0;
        $$('[data-asset-card]').forEach((card) => {
          const matches = !query || card.dataset.search.includes(query);
          card.hidden = !matches;
          if (matches) count += 1;
        });
        const countNode = document.getElementById('library-count');
        if (countNode) countNode.textContent = String(count);
        const empty = document.getElementById('search-empty');
        if (empty) empty.hidden = count !== 0 || !query;
      });
    }
  }

  /* ---------- playback editor ---------- */

  function renderPlaybackPage() {
    const site = activeSite();
    if (!site) return noSiteView('재생을 설정할 장소가 없습니다.', '장소를 만든 뒤 이미지 순서와 재생 방식을 정할 수 있습니다.');
    const entries = playlistEntries(site);
    const warnings = siteWarnings(site);
    const patternColumns = entries.length && site.displays.length ? lcm(entries.length, site.displays.length) : 0;
    return `<div class="page">
      <header class="page-head">
        <div class="page-head__copy">
          <p class="eyebrow">${escapeHTML(site.name)} · 재생</p>
          <h1 id="page-title">재생 방식을 정하세요</h1>
          <p class="page-subtitle">화면이 몇 대든 이미지 순서와 시작 위치를 정하면 같은 방식으로 재생됩니다. 변경 내용은 자동으로 저장됩니다.</p>
        </div>
        <div class="head-actions"><button class="btn btn--secondary" type="button" data-action="go" data-href="#/library" data-site-id="${site.id}">${icon('image')}이미지 보관함</button><button class="btn btn--primary" type="button" data-action="go" data-href="#/preview" data-site-id="${site.id}">${icon('eye')}미리보기로</button></div>
      </header>

      <section aria-labelledby="mode-title">
        <div class="section-head" style="margin-top:0"><div><h2 id="mode-title">재생 방식</h2><p>지금 장소에 알맞은 방식을 하나 고르세요.</p></div><span class="chip">${entries.length}장 이미지 · ${site.displays.length}대 화면</span></div>
        <div class="mode-grid" role="radiogroup" aria-label="재생 방식 선택">
          ${Object.entries(MODES).map(([key, mode]) => `<label class="mode-card"><input type="radio" name="playback-mode" value="${key}" ${site.mode === key ? 'checked' : ''}><span class="mode-card__inner"><span class="mode-card__top"><span class="mode-card__name">${mode.name}</span><span class="mode-card__radio" aria-hidden="true"></span></span>${modeGlyph(key)}<span class="mode-card__desc">${mode.desc}</span></span></label>`).join('')}
        </div>
        <div class="wizard-note" style="margin-top:10px">${icon('info', 'icon--sm')}<span><strong>${MODES[site.mode].name}</strong> · ${MODES[site.mode].long}</span></div>
      </section>

      ${warnings.length ? `<section class="card" style="margin-top:14px" aria-label="재생 경고"><div class="card__head" style="padding-bottom:10px"><div><h2 style="font-size:1rem">확인할 내용</h2></div><span class="badge ${warnings.some((item) => item.severity === 'error') ? 'badge--error' : 'badge--pending'}">${warnings.length}개</span></div><div class="warning-list" style="padding-top:0">${warnings.map((warning) => warningRow(warning, true)).join('')}</div></section>` : ''}

      <div class="playback-grid">
        <section class="card" aria-labelledby="playlist-title">
          <div class="card__head"><div><h2 id="playlist-title">이미지 순서</h2><p class="small muted">끌어서 순서를 바꾸거나, 키보드로 위아래 버튼을 사용하세요. 표시 시간은 이미지마다 정할 수 있습니다.</p></div><button class="btn btn--sm btn--primary" type="button" data-action="add-playlist-images">${icon('plus', 'icon--sm')}이미지 추가</button></div>
          ${entries.length ? `<div class="playlist" id="playlist">${entries.map((entry, index) => playlistRow(entry, index, entries.length, site)).join('')}</div>` : `<div class="empty-inline" style="margin:0 16px 16px"><span class="badge badge--error">${icon('alert')}재생할 이미지 없음</span><p style="margin-top:8px">보관함에서 이미지를 한 장 이상 골라 주세요.</p><div class="empty-state__actions" style="margin-top:12px"><button class="btn btn--sm btn--primary" type="button" data-action="add-playlist-images">이미지 추가</button><button class="btn btn--sm btn--secondary" type="button" data-action="go" data-href="#/library">보관함 열기</button></div></div>`}
          <div class="card__footer" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px"><span class="tiny muted">총 ${entries.reduce((total, entry) => total + entry.seconds, 0)}초 · ${entries.length}장</span><span class="tiny muted">${entries.length && site.displays.length ? `전체 패턴 ${patternColumns}칸` : '이미지와 화면을 추가하면 패턴을 계산합니다.'}</span></div>
        </section>
        ${renderDisplaySettings(site, entries)}
      </div>
      ${renderFallbackCard(site)}
      ${renderPatternCard(site, entries, patternColumns)}
    </div>`;
  }

  function playlistRow(entry, index, total, site) {
    return `<div class="playlist-row" draggable="true" data-playlist-id="${entry.asset.id}">
      <span class="drag-handle" draggable="true" data-drag-handle="${entry.asset.id}" aria-hidden="true" title="끌어서 순서 바꾸기">${icon('grip')}</span>
      <img class="playlist-row__thumb" src="${escapeAttr(entry.asset.dataUrl)}" alt="">
      <span class="playlist-row__order" aria-hidden="true">${index + 1}</span>
      <div class="playlist-row__name"><strong title="${escapeAttr(entry.asset.title)}">${escapeHTML(entry.asset.title)}</strong><span>${entry.asset.width}×${entry.asset.height} · ${entry.asset.kind === 'portrait' ? '세로' : '가로'}</span></div>
      <label class="duration-field"><span class="sr-only">${escapeHTML(entry.asset.title)} 표시 시간</span><input class="input" type="number" inputmode="numeric" min="0" max="120" step="1" value="${escapeAttr(entry.seconds)}" data-field="playlist-duration" data-image-id="${entry.asset.id}" aria-label="${escapeAttr(entry.asset.title)} 표시 시간, 초"><span>초</span></label>
      <div class="playlist-row__buttons">
        <button class="icon-btn" type="button" data-action="move-up" data-image-id="${entry.asset.id}" aria-label="${escapeAttr(entry.asset.title)} 위로 이동" ${index === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button>
        <button class="icon-btn" type="button" data-action="move-down" data-image-id="${entry.asset.id}" aria-label="${escapeAttr(entry.asset.title)} 아래로 이동" ${index === total - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button>
        <button class="icon-btn" type="button" data-action="remove-playlist-item" data-image-id="${entry.asset.id}" aria-label="${escapeAttr(entry.asset.title)} 순서에서 빼기">${icon('trash')}</button>
      </div>
    </div>`;
  }

  function renderDisplaySettings(site, entries) {
    const usesOffsets = site.mode === 'cycle' || site.mode === 'individual';
    const count = entries.length;
    const note = site.mode === 'mirror'
      ? '동시 재생은 모든 화면에 같은 이미지가 나오므로 시작 위치와 이동을 따로 정하지 않습니다.'
      : site.mode === 'canvas'
        ? '통합 화면은 이미지 한 장을 하나의 큰 화면처럼 나누어 보여 줍니다. 화면별 시작 위치는 쓰지 않습니다.'
        : '시작 위치는 첫 칸에서 보여 줄 이미지 번호입니다. 이동은 다음 칸으로 넘어갈 때 몇 칸씩 움직일지 정합니다.';
    return `<section class="card" aria-labelledby="display-settings-title">
      <div class="card__head"><div><h2 id="display-settings-title">화면별 시작 위치</h2><p class="small muted">이미지 수와 화면 수가 달라도 시작 위치와 이동으로 겹침을 줄일 수 있습니다.</p></div>${usesOffsets && count ? `<button class="btn btn--xs btn--secondary" type="button" data-action="auto-offsets">자동 배분</button>` : ''}</div>
      ${site.displays.length ? `<div class="display-settings">${site.displays.map((display, index) => `<div class="display-setting-row"><div class="display-setting-row__name"><strong><span class="status-dot status-dot--${display.status}"></span> ${escapeHTML(display.name)}</strong><span>${display.width}×${display.height} · ${orientationLabel(display)}</span></div><div class="field"><label class="field__label" for="offset-${display.id}">시작</label><select class="select" id="offset-${display.id}" data-field="start-offset" data-display-id="${display.id}" ${!usesOffsets || !count ? 'disabled' : ''}>${Array.from({ length: Math.max(count, 1) }, (_, imageIndex) => `<option value="${imageIndex}" ${Number(display.startOffset) === imageIndex ? 'selected' : ''}>${imageIndex + 1}번</option>`).join('')}</select></div><div class="field"><label class="field__label" for="step-${display.id}">이동</label><select class="select" id="step-${display.id}" data-field="display-step" data-display-id="${display.id}" ${!usesOffsets || !count ? 'disabled' : ''}><option value="1" ${Number(display.step) === 1 ? 'selected' : ''}>+1</option><option value="-1" ${Number(display.step) === -1 ? 'selected' : ''}>-1</option><option value="0" ${Number(display.step) === 0 ? 'selected' : ''}>고정</option></select></div></div>`).join('')}</div>` : '<div class="empty-inline" style="margin:0 16px 16px">화면을 먼저 등록해 주세요.</div>'}
      <div class="settings-note">${icon('info', 'icon--sm')}<span>${note}</span></div>
    </section>`;
  }

  function renderFallbackCard(site) {
    const fallback = fallbackAsset(site);
    return `<section class="card fallback-card" aria-labelledby="fallback-title">
      <div class="card__head"><div><h2 id="fallback-title">게시 전 안전장치</h2><p class="small muted">이미지를 갑자기 불러오지 못할 때 화면이 비지 않도록 준비합니다.</p></div><span class="badge badge--online">${icon('shield')}비상 이미지</span></div>
      <div class="fallback-card__body">
        <div class="fallback-preview">${fallback ? `<img src="${escapeAttr(fallback.dataUrl)}" alt="${escapeAttr(fallback.alt || fallback.title)}">` : `<div class="empty-inline" style="margin:0;height:100%;display:grid;place-content:center">이미지 없음</div>`}<span class="safe-area safe-area--label" aria-hidden="true">안전 영역</span></div>
        <div class="fallback-card__controls">
          <div class="field"><label class="field__label" for="fallback-image">비상 이미지</label><select class="select" id="fallback-image" data-field="fallback-image" ${state.assets.length ? '' : 'disabled'}>${state.assets.map((asset) => `<option value="${asset.id}" ${asset.id === site.fallbackAssetId ? 'selected' : ''}>${escapeHTML(asset.title)}</option>`).join('')}</select><span class="field__help">모든 화면에 공통으로 보여 줄 안전한 안내 이미지를 골라 주세요. 오류가 나면 이 이미지로 바뀝니다.</span></div>
          <div class="wizard-note" style="margin-top:0">${icon('info', 'icon--sm')}<span>게시 전 미리보기에서 오류 화면이 이 이미지로 바뀌는지 확인할 수 있습니다. 글자는 가장자리에서 10% 안쪽에 두세요.</span></div>
        </div>
      </div>
    </section>`;
  }

  function renderPatternCard(site, entries, columns) {
    const count = entries.length;
    const displayCount = site.displays.length;
    if (!count || !displayCount) {
      return `<section class="card pattern-card" aria-labelledby="pattern-title"><div class="card__head"><div><h2 id="pattern-title">패턴 미리보기</h2><p class="small muted">이미지 수와 화면 수가 다를 때 어떤 순서로 보이는지 확인하세요.</p></div></div><div class="pattern-empty">${icon('grid')}<p>이미지와 화면을 추가하면 패턴이 나타납니다.</p></div></section>`;
    }
    const rows = site.displays.map((display) => {
      const cells = Array.from({ length: columns }, (_, slot) => {
        let imageIndex = slot;
        if (site.mode === 'cycle' || site.mode === 'individual') {
          imageIndex = mod(slot * Number(display.step) + Number(display.startOffset), count);
        } else {
          imageIndex = mod(slot, count);
        }
        const asset = entries[imageIndex].asset;
        return `<td aria-label="${escapeAttr(display.name)}, ${slot + 1}번째 칸, ${escapeAttr(asset.title)}"><img class="pattern-thumb" src="${escapeAttr(asset.dataUrl)}" alt=""><span class="pattern-num">${imageIndex + 1}</span></td>`;
      }).join('');
      return `<tr><th scope="row"><div class="pattern-name">${escapeHTML(display.name)}</div><div class="pattern-sub">${site.mode === 'cycle' || site.mode === 'individual' ? `시작 ${Number(display.startOffset) + 1} · 이동 ${Number(display.step) > 0 ? '+' : ''}${display.step}` : '같은 이미지'}</div></th>${cells}</tr>`;
    }).join('');
    const note = count < displayCount
      ? `이미지 ${count}장이 화면 ${displayCount}대보다 적어 같은 이미지가 일부 화면에 함께 나옵니다. 시작 위치를 다르게 두면 반복이 덜 눈에 띕니다.`
      : count > displayCount
        ? `이미지 ${count}장이 화면 ${displayCount}대보다 많아 한 주기 안에 모든 이미지를 나누어 보여 줍니다.`
        : `이미지 ${count}장과 화면 ${displayCount}대가 같습니다. 시작 위치를 다르게 두면 한 주기 안에서 겹치지 않게 배치할 수 있습니다.`;
    return `<section class="card pattern-card" aria-labelledby="pattern-title">
      <div class="card__head"><div><h2 id="pattern-title">패턴 미리보기</h2><p class="small muted">이미지 수와 화면 수의 최소 공통 주기(${columns}칸)까지 계산했습니다. 각 칸은 이미지가 바뀌는 순서입니다.</p></div><button class="btn btn--sm btn--secondary" type="button" data-action="go" data-href="#/preview" data-site-id="${site.id}">${icon('play', 'icon--sm')}시간으로 보기</button></div>
      <div class="pattern-summary"><span class="chip">${modeLabel(site.mode)}</span><span class="chip">이미지 ${count}장</span><span class="chip">화면 ${displayCount}대</span><span class="chip ${count !== displayCount ? 'chip--amber' : 'chip--celadon'}">${count === displayCount ? '수량 일치' : '수량 다름'}</span></div>
      <div class="pattern-scroll"><table class="pattern-table"><caption class="sr-only">화면별 이미지 순환 패턴</caption><thead><tr><th scope="col">화면</th>${Array.from({ length: columns }, (_, index) => `<th scope="col">${index + 1}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card__footer"><div class="notice-line" style="display:flex;gap:8px;align-items:flex-start;color:var(--celadon-deep);font-size:.79rem;line-height:1.55">${icon('info', 'icon--sm')}<span>${note}</span></div></div>
    </section>`;
  }

  function openAddImagesModal() {
    const site = activeSite();
    if (!site) return;
    const available = state.assets.filter((asset) => !site.playlistIds.includes(asset.id));
    if (!available.length) {
      announce(state.assets.length ? '모든 이미지가 이미 재생 순서에 들어 있습니다.' : '보관함에 이미지가 없습니다. 먼저 이미지를 올려 주세요.', 'info');
      return;
    }
    const dialog = `<form id="add-images-form" data-site-id="${site.id}">
      <div class="modal__head"><div><h2 class="modal__title" id="modal-title">재생 순서에 이미지 추가</h2><p class="modal__sub">추가할 이미지를 고르세요. 지금 순서 뒤에 붙습니다.</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body"><div id="add-images-error"></div><div class="sample-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">${available.map((asset) => `<label class="sample-card"><input type="checkbox" name="asset" value="${asset.id}"><span class="sample-card__inner"><span class="sample-card__thumb"><img src="${escapeAttr(asset.dataUrl)}" alt=""><span class="sample-card__check">${icon('check', 'icon--sm')}</span></span><span class="sample-card__name">${escapeHTML(asset.title)}</span></span></label>`).join('')}</div></div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">취소</button><button class="btn btn--primary" type="submit">${icon('plus')}선택한 이미지 추가</button></div>
    </form>`;
    openModal(dialog, { label: '재생 순서에 이미지 추가', wide: true });
  }

  function submitAddImages(event) {
    event.preventDefault();
    const site = activeSite();
    if (!site) return;
    const form = event.currentTarget;
    const selected = $$('input[name="asset"]:checked', form).map((input) => input.value);
    if (!selected.length) {
      const slot = form.querySelector('#add-images-error');
      if (slot) slot.innerHTML = `<div class="error-summary" role="alert" tabindex="-1"><div class="error-summary__title">${icon('alert')}이미지를 골라 주세요.</div><ul><li>재생 순서에 추가할 이미지를 한 장 이상 선택해 주세요.</li></ul></div>`;
      announce('추가할 이미지를 한 장 이상 선택해 주세요.', 'error');
      const first = form.querySelector('input[name="asset"]');
      if (first) first.focus();
      return;
    }
    selected.forEach((id) => {
      if (!site.playlistIds.includes(id)) {
        site.playlistIds.push(id);
        if (!site.durations) site.durations = {};
        site.durations[id] = 8;
      }
    });
    clampDisplayOffsets(site);
    addActivity(`${site.name} 재생 순서에 이미지 ${selected.length}장을 추가했습니다.`, 'edit', site.id);
    saveState();
    closeModal();
    render();
    announce(`이미지 ${selected.length}장을 재생 순서에 추가했습니다.`);
  }

  function movePlaylistItem(imageId, direction) {
    const site = activeSite();
    if (!site) return;
    const index = site.playlistIds.indexOf(imageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= site.playlistIds.length) return;
    [site.playlistIds[index], site.playlistIds[target]] = [site.playlistIds[target], site.playlistIds[index]];
    saveState();
    ui.focusAfterRender = `button[data-action="${direction < 0 ? 'move-up' : 'move-down'}"][data-image-id="${imageId}"]`;
    render();
    announce('이미지 순서를 바꿨습니다.');
  }

  function removePlaylistItem(imageId) {
    const site = activeSite();
    if (!site) return;
    const asset = assetById(imageId);
    site.playlistIds = site.playlistIds.filter((id) => id !== imageId);
    if (site.durations) delete site.durations[imageId];
    clampDisplayOffsets(site);
    saveState();
    render();
    announce(`${asset?.title || '이미지'}을 재생 순서에서 뺐습니다. 보관함에는 그대로 있습니다.`);
  }

  function autoDistributeOffsets() {
    const site = activeSite();
    if (!site) return;
    const count = site.playlistIds.length;
    if (!count) {
      announce('이미지를 먼저 추가해 주세요.', 'error');
      return;
    }
    site.displays.forEach((display, index) => {
      display.startOffset = mod(index, count);
      display.step = 1;
    });
    saveState();
    render();
    announce('화면마다 시작 위치를 고르게 배분했습니다. 패턴 미리보기에서 확인할 수 있습니다.');
  }

  function initPlaybackDnD() {
    const playlist = document.getElementById('playlist');
    if (!playlist) return;
    let draggedId = null;
    $$('.playlist-row', playlist).forEach((row) => {
      row.addEventListener('dragstart', (event) => {
        if (event.target.closest('button, input, label, a')) {
          event.preventDefault();
          return;
        }
        draggedId = row.dataset.playlistId;
        row.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', draggedId);
        }
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        $$('.playlist-row', playlist).forEach((item) => item.classList.remove('is-dragover'));
        draggedId = null;
      });
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (draggedId && row.dataset.playlistId !== draggedId) row.classList.add('is-dragover');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-dragover'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('is-dragover');
        const site = activeSite();
        if (!site || !draggedId) return;
        const from = site.playlistIds.indexOf(draggedId);
        const to = site.playlistIds.indexOf(row.dataset.playlistId);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = site.playlistIds.splice(from, 1);
        site.playlistIds.splice(to, 0, moved);
        clampDisplayOffsets(site);
        saveState();
        render();
        announce('이미지 순서를 바꿨습니다.');
      });
    });
  }

  /* ---------- preview and simulation ---------- */

  function ensurePreviewClock(site) {
    if (!ui.previewClock || ui.previewClock.siteId !== site?.id) {
      ui.previewClock = { siteId: site?.id || null, t: 0, playing: true, last: null, timer: null };
    }
    return ui.previewClock;
  }

  function startPreviewClock() {
    const site = activeSite();
    if (!site) return;
    const clock = ensurePreviewClock(site);
    clock.last = performance.now();
    if (clock.timer) window.clearInterval(clock.timer);
    clock.timer = window.setInterval(tickPreview, 200);
    initPreviewControls();
    updatePreviewFrame();
  }

  function stopPreviewClock() {
    if (ui.previewClock?.timer) window.clearInterval(ui.previewClock.timer);
    ui.previewClock = null;
  }

  function tickPreview() {
    const site = activeSite();
    const clock = ui.previewClock;
    if (!site || !clock) return;
    const now = performance.now();
    if (clock.playing) {
      const delta = clock.last ? Math.min(now - clock.last, 1000) : 0;
      clock.t += delta;
    }
    clock.last = now;
    updatePreviewFrame();
  }

  function previewContentHTML(site, display, entry) {
    if (!entry) return '<div class="preview-no-content"><strong>이미지 없음</strong><span>이미지를 추가해 주세요</span></div>';
    if (site.mode === 'canvas') {
      const style = `width:${(100 / Math.max(display.w, 0.01)).toFixed(3)}%;height:${(100 / Math.max(display.h, 0.01)).toFixed(3)}%;left:${(-(display.x * 100) / Math.max(display.w, 0.01)).toFixed(3)}%;top:${(-(display.y * 100) / Math.max(display.h, 0.01)).toFixed(3)}%`;
      return `<img class="slice-img" src="${escapeAttr(entry.asset.dataUrl)}" alt="" style="${style}">`;
    }
    const fit = display.fit === 'cover' ? 'cover' : display.fit === 'stretch' ? 'fill' : 'contain';
    return `<img class="preview-img" src="${escapeAttr(entry.asset.dataUrl)}" alt="" style="object-fit:${fit}">`;
  }

  function previewStateHTML(display) {
    if (display.status === 'online') return '';
    const meta = STATUS[display.status];
    const detail = display.status === 'offline' ? '마지막 이미지' : display.status === 'pending' ? '게시 전' : '비상 이미지';
    return `<span class="preview-state preview-state--${display.status}">${icon(meta.icon)}${meta.label} · ${detail}</span>`;
  }

  function previewMonitor(site, display, entry) {
    const fallback = fallbackAsset(site);
    const shownEntry = display.status === 'error' && fallback ? { asset: fallback, fallback: true } : entry;
    return `<div class="preview-monitor" style="${layoutRectStyle(display)}" data-preview-display-id="${display.id}">
      <div class="preview-screen" data-preview-screen data-display-id="${display.id}" data-image-id="${shownEntry?.asset?.id || ''}">${previewContentHTML(site, display, shownEntry)}</div>
      ${previewStateHTML(display)}
      <span class="preview-label"><span class="status-dot status-dot--${display.status}"></span>${escapeHTML(display.name)}<span class="preview-label__meta">${orientationLabel(display)}</span></span>
    </div>`;
  }

  function renderPreviewPage() {
    const site = activeSite();
    if (!site) return noSiteView('미리 볼 장소가 없습니다.', '장소와 화면을 만든 뒤 가상 모니터에서 미리 확인할 수 있습니다.');
    const clock = ensurePreviewClock(site);
    const resolved = resolveSiteAt(site, clock.t);
    const warnings = siteWarnings(site);
    const entries = playlistEntries(site);
    const cycleSeconds = resolved.cycleMs / 1000;
    const timeSeconds = cycleSeconds ? (clock.t % resolved.cycleMs) / 1000 : 0;
    const nextVersion = (Number(site.publishedVersion) || 0) + 1;
    const canPublish = site.displays.length > 0 && entries.length > 0;
    const warningCount = warnings.length;

    return `<div class="page">
      <header class="page-head">
        <div class="page-head__copy">
          <p class="eyebrow">${escapeHTML(site.name)} · 미리보기</p>
          <h1 id="page-title">게시 전에 가상으로 확인하세요</h1>
          <p class="page-subtitle">실제 배치 비율과 재생 순서로 보여 줍니다. 재생 방식을 바꾸면 이 화면도 바로 달라집니다.</p>
        </div>
        <div class="head-actions"><button class="btn btn--secondary" type="button" data-action="go" data-href="#/playback" data-site-id="${site.id}">${icon('sliders')}재생 설정</button><button class="btn btn--celadon" type="button" data-action="publish-preview" ${canPublish ? '' : 'disabled'}>${icon('send')}이대로 게시</button></div>
      </header>
      <div class="preview-grid">
        <section class="card preview-main" aria-labelledby="preview-title">
          <div class="preview-head">
            <div class="preview-head__left"><h2 class="preview-title" id="preview-title">가상 모니터</h2><span class="chip">${modeLabel(site.mode)}</span><span class="chip">화면 ${site.displays.length}대</span><span class="chip">이미지 ${entries.length}장</span></div>
            <span class="chip chip--navy">${icon('eye', 'icon--sm')}가상 재생</span>
          </div>
          <div class="preview-stage">
            <div class="preview-canvas" id="preview-canvas" aria-label="${escapeAttr(site.name)} 가상 모니터 배치">
              ${site.displays.length ? resolved.perDisplay.map((item) => previewMonitor(site, item.display, item.entry)).join('') : `<div class="empty-inline" style="position:absolute;inset:16px;border:0;background:transparent;color:#b8ccc4;display:grid;place-content:center">연결된 화면이 없습니다.</div>`}
            </div>
          </div>
          <div class="preview-controls">
            <button class="play-button" id="preview-play" type="button" data-action="toggle-playback" aria-label="일시정지" aria-pressed="${clock.playing}">${clock.playing ? icon('pause') : icon('play')}</button>
            <button class="icon-btn icon-btn--bordered" type="button" data-action="restart-playback" aria-label="처음부터 다시 재생" title="처음부터">${icon('rewind')}</button>
            <div class="scrub-area"><label class="sr-only" for="preview-scrub">재생 위치</label><input id="preview-scrub" type="range" min="0" max="${Math.max(cycleSeconds, 1).toFixed(1)}" step="0.1" value="${timeSeconds.toFixed(1)}" ${cycleSeconds ? '' : 'disabled'} aria-describedby="preview-time"><span class="scrub-time" id="preview-time">${formatClock(timeSeconds)} / ${formatClock(cycleSeconds)}</span></div>
            <span class="chip sim-badge" id="preview-next">${cycleSeconds ? `다음 이미지까지 ${formatClock(resolved.timeline.remainingMs / 1000)}` : '전환 없음'}</span>
          </div>
          <div class="card__footer" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:10px 18px"><span class="tiny muted">가상 재생입니다. 실제 화면의 밝기·테두리·시야각은 다를 수 있습니다.</span><span class="tiny muted">${clock.playing ? '재생 중' : '일시정지'} · ${formatClock(timeSeconds)}</span></div>
        </section>
        <aside class="preview-side">
          <section class="card" aria-labelledby="preview-warnings-title">
            <div class="warning-summary"><span class="warning-summary__icon ${warningCount ? '' : 'warning-summary__icon--ok'}">${icon(warningCount ? 'alert' : 'check-circle')}</span><div><strong id="preview-warnings-title">${warningCount ? `확인할 내용 ${warningCount}개` : '확인할 경고가 없습니다.'}</strong><span>${warningCount ? '게시는 가능하지만 한 번 더 살펴보세요.' : '화면과 이미지가 준비되었습니다.'}</span></div></div>
            <div class="preview-warnings">${warningCount ? warnings.map((warning) => warningRow(warning, false)).join('') : `<div class="warning-row warning-row--info" style="border:0">${icon('check-circle')}<div><strong>지금 바로 게시할 수 있습니다.</strong><br>아래 요약을 확인한 뒤 게시해 주세요.</div></div>`}</div>
          </section>
          <section class="card" aria-labelledby="publish-title">
            <div class="card__head" style="padding-bottom:9px"><div><h2 id="publish-title" style="font-size:1rem">게시 요약</h2><p class="small muted">확인 후 새 버전으로 저장합니다.</p></div></div>
            <div class="publish-card__body">
              <div class="publish-fact"><span>장소</span><strong>${escapeHTML(site.name)}</strong></div>
              <div class="publish-fact"><span>화면</span><strong>${site.displays.length}대</strong></div>
              <div class="publish-fact"><span>이미지</span><strong>${entries.length}장</strong></div>
              <div class="publish-fact"><span>재생 방식</span><strong>${modeLabel(site.mode)}</strong></div>
              <div class="publish-fact"><span>비상 이미지</span><strong>${escapeHTML(fallbackAsset(site)?.title || '아직 없음')}</strong></div>
              <div class="publish-fact"><span>버전</span><strong>${site.publishedVersion} → ${nextVersion}</strong></div>
              ${!canPublish ? `<div class="warning-row warning-row--error" style="margin-top:3px">${icon('alert')}<div><strong>지금은 게시할 수 없습니다.</strong><br>${!site.displays.length ? '화면을 한 대 이상 등록해 주세요.' : '이미지를 한 장 이상 추가해 주세요.'}</div></div>` : ''}
              <button class="btn btn--primary btn--block" type="button" data-action="publish-preview" style="margin-top:5px" ${canPublish ? '' : 'disabled'}>${icon('send')}이대로 게시</button>
              <p class="tiny muted" style="margin:0;text-align:center">프로토타입에서는 버전과 활동 기록만 바뀝니다.</p>
            </div>
          </section>
        </aside>
      </div>
    </div>`;
  }

  function initPreviewControls() {
    const scrub = document.getElementById('preview-scrub');
    if (!scrub) return;
    scrub.addEventListener('input', () => {
      const clock = ui.previewClock;
      if (!clock) return;
      clock.t = Number(scrub.value) * 1000;
      clock.last = performance.now();
      updatePreviewFrame();
    });
  }

  function updatePreviewFrame() {
    const site = activeSite();
    const clock = ui.previewClock;
    if (!site || !clock) return;
    const resolved = resolveSiteAt(site, clock.t);
    const screens = $$('.preview-screen');
    screens.forEach((screen) => {
      const display = displayById(site, screen.dataset.displayId);
      const match = resolved.perDisplay.find((item) => item.display.id === screen.dataset.displayId);
      let entry = match?.entry || null;
      const fallback = fallbackAsset(site);
      if (display?.status === 'error' && fallback) entry = { asset: fallback, fallback: true };
      if (!display) return;
      if ((screen.dataset.imageId || '') !== (entry?.asset?.id || '')) {
        screen.innerHTML = previewContentHTML(site, display, entry);
        screen.dataset.imageId = entry?.asset?.id || '';
      }
    });
    const cycleSeconds = resolved.cycleMs / 1000;
    const elapsedSeconds = cycleSeconds ? mod(clock.t, resolved.cycleMs) / 1000 : 0;
    const scrub = document.getElementById('preview-scrub');
    if (scrub && document.activeElement !== scrub) {
      scrub.value = elapsedSeconds.toFixed(1);
    }
    if (scrub) {
      const max = Math.max(cycleSeconds, 1);
      scrub.style.setProperty('--track', `${(elapsedSeconds / max) * 100}%`);
      scrub.setAttribute('aria-valuetext', `${formatClock(elapsedSeconds)} / ${formatClock(cycleSeconds)}`);
    }
    const timeLabel = document.getElementById('preview-time');
    if (timeLabel) timeLabel.textContent = `${formatClock(elapsedSeconds)} / ${formatClock(cycleSeconds)}`;
    const nextLabel = document.getElementById('preview-next');
    if (nextLabel) nextLabel.textContent = cycleSeconds ? `다음 이미지까지 ${formatClock(resolved.timeline.remainingMs / 1000)}` : '전환 없음';
    const playButton = document.getElementById('preview-play');
    if (playButton) {
      playButton.setAttribute('aria-pressed', String(clock.playing));
      playButton.setAttribute('aria-label', clock.playing ? '일시정지' : '재생');
      playButton.innerHTML = clock.playing ? icon('pause') : icon('play');
    }
  }

  function togglePreviewPlayback() {
    const clock = ui.previewClock;
    if (!clock) return;
    clock.playing = !clock.playing;
    clock.last = performance.now();
    updatePreviewFrame();
    announce(clock.playing ? '가상 재생을 시작했습니다.' : '가상 재생을 일시정지했습니다.');
  }

  function restartPreviewPlayback() {
    const clock = ui.previewClock;
    if (!clock) return;
    clock.t = 0;
    clock.playing = true;
    clock.last = performance.now();
    updatePreviewFrame();
    announce('처음부터 다시 재생합니다.');
  }

  function openPublishModal() {
    const site = activeSite();
    if (!site) return;
    const entries = playlistEntries(site);
    if (!entries.length || !site.displays.length) return;
    const warnings = siteWarnings(site);
    const nextVersion = (Number(site.publishedVersion) || 0) + 1;
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">이대로 게시할까요?</h2><p class="modal__sub">확인을 누르면 새 게시 버전이 만들어집니다.</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body">
        ${warnings.length ? `<div class="confirm-callout">${icon('alert')}<div><strong>확인할 내용이 ${warnings.length}개 남아 있습니다.</strong><br>${escapeHTML(warnings[0].title)} · ${escapeHTML(warnings[0].body)}</div></div>` : `<div class="confirm-callout confirm-callout--info">${icon('check-circle')}<div><strong>화면과 이미지가 준비되었습니다.</strong><br>이전 버전의 마지막 이미지에서 새 버전으로 넘어갑니다.</div></div>`}
        <div class="confirm-meta"><div><span>장소</span><strong>${escapeHTML(site.name)}</strong></div><div><span>화면</span><strong>${site.displays.length}대</strong></div><div><span>이미지</span><strong>${entries.length}장 · ${modeLabel(site.mode)}</strong></div><div><span>비상 이미지</span><strong>${escapeHTML(fallbackAsset(site)?.title || '없음')}</strong></div><div><span>버전</span><strong>${site.publishedVersion} → ${nextVersion}</strong></div><div><span>게시자</span><strong>김하늘</strong></div></div>
        <p class="field__help" style="margin-top:14px">오프라인 화면은 연결이 돌아올 때까지 마지막 이미지를 계속 보여 줍니다.</p>
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">취소</button><button class="btn btn--celadon" type="button" data-action="confirm-publish" data-site-id="${site.id}">${icon('send')}새 버전 게시</button></div>`;
    openModal(dialog, { label: '게시 확인' });
  }

  function publishSite(siteId) {
    const site = siteById(siteId);
    if (!site) return;
    const entries = playlistEntries(site);
    if (!entries.length || !site.displays.length) return;
    const previousVersion = Number(site.publishedVersion) || 0;
    site.publishedVersion = previousVersion + 1;
    site.lastPublishedAt = nowISO();
    site.publications = site.publications || [];
    site.publications.unshift({
      version: site.publishedVersion, at: nowISO(), actor: '김하늘', mode: site.mode,
      imageCount: entries.length, displayCount: site.displays.length, note: '미리보기에서 새 버전 게시'
    });
    site.publications = site.publications.slice(0, 8);
    addActivity(`${site.name}에 버전 ${site.publishedVersion}을 게시했습니다.`, 'publish', site.id);
    saveState();
    closeModal();
    if (ui.previewClock) {
      ui.previewClock.playing = true;
      ui.previewClock.last = performance.now();
    }
    render();
    announce(`게시를 완료했습니다. 버전 ${site.publishedVersion}이 준비되었습니다.`);
  }

  /* ---------- status and recovery ---------- */

  function allDisplays() {
    return state.sites.flatMap((site) => site.displays.map((display) => ({ site, display })));
  }

  function statusFilterLabel(filter) {
    return filter === 'all' ? '전체' : STATUS[filter]?.label || filter;
  }

  function renderStatusPage() {
    if (!state.sites.length) return noSiteView('점검할 화면이 없습니다.', '장소와 화면을 등록하면 연결 상태와 오류 원인을 확인할 수 있습니다.');
    const all = allDisplays();
    const counts = all.reduce((result, item) => {
      result[item.display.status] = (result[item.display.status] || 0) + 1;
      return result;
    }, { online: 0, offline: 0, pending: 0, error: 0 });
    const filter = ui.statusFilter;
    const filtered = filter === 'all' ? all : all.filter((item) => item.display.status === filter);
    const filters = ['all', 'online', 'offline', 'pending', 'error'];
    const issueCount = counts.offline + counts.error;
    const statusSentence = `${all.length}대 중 ${counts.online}대 정상${issueCount ? `, ${issueCount}대 확인 필요` : ''}${counts.pending ? `, ${counts.pending}대 등록 대기` : ''}.`;
    return `<div class="page">
      <header class="page-head">
        <div class="page-head__copy">
          <p class="eyebrow">운영 · 상태 점검</p>
          <h1 id="page-title">화면 상태</h1>
          <p class="page-subtitle">연결이 끊긴 화면과 오류 원인을 확인하세요. 화면이 응답하지 않아도 마지막 이미지는 계속 보여 줍니다.</p>
        </div>
        <div class="head-actions"><button class="btn btn--secondary" type="button" data-action="refresh-status">${icon('refresh')}상태 다시 확인</button><button class="btn btn--primary" type="button" data-action="go" data-href="#/register">${icon('monitor-add')}화면 등록</button></div>
      </header>
      <div class="status-sentence ${issueCount ? 'status-sentence--attention' : ''}"><span class="status-sentence__icon">${icon(issueCount ? 'alert' : 'check-circle')}</span><div><strong>${statusSentence}</strong><span>${issueCount ? '상세에서 원인과 다음 행동을 확인하고 복구해 주세요.' : counts.pending ? '등록을 기다리는 화면을 승인해 주세요.' : '마지막 확인 기준으로 모든 화면이 정상입니다.'}</span></div></div>
      <div class="metric-strip" style="margin-top:0">
        ${metric('check-circle', '온라인', counts.online, '')}
        ${metric('wifi-off', '오프라인', counts.offline, 'metric__icon--soft')}
        ${metric('monitor-add', '등록 대기', counts.pending, 'metric__icon--wait')}
        ${metric('alert', '오류', counts.error, 'metric__icon--warn')}
      </div>
      <div class="filter-row" role="group" aria-label="상태로 거르기">
        ${filters.map((key) => `<button class="filter-btn" type="button" data-action="filter-status" data-filter="${key}" aria-pressed="${filter === key}">${statusFilterLabel(key)} <span class="filter-count">${key === 'all' ? all.length : counts[key] || 0}</span></button>`).join('')}
      </div>
      <section class="card" aria-labelledby="status-table-title">
        <div class="card__head"><div><h2 id="status-table-title">연결된 화면</h2><p class="small muted">상세를 열면 원인과 다음 행동, 복구 버튼을 확인할 수 있습니다.</p></div><span class="chip">${filtered.length}대 표시</span></div>
        ${filtered.length ? `<div class="table-wrap"><table class="data-table status-table"><caption class="sr-only">장소별 화면 연결 상태</caption><thead><tr><th scope="col">화면</th><th scope="col">상태</th><th scope="col">해상도·방향</th><th scope="col">마지막 연결</th><th scope="col">현재 이미지</th><th scope="col"><span class="sr-only">동작</span></th></tr></thead><tbody>
          ${filtered.map(({ site, display }) => {
            const resolved = resolveSiteAt(site, 0);
            const index = site.displays.findIndex((item) => item.id === display.id);
            const entry = resolved.perDisplay[index]?.entry?.asset;
            const current = display.status === 'error' && fallbackAsset(site) ? fallbackAsset(site) : entry;
            const isFallback = Boolean(display.status === 'error' && fallbackAsset(site));
            return `<tr><td data-label="화면"><div class="cell-title">${escapeHTML(display.name)}</div><div class="cell-sub">${escapeHTML(site.name)}</div></td><td data-label="상태">${statusBadge(display.status)}</td><td data-label="해상도·방향">${display.width}×${display.height}<div class="cell-sub">${orientationLabel(display)}</div></td><td data-label="마지막 연결">${display.lastSeen ? relativeTime(display.lastSeen) : '연결 전'}</td><td data-label="현재 이미지">${current ? escapeHTML(current.title) : '<span class="muted">표시할 이미지 없음</span>'}${isFallback ? ' <span class="chip">비상</span>' : ''}</td><td data-label="동작"><div class="table-actions"><button class="btn btn--xs btn--secondary" type="button" data-action="open-status" data-site-id="${site.id}" data-display-id="${display.id}">상세</button></div></td></tr>`;
          }).join('')}
        </tbody></table></div>` : `<div class="empty-inline" style="margin:0 18px 18px">${statusFilterLabel(filter)} 상태인 화면이 없습니다.</div>`}
      </section>
      <div class="section-head"><div><h2>상태를 읽는 법</h2><p>색과 아이콘, 글자를 함께 사용해 구분합니다.</p></div></div>
      <div class="site-grid status-legend">${Object.entries(STATUS).map(([key, meta]) => `<div class="card" style="padding:13px"><span class="badge badge--${meta.className}">${icon(meta.icon)}${meta.label}</span><p class="tiny muted" style="margin-top:8px">${key === 'online' ? '30초 안에 응답했습니다.' : key === 'offline' ? '90초 동안 응답이 없습니다.' : key === 'pending' ? '연결은 되었지만 승인 전입니다.' : '이미지나 화면 프로그램에 문제가 있습니다.'}</p></div>`).join('')}</div>
    </div>`;
  }

  function statusMessage(display) {
    if (display.status === 'online') {
      return {
        cause: '화면이 정상적으로 연결되어 있습니다.',
        action: '테스트 이미지를 보내 실제 화면에 잘 보이는지 확인해 보세요.',
        tone: 'ok'
      };
    }
    if (display.status === 'offline') {
      return {
        cause: `90초 넘게 화면에서 응답이 없습니다. 마지막 연결은 ${display.lastSeen ? relativeTime(display.lastSeen) : '기록 없음'}입니다.`,
        action: '네트워크 케이블과 화면 전원을 확인한 뒤 ‘다시 연결’을 눌러 주세요. 연결 전까지는 마지막 이미지를 계속 보여 줍니다.',
        tone: 'warn'
      };
    }
    if (display.status === 'pending') {
      return {
        cause: '화면이 연결을 기다리고 있습니다. 아직 게시 승인을 하지 않았습니다.',
        action: '화면 이름과 방향을 확인한 뒤 화면 등록에서 승인해 주세요.',
        tone: 'warn'
      };
    }
    return {
      cause: `화면이 이미지를 불러오지 못했습니다. 오류 코드 ${display.errorCode || 'E-204'}가 기록되었습니다.`,
      action: '원내 네트워크 연결을 확인한 뒤 ‘화면 프로그램 다시 시작’을 눌러 주세요. 그래도 풀리지 않으면 로그를 복사해 담당자에게 전달해 주세요.',
      tone: 'error'
    };
  }

  function openStatusDetail(siteId, displayId) {
    const site = siteById(siteId) || activeSite();
    const display = displayById(site, displayId);
    if (!site || !display) return;
    const message = statusMessage(display);
    const resolved = resolveSiteAt(site, 0);
    const index = site.displays.findIndex((item) => item.id === display.id);
    const entry = resolved.perDisplay[index]?.entry?.asset;
    const recovery = display.status === 'pending'
      ? `<button class="btn btn--primary" type="button" data-action="recover-pending" data-site-id="${site.id}">${icon('check')}등록 화면으로 이동</button>`
      : display.status === 'error'
        ? `<button class="btn btn--primary" type="button" data-action="recover-display" data-recovery="restart" data-site-id="${site.id}" data-display-id="${display.id}">${icon('refresh')}화면 프로그램 다시 시작</button><button class="btn btn--secondary" type="button" data-action="recover-display" data-recovery="reconnect" data-site-id="${site.id}" data-display-id="${display.id}">${icon('link')}다시 연결</button>`
        : display.status === 'offline'
          ? `<button class="btn btn--primary" type="button" data-action="recover-display" data-recovery="reconnect" data-site-id="${site.id}" data-display-id="${display.id}">${icon('link')}다시 연결</button>`
          : `<button class="btn btn--primary" type="button" data-action="recover-display" data-recovery="test" data-site-id="${site.id}" data-display-id="${display.id}">${icon('send')}테스트 이미지 보내기</button>`;
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">${escapeHTML(display.name)}</h2><p class="modal__sub">${escapeHTML(site.name)} · ${escapeHTML(display.hardwareId)}</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body">
        <div class="status-detail-head"><div><div class="status-detail-name">${escapeHTML(display.name)}</div><div class="status-detail-sub">${display.width}×${display.height} · ${orientationLabel(display)} 방향 · ${escapeHTML(display.browser || '브라우저 정보 없음')}</div></div>${statusBadge(display.status)}</div>
        <div class="status-cause ${message.tone === 'ok' ? 'status-cause--ok' : message.tone === 'warn' ? 'status-cause--info' : ''}">${icon(message.tone === 'error' ? 'alert' : message.tone === 'ok' ? 'check-circle' : 'info')}<div><strong>${message.tone === 'ok' ? '상태' : '원인'}</strong>${escapeHTML(message.cause)}<br><br><strong>다음 행동</strong>${escapeHTML(message.action)}</div></div>
        <dl class="meta-list"><div class="meta-list__row"><dt>마지막 연결</dt><dd>${display.lastSeen ? relativeTime(display.lastSeen) : '연결 전'}</dd></div><div class="meta-list__row"><dt>현재 이미지</dt><dd>${entry ? escapeHTML(entry.title) : '표시할 이미지 없음'}</dd></div><div class="meta-list__row"><dt>비상 이미지</dt><dd>${escapeHTML(fallbackAsset(site)?.title || '아직 없음')}</dd></div><div class="meta-list__row"><dt>네트워크</dt><dd>${escapeHTML(display.ip || '정보 없음')} · 원내 유선</dd></div><div class="meta-list__row"><dt>화면 기능</dt><dd>${escapeHTML((display.capabilities || []).join(' · '))}</dd></div><div class="meta-list__row"><dt>게시 버전</dt><dd>${site.publishedVersion}</dd></div>${display.errorCode ? `<div class="meta-list__row"><dt>오류 코드</dt><dd>${escapeHTML(display.errorCode)}</dd></div>` : ''}</dl>
        <div class="recovery-actions">${recovery}<button class="btn btn--secondary" type="button" data-action="copy-display-log" data-site-id="${site.id}" data-display-id="${display.id}">${icon('copy')}로그 복사</button></div>
        <div id="recovery-result" class="recovery-result" role="status"></div>
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">닫기</button></div>`;
    openModal(dialog, { label: `${display.name} 상태 상세` });
  }

  function displayLog(site, display) {
    const message = statusMessage(display);
    const now = new Date();
    return [
      '[열린안내판 프로토타입 로그]',
      `시각: ${now.toLocaleString('ko-KR')}`,
      `장소: ${site.name} (${site.id})`,
      `화면: ${display.name} (${display.id})`,
      `하드웨어: ${display.hardwareId}`,
      `상태: ${STATUS[display.status].label}`,
      `해상도: ${display.width}×${display.height} / ${orientationLabel(display)}`,
      `브라우저: ${display.browser}`,
      `네트워크: ${display.ip}`,
      `마지막 연결: ${display.lastSeen || '기록 없음'}`,
      `게시 버전: ${site.publishedVersion}`,
      `원인: ${message.cause}`,
      `다음 행동: ${message.action}`
    ].join('\n');
  }

  function recoverDisplay(siteId, displayId, recovery) {
    const site = siteById(siteId);
    const display = displayById(site, displayId);
    if (!site || !display) return;
    if (recovery === 'test') {
      const target = document.getElementById('recovery-result');
      if (target) target.innerHTML = `<div class="upload-result">${icon('check-circle', 'icon--sm')}<span>테스트 이미지를 보냈습니다. 화면에 색색의 확인 무늬가 10초 동안 표시됩니다.</span></div>`;
      announce('테스트 이미지를 보냈습니다. 실제 화면에서 확인해 주세요.');
      return;
    }
    display.status = 'online';
    display.lastSeen = nowISO();
    display.errorCode = '';
    addActivity(`${site.name}의 ${display.name} 화면을 다시 연결했습니다.`, 'check', site.id);
    saveState();
    closeModal();
    render();
    announce(`${display.name} 화면이 다시 연결되었습니다.`);
  }

  /* ---------- first-use six-step flow ---------- */

  const WIZARD_STEPS = ['장소', '화면', '배치', '이미지', '재생', '미리보기'];

  function defaultWizard() {
    const initialImages = imageIdsForCount(3);
    return {
      step: 1, maxStep: 1, siteName: '', location: '1층 로비', hours: '09:00 — 18:00',
      displayCount: 4, layoutType: 'grid', orientation: 'landscape', resolution: '1920×1080',
      selectedAssetIds: initialImages, durations: Object.fromEntries(initialImages.map((id) => [id, 8])),
      fallbackAssetId: 'img-closure',
      mode: 'cycle', createdAt: nowISO(), updatedAt: nowISO()
    };
  }

  function startWizard() {
    if (!state.wizard) {
      state.wizard = defaultWizard();
      saveState();
    }
    if (location.hash === '#/setup') render({ focusHeading: true });
    else location.hash = '#/setup';
  }

  function saveWizardDraft(silent = false) {
    if (!state.wizard) return;
    state.wizard.updatedAt = nowISO();
    saveState();
    if (!silent) announce(`초안을 저장했습니다. ${state.wizard.step}단계에서 다시 이어서 할 수 있습니다.`);
  }

  function wizardSelectedAssets() {
    if (!state.wizard) return [];
    return state.wizard.selectedAssetIds.map(assetById).filter(Boolean);
  }

  function wizardDisplayGeometry() {
    const wizard = state.wizard;
    const count = wizard.displayCount;
    const type = wizard.layoutType;
    const sourceType = type === 'custom' ? 'grid' : type;
    return makeSlots(count, sourceType);
  }

  function wizardPreviewSite() {
    const wizard = state.wizard;
    const assets = wizardSelectedAssets();
    const [width, height] = String(wizard.resolution).split('×').map((value) => Number(String(value).trim()));
    const slots = wizardDisplayGeometry();
    const displays = Array.from({ length: wizard.displayCount }, (_, index) => ({
      id: `wizard-d${index + 1}`,
      name: DISPLAY_NAMES[index % DISPLAY_NAMES.length],
      status: 'online',
      orientation: wizard.orientation,
      width: width || (wizard.orientation === 'portrait' ? 1080 : 1920),
      height: height || (wizard.orientation === 'portrait' ? 1920 : 1080),
      rotation: wizard.orientation === 'portrait' ? 90 : 0,
      fit: 'contain',
      lastSeen: nowISO(),
      ip: `192.168.0.${40 + index}`,
      browser: 'Chrome 141',
      capabilities: ['브라우저', '다중 창', '오프라인 저장'],
      hardwareId: `DRAFT-${index + 1}`,
      startOffset: assets.length ? mod(index, assets.length) : 0,
      step: 1,
      ...slots[index]
    }));
    return {
      id: 'wizard-preview', letter: 'C', name: wizard.siteName || '새 인포메이션센터', location: wizard.location || '1층 로비',
      hours: wizard.hours || '09:00 — 18:00', displays, layoutType: wizard.layoutType, mode: wizard.mode,
      playlistIds: assets.map((asset) => asset.id), durations: { ...(wizard.durations || {}) },
      fallbackAssetId: wizard.fallbackAssetId || 'img-closure',
      publishedVersion: 1, lastPublishedAt: null, pending: [], publications: []
    };
  }

  function layoutDiagram(type, count) {
    const effective = type === 'custom' ? 'grid' : type;
    const rects = makeSlots(Math.max(count, 1), effective);
    return `<svg class="mini-diagram" viewBox="0 0 100 46" preserveAspectRatio="none" aria-hidden="true">${rects.map((rect) => `<rect class="accent" x="${(rect.x * 96 + 2).toFixed(1)}" y="${(rect.y * 42 + 2).toFixed(1)}" width="${(rect.w * 96).toFixed(1)}" height="${(rect.h * 42).toFixed(1)}" rx="1"/>`).join('')}</svg>`;
  }

  function wizardStepButton(index) {
    const wizard = state.wizard;
    const current = wizard.step;
    const done = index < wizard.maxStep && index !== current;
    const enabled = index <= wizard.maxStep;
    return `<li class="step ${index === current ? 'is-current' : done ? 'is-done' : ''}">
      <button class="step__btn" type="button" data-action="wizard-goto" data-step="${index}" ${enabled ? '' : 'disabled'} ${index === current ? 'aria-current="step"' : ''}><span class="step__line"></span><span class="step__label"><span class="step__num">${done ? icon('check', 'icon--sm') : index}</span><span class="step__text">${WIZARD_STEPS[index - 1]}</span></span></button>
    </li>`;
  }

  function wizardErrorSummary() {
    if (!ui.wizardErrors.length) return '';
    return `<div class="error-summary" role="alert" tabindex="-1" id="wizard-error-summary"><div class="error-summary__title">${icon('alert')}입력을 확인해 주세요.</div><ul>${ui.wizardErrors.map((error) => `<li><button class="text-link" type="button" data-action="focus-field" data-target="${error.href}">${escapeHTML(error.message)}</button></li>`).join('')}</ul></div>`;
  }

  function renderWizardPage() {
    if (!state.wizard) {
      return `<div class="page"><header class="page-head"><div class="page-head__copy"><p class="eyebrow">첫 게시</p><h1 id="page-title">초안이 없습니다.</h1><p class="page-subtitle">첫 장소 만들기로 여섯 단계를 시작하세요.</p></div></header><section class="empty-state"><div class="empty-state__mark">${icon('site')}</div><h2>새 장소를 함께 준비해 볼까요?</h2><p>장소 이름부터 화면, 이미지, 재생 순서, 게시까지 차례대로 안내합니다.</p><div class="empty-state__actions"><button class="btn btn--primary" type="button" data-action="start-wizard">첫 장소 만들기</button><a class="btn btn--secondary" href="#/dashboard">홈으로</a></div></section></div>`;
    }
    const wizard = state.wizard;
    wizard.step = clamp(wizard.step || 1, 1, 6);
    wizard.maxStep = clamp(wizard.maxStep || 1, wizard.step, 6);
    const site = wizardPreviewSite();
    const warnings = siteWarnings(site);
    const stepContent = [renderWizardSiteStep, renderWizardDisplayStep, renderWizardLayoutStep, renderWizardImageStep, renderWizardPlaybackStep, renderWizardPreviewStep][wizard.step - 1](site, warnings);
    return `<div class="page wizard-shell">
      <header class="page-head">
        <div class="page-head__copy"><p class="eyebrow">첫 게시 준비 · ${wizard.step}/6</p><h1 id="page-title">처음 설정을 도와드릴게요</h1><p class="page-subtitle">한 단계에 한 가지 결정만 합니다. 언제든 초안을 저장하고 나중에 이어서 할 수 있어요.</p></div>
        <div class="head-actions"><button class="btn btn--secondary" type="button" data-action="save-wizard">${icon('save')}초안 저장</button><a class="btn btn--ghost" href="#/dashboard">나가기</a></div>
      </header>
      <section class="card wizard-top" aria-label="설정 진행률">
        <div class="wizard-top__head"><div><div class="wizard-top__title">${escapeHTML(wizard.siteName || '새 장소')}</div><div class="wizard-top__meta">${wizard.displayCount}대 화면 · ${wizardSelectedAssets().length}장 이미지 · ${modeLabel(wizard.mode)} · 저장됨 ${relativeTime(wizard.updatedAt)}</div></div><span class="chip chip--celadon">초안 자동 저장</span></div>
        <ol class="steps">${WIZARD_STEPS.map((label, index) => wizardStepButton(index + 1)).join('')}</ol>
      </section>
      <section class="card wizard-card" aria-labelledby="wizard-step-title">
        <div class="wizard-card__inner">${wizardErrorSummary()}${stepContent}</div>
        <div class="wizard-card__footer">
          <div class="wizard-footer__left"><button class="btn btn--sm btn--ghost" type="button" data-action="discard-wizard">${icon('trash', 'icon--sm')}초안 버리기</button><span class="tiny muted">변경 내용은 이 브라우저에 저장됩니다.</span></div>
          <div class="wizard-footer__right"><button class="btn btn--secondary" type="button" data-action="wizard-prev" ${wizard.step === 1 ? 'disabled' : ''}>이전</button>${wizard.step < 6 ? `<button class="btn btn--primary" type="button" data-action="wizard-next">다음 단계${icon('arrow-right')}</button>` : `<button class="btn btn--celadon" type="button" data-action="wizard-publish">${icon('send')}이대로 게시</button>`}</div>
        </div>
      </section>
    </div>`;
  }

  function wizardHeader(kicker, title, lead) {
    return `<p class="step-kicker">${escapeHTML(kicker)}</p><h2 class="wizard-h2" id="wizard-step-title">${escapeHTML(title)}</h2><p class="wizard-lead">${escapeHTML(lead)}</p>`;
  }

  function renderWizardSiteStep() {
    const wizard = state.wizard;
    const fieldError = ui.wizardErrors.find((error) => error.field === 'siteName');
    return `${wizardHeader('1단계 · 장소', '어느 곳의 화면을 관리할까요?', '장소 이름은 대시보드와 화면 상단에 표시됩니다. 나중에 바꿀 수 있습니다.')}
      <div class="wizard-section">
        <div class="field"><label class="field__label" for="wizard-site-name">장소 이름 <span class="optional">(필수)</span></label><input class="input" id="wizard-site-name" data-wizard-field="siteName" value="${escapeAttr(wizard.siteName)}" maxlength="40" placeholder="예: C 안내센터" aria-describedby="wizard-site-name-help${fieldError ? ' wizard-site-name-error' : ''}" ${fieldError ? 'aria-invalid="true"' : ''}><span class="field__help" id="wizard-site-name-help">직원들이 알아보기 쉬운 이름으로 적어 주세요. 예: A 인포메이션센터</span>${fieldError ? `<span class="field__error" id="wizard-site-name-error">${escapeHTML(fieldError.message)}</span>` : ''}</div>
        <div class="wizard-form-row"><div class="field"><label class="field__label" for="wizard-location">위치 <span class="optional">(선택)</span></label><input class="input" id="wizard-location" data-wizard-field="location" value="${escapeAttr(wizard.location)}" maxlength="40"></div><div class="field"><label class="field__label" for="wizard-hours">운영 시간 <span class="optional">(선택)</span></label><input class="input" id="wizard-hours" data-wizard-field="hours" value="${escapeAttr(wizard.hours)}" maxlength="30"></div></div>
      </div>
      <div class="wizard-note">${icon('info', 'icon--sm')}<span>이 장소만의 화면 배치와 재생 순서를 따로 관리합니다. 다른 장소의 설정은 바뀌지 않습니다.</span></div>`;
  }

  function renderWizardDisplayStep() {
    const wizard = state.wizard;
    const found = Array.from({ length: wizard.displayCount }, (_, index) => ({ name: DISPLAY_NAMES[index % DISPLAY_NAMES.length], code: String(482913 + index * 31) }));
    return `${wizardHeader('2단계 · 화면', '화면은 몇 대인가요?', '모니터 수는 나중에도 늘리거나 줄일 수 있습니다. 지금 연결할 화면 수를 먼저 정해 주세요.')}
      <div class="wizard-section"><div class="choice-grid choice-grid--3" role="radiogroup" aria-label="화면 수">${[1, 4, 6].map((count) => `<label class="choice-card"><input type="radio" name="wizard-display-count" value="${count}" data-wizard-choice="displayCount" ${wizard.displayCount === count ? 'checked' : ''}><span class="choice-card__inner"><span class="choice-card__num">${count}</span><span class="choice-card__name">${count}대</span><span class="choice-card__desc">${count === 1 ? '한 화면으로 시작' : count === 4 ? '2×2 격자에 알맞음' : '3×2 격자에 알맞음'}</span><span class="mini-diagram" style="height:42px">${layoutDiagram(count === 1 ? 'single' : 'grid', count)}</span></span></label>`).join('')}</div></div>
      <div class="wizard-section"><h3 style="font-size:.86rem;color:var(--ink-soft)">같은 네트워크에서 찾은 화면</h3><div class="found-displays">${found.map((device, index) => `<span class="found-display"><span class="status-dot"></span>${escapeHTML(device.name)} <span class="muted">· ${device.code}</span></span>`).join('')}</div><p class="field__help" style="margin-top:8px">프로토타입에서는 위 화면을 이미 찾은 것으로 가정합니다. 실제 연결은 ‘화면 등록’에서 자동 찾기, 6자리 코드, 링크 중 하나로 진행합니다.</p></div>
      <div class="wizard-note">${icon('monitor-add', 'icon--sm')}<span>새 화면의 이름과 방향은 다음 단계와 등록 화면에서 조정할 수 있습니다. 승인 전에는 ‘대기’ 상태로 표시됩니다.</span></div>`;
  }

  function renderWizardLayoutStep() {
    const wizard = state.wizard;
    const resolutions = wizard.orientation === 'portrait' ? ['1080×1920', '1440×2560', '720×1280'] : ['1920×1080', '2560×1440', '1280×720'];
    if (!resolutions.includes(wizard.resolution)) wizard.resolution = resolutions[0];
    const site = wizardPreviewSite();
    return `${wizardHeader('3단계 · 배치', '화면을 어떻게 놓을까요?', '자주 쓰는 배치를 고르면 화면 위치가 자동으로 잡힙니다. 직접 배치는 장소 화면에서 세밀하게 조정할 수 있습니다.')}
      <div class="wizard-section"><div class="choice-grid choice-grid--5" role="radiogroup" aria-label="배치 방식">${Object.entries(LAYOUTS).map(([key, layout]) => `<label class="choice-card"><input type="radio" name="wizard-layout" value="${key}" data-wizard-choice="layoutType" ${wizard.layoutType === key ? 'checked' : ''} ${key === 'single' && wizard.displayCount !== 1 ? 'disabled' : ''}><span class="choice-card__inner"><span class="choice-card__name">${layout.name}</span><span class="choice-card__desc">${key === 'single' && wizard.displayCount !== 1 ? '화면이 1대일 때' : layout.desc}</span>${layoutDiagram(key, wizard.displayCount)}</span></label>`).join('')}</div></div>
      <div class="wizard-form-row" style="grid-template-columns:1fr 1fr"><div class="field"><label class="field__label" for="wizard-orientation">화면 방향</label><select class="select" id="wizard-orientation" data-wizard-select="orientation"><option value="landscape" ${wizard.orientation === 'landscape' ? 'selected' : ''}>가로 방향</option><option value="portrait" ${wizard.orientation === 'portrait' ? 'selected' : ''}>세로 방향</option></select></div><div class="field"><label class="field__label" for="wizard-resolution">해상도</label><select class="select" id="wizard-resolution" data-wizard-select="resolution">${resolutions.map((resolution) => `<option value="${resolution}" ${wizard.resolution === resolution ? 'selected' : ''}>${resolution.replace('×', ' × ')}</option>`).join('')}</select></div></div>
      <div class="wizard-section"><div class="section-head" style="margin:0 0 8px"><div><h3 style="font-size:.86rem">배치 미리보기</h3></div><span class="chip">${wizard.displayCount}대 · ${LAYOUTS[wizard.layoutType].name}</span></div><div class="mini-stage" style="max-width:560px">${site.displays.map((display) => `<div class="mini-monitor" style="${layoutRectStyle(display)};background:#29495e"><span style="position:absolute;inset:0;display:grid;place-items:center;color:#dbe9e2;font-size:.62rem">${escapeHTML(display.name)}</span></div>`).join('')}</div></div>`;
  }

  function renderWizardImageStep() {
    const wizard = state.wizard;
    const selected = new Set(wizard.selectedAssetIds);
    const site = wizardPreviewSite();
    const targetAspect = displayAspect(siteTargetDisplay(site));
    const mismatch = wizardSelectedAssets().filter((asset) => aspectMismatch(asset, targetAspect)).length;
    const fieldError = ui.wizardErrors.find((error) => error.field === 'images');
    return `${wizardHeader('4단계 · 이미지', '어떤 이미지를 보여 줄까요?', '보관함에서 고르거나 새 파일을 올릴 수 있습니다. 한 장 이상 골라 주세요.')}
      <div class="wizard-section">
        ${state.assets.length ? `<div class="sample-grid">${state.assets.map((asset, index) => `<label class="sample-card"><input type="checkbox" name="wizard-asset" value="${asset.id}" data-wizard-asset ${selected.has(asset.id) ? 'checked' : ''} ${index === 0 ? 'id="wizard-first-image"' : ''}><span class="sample-card__inner"><span class="sample-card__thumb"><img src="${escapeAttr(asset.dataUrl)}" alt=""><span class="sample-card__check">${icon('check', 'icon--sm')}</span></span><span class="sample-card__name">${escapeHTML(asset.title)}</span></span></label>`).join('')}</div>` : `<div class="empty-inline">보관함에 이미지가 없습니다. 아래에서 먼저 이미지를 올려 주세요.</div>`}
        ${fieldError ? `<div class="field__error" style="margin-top:9px">${escapeHTML(fieldError.message)}</div>` : ''}
        <div class="wizard-upload" id="wizard-upload-zone"><label class="upload-zone" for="wizard-upload"><input type="file" id="wizard-upload" accept="image/jpeg,image/png,image/webp" multiple aria-label="이미지 파일 올리기"><span class="upload-zone__icon">${icon('upload', 'icon--sm')}</span><span><strong style="display:block;font-size:.82rem">이미지 파일 올리기</strong><span class="tiny muted">JPEG · PNG · WebP · 8MB까지</span></span></label></div>
        <div class="section-head" style="margin:14px 0 6px"><div class="small muted"><strong style="color:var(--navy-900)">${wizardSelectedAssets().length}장</strong> 선택됨${mismatch ? ` · <span style="color:var(--vermilion-dark);font-weight:700">비율 확인 ${mismatch}장</span>` : ''}</div><a class="text-link" href="#/library">보관함에서 관리하기 ${icon('arrow-right', 'icon--sm')}</a></div>
        ${mismatch ? `<div class="wizard-note wizard-note--amber">${icon('alert', 'icon--sm')}<span>선택한 화면 방향과 비율이 다른 이미지가 ${mismatch}장 있습니다. 게시는 가능하지만 미리보기에서 여백이나 잘림을 확인해 주세요.</span></div>` : ''}
      </div>`;
  }

  function renderWizardPlaybackStep() {
    const wizard = state.wizard;
    const assets = wizardSelectedAssets();
    return `${wizardHeader('5단계 · 재생', '이미지를 어떤 순서로 보여 줄까요?', '재생 방식을 고르고 이미지 순서와 표시 시간을 정하세요. 화면별 세부 위치는 나중에 재생 화면에서 조정할 수 있습니다.')}
      <div class="wizard-section"><div class="mode-grid" role="radiogroup" aria-label="재생 방식">${Object.entries(MODES).map(([key, mode]) => `<label class="mode-card"><input type="radio" name="wizard-mode" value="${key}" data-wizard-choice="mode" ${wizard.mode === key ? 'checked' : ''}><span class="mode-card__inner"><span class="mode-card__top"><span class="mode-card__name">${mode.name}</span><span class="mode-card__radio" aria-hidden="true"></span></span>${modeGlyph(key)}<span class="mode-card__desc">${mode.desc}</span></span></label>`).join('')}</div></div>
      <div class="wizard-section"><div class="section-head" style="margin-top:0"><div><h3 style="font-size:.9rem">이미지 순서</h3><p class="small muted">위아래 버튼으로 순서를 바꾸세요.</p></div><span class="chip">${assets.length}장 · 총 ${assets.reduce((total, asset) => total + Number(wizard.durations?.[asset.id] ?? 8), 0)}초</span></div>
        <div class="wizard-order">${assets.length ? assets.map((asset, index) => `<div class="wizard-order__row"><span class="playlist-row__order">${index + 1}</span><img src="${escapeAttr(asset.dataUrl)}" alt=""><span>${escapeHTML(asset.title)}</span><div class="wizard-order__buttons"><label class="duration-field" style="margin-right:6px"><span class="sr-only">${escapeHTML(asset.title)} 표시 시간</span><input class="input" type="number" min="0" max="120" step="1" value="${escapeAttr(wizard.durations?.[asset.id] ?? 8)}" data-wizard-duration="${asset.id}" aria-label="${escapeAttr(asset.title)} 표시 시간, 초"><span>초</span></label><button class="icon-btn" type="button" data-action="wizard-move-up" data-image-id="${asset.id}" aria-label="${escapeAttr(asset.title)} 위로 이동" ${index === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button><button class="icon-btn" type="button" data-action="wizard-move-down" data-image-id="${asset.id}" aria-label="${escapeAttr(asset.title)} 아래로 이동" ${index === assets.length - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button></div></div>`).join('') : `<div class="empty-inline">4단계에서 이미지를 먼저 골라 주세요.</div>`}</div></div>
      <div class="wizard-section" style="margin-top:20px"><div class="wizard-form-row" style="grid-template-columns:minmax(0,1fr) 200px;align-items:end"><div><h3 style="font-size:.9rem;margin-bottom:4px">비상 이미지</h3><p class="small muted">이미지를 불러오지 못하거나 화면에 오류가 날 때 대신 보여 줄 이미지입니다.</p></div><div class="field"><label class="field__label" for="wizard-fallback">비상 이미지 선택</label><select class="select" id="wizard-fallback" data-wizard-select="fallbackAssetId">${state.assets.map((asset) => `<option value="${asset.id}" ${asset.id === wizard.fallbackAssetId ? 'selected' : ''}>${escapeHTML(asset.title)}</option>`).join('')}</select></div></div></div>
      <div class="wizard-note">${icon('sliders', 'icon--sm')}<span>화면마다 시작 위치와 이동 방향을 다르게 두는 세부 설정은 재생 화면에서 할 수 있습니다.</span></div>`;
  }

  function renderWizardPreviewStep(site, warnings) {
    const wizard = state.wizard;
    const resolved = resolveSiteAt(site, 0);
    const entries = playlistEntries(site);
    return `${wizardHeader('6단계 · 미리보기', '이대로 게시할 준비가 되었나요?', '가상 모니터에서 배치와 첫 이미지를 확인하세요. 게시하면 이 장소가 대시보드에 추가됩니다.')}
      <div class="wizard-preview">
        <div><div class="preview-canvas" aria-label="새 장소 가상 미리보기">${site.displays.length ? resolved.perDisplay.map((item) => previewMonitor(site, item.display, item.entry)).join('') : '<div class="empty-inline" style="position:absolute;inset:12px">화면이 없습니다.</div>'}</div><p class="field__help" style="margin-top:8px">정지 화면 미리보기입니다. 재생 순서는 재생 화면에서 확인할 수 있습니다.</p></div>
        <div class="wizard-summary">
          <div class="wizard-summary__row"><span>장소</span><strong>${escapeHTML(wizard.siteName || '이름 없음')}</strong></div>
          <div class="wizard-summary__row"><span>화면</span><strong>${wizard.displayCount}대 · ${layoutName(wizard.layoutType)}</strong></div>
          <div class="wizard-summary__row"><span>이미지</span><strong>${entries.length}장</strong></div>
          <div class="wizard-summary__row"><span>재생 방식</span><strong>${modeLabel(wizard.mode)}</strong></div>
          <div class="wizard-summary__row"><span>비상 이미지</span><strong>${escapeHTML(fallbackAsset(site)?.title || '아직 없음')}</strong></div>
          <div class="wizard-summary__row"><span>첫 게시 버전</span><strong>버전 1</strong></div>
          <div class="warning-list" style="padding:0">${warnings.length ? warnings.slice(0, 4).map((warning) => warningRow(warning, false)).join('') : `<div class="warning-row warning-row--info">${icon('check-circle')}<div><strong>확인할 경고가 없습니다.</strong><br>게시 준비가 끝났습니다.</div></div>`}</div>
        </div>
      </div>
      <div class="wizard-note">${icon('info', 'icon--sm')}<span>게시 후에도 장소 화면에서 배치와 이미지를 바꿀 수 있습니다. 버전이 바뀌어도 이전 게시 이력은 남습니다.</span></div>`;
  }

  function layoutName(type) {
    return LAYOUTS[type]?.name || type;
  }

  function validateWizardStep(step = state.wizard?.step) {
    const wizard = state.wizard;
    if (!wizard) return [];
    const errors = [];
    if (step >= 1 && !String(wizard.siteName || '').trim()) {
      errors.push({ field: 'siteName', message: '장소 이름을 입력해 주세요.', href: '#wizard-site-name' });
    }
    if (step >= 2 && ![1, 4, 6].includes(Number(wizard.displayCount))) {
      errors.push({ field: 'displayCount', message: '화면 수를 1대, 4대, 6대 중에서 골라 주세요.', href: '#wizard-display-count' });
    }
    if (step >= 4 && !wizardSelectedAssets().length) {
      errors.push({ field: 'images', message: '보여 줄 이미지를 한 장 이상 골라 주세요.', href: '#wizard-first-image' });
    }
    return errors;
  }

  function wizardNext() {
    const wizard = state.wizard;
    if (!wizard) return;
    const errors = validateWizardStep(wizard.step);
    if (errors.length) {
      ui.wizardErrors = errors;
      announce(errors[0].message, 'error');
      render();
      ui.focusAfterRender = errors[0].href;
      return;
    }
    ui.wizardErrors = [];
    wizard.step = clamp(wizard.step + 1, 1, 6);
    wizard.maxStep = Math.max(wizard.maxStep, wizard.step);
    wizard.updatedAt = nowISO();
    saveState();
    render({ focusHeading: true });
  }

  function wizardPrev() {
    if (!state.wizard) return;
    ui.wizardErrors = [];
    state.wizard.step = clamp(state.wizard.step - 1, 1, 6);
    saveState();
    render({ focusHeading: true });
  }

  function wizardGoto(step) {
    if (!state.wizard) return;
    const target = Number(step);
    if (target < 1 || target > state.wizard.maxStep) return;
    state.wizard.step = target;
    ui.wizardErrors = [];
    saveState();
    render({ focusHeading: true });
  }

  function wizardMove(imageId, direction) {
    const wizard = state.wizard;
    if (!wizard) return;
    const index = wizard.selectedAssetIds.indexOf(imageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= wizard.selectedAssetIds.length) return;
    [wizard.selectedAssetIds[index], wizard.selectedAssetIds[target]] = [wizard.selectedAssetIds[target], wizard.selectedAssetIds[index]];
    wizard.updatedAt = nowISO();
    saveState();
    ui.focusAfterRender = `button[data-action="${direction < 0 ? 'wizard-move-up' : 'wizard-move-down'}"][data-image-id="${imageId}"]`;
    render();
  }

  function openWizardPublishModal() {
    const wizard = state.wizard;
    if (!wizard) return;
    const errors = validateWizardStep(6);
    if (errors.length) {
      ui.wizardErrors = errors;
      wizard.step = errors[0].field === 'images' ? 4 : 1;
      wizard.maxStep = Math.max(wizard.maxStep, wizard.step);
      saveState();
      announce(errors[0].message, 'error');
      render();
      ui.focusAfterRender = errors[0].href;
      return;
    }
    const site = wizardPreviewSite();
    const warnings = siteWarnings(site);
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">첫 게시를 시작할까요?</h2><p class="modal__sub">${escapeHTML(wizard.siteName)} · 버전 1</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body">
        ${warnings.length ? `<div class="confirm-callout">${icon('alert')}<div><strong>게시 전에 확인할 내용이 ${warnings.length}개 있습니다.</strong><br>${escapeHTML(warnings[0].title)}</div></div>` : `<div class="confirm-callout confirm-callout--info">${icon('check-circle')}<div><strong>모든 준비가 끝났습니다.</strong><br>확인을 누르면 장소가 대시보드에 추가됩니다.</div></div>`}
        <div class="confirm-meta"><div><span>장소</span><strong>${escapeHTML(wizard.siteName)}</strong></div><div><span>화면·배치</span><strong>${wizard.displayCount}대 · ${layoutName(wizard.layoutType)}</strong></div><div><span>이미지</span><strong>${wizardSelectedAssets().length}장 · ${modeLabel(wizard.mode)}</strong></div><div><span>비상 이미지</span><strong>${escapeHTML(fallbackAsset(site)?.title || '없음')}</strong></div><div><span>게시자</span><strong>김하늘</strong></div></div>
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">취소</button><button class="btn btn--celadon" type="button" data-action="wizard-confirm-publish">${icon('send')}첫 게시 시작</button></div>`;
    openModal(dialog, { label: '첫 게시 확인' });
  }

  function publishWizardSite() {
    const wizard = state.wizard;
    if (!wizard) return;
    const draftSite = wizardPreviewSite();
    const id = uid('site');
    const displays = draftSite.displays.map((display, index) => ({
      ...deepClone(display), id: `${id}-d${index + 1}`,
      hardwareId: `GUK-${String(index + 1).padStart(2, '0')}-NEW`, status: 'online', lastSeen: nowISO()
    }));
    const site = {
      id, letter: state.sites.length < 26 ? String.fromCharCode(65 + state.sites.length) : '새', name: wizard.siteName.trim(), location: wizard.location || '1층 로비', hours: wizard.hours || '09:00 — 18:00',
      displays, layoutType: wizard.layoutType, mode: wizard.mode,
      playlistIds: wizardSelectedAssets().map((asset) => asset.id),
      durations: { ...(wizard.durations || {}) },
      fallbackAssetId: wizard.fallbackAssetId || wizardSelectedAssets()[0]?.id || 'img-closure',
      publishedVersion: 1, lastPublishedAt: nowISO(), pending: [],
      publications: [{ version: 1, at: nowISO(), actor: '김하늘', mode: wizard.mode, imageCount: wizardSelectedAssets().length, displayCount: wizard.displayCount, note: '첫 게시' }],
      notes: ''
    };
    autoOffsets(site);
    state.sites.push(site);
    state.activeSiteId = site.id;
    state.wizard = null;
    addActivity(`${site.name}의 첫 게시를 완료했습니다.`, 'publish', site.id);
    saveState();
    closeModal();
    announce('첫 게시를 완료했습니다. 대시보드에 새 장소가 추가되었습니다.');
    goTo('#/dashboard');
  }

  function discardWizard() {
    if (!state.wizard) return;
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">초안을 버릴까요?</h2><p class="modal__sub">저장한 단계와 입력 내용이 사라집니다.</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body"><div class="confirm-callout">${icon('alert')}<div><strong>되돌릴 수 없습니다.</strong><br>${escapeHTML(state.wizard.siteName || '새 장소')} 설정을 다시 처음부터 시작하게 됩니다.</div></div></div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">계속 작성</button><button class="btn btn--danger" type="button" data-action="confirm-discard-wizard">초안 버리기</button></div>`;
    openModal(dialog, { label: '초안 버리기 확인' });
  }

  function confirmDiscardWizard() {
    state.wizard = null;
    saveState();
    closeModal();
    announce('초안을 버렸습니다.');
    goTo('#/dashboard');
  }

  async function handleWizardFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !state.wizard) return;
    const accepted = ['image/jpeg', 'image/png', 'image/webp'];
    let added = 0;
    const errors = [];
    for (const file of files) {
      if (!accepted.includes(file.type) || file.size > 8 * 1024 * 1024) {
        errors.push(`${file.name}: JPEG, PNG, WebP 파일 8MB 이하만 올릴 수 있습니다.`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataURL(file);
        const dimensions = await imageDimensions(dataUrl);
        const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || '새 이미지';
        const asset = {
          id: uid('img'), title, filename: file.name, width: dimensions.width, height: dimensions.height,
          size: file.size, mime: file.type, dataUrl, createdAt: nowISO(), sample: false,
          kind: dimensions.height > dimensions.width ? 'portrait' : 'landscape', alt: title, uploaded: true
        };
        state.assets.unshift(asset);
        if (!state.wizard.selectedAssetIds.includes(asset.id)) state.wizard.selectedAssetIds.push(asset.id);
        if (!state.wizard.durations) state.wizard.durations = {};
        state.wizard.durations[asset.id] = 8;
        added += 1;
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    state.wizard.updatedAt = nowISO();
    saveState();
    render();
    announce(added ? `이미지 ${added}장을 올리고 선택했습니다.${errors.length ? ` ${errors.join(' ')}` : ''}` : errors.join(' ') || '이미지를 올리지 못했습니다.', added ? 'success' : 'error');
  }

  function initWizardUpload() {
    const input = document.getElementById('wizard-upload');
    if (!input) return;
    input.addEventListener('change', () => {
      handleWizardFiles(input.files);
      input.value = '';
    });
  }

  /* ---------- modals, scenario drawer, help ---------- */

  function openModal(contentHTML, options = {}) {
    if (modalState.open) {
      modalRoot.innerHTML = '';
      document.body.classList.remove('modal-open');
    } else {
      modalState.previousFocus = document.activeElement;
    }
    let content = contentHTML;
    if (content.trim().startsWith('<form')) {
      content = content.replace('<form', '<form class="modal__form"');
    }
    const classes = ['modal', options.wide ? 'modal--wide' : '', options.drawer ? 'modal--drawer' : ''].filter(Boolean).join(' ');
    modalRoot.innerHTML = `<div class="modal-backdrop ${options.drawer ? 'modal-backdrop--drawer' : ''}" id="modal-backdrop" data-modal-backdrop>
      <section class="${classes}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${content}</section>
    </div>`;
    document.body.classList.add('modal-open');
    modalState.open = true;
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) closeModal();
      });
    }
    window.requestAnimationFrame(() => {
      const dialog = modalRoot.querySelector('.modal');
      if (!dialog) return;
      const initial = dialog.querySelector('[data-autofocus]') || dialog.querySelector('input:not([type="hidden"]), select, textarea') || dialog.querySelector('.modal__actions .btn--primary, .modal__actions .btn--celadon') || dialog.querySelector('button, a[href]');
      if (initial) initial.focus();
      else dialog.focus();
    });
  }

  function closeModal() {
    if (!modalState.open) return;
    modalRoot.innerHTML = '';
    document.body.classList.remove('modal-open');
    modalState.open = false;
    const previous = modalState.previousFocus;
    modalState.previousFocus = null;
    if (previous && previous.isConnected) {
      previous.focus();
    } else {
      const main = document.getElementById('main');
      if (main) main.focus({ preventScroll: true });
    }
  }

  function openScenarioDrawer() {
    const scenarioSite = siteById('site-a') || activeSite();
    const siteCount = state.sites.length ? 2 : 0;
    const displayCount = scenarioSite?.displays.length || state.scenario.displays || 4;
    const imageCount = scenarioSite?.playlistIds.length ?? state.scenario.images ?? 3;
    const mode = scenarioSite?.mode || state.scenario.mode || 'cycle';
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">시나리오 둘러보기</h2><p class="modal__sub">화면 수, 이미지 수, 재생 방식을 바꿔 보세요.</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body" style="padding:0">
        <div class="drawer-section"><h3>장소</h3><div class="drawer-options drawer-options--2"><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="sites" data-value="2" aria-pressed="${siteCount === 2}">장소 2곳</button><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="sites" data-value="0" aria-pressed="${siteCount === 0}">빈 상태</button></div><p class="drawer-note">빈 상태는 첫 장소를 만들기 전 화면을 확인할 때 유용합니다.</p></div>
        <div class="drawer-section"><h3>화면 수 <span class="muted">· A센터 기준</span></h3><div class="drawer-options"><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="displays" data-value="1" aria-pressed="${displayCount === 1}">1대</button><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="displays" data-value="4" aria-pressed="${displayCount === 4}">4대</button><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="displays" data-value="6" aria-pressed="${displayCount === 6}">6대</button></div><p class="drawer-note">B 인포메이션센터는 2대 그대로 유지됩니다.</p></div>
        <div class="drawer-section"><h3>재생 이미지</h3><div class="drawer-options"><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="images" data-value="0" aria-pressed="${imageCount === 0}">0장</button><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="images" data-value="1" aria-pressed="${imageCount === 1}">1장</button><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="images" data-value="3" aria-pressed="${imageCount === 3}">3장</button><button class="drawer-option" type="button" data-action="apply-scenario" data-kind="images" data-value="8" aria-pressed="${imageCount === 8}">8장</button></div><p class="drawer-note">보관함에는 샘플 8장이 남아 있고, 선택한 수만큼 재생 순서에 들어갑니다.</p></div>
        <div class="drawer-section"><h3>재생 방식 <span class="muted">· A센터</span></h3><div class="drawer-options drawer-options--2">${Object.entries(MODES).map(([key, item]) => `<button class="drawer-option" type="button" data-action="apply-scenario" data-kind="mode" data-value="${key}" aria-pressed="${mode === key}">${item.name}</button>`).join('')}</div></div>
        <div class="drawer-section"><div class="wizard-note wizard-note--amber" style="margin:0">${icon('alert', 'icon--sm')}<span>시나리오를 바꾸면 장소, 화면, 재생 순서가 모의 초기값으로 돌아갑니다. 올린 이미지와 초안은 지워집니다.</span></div></div>
      </div>
      <div class="drawer-actions"><button class="btn btn--secondary btn--block" type="button" data-action="scenario-reset">${icon('refresh')}처음 상태로 돌아가기</button><button class="btn btn--ghost btn--block" type="button" data-action="close-modal">닫기</button></div>`;
    openModal(dialog, { label: '시나리오 둘러보기', drawer: true });
  }

  function applyScenario(kind, value) {
    const scenarioSite = siteById('site-a') || activeSite();
    const current = {
      sites: state.sites.length ? 2 : 0,
      displays: scenarioSite?.displays.length || state.scenario.displays || 4,
      images: scenarioSite?.playlistIds.length ?? state.scenario.images ?? 3,
      mode: scenarioSite?.mode || state.scenario.mode || 'cycle'
    };
    if (kind === 'sites') current.sites = Number(value);
    if (kind === 'displays') current.displays = Number(value);
    if (kind === 'images') current.images = Number(value);
    if (kind === 'mode') current.mode = value;
    if (current.sites === 0) {
      state = buildDefaultState({ sites: 0, displays: current.displays, images: current.images, mode: current.mode });
    } else {
      if (![1, 4, 6].includes(current.displays)) current.displays = 4;
      if (![0, 1, 3, 8].includes(current.images)) current.images = 3;
      state = buildDefaultState({ sites: 2, displays: current.displays, images: current.images, mode: current.mode });
    }
    state.scenario = current;
    ui.tab = 'layout';
    ui.statusFilter = 'all';
    ui.registrationError = '';
    ui.manualCode = '';
    ui.uploadMessage = '';
    ui.layoutHistory.clear();
    ui.selectedDisplayId = null;
    saveState();
    closeModal();
    const hash = location.hash || '#/dashboard';
    if (hash !== '#/dashboard') location.hash = '#/dashboard';
    else render({ focusHeading: true });
    announce('시나리오를 적용했습니다. 화면 수와 이미지 수가 새로 바뀌었습니다.');
  }

  function resetScenario() {
    state = buildDefaultState({ sites: 2, displays: 4, images: 3, mode: 'cycle' });
    state.scenario = { sites: 2, displays: 4, images: 3, mode: 'cycle' };
    ui.tab = 'layout';
    ui.statusFilter = 'all';
    ui.registrationError = '';
    ui.manualCode = '';
    ui.uploadMessage = '';
    ui.layoutHistory.clear();
    ui.selectedDisplayId = null;
    saveState();
    closeModal();
    if (location.hash !== '#/dashboard') location.hash = '#/dashboard';
    else render({ focusHeading: true });
    announce('기본 시나리오로 돌아왔습니다.');
  }

  function openHelpModal() {
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">이 프로토타입 사용법</h2><p class="modal__sub">의사결정과 사용성 테스트를 위한 작동형 화면입니다.</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body">
        <div class="status-cause status-cause--ok">${icon('info')}<div><strong>먼저 둘러보기</strong>오른쪽 위 ‘시나리오’에서 장소 2곳, 화면 1·4·6대, 이미지 0·1·3·8장, 네 가지 재생 방식을 바꿀 수 있습니다. 첫 사용 흐름은 홈의 ‘새 장소 만들기’에서 시작합니다.</div></div>
        <h3 style="font-size:.88rem;margin:18px 0 9px">키보드로 하기</h3>
        <ul class="help-list">
          <li><strong><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd></strong><span>버튼과 입력란 사이를 이동합니다.</span></li>
          <li><strong><kbd>ESC</kbd></strong><span>열린 창을 닫고 원래 자리로 돌아갑니다.</span></li>
          <li><strong><kbd>방향키</kbd></strong><span>배치판에서 선택한 화면을 조금씩 옮깁니다. <kbd>Shift</kbd>를 함께 누르면 크게 이동합니다.</span></li>
          <li><strong><kbd>Alt</kbd>+<kbd>방향키</kbd></strong><span>선택한 화면의 가로·세로 크기를 바꿉니다.</span></li>
          <li><strong>위·아래 버튼</strong><span>이미지 순서를 끌지 않고 바꿀 수 있습니다.</span></li>
        </ul>
        <p class="field__help" style="margin-top:18px">저장한 내용은 이 브라우저의 저장 공간에만 남습니다. 새로 고침하거나 같은 브라우저로 다시 열면 이어서 볼 수 있습니다. 실제 서버나 화면에는 아무것도 전송되지 않습니다.</p>
      </div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">닫기</button><button class="btn btn--primary" type="button" data-action="scenario-reset">${icon('refresh')}처음 상태로</button></div>`;
    openModal(dialog, { label: '도움말' });
  }

  function openRemoveDisplayModal(displayId) {
    const site = activeSite();
    const display = displayById(site, displayId);
    if (!site || !display) return;
    const last = site.displays.length === 1;
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">${escapeHTML(display.name)}을 연결 해제할까요?</h2><p class="modal__sub">${escapeHTML(site.name)} 배치에서 이 화면을 뺍니다.</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body"><div class="confirm-callout">${icon('alert')}<div><strong>배치가 다시 정리됩니다.</strong><br>${last ? '마지막 남은 화면입니다. 연결을 해제하면 이 장소는 이미지를 보여 줄 화면이 없게 됩니다.' : `남은 화면 ${site.displays.length - 1}대의 위치가 자동으로 다시 정리됩니다. 실제 화면 기기 자체는 꺼지지 않습니다.`}</div></div><div class="confirm-meta"><div><span>화면</span><strong>${escapeHTML(display.name)}</strong></div><div><span>해상도</span><strong>${display.width}×${display.height}</strong></div><div><span>마지막 연결</span><strong>${display.lastSeen ? relativeTime(display.lastSeen) : '연결 전'}</strong></div></div></div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">취소</button><button class="btn btn--danger" type="button" data-action="confirm-remove-display" data-display-id="${display.id}">${icon('trash')}연결 해제</button></div>`;
    openModal(dialog, { label: '화면 연결 해제 확인' });
  }

  function testPatternDataUrl() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#17313d"/><rect x="60" y="60" width="1160" height="600" fill="#f4efe5"/><rect x="60" y="60" width="290" height="150" fill="#6f9488"/><rect x="350" y="60" width="290" height="150" fill="#b6503d"/><rect x="640" y="60" width="290" height="150" fill="#172a3a"/><rect x="930" y="60" width="290" height="150" fill="#d9cfbe"/><circle cx="640" cy="410" r="132" fill="none" stroke="#172a3a" stroke-width="3"/><path d="M60 510h1160M60 570h1160M200 60v600M330 60v600M430 60v600M560 60v600M660 60v600M790 60v600M890 60v600M1020 60v600M1120 60v600" stroke="#172a3a" stroke-width="1" opacity=".18"/><text x="640" y="402" fill="#172a3a" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="64" font-weight="700" text-anchor="middle">테스트 화면</text><text x="640" y="452" fill="#5b696c" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="24" text-anchor="middle">색과 가장자리를 확인해 주세요</text><text x="640" y="628" fill="#5b696c" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="20" text-anchor="middle">열린안내판 프로토타입</text></svg>`;
    return svgData(svg);
  }

  function openTestImageModal(displayId) {
    const site = activeSite();
    const display = displayById(site, displayId);
    if (!site || !display) return;
    const dialog = `<div class="modal__head"><div><h2 class="modal__title" id="modal-title">테스트 이미지 보내기</h2><p class="modal__sub">${escapeHTML(display.name)} · ${display.width}×${display.height} · ${orientationLabel(display)}</p></div><button class="icon-btn modal__close" type="button" data-action="close-modal" aria-label="닫기">${icon('x')}</button></div>
      <div class="modal__body"><div style="padding:10px;border-radius:12px;background:#152530"><img src="${escapeAttr(testPatternDataUrl())}" alt="색 막대와 격자, 테스트 화면 글자가 있는 확인용 이미지" style="display:block;width:100%;border-radius:4px"></div><div class="wizard-note">${icon('info', 'icon--sm')}<span>테스트 이미지는 약 10초 동안 표시됩니다. 화면 가장자리와 색이 잘 보이는지 확인한 뒤 실제 게시를 시작하세요.</span></div></div>
      <div class="modal__actions"><button class="btn btn--secondary" type="button" data-action="close-modal">취소</button><button class="btn btn--primary" type="button" data-action="confirm-test-image" data-display-id="${display.id}">${icon('send')}테스트 이미지 보내기</button></div>`;
    openModal(dialog, { label: '테스트 이미지 보내기', wide: true });
  }

  /* ---------- interaction wiring ---------- */

  function handleAction(action, element) {
    switch (action) {
      case 'close-modal': closeModal(); break;
      case 'open-scenario': openScenarioDrawer(); break;
      case 'open-help': openHelpModal(); break;
      case 'apply-scenario': applyScenario(element.dataset.kind, element.dataset.value); break;
      case 'scenario-reset': resetScenario(); break;
      case 'start-wizard': case 'resume-wizard': startWizard(); break;
      case 'discard-wizard': discardWizard(); break;
      case 'confirm-discard-wizard': confirmDiscardWizard(); break;
      case 'save-wizard': saveWizardDraft(); break;
      case 'wizard-prev': wizardPrev(); break;
      case 'wizard-next': wizardNext(); break;
      case 'wizard-goto': wizardGoto(element.dataset.step); break;
      case 'wizard-move-up': wizardMove(element.dataset.imageId, -1); break;
      case 'wizard-move-down': wizardMove(element.dataset.imageId, 1); break;
      case 'wizard-publish': openWizardPublishModal(); break;
      case 'wizard-confirm-publish': publishWizardSite(); break;
      case 'go': {
        closeModal();
        goTo(element.dataset.href || '#/dashboard', element.dataset.siteId || null);
        break;
      }
      case 'focus-field': {
        const target = document.querySelector(element.dataset.target || '');
        if (target) target.focus();
        break;
      }
      case 'set-tab': {
        ui.tab = element.dataset.tab;
        ui.focusAfterRender = `[data-action="set-tab"][data-tab="${ui.tab}"]`;
        render();
        break;
      }
      case 'set-layout': setLayoutType(element.dataset.layout); break;
      case 'add-display': addDisplayToSite(activeSite()); break;
      case 'undo-layout': undoLayout(); break;
      case 'redo-layout': redoLayout(); break;
      case 'remove-display': openRemoveDisplayModal(element.dataset.displayId); break;
      case 'confirm-remove-display': {
        const site = activeSite();
        closeModal();
        if (site) removeDisplayFromSite(site, element.dataset.displayId);
        break;
      }
      case 'test-image': openTestImageModal(element.dataset.displayId); break;
      case 'confirm-test-image': {
        const site = activeSite();
        const display = displayById(site, element.dataset.displayId);
        closeModal();
        addActivity(`${display?.name || '화면'}에 테스트 이미지를 보냈습니다.`, 'check', site?.id || null);
        saveState();
        announce('테스트 이미지를 보냈습니다. 실제 화면에서 확인해 주세요.');
        break;
      }
      case 'approve-pending': openApprovalModal(element.dataset.pendingId); break;
      case 'open-browser-test': openBrowserTestModal(); break;
      case 'copy-browser-code': copyText(ui.browserTestCode || '', '확인 코드를 복사했습니다.'); break;
      case 'add-browser-pending': addBrowserPending(); break;
      case 'scan-displays': scanForDisplays(); break;
      case 'copy-registration-link': copyText(registrationLink(activeSite()), '등록 링크를 복사했습니다.'); break;
      case 'open-status': {
        const siteId = element.dataset.siteId || activeSite()?.id;
        openStatusDetail(siteId, element.dataset.displayId);
        break;
      }
      case 'open-status-filter': break;
      case 'filter-status': {
        ui.statusFilter = element.dataset.filter;
        ui.focusAfterRender = `[data-action="filter-status"][data-filter="${ui.statusFilter}"]`;
        render();
        break;
      }
      case 'refresh-status':
        announce('모든 화면의 마지막 연결 시각을 다시 확인했습니다. 상태 변화는 없습니다.', 'info');
        break;
      case 'recover-display':
        recoverDisplay(element.dataset.siteId, element.dataset.displayId, element.dataset.recovery);
        break;
      case 'recover-pending':
        closeModal();
        goTo('#/register', element.dataset.siteId || null);
        break;
      case 'copy-display-log': {
        const site = siteById(element.dataset.siteId);
        const display = displayById(site, element.dataset.displayId);
        if (site && display) copyText(displayLog(site, display), '화면 로그를 복사했습니다.');
        break;
      }
      case 'asset-detail': openAssetDetail(element.dataset.assetId); break;
      case 'delete-asset': {
        if (modalState.open) closeModal();
        openDeleteAssetModal(element.dataset.assetId);
        break;
      }
      case 'confirm-delete-asset': deleteAsset(element.dataset.assetId); break;
      case 'restore-samples': restoreSamples(); break;
      case 'add-playlist-images': openAddImagesModal(); break;
      case 'move-up': movePlaylistItem(element.dataset.imageId, -1); break;
      case 'move-down': movePlaylistItem(element.dataset.imageId, 1); break;
      case 'remove-playlist-item': removePlaylistItem(element.dataset.imageId); break;
      case 'auto-offsets': autoDistributeOffsets(); break;
      case 'toggle-playback': togglePreviewPlayback(); break;
      case 'restart-playback': restartPreviewPlayback(); break;
      case 'publish-preview': openPublishModal(); break;
      case 'confirm-publish': publishSite(element.dataset.siteId); break;
      default: break;
    }
  }

  document.addEventListener('click', (event) => {
    const skip = event.target.closest('.skip-link');
    if (skip) {
      event.preventDefault();
      const main = document.getElementById('main');
      if (main) {
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: 'start' });
      }
      return;
    }
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;
    if (target.tagName === 'A' && !target.getAttribute('href')?.startsWith('#')) return;
    handleAction(action, target);
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.id === 'manual-code-form') {
      submitManualCode(event);
      return;
    }
    if (form.id === 'add-images-form') {
      submitAddImages(event);
      return;
    }
    if (form.id === 'approve-display-form') {
      event.preventDefault();
      const nameInput = form.querySelector('input[name="name"]');
      const name = nameInput?.value.trim() || '';
      if (!name) {
        const slot = form.querySelector('#approve-error-slot');
        if (slot) slot.innerHTML = `<div class="error-summary" role="alert" tabindex="-1" id="approve-error"><div class="error-summary__title">${icon('alert')}입력을 확인해 주세요.</div><ul><li><button class="text-link" type="button" data-action="focus-field" data-target="#approve-name">화면 이름을 입력해 주세요.</button></li></ul></div>`;
        nameInput?.setAttribute('aria-invalid', 'true');
        announce('화면 이름을 입력해 주세요.', 'error');
        if (nameInput) nameInput.focus();
        return;
      }
      const site = siteById(form.dataset.siteId);
      if (site) approvePending(site, form.dataset.pendingId, name, form.elements.orientation.value);
    }
  });

  document.addEventListener('input', (event) => {
    const field = event.target.dataset.wizardField;
    if (field && state.wizard) {
      state.wizard[field] = event.target.value;
      state.wizard.updatedAt = nowISO();
      if (ui.wizardInputTimer) window.clearTimeout(ui.wizardInputTimer);
      ui.wizardInputTimer = window.setTimeout(() => saveState(), 250);
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('[data-role="site-picker"]')) {
      const siteId = target.value;
      if (siteById(siteId)) {
        state.activeSiteId = siteId;
        ui.selectedDisplayId = null;
        saveState();
        const route = parseRoute();
        if (route.name === 'site') location.hash = `#/site/${siteId}`;
        else render();
        ui.focusAfterRender = '#site-picker';
        announce(`${siteById(siteId).name}로 바꿨습니다.`, 'silent');
      }
      return;
    }

    if (target.matches('input[name="playback-mode"]')) {
      const site = activeSite();
      if (!site) return;
      site.mode = target.value;
      saveState();
      ui.focusAfterRender = `input[name="playback-mode"][value="${target.value}"]`;
      render();
      announce(`${MODES[site.mode].name}으로 바꿨습니다.`);
      return;
    }

    if (target.dataset.wizardChoice) {
      const wizard = state.wizard;
      if (!wizard) return;
      const choice = target.dataset.wizardChoice;
      if (choice === 'displayCount') {
        const previous = wizard.displayCount;
        wizard.displayCount = Number(target.value);
        if (wizard.displayCount === 1) wizard.layoutType = 'single';
        else if (previous === 1) wizard.layoutType = 'grid';
      } else if (choice === 'layoutType') {
        wizard.layoutType = target.value;
      } else if (choice === 'mode') {
        wizard.mode = target.value;
      }
      wizard.updatedAt = nowISO();
      ui.wizardErrors = ui.wizardErrors.filter((error) => error.field !== choice);
      saveState();
      ui.focusAfterRender = `input[data-wizard-choice="${choice}"]:checked`;
      render();
      return;
    }

    if (target.dataset.wizardSelect) {
      const wizard = state.wizard;
      if (!wizard) return;
      const field = target.dataset.wizardSelect;
      if (field === 'orientation') {
        wizard.orientation = target.value;
        wizard.resolution = target.value === 'portrait' ? '1080×1920' : '1920×1080';
      } else if (field === 'resolution') {
        wizard.resolution = target.value;
      } else if (field === 'fallbackAssetId') {
        wizard.fallbackAssetId = target.value;
      }
      wizard.updatedAt = nowISO();
      saveState();
      ui.focusAfterRender = field === 'fallbackAssetId' ? '#wizard-fallback' : `#wizard-${field}`;
      render();
      return;
    }

    if (target.matches('[data-wizard-asset]')) {
      const wizard = state.wizard;
      if (!wizard) return;
      const id = target.value;
      const selected = new Set(wizard.selectedAssetIds);
      if (target.checked) {
        if (!selected.has(id)) wizard.selectedAssetIds.push(id);
        if (!wizard.durations) wizard.durations = {};
        if (wizard.durations[id] == null) wizard.durations[id] = 8;
      } else {
        wizard.selectedAssetIds = wizard.selectedAssetIds.filter((assetId) => assetId !== id);
      }
      ui.wizardErrors = ui.wizardErrors.filter((error) => error.field !== 'images');
      wizard.updatedAt = nowISO();
      saveState();
      ui.focusAfterRender = `input[data-wizard-asset][value="${id}"]`;
      render();
      announce(`이미지 ${wizard.selectedAssetIds.length}장을 선택했습니다.`, 'silent');
      return;
    }

    if (target.dataset.wizardDuration) {
      const wizard = state.wizard;
      if (!wizard) return;
      const id = target.dataset.wizardDuration;
      const value = clamp(Number(target.value) || 0, 0, 120);
      if (!wizard.durations) wizard.durations = {};
      wizard.durations[id] = value;
      wizard.updatedAt = nowISO();
      saveState();
      ui.focusAfterRender = `input[data-wizard-duration="${id}"]`;
      render();
      return;
    }

    if (target.dataset.field) {
      handleFieldChange(target);
    }
  });

  function handleFieldChange(target) {
    const site = activeSite();
    if (!site) return;
    const field = target.dataset.field;
    const display = displayById(site, target.dataset.displayId);
    if (field === 'playlist-duration') {
      const id = target.dataset.imageId;
      const value = clamp(Number(target.value) || 0, 0, 120);
      if (!site.durations) site.durations = {};
      site.durations[id] = value;
      saveState();
      ui.focusAfterRender = `input[data-field="playlist-duration"][data-image-id="${id}"]`;
      render();
      return;
    }
    if (field === 'fallback-image') {
      site.fallbackAssetId = target.value;
      saveState();
      ui.focusAfterRender = '#fallback-image';
      render();
      announce('비상 이미지를 바꿨습니다. 미리보기에서 확인해 주세요.');
      return;
    }
    if (!display) return;
    if (field === 'display-name') {
      const value = target.value.trim() || display.name;
      display.name = value;
      saveState();
      ui.focusAfterRender = '#display-name';
      render();
      return;
    }
    if (field === 'display-resolution') {
      const [width, height] = target.value.split('×').map(Number);
      display.width = width;
      display.height = height;
      display.orientation = height > width ? 'portrait' : 'landscape';
      display.rotation = height > width ? 90 : 0;
      saveState();
      ui.focusAfterRender = '#display-resolution';
      render();
      announce(`${display.name} 해상도를 ${target.value}로 바꿨습니다.`);
      return;
    }
    if (field === 'display-orientation') {
      display.orientation = target.value;
      display.rotation = target.value === 'portrait' ? 90 : 0;
      const next = target.value === 'portrait' ? [1080, 1920] : [1920, 1080];
      display.width = next[0];
      display.height = next[1];
      saveState();
      ui.focusAfterRender = '#display-orientation';
      render();
      announce(`${display.name} 방향을 ${orientationLabel(display)}로 바꿨습니다.`);
      return;
    }
    if (field === 'display-fit') {
      display.fit = target.value;
      saveState();
      ui.focusAfterRender = '#display-fit';
      render();
      announce(`${display.name} 이미지 맞춤 방식을 바꿨습니다.`);
      return;
    }
    if (field === 'start-offset') {
      display.startOffset = Number(target.value);
      saveState();
      ui.focusAfterRender = `select[data-display-id="${display.id}"][data-field="start-offset"]`;
      render();
      return;
    }
    if (field === 'display-step') {
      display.step = Number(target.value);
      saveState();
      ui.focusAfterRender = `select[data-display-id="${display.id}"][data-field="display-step"]`;
      render();
    }
  }

  document.addEventListener('keydown', (event) => {
    if (modalState.open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key === 'Tab') {
        const dialog = modalRoot.querySelector('.modal');
        if (!dialog) return;
        const focusables = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', dialog).filter((element) => element.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    const tab = event.target.closest('[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const list = tab.closest('[role="tablist"]');
      if (!list) return;
      const tabs = $$('[role="tab"]', list);
      const current = tabs.indexOf(tab);
      let next = current;
      if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      event.preventDefault();
      tabs[next]?.click();
    }
  });

  window.addEventListener('hashchange', () => {
    closeModal();
    render({ focusHeading: true });
  });

  function normalizeState() {
    state.sites = Array.isArray(state.sites) ? state.sites : [];
    state.assets = Array.isArray(state.assets) ? state.assets : [];
    state.sites.forEach((site) => {
      site.displays = Array.isArray(site.displays) ? site.displays : [];
      site.playlistIds = Array.isArray(site.playlistIds) ? site.playlistIds : [];
      site.pending = Array.isArray(site.pending) ? site.pending : [];
      site.publications = Array.isArray(site.publications) ? site.publications : [];
      site.durations = site.durations || {};
      site.playlistIds.forEach((id) => { if (site.durations[id] == null) site.durations[id] = 8; });
      if (!site.fallbackAssetId || !assetById(site.fallbackAssetId)) {
        site.fallbackAssetId = state.assets.find((asset) => asset.id === 'img-closure')?.id || state.assets[0]?.id || null;
      }
      if (!MODES[site.mode]) site.mode = 'cycle';
      if (!LAYOUTS[site.layoutType]) site.layoutType = site.displays.length <= 1 ? 'single' : 'grid';
      site.displays.forEach((display) => {
        if (!STATUS[display.status]) display.status = 'offline';
        if (!display.fit) display.fit = 'contain';
        if (display.startOffset == null) display.startOffset = 0;
        if (display.step == null) display.step = 1;
        if (!Array.isArray(display.capabilities)) display.capabilities = ['브라우저'];
      });
    });
    if (state.wizard) {
      state.wizard.step = clamp(Number(state.wizard.step) || 1, 1, 6);
      state.wizard.maxStep = clamp(Number(state.wizard.maxStep) || state.wizard.step, state.wizard.step, 6);
      state.wizard.selectedAssetIds = Array.isArray(state.wizard.selectedAssetIds) ? state.wizard.selectedAssetIds : [];
      state.wizard.durations = state.wizard.durations || {};
      if (!state.wizard.fallbackAssetId || !assetById(state.wizard.fallbackAssetId)) {
        state.wizard.fallbackAssetId = state.assets.find((asset) => asset.id === 'img-closure')?.id || state.assets[0]?.id || null;
      }
      if (!MODES[state.wizard.mode]) state.wizard.mode = 'cycle';
      if (!LAYOUTS[state.wizard.layoutType]) state.wizard.layoutType = 'grid';
    }
    state.scenario = state.scenario || { sites: 2, displays: 4, images: 3, mode: 'cycle' };
    ensureActiveSite();
  }

  normalizeState();
  saveState();
  render();

})();
