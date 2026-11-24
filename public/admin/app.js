/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  dashboard: null,
  contents: [],
  devices: [],
  playlists: [],
  contentFilter: 'all',
  editor: null,
  uploading: false,
  booted: false,
};

const el = {
  loginView: $('#login-view'),
  appView: $('#app-view'),
  loginForm: $('#login-form'),
  loginError: $('#login-error'),
  loginDemoHint: $('#login-demo-hint'),
  password: $('#password'),
  view: $('#view'),
  pageTitle: $('#page-title'),
  pageEyebrow: $('#page-eyebrow'),
  modal: $('#modal'),
  toast: $('#toast'),
};

const PAGE_META = {
  dashboard: { title: '대시보드', eyebrow: 'OVERVIEW' },
  contents: { title: '콘텐츠', eyebrow: 'CONTENT LIBRARY' },
  devices: { title: '기기', eyebrow: 'DISPLAYS' },
  playlists: { title: '재생목록', eyebrow: 'PLAYLISTS' },
};

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

async function api(path, options = {}) {
  const request = { ...options, headers: { ...(options.headers || {}) } };
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
    request.body = JSON.stringify(options.body);
    request.headers['Content-Type'] = 'application/json';
  }
  let response;
  try {
    response = await fetch(path, request);
  } catch {
    throw new ApiError('서버에 연결하지 못했습니다. 서버가 실행 중인지 확인해 주세요.');
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (response.status === 401) {
    if (!path.endsWith('/auth/login')) showLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    throw new ApiError(data?.error || '로그인이 필요합니다.', 401);
  }
  if (!response.ok) throw new ApiError(data?.error || `요청을 처리하지 못했습니다. (${response.status})`, response.status);
  return data;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function fmtBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)}KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function timeAgo(iso) {
  if (!iso) return '기록 없음';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '기록 없음';
  if (diff < 45 * 1000) return '방금 전';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}시간 전`;
  return `${Math.floor(diff / 86400000)}일 전`;
}

function durationLabel(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return `${value}초`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${minutes}분 ${remainder}초` : `${minutes}분`;
}

function statusBadge(status) {
  if (status === 'online') return '<span class="badge badge-online">온라인</span>';
  if (status === 'offline') return '<span class="badge badge-offline">오프라인</span>';
  return '<span class="badge badge-pending">연결 대기</span>';
}

function kindLabel(kind) {
  return kind === 'image' ? '이미지' : kind === 'video' ? '동영상' : 'URL';
}

function thumbHtml(content, options = {}) {
  if (!content) return '<div class="thumb thumb-url">?</div>';
  const className = options.portrait ? 'thumb portrait' : 'thumb';
  if (content.kind === 'image') {
    return `<div class="${className}"><img src="${esc(content.url)}" alt="" loading="lazy" /><span class="tag kind">이미지</span></div>`;
  }
  if (content.kind === 'video') {
    return `<div class="${className}"><video src="${esc(content.url)}" muted preload="metadata" playsinline></video><div class="play">▶</div><span class="tag kind">동영상</span></div>`;
  }
  let host = 'URL';
  try { host = new URL(content.url, location.origin).hostname || 'URL'; } catch { /* keep */ }
  return `<div class="thumb thumb-url" aria-hidden="true">◫<span class="tag kind">URL</span><span class="sr-only">${esc(host)}</span></div>`;
}

function toast(message, type = 'ok') {
  el.toast.textContent = message;
  el.toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.toast.hidden = true; }, 4200);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
  }
}

function showLogin(message = '') {
  el.appView.hidden = true;
  el.loginView.hidden = false;
  document.title = '로그인 · 국악원 사이니지 관리';
  if (message) {
    el.loginError.textContent = message;
    el.loginError.hidden = false;
  } else {
    el.loginError.hidden = true;
  }
  setTimeout(() => el.password.focus(), 40);
}

async function enterApp() {
  el.loginView.hidden = true;
  el.appView.hidden = false;
  await loadAll();
  if (!state.booted) {
    state.booted = true;
    window.addEventListener('hashchange', () => { route().catch(showError); });
  }
  if (!location.hash) {
    history.replaceState(null, '', '#/dashboard');
  }
  await route();
}

function showError(error) {
  console.error(error);
  if (error instanceof ApiError && error.status === 401) return;
  toast(error?.message || '요청을 처리하지 못했습니다.', 'error');
}

async function loadAll() {
  const [dashboard, contents, devices, playlists] = await Promise.all([
    api('/api/dashboard'),
    api('/api/contents'),
    api('/api/devices'),
    api('/api/playlists'),
  ]);
  state.dashboard = dashboard;
  state.contents = contents.contents;
  state.devices = devices.devices;
  state.playlists = playlists.playlists;
}

async function refreshOnly() {
  const [dashboard, devices] = await Promise.all([api('/api/dashboard'), api('/api/devices')]);
  state.dashboard = dashboard;
  state.devices = devices.devices;
}

function setPageMeta(page) {
  const meta = PAGE_META[page] || PAGE_META.dashboard;
  el.pageTitle.textContent = meta.title;
  el.pageEyebrow.textContent = meta.eyebrow;
  document.title = `${meta.title} · 국악원 사이니지 관리`;
  $$('.nav a').forEach((link) => {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

async function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [page, id] = raw.split('/');
  if (page === 'playlists' && id) {
    setPageMeta('playlists');
    await renderPlaylistEditor(id);
    return;
  }
  setPageMeta(PAGE_META[page] ? page : 'dashboard');
  if (page === 'contents') renderContents();
  else if (page === 'devices') renderDevices();
  else if (page === 'playlists') renderPlaylists();
  else renderDashboard();
  el.view.focus({ preventScroll: true });
}

/* ---------------- Dashboard ---------------- */
function renderDashboard() {
  const data = state.dashboard;
  if (!data) {
    el.view.innerHTML = '<div class="loading">불러오는 중…</div>';
    return;
  }
  const { counts, devices } = data;
  const steps = [
    { done: counts.contents > 0, title: '콘텐츠 올리기', note: counts.contents ? `${counts.contents}개 보관 중` : '이미지·영상·URL' },
    { done: counts.devices > 0, title: '기기 등록', note: counts.devices ? `${counts.devices}대 등록` : '등록 코드 발급' },
    { done: counts.playlists > 0, title: '재생목록 만들기', note: counts.playlists ? `${counts.playlists}개 준비` : '순서와 시간 설정' },
    { done: counts.publishedDevices > 0, title: '게시하기', note: counts.publishedDevices ? `${counts.publishedDevices}대 송출 중` : '재생기에 배포' },
  ];
  const tasks = buildTasks(counts, devices);
  const primary = devices.find((device) => device.status === 'pending') || devices[0];
  const recentContents = data.contents.slice(0, 4);

  el.view.innerHTML = `
    <div class="stack">
      <section class="hero">
        <div>
          <p class="eyebrow">TODAY'S SIGNAGE</p>
          <h2>${counts.onlineDevices > 0 ? '지금, 화면이 정상적으로 연결되어 있습니다.' : '재생기를 연결해 첫 송출을 시작하세요.'}</h2>
          <p>콘텐츠를 올리고 기기에 배정한 뒤 게시하면, 재생기가 마지막 목록을 캐시해 서버가 잠시 끊겨도 계속 재생합니다.</p>
        </div>
        <div class="hero-stat"><strong>${counts.onlineDevices}<span style="font-size:18px;color:#afc5cb"> / ${counts.devices}</span></strong><span>연결된 화면</span></div>
      </section>

      <section class="steps" aria-label="송출 준비 단계">
        ${steps.map((step) => `<div class="step ${step.done ? 'done' : ''}"><div><strong>${step.title}</strong><span>${step.note}</span></div></div>`).join('')}
      </section>

      <div class="grid grid-4">
        <section class="card stat"><p class="stat-label">콘텐츠</p><p class="stat-value">${counts.contents}</p><p class="stat-note">이미지 ${counts.images} · 동영상 ${counts.videos} · URL ${counts.urls}</p></section>
        <section class="card stat"><p class="stat-label">재생목록</p><p class="stat-value">${counts.playlists}</p><p class="stat-note">기기에 배정할 순환 목록</p></section>
        <section class="card stat"><p class="stat-label">기기</p><p class="stat-value">${counts.devices}</p><p class="stat-note">온라인 ${counts.onlineDevices} · 대기 ${counts.pendingDevices}</p></section>
        <section class="card stat"><p class="stat-label">게시된 기기</p><p class="stat-value">${counts.publishedDevices}</p><p class="stat-note">마지막 목록을 재생 중</p></section>
      </div>

      <div class="grid grid-2">
        <section class="card card-pad next-card">
          <div class="card-head"><h2>다음 할 일</h2><span class="tag">${tasks.length ? tasks.length + '개' : '준비 완료'}</span></div>
          ${tasks.length ? `<div class="next-list">${tasks.map((task) => `
            <div class="next-item">
              <div><strong>${task.title}</strong><span>${task.description}</span></div>
              <button class="btn btn-ghost btn-sm" type="button" data-action="${task.action || 'navigate'}" data-href="${task.href || ''}" data-id="${task.deviceId || ''}">${task.button}</button>
            </div>`).join('')}</div>` : `
            <div class="empty" style="padding:26px 18px"><div class="empty-mark">✓</div><h3>송출 준비가 끝났습니다</h3><p>재생기에서 등록 코드를 입력하거나, 기기 카드의 <strong>재생기 열기</strong>를 눌러 화면을 띄우세요.</p></div>`}
        </section>

        <section class="card card-pad">
          <div class="card-head"><h2>재생기 연결</h2>${primary ? statusBadge(primary.status) : ''}</div>
          ${primary ? `
            <p class="small muted" style="margin-top:-8px">재생기 첫 화면에 아래 6자리 코드를 입력합니다.</p>
            <div class="device-code-wrap" style="margin-top:14px">
              <div><span class="device-code-label">REGISTRATION CODE</span><span class="device-code">${esc(primary.pairingCode)}</span></div>
              <div class="button-row"><button class="btn btn-ghost btn-sm" type="button" data-action="copy-code" data-code="${esc(primary.pairingCode)}">코드 복사</button><a class="btn btn-primary btn-sm" href="${esc(primary.playerUrl)}" target="_blank" rel="noopener">재생기 열기</a></div>
            </div>
            <p class="tiny muted" style="margin-top:14px">${esc(primary.name)} · ${primary.orientation === 'portrait' ? '세로' : '가로'} ${primary.width}×${primary.height}</p>
          ` : '<div class="empty" style="padding:26px 18px"><h3>등록된 기기가 없습니다</h3><p>기기를 먼저 추가하면 재생기 연결 코드가 발급됩니다.</p><a class="btn btn-primary btn-sm" href="#/devices">기기 추가</a></div>'}
        </section>
      </div>

      <section class="card card-pad">
        <div class="card-head"><h2>기기 상태</h2><a class="btn btn-ghost btn-sm" href="#/devices">전체 보기</a></div>
        ${devices.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>기기</th><th>상태</th><th>재생목록</th><th>게시 버전</th><th>마지막 연결</th><th></th></tr></thead>
            <tbody>${devices.slice(0, 6).map((device) => `
              <tr><td class="table-device">${esc(device.name)}<div class="tiny muted">${esc(device.location || '위치 미지정')}</div></td>
              <td>${statusBadge(device.status)}</td>
              <td>${esc(device.playlistName || '미지정')}</td>
              <td>${device.publishedVersion ? `v${device.publishedVersion}` : '<span class="badge badge-warn">미게시</span>'}</td>
              <td class="muted">${timeAgo(device.lastSeen)}</td>
              <td><button class="btn btn-ghost btn-sm" type="button" data-action="device-settings" data-id="${esc(device.id)}">설정</button></td></tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty" style="padding:26px"><h3>등록된 기기가 없습니다</h3><p>기기를 추가하고 등록 코드를 발급하세요.</p><a class="btn btn-primary btn-sm" href="#/devices">기기 추가</a></div>'}
      </section>

      <div class="grid grid-2">
        <section class="card card-pad">
          <div class="card-head"><h2>최근 콘텐츠</h2><a class="btn btn-ghost btn-sm" href="#/contents">보관함</a></div>
          ${recentContents.length ? `<div class="content-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">${recentContents.map((content) => `
            <article class="content-card">${thumbHtml(content)}<div class="content-body"><p class="content-name" title="${esc(content.name)}">${esc(content.name)}</p><div class="content-meta"><span>${kindLabel(content.kind)}</span><span>${fmtDate(content.created_at).slice(0, 12)}</span></div></div></article>`).join('')}</div>` : '<div class="empty" style="padding:26px"><h3>콘텐츠가 없습니다</h3><p>첫 이미지나 동영상을 올려 보세요.</p><a class="btn btn-primary btn-sm" href="#/contents">콘텐츠 올리기</a></div>'}
        </section>
        <section class="card card-pad">
          <div class="card-head"><h2>최근 게시</h2><span class="tag">${data.recentPublications.length}건</span></div>
          ${data.recentPublications.length ? `<div class="next-list">${data.recentPublications.map((item) => `
            <div class="next-item"><div><strong>${esc(item.device_name)}</strong><span>${fmtDate(item.published_at)}</span></div><span class="tag">v${item.version}</span></div>`).join('')}</div>` : '<div class="empty" style="padding:26px"><h3>게시 기록이 없습니다</h3><p>재생 설정을 확인하고 기기에 게시해 보세요.</p><a class="btn btn-primary btn-sm" href="#/devices">기기 설정</a></div>'}
        </section>
      </div>
    </div>`;
}

function buildTasks(counts, devices) {
  const tasks = [];
  if (!counts.contents) {
    tasks.push({ title: '콘텐츠를 올려 주세요', description: '이미지, 동영상, URL 중 하나부터 시작합니다.', href: '#/contents', button: '콘텐츠 열기' });
  }
  if (!counts.playlists) {
    tasks.push({ title: '재생목록을 만들어 주세요', description: '콘텐츠 순서와 표시 시간을 정합니다.', href: '#/playlists', button: '재생목록 만들기' });
  }
  if (!counts.devices) {
    tasks.push({ title: '기기를 추가해 주세요', description: '등록 코드를 발급하면 재생기에 입력할 수 있습니다.', href: '#/devices', button: '기기 추가' });
  }
  for (const device of devices) {
    if (!device.playlistId && !(device.schedules || []).length) {
      tasks.push({ title: `‘${device.name}’에 재생목록을 배정하세요`, description: '기본 재생목록이나 시간표를 지정해야 게시할 수 있습니다.', action: 'device-settings', deviceId: device.id, button: '설정' });
    } else if (!device.publishedVersion) {
      tasks.push({ title: `‘${device.name}’에 아직 게시하지 않았습니다`, description: '재생 설정을 저장한 뒤 게시 버튼을 눌러 주세요.', action: 'publish-device', deviceId: device.id, button: '지금 게시' });
    }
  }
  if (!tasks.length) tasks.push({ title: '재생기에서 등록 코드를 입력하세요', description: '코드를 입력하면 게시된 목록이 전체 화면으로 시작됩니다.', href: '#/devices', button: '기기 확인' });
  return tasks.slice(0, 5);
}

/* ---------------- Contents ---------------- */
function renderContents() {
  const filtered = state.contentFilter === 'all' ? state.contents : state.contents.filter((content) => content.kind === state.contentFilter);
  const counts = {
    all: state.contents.length,
    image: state.contents.filter((content) => content.kind === 'image').length,
    video: state.contents.filter((content) => content.kind === 'video').length,
    url: state.contents.filter((content) => content.kind === 'url').length,
  };
  el.view.innerHTML = `
    <p class="page-intro">이미지·동영상을 올리거나 안내 웹페이지 주소를 추가합니다. 콘텐츠는 재생목록에서 순서와 표시 시간을 정한 뒤 기기에 게시됩니다.</p>
    <section class="card card-pad" style="margin-bottom:22px">
      <div id="dropzone" class="dropzone">
        <p class="big">파일을 여기로 끌어다 놓으세요</p>
        <p>JPEG · PNG · WebP · GIF · MP4 · WebM · OGG / 파일당 300MB</p>
        <div class="button-row">
          <button class="btn btn-primary" type="button" data-action="pick-files">파일 선택</button>
          <button class="btn btn-ghost" type="button" data-action="new-url">URL 추가</button>
        </div>
        <input id="content-file-input" class="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/ogg,.jpg,.jpeg,.png,.webp,.gif,.mp4,.m4v,.webm,.ogv,.ogg" />
        <div id="upload-queue" class="upload-queue" aria-live="polite"></div>
      </div>
    </section>
    <div class="filter-bar" role="group" aria-label="콘텐츠 종류 필터">
      ${[['all','전체'],['image','이미지'],['video','동영상'],['url','URL']].map(([kind, label]) => `<button type="button" data-action="filter-content" data-kind="${kind}" aria-pressed="${state.contentFilter === kind}">${label} ${counts[kind]}</button>`).join('')}
    </div>
    ${filtered.length ? `<div class="content-grid">${filtered.map((content) => `
      <article class="content-card">
        ${thumbHtml(content, { portrait: content.width && content.height && content.height > content.width })}
        <div class="content-body">
          <p class="content-name" title="${esc(content.name)}">${esc(content.name)}</p>
          <div class="content-meta"><span>${kindLabel(content.kind)}${content.width && content.height ? ` · ${content.width}×${content.height}` : ''}</span><span>${content.file_size ? fmtBytes(content.file_size) : '웹페이지'}</span></div>
          <div class="content-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="rename-content" data-id="${esc(content.id)}">이름 변경</button><button class="btn btn-danger btn-sm" type="button" data-action="delete-content" data-id="${esc(content.id)}">삭제</button></div>
        </div>
      </article>`).join('')}</div>` : `
      <div class="empty"><div class="empty-mark">▦</div><h3>${state.contentFilter === 'all' ? '아직 콘텐츠가 없습니다' : '이 종류의 콘텐츠가 없습니다'}</h3><p>이미지나 동영상을 끌어다 놓거나 URL을 추가해 보세요. 첫 콘텐츠는 재생목록의 기본 재료가 됩니다.</p><button class="btn btn-primary" type="button" data-action="pick-files">파일 선택</button></div>`}
  `;
  wireDropzone();
}

function wireDropzone() {
  const dropzone = $('#dropzone');
  if (!dropzone) return;
  for (const eventName of ['dragenter', 'dragover']) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    });
  }
  dropzone.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files?.length) uploadFiles(event.dataTransfer.files);
  });
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length || state.uploading) return;
  const allowed = /\.(jpe?g|png|webp|gif|mp4|m4v|webm|ogv|ogg)$/i;
  const queue = $('#upload-queue');
  if (!queue) return;
  state.uploading = true;
  let success = 0;
  let failure = 0;
  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `<span class="name"></span><span class="status">대기</span><div class="track"><div class="bar"></div></div>`;
    $('.name', item).textContent = file.name;
    queue.appendChild(item);
    const status = $('.status', item);
    const bar = $('.bar', item);
    if (!allowed.test(file.name)) {
      status.textContent = '지원하지 않는 형식';
      failure += 1;
      continue;
    }
    try {
      await uploadOne(file, (percent) => {
        bar.style.width = `${percent}%`;
        status.textContent = percent < 100 ? `${percent}%` : '저장 중…';
      });
      bar.style.width = '100%';
      status.textContent = '완료';
      success += 1;
    } catch (error) {
      status.textContent = error.message || '실패';
      status.style.color = '#a33b2a';
      failure += 1;
    }
  }
  state.uploading = false;
  try {
    await loadAll();
    renderContents();
    if (success) toast(`${success}개 콘텐츠를 올렸습니다.`);
    if (failure) toast(`${failure}개 파일을 올리지 못했습니다. 형식과 크기를 확인해 주세요.`, 'error');
  } catch (error) {
    showError(error);
  }
}

function uploadOne(file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/contents');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      let data = null;
      try { data = JSON.parse(request.responseText); } catch { /* ignore */ }
      if (request.status === 401) {
        showLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        reject(new ApiError('로그인이 만료되었습니다.', 401));
      } else if (request.status >= 200 && request.status < 300) {
        resolve(data);
      } else {
        reject(new ApiError(data?.error || '업로드에 실패했습니다.', request.status));
      }
    });
    request.addEventListener('error', () => reject(new ApiError('서버에 연결하지 못했습니다.')));
    const body = new FormData();
    body.append('files', file, file.name);
    request.send(body);
  });
}

/* ---------------- Devices ---------------- */
function renderDevices() {
  el.view.innerHTML = `
    <div class="card-head" style="margin-bottom:10px"><p class="page-intro" style="margin:0">기기를 추가하면 6자리 등록 코드가 발급됩니다. 재생기 첫 화면에 코드를 입력하면 연결되고, 준비한 재생목록을 게시할 수 있습니다.</p><button class="btn btn-primary" type="button" data-action="new-device">기기 추가</button></div>
    ${state.devices.length ? `<div class="device-grid">${state.devices.map(deviceCardHtml).join('')}</div>` : `
      <div class="empty"><div class="empty-mark">▣</div><h3>등록된 기기가 없습니다</h3><p>로비 PC나 안내 모니터를 기기로 추가하세요. 기기마다 고유한 등록 코드와 재생 상태를 관리합니다.</p><button class="btn btn-primary" type="button" data-action="new-device">첫 기기 추가</button></div>`}
  `;
}

function deviceCardHtml(device) {
  const orientation = device.orientation === 'portrait' ? '세로' : '가로';
  const stateLabel = device.playerState?.startsWith('playing') ? '재생 중' : device.playerState === 'paused' ? '일시정지' : device.status === 'online' ? '연결됨' : '—';
  return `<article class="card device-card">
    <div class="device-top">
      <div><h2 class="device-name">${esc(device.name)}</h2><p class="device-loc">${esc(device.location || '위치 미지정')} · ${orientation} ${device.width}×${device.height}</p></div>
      <div class="button-row">${statusBadge(device.status)}${device.paired ? '<span class="badge badge-info">연결됨</span>' : '<span class="badge badge-plain badge-warn">미연결</span>'}</div>
    </div>
    <div class="device-code-wrap">
      <div><span class="device-code-label">등록 코드 · 재생기 첫 화면에 입력</span><span class="device-code">${esc(device.pairingCode)}</span></div>
      <div class="button-row"><button class="btn btn-ghost btn-sm" type="button" data-action="copy-code" data-code="${esc(device.pairingCode)}">복사</button><a class="btn btn-primary btn-sm" href="${esc(device.playerUrl)}" target="_blank" rel="noopener">재생기 열기</a></div>
    </div>
    <div class="device-facts">
      <span>재생목록 <strong>${esc(device.playlistName || '미지정')}</strong></span>
      <span>게시 <strong>${device.publishedVersion ? `v${device.publishedVersion}` : '아직 없음'}</strong></span>
      <span>마지막 연결 <strong>${timeAgo(device.lastSeen)}</strong></span>
      ${device.reportedWidth ? `<span>실제 화면 <strong>${device.reportedWidth}×${device.reportedHeight || '?'}</strong></span>` : ''}
      ${device.lastSeen ? `<span>현재 상태 <strong>${esc(stateLabel)}</strong></span>` : ''}
    </div>
    ${device.lastError ? `<div class="device-error">마지막 오류: ${esc(device.lastError)}</div>` : ''}
    <div class="device-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-action="device-settings" data-id="${esc(device.id)}">재생 설정</button>
      <button class="btn btn-primary btn-sm" type="button" data-action="publish-device" data-id="${esc(device.id)}" ${!device.playlistId && !device.schedules?.length ? 'disabled' : ''}>게시</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" type="button" data-action="regenerate-code" data-id="${esc(device.id)}">코드 재발급</button>
      ${device.paired ? `<button class="btn btn-ghost btn-sm" type="button" data-action="unpair-device" data-id="${esc(device.id)}">연결 해제</button>` : ''}
      <button class="btn btn-danger btn-sm" type="button" data-action="delete-device" data-id="${esc(device.id)}">삭제</button>
    </div>
  </article>`;
}

function playlistOptions(selectedId, includeNone = false) {
  return `${includeNone ? `<option value="" ${!selectedId ? 'selected' : ''}>지정 안 함</option>` : ''}${state.playlists.map((playlist) => `<option value="${esc(playlist.id)}" ${playlist.id === selectedId ? 'selected' : ''}>${esc(playlist.name)}</option>`).join('')}`;
}

function daysChecks(days = [1, 2, 3, 4, 5]) {
  return ['일', '월', '화', '수', '목', '금', '토'].map((label, index) => `<label><input type="checkbox" data-day="${index}" ${days.includes(index) ? 'checked' : ''} />${label}</label>`).join('');
}

function scheduleRowHtml(schedule = null) {
  const days = schedule?.days || [1, 2, 3, 4, 5];
  const start = schedule?.startTime || '09:00';
  const end = schedule?.endTime || '18:00';
  const playlistId = schedule?.playlistId || state.playlists[0]?.id || '';
  return `<div class="schedule-row" data-schedule-row>
    <div class="top"><div class="times"><input type="time" data-start value="${esc(start)}" aria-label="시작 시각" /><span>—</span><input type="time" data-end value="${esc(end)}" aria-label="종료 시각" /></div><button class="icon-button" type="button" data-action="remove-schedule" aria-label="시간표 삭제">×</button></div>
    <div class="bottom"><div class="day-checks" role="group" aria-label="요일">${daysChecks(days)}</div><select data-schedule-playlist aria-label="시간표 재생목록">${playlistOptions(playlistId)}</select></div>
  </div>`;
}

function openDeviceSettings(device) {
  if (!state.playlists.length) {
    toast('재생목록을 먼저 만들어 주세요.', 'error');
    location.hash = '#/playlists';
    return;
  }
  const schedules = device.schedules?.length ? device.schedules : [];
  openModal({
    title: `${device.name} 재생 설정`,
    subtitle: '기본 재생목록과 시간표를 저장한 뒤 게시하면 재생기에 배포됩니다.',
    wide: true,
    body: `<form id="device-settings-form" data-device-id="${esc(device.id)}" class="form-grid">
      <label class="field"><span>기본 재생목록</span><select id="device-default-playlist" name="playlistId">${playlistOptions(device.playlistId, true)}</select><span class="help">시간표에 해당하지 않는 시간에 재생합니다.</span></label>
      <div class="divider"></div>
      <div class="card-head" style="margin-bottom:0"><div><h3 style="margin-bottom:3px">시간표</h3><span class="tiny muted">요일과 시간에 따라 다른 재생목록을 보여줍니다. 자정을 넘는 시간대도 저장할 수 있습니다.</span></div><button class="btn btn-ghost btn-sm" type="button" data-action="add-schedule">시간표 추가</button></div>
      <div id="schedule-list" class="schedule-list">${schedules.length ? schedules.map(scheduleRowHtml).join('') : '<p class="tiny muted" id="schedule-empty">등록된 시간표가 없습니다. 기본 재생목록을 항상 재생합니다.</p>'}</div>
      <p id="device-settings-error" class="form-error" hidden></p>
    </form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>취소</button><button class="btn btn-ghost" type="submit" form="device-settings-form" data-after="save">저장</button><button class="btn btn-primary" type="submit" form="device-settings-form" data-after="publish">저장 후 게시</button>`,
  });
}

async function saveDeviceSettings(form, publishAfter) {
  const deviceId = form.dataset.deviceId;
  const playlistId = $('#device-default-playlist', form).value || null;
  const rows = $$('[data-schedule-row]', form).map((row) => ({
    playlistId: $('[data-schedule-playlist]', row).value,
    days: $$('input[data-day]:checked', row).map((input) => Number(input.dataset.day)),
    startTime: $('[data-start]', row).value,
    endTime: $('[data-end]', row).value,
    enabled: true,
  }));
  const error = $('#device-settings-error', form);
  if (!playlistId && rows.length === 0) {
    error.textContent = '기본 재생목록이나 시간표 중 하나는 지정해 주세요.';
    error.hidden = false;
    return false;
  }
  if (rows.some((row) => !row.days.length || !row.startTime || !row.endTime)) {
    error.textContent = '모든 시간표에 요일과 시작·종료 시각을 입력해 주세요.';
    error.hidden = false;
    return false;
  }
  error.hidden = true;
  await api(`/api/devices/${encodeURIComponent(deviceId)}/assignment`, {
    method: 'PUT',
    body: { playlistId, schedules: rows },
  });
  let message = '재생 설정을 저장했습니다.';
  if (publishAfter) {
    const published = await api(`/api/devices/${encodeURIComponent(deviceId)}/publish`, { method: 'POST' });
    message = `재생 설정을 저장하고 v${published.version}으로 게시했습니다.`;
  }
  await refreshOnly();
  renderDevices();
  closeModal();
  toast(message);
  return true;
}

/* ---------------- Playlists ---------------- */
function renderPlaylists() {
  el.view.innerHTML = `
    <div class="card-head" style="margin-bottom:10px"><p class="page-intro" style="margin:0">재생목록은 이미지·동영상·URL을 어떤 순서로, 몇 초씩 보여줄지 정합니다. 저장한 목록은 기기에 배정한 뒤 게시해야 실제 화면에 반영됩니다.</p><button class="btn btn-primary" type="button" data-action="new-playlist">새 재생목록</button></div>
    ${state.playlists.length ? `<div class="playlist-list">${state.playlists.map((playlist) => `
      <article class="playlist-row">
        <div class="main"><h3>${esc(playlist.name)}</h3><p>${esc(playlist.description || '설명 없음')}</p></div>
        <div class="metrics"><span>${playlist.item_count}개 항목</span><span>${durationLabel(playlist.total_seconds)}</span><span>기기 ${playlist.device_count}대</span></div>
        <div class="button-row"><a class="btn btn-ghost btn-sm" href="#/playlists/${esc(playlist.id)}">편집</a><button class="btn btn-danger btn-sm" type="button" data-action="delete-playlist" data-id="${esc(playlist.id)}">삭제</button></div>
      </article>`).join('')}</div>` : `
      <div class="empty"><div class="empty-mark">≋</div><h3>재생목록을 만들어 보세요</h3><p>콘텐츠를 고르고 순서와 표시 시간을 정하면 하나의 순환 재생 흐름이 됩니다. 기기에 배정한 뒤 게시하세요.</p><button class="btn btn-primary" type="button" data-action="new-playlist">첫 재생목록 만들기</button></div>`}
  `;
}

async function renderPlaylistEditor(playlistId) {
  el.view.innerHTML = '<div class="loading">재생목록을 불러오는 중…</div>';
  try {
    const [data, contents] = await Promise.all([
      api(`/api/playlists/${encodeURIComponent(playlistId)}`),
      api('/api/contents'),
    ]);
    state.contents = contents.contents;
    state.editor = {
      playlist: data.playlist,
      name: data.playlist.name,
      description: data.playlist.description || '',
      items: data.items.map((item) => ({
        contentId: item.contentId,
        content: item.content,
        durationSeconds: item.durationSeconds,
        fitMode: item.fitMode,
        transitionMs: item.transitionMs,
        enabled: item.enabled,
      })),
    };
    el.view.innerHTML = `
      <div style="margin-bottom:14px"><a class="btn btn-ghost btn-sm" href="#/playlists">← 재생목록 목록</a></div>
      <div class="playlist-editor">
        <section class="card card-pad">
          <form id="playlist-editor-form" data-playlist-id="${esc(playlistId)}" class="form-grid">
            <div class="form-grid two">
              <label class="field"><span>재생목록 이름</span><input id="playlist-name" maxlength="120" required value="${esc(state.editor.name)}" /></label>
              <label class="field"><span>설명 <span class="muted">(선택)</span></span><input id="playlist-description" maxlength="500" value="${esc(state.editor.description)}" placeholder="예: 로비 오전 안내" /></label>
            </div>
            <div class="divider"></div>
            <div class="card-head" style="margin-bottom:0"><div><h3>재생 항목</h3><span class="tiny muted">위에서 아래로 순환합니다. 동영상은 재생이 끝나면 넘어갑니다.</span></div><div class="button-row"><select id="add-content-select" aria-label="추가할 콘텐츠" style="min-width:220px">${state.contents.map((content) => `<option value="${esc(content.id)}">${esc(content.name)} (${kindLabel(content.kind)})</option>`).join('')}</select><button class="btn btn-celadon btn-sm" type="button" data-action="add-playlist-item" ${state.contents.length ? '' : 'disabled'}>+ 항목 추가</button></div></div>
            <div id="editor-items" class="playlist-items"></div>
            <p id="playlist-error" class="form-error" hidden></p>
            <div class="form-actions"><a class="btn btn-ghost" href="#/playlists">취소</a><button class="btn btn-primary btn-lg" type="submit">재생목록 저장</button></div>
          </form>
        </section>
        <aside class="card card-pad">
          <div class="summary-box">
            <h3>재생 요약</h3>
            <dl><dt>항목</dt><dd id="summary-count">0개</dd><dt>사용 항목</dt><dd id="summary-enabled">0개</dd><dt>한 바퀴</dt><dd id="summary-total">0초</dd><dt>마지막 저장</dt><dd>${fmtDate(state.editor.playlist.updated_at)}</dd></dl>
          </div>
          <p class="tiny muted" style="margin-top:16px">저장 후 <a href="#/devices">기기</a>의 재생 설정에서 이 목록을 선택하고 <strong>게시</strong>해야 재생기에 반영됩니다.</p>
          <p class="tiny muted">키보드로도 항목을 추가하고 ↑/↓ 버튼으로 순서를 바꿀 수 있습니다.</p>
        </aside>
      </div>`;
    renderEditorItems();
  } catch (error) {
    el.view.innerHTML = `<div class="empty"><div class="empty-mark">!</div><h3>재생목록을 열 수 없습니다</h3><p>${esc(error.message)}</p><a class="btn btn-primary" href="#/playlists">목록으로</a></div>`;
  }
}

function syncEditorFields() {
  if (!state.editor) return;
  const name = $('#playlist-name');
  const description = $('#playlist-description');
  if (name) state.editor.name = name.value;
  if (description) state.editor.description = description.value;
  $$('[data-editor-item]').forEach((row) => {
    const index = Number(row.dataset.index);
    const item = state.editor.items[index];
    if (!item) return;
    item.durationSeconds = Number($('[data-item-duration]', row).value) || 10;
    item.fitMode = $('[data-item-fit]', row).value;
    item.transitionMs = Number($('[data-item-transition]', row).value) || 0;
    item.enabled = $('[data-item-enabled]', row).checked;
  });
}

function renderEditorItems() {
  if (!state.editor) return;
  const container = $('#editor-items');
  if (!container) return;
  if (!state.editor.items.length) {
    container.innerHTML = `<div class="empty" style="padding:30px 20px"><div class="empty-mark">＋</div><h3>재생 항목이 없습니다</h3><p>위에서 콘텐츠를 고르고 <strong>항목 추가</strong>를 눌러 주세요.</p></div>`;
  } else {
    container.innerHTML = state.editor.items.map((item, index) => `
      <div class="playlist-item" data-editor-item data-index="${index}">
        ${thumbHtml(item.content, { portrait: item.content.width && item.content.height && item.content.height > item.content.width })}
        <div>
          <p class="playlist-item-title">${index + 1}. ${esc(item.content.name)}</p>
          <div class="playlist-item-fields">
            <label>표시 시간(초)<input type="number" data-item-duration min="3" max="3600" value="${item.durationSeconds}" /></label>
            <label>화면 맞춤<select data-item-fit><option value="contain" ${item.fitMode === 'contain' ? 'selected' : ''}>전체 보이기</option><option value="cover" ${item.fitMode === 'cover' ? 'selected' : ''}>채우기</option><option value="stretch" ${item.fitMode === 'stretch' ? 'selected' : ''}>늘이기</option></select></label>
            <label>전환(ms)<input type="number" data-item-transition min="0" max="3000" step="100" value="${item.transitionMs}" /></label>
            <label style="justify-content:end"><span>&nbsp;</span><span style="display:flex;align-items:center;gap:5px;font-size:11px;color:#48565d"><input type="checkbox" data-item-enabled ${item.enabled ? 'checked' : ''} style="width:auto;min-height:0" /> 사용</span></label>
          </div>
        </div>
        <div class="playlist-item-tools">
          <button class="btn btn-ghost btn-sm" type="button" data-action="move-item-up" data-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="${esc(item.content.name)} 위로 이동">↑</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="move-item-down" data-index="${index}" ${index === state.editor.items.length - 1 ? 'disabled' : ''} aria-label="${esc(item.content.name)} 아래로 이동">↓</button>
          <button class="btn btn-danger btn-sm" type="button" data-action="remove-playlist-item" data-index="${index}" aria-label="${esc(item.content.name)} 빼기">빼기</button>
        </div>
      </div>`).join('');
  }
  updateEditorSummary();
}

function updateEditorSummary() {
  if (!state.editor) return;
  const enabled = state.editor.items.filter((item) => item.enabled);
  const total = enabled.reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0);
  const count = $('#summary-count');
  if (count) count.textContent = `${state.editor.items.length}개`;
  const enabledEl = $('#summary-enabled');
  if (enabledEl) enabledEl.textContent = `${enabled.length}개`;
  const totalEl = $('#summary-total');
  if (totalEl) totalEl.textContent = durationLabel(total);
}

async function savePlaylistEditor(form) {
  if (!state.editor) return false;
  syncEditorFields();
  const errorEl = $('#playlist-error');
  if (!state.editor.name.trim()) {
    errorEl.textContent = '재생목록 이름을 입력해 주세요.';
    errorEl.hidden = false;
    return false;
  }
  if (!state.editor.items.length) {
    errorEl.textContent = '재생 항목을 하나 이상 추가해 주세요.';
    errorEl.hidden = false;
    return false;
  }
  if (!state.editor.items.some((item) => item.enabled)) {
    errorEl.textContent = '사용 중인 항목이 하나 이상 있어야 합니다.';
    errorEl.hidden = false;
    return false;
  }
  errorEl.hidden = true;
  const result = await api(`/api/playlists/${encodeURIComponent(state.editor.playlist.id)}`, {
    method: 'PUT',
    body: {
      name: state.editor.name.trim(),
      description: state.editor.description.trim(),
      items: state.editor.items.map((item) => ({
        contentId: item.contentId,
        durationSeconds: item.durationSeconds,
        fitMode: item.fitMode,
        transitionMs: item.transitionMs,
        enabled: item.enabled,
      })),
    },
  });
  state.editor.playlist = result.playlist;
  state.editor.items = result.items.map((item) => ({
    contentId: item.contentId,
    content: item.content,
    durationSeconds: item.durationSeconds,
    fitMode: item.fitMode,
    transitionMs: item.transitionMs,
    enabled: item.enabled,
  }));
  await loadAll();
  renderEditorItems();
  toast('재생목록을 저장했습니다. 기기에 게시하면 반영됩니다.');
  return true;
}

/* ---------------- Modals ---------------- */
function openModal({ title, subtitle = '', body, footer = '', wide = false }) {
  if (el.modal.open) el.modal.close();
  el.modal.className = `modal ${wide ? 'wide' : ''}`;
  el.modal.innerHTML = `
    <div class="modal-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="icon-button" type="button" data-close aria-label="닫기">×</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">${footer}</div>`;
  el.modal.showModal();
  const firstInput = $('input:not([type=hidden]), select, textarea', el.modal);
  setTimeout(() => firstInput?.focus(), 30);
}

function closeModal() {
  if (el.modal.open) el.modal.close();
}

function openUrlModal() {
  openModal({
    title: 'URL 콘텐츠 추가',
    subtitle: '안내 페이지처럼 웹 주소로 보여줄 화면을 추가합니다.',
    body: `<form id="create-url-form" class="form-grid">
      <label class="field"><span>이름</span><input name="name" maxlength="200" required placeholder="예: 오늘의 공연 안내" /></label>
      <label class="field"><span>웹 주소</span><input name="url" type="url" maxlength="2000" required placeholder="https://example.com/notice" /><span class="help">외부 사이트가 iframe 표시를 막아 두면 화면에 나오지 않을 수 있습니다. 로컬 안내 페이지 주소를 권장합니다.</span></label>
      <p id="create-url-error" class="form-error" hidden></p>
    </form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>취소</button><button class="btn btn-primary" type="submit" form="create-url-form">URL 추가</button>`,
  });
}

function openRenameModal(content) {
  openModal({
    title: '콘텐츠 이름 변경',
    body: `<form id="rename-content-form" data-id="${esc(content.id)}" class="form-grid"><label class="field"><span>이름</span><input name="name" maxlength="200" required value="${esc(content.name)}" /></label><p id="rename-error" class="form-error" hidden></p></form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>취소</button><button class="btn btn-primary" type="submit" form="rename-content-form">저장</button>`,
  });
}

function openCreateDeviceModal() {
  openModal({
    title: '기기 추가',
    subtitle: '관리할 화면을 먼저 만들고 6자리 등록 코드를 재생기에 입력합니다.',
    body: `<form id="create-device-form" class="form-grid">
      <div class="form-grid two">
        <label class="field"><span>기기 이름</span><input name="name" maxlength="120" required placeholder="예: 로비 안내 화면" /></label>
        <label class="field"><span>위치 <span class="muted">(선택)</span></span><input name="location" maxlength="200" placeholder="예: 1층 인포메이션센터" /></label>
      </div>
      <div class="form-grid two">
        <label class="field"><span>화면 방향</span><select id="device-orientation" name="orientation"><option value="landscape">가로</option><option value="portrait">세로</option></select></label>
        <label class="field"><span>해상도</span><span style="display:flex;gap:6px;align-items:center"><input name="width" type="number" min="320" max="7680" value="1920" aria-label="가로 픽셀" /><span>×</span><input name="height" type="number" min="320" max="7680" value="1080" aria-label="세로 픽셀" /></span></label>
      </div>
      <label class="field"><span>기본 재생목록 <span class="muted">(선택)</span></span><select name="playlistId">${playlistOptions(null, true)}</select><span class="help">나중에 기기의 재생 설정에서 바꿀 수 있습니다.</span></label>
      <label class="field"><span>메모 <span class="muted">(선택)</span></span><textarea name="notes" maxlength="1000" placeholder="설치 위치, 담당자, 특이사항"></textarea></label>
      <p id="create-device-error" class="form-error" hidden></p>
    </form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>취소</button><button class="btn btn-primary" type="submit" form="create-device-form">기기 추가</button>`,
  });
  const orientation = $('#device-orientation');
  orientation?.addEventListener('change', () => {
    const form = $('#create-device-form');
    if (!form) return;
    const width = $('input[name=width]', form);
    const height = $('input[name=height]', form);
    if (!width || !height) return;
    if (orientation.value === 'portrait') { width.value = '1080'; height.value = '1920'; }
    else { width.value = '1920'; height.value = '1080'; }
  });
}

function openCreatePlaylistModal() {
  openModal({
    title: '새 재생목록',
    subtitle: '이름을 정하면 콘텐츠를 추가하는 편집 화면으로 이동합니다.',
    body: `<form id="create-playlist-form" class="form-grid"><label class="field"><span>이름</span><input name="name" maxlength="120" required placeholder="예: 로비 기본 순환" /></label><label class="field"><span>설명 <span class="muted">(선택)</span></span><textarea name="description" maxlength="500" placeholder="어디에서 어떤 순서로 보여줄지 적어 두세요."></textarea></label><p id="create-playlist-error" class="form-error" hidden></p></form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>취소</button><button class="btn btn-primary" type="submit" form="create-playlist-form">만들고 편집</button>`,
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('등록 코드를 복사했습니다.');
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    toast('등록 코드를 복사했습니다.');
  }
}

/* ---------------- Actions ---------------- */
document.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action]');
  if (trigger) {
    event.preventDefault();
    const action = trigger.dataset.action;
    try {
      if (action === 'navigate') {
        if (trigger.dataset.href) location.hash = trigger.dataset.href;
      } else if (action === 'pick-files') {
        $('#content-file-input')?.click();
      } else if (action === 'filter-content') {
        state.contentFilter = trigger.dataset.kind || 'all';
        renderContents();
      } else if (action === 'new-url') {
        openUrlModal();
      } else if (action === 'rename-content') {
        const content = state.contents.find((item) => item.id === trigger.dataset.id);
        if (content) openRenameModal(content);
      } else if (action === 'delete-content') {
        const content = state.contents.find((item) => item.id === trigger.dataset.id);
        if (!content) return;
        if (!confirm(`‘${content.name}’ 콘텐츠를 삭제할까요? 재생목록에서 사용 중이면 삭제할 수 없습니다.`)) return;
        await api(`/api/contents/${encodeURIComponent(content.id)}`, { method: 'DELETE' });
        await loadAll();
        renderContents();
        toast('콘텐츠를 삭제했습니다.');
      } else if (action === 'new-device') {
        openCreateDeviceModal();
      } else if (action === 'device-settings') {
        const device = state.devices.find((item) => item.id === trigger.dataset.id);
        if (device) openDeviceSettings(device);
      } else if (action === 'publish-device') {
        setBusy(trigger, true, '게시 중…');
        try {
          const published = await api(`/api/devices/${encodeURIComponent(trigger.dataset.id)}/publish`, { method: 'POST' });
          await refreshOnly();
          renderDevices();
          toast(`기기에 v${published.version}을 게시했습니다.`);
        } finally {
          setBusy(trigger, false);
        }
      } else if (action === 'copy-code') {
        await copyText(trigger.dataset.code || '');
      } else if (action === 'regenerate-code') {
        const device = state.devices.find((item) => item.id === trigger.dataset.id);
        if (!device) return;
        if (!confirm(`‘${device.name}’의 등록 코드를 새로 만들까요? 현재 연결된 재생기는 해제됩니다.`)) return;
        const result = await api(`/api/devices/${encodeURIComponent(device.id)}/regenerate-code`, { method: 'POST' });
        await refreshOnly();
        renderDevices();
        toast(`새 등록 코드는 ${result.device.pairingCode}입니다.`);
      } else if (action === 'unpair-device') {
        const device = state.devices.find((item) => item.id === trigger.dataset.id);
        if (!device) return;
        if (!confirm(`‘${device.name}’의 재생기 연결을 해제할까요? 같은 등록 코드로 다시 연결할 수 있습니다.`)) return;
        await api(`/api/devices/${encodeURIComponent(device.id)}/unpair`, { method: 'POST' });
        await refreshOnly();
        renderDevices();
        toast('재생기 연결을 해제했습니다.');
      } else if (action === 'delete-device') {
        const device = state.devices.find((item) => item.id === trigger.dataset.id);
        if (!device) return;
        if (!confirm(`‘${device.name}’ 기기를 삭제할까요? 재생 기록과 시간표도 함께 삭제됩니다.`)) return;
        await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: 'DELETE' });
        await loadAll();
        renderDevices();
        toast('기기를 삭제했습니다.');
      } else if (action === 'new-playlist') {
        openCreatePlaylistModal();
      } else if (action === 'delete-playlist') {
        const playlist = state.playlists.find((item) => item.id === trigger.dataset.id);
        if (!playlist) return;
        if (!confirm(`‘${playlist.name}’ 재생목록을 삭제할까요? 기기에서 사용 중이면 삭제할 수 없습니다.`)) return;
        await api(`/api/playlists/${encodeURIComponent(playlist.id)}`, { method: 'DELETE' });
        await loadAll();
        renderPlaylists();
        toast('재생목록을 삭제했습니다.');
      } else if (action === 'add-playlist-item') {
        if (!state.editor) return;
        syncEditorFields();
        const select = $('#add-content-select');
        const content = state.contents.find((item) => item.id === select?.value);
        if (!content) return;
        state.editor.items.push({ contentId: content.id, content, durationSeconds: content.kind === 'url' ? 15 : 10, fitMode: 'contain', transitionMs: 400, enabled: true });
        renderEditorItems();
      } else if (action === 'remove-playlist-item') {
        syncEditorFields();
        state.editor.items.splice(Number(trigger.dataset.index), 1);
        renderEditorItems();
      } else if (action === 'move-item-up' || action === 'move-item-down') {
        syncEditorFields();
        const index = Number(trigger.dataset.index);
        const nextIndex = action === 'move-item-up' ? index - 1 : index + 1;
        if (nextIndex < 0 || nextIndex >= state.editor.items.length) return;
        const [item] = state.editor.items.splice(index, 1);
        state.editor.items.splice(nextIndex, 0, item);
        renderEditorItems();
      } else if (action === 'add-schedule') {
        const list = $('#schedule-list');
        $('#schedule-empty')?.remove();
        list?.insertAdjacentHTML('beforeend', scheduleRowHtml());
        const last = list?.lastElementChild;
        $('[data-start]', last)?.focus();
      } else if (action === 'remove-schedule') {
        trigger.closest('[data-schedule-row]')?.remove();
      }
    } catch (error) {
      showError(error);
      if (trigger && trigger.tagName === 'BUTTON') trigger.disabled = false;
    }
  }

  if (event.target.closest('[data-close]')) closeModal();
  if (event.target === el.modal) closeModal();
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'content-file-input') {
    uploadFiles(event.target.files);
    event.target.value = '';
  }
  if (event.target.closest('[data-editor-item]')) {
    syncEditorFields();
    updateEditorSummary();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.closest('[data-editor-item]') || event.target.id === 'playlist-name' || event.target.id === 'playlist-description') {
    syncEditorFields();
    updateEditorSummary();
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id === 'login-form') return;
  event.preventDefault();
  const submitter = event.submitter;
  const label = submitter?.textContent;
  setBusy(submitter, true);
  try {
    if (form.id === 'create-url-form') {
      const data = new FormData(form);
      const error = $('#create-url-error');
      try {
        await api('/api/contents/url', { method: 'POST', body: { name: data.get('name'), url: data.get('url') } });
      } catch (errorValue) {
        error.textContent = errorValue.message;
        error.hidden = false;
        return;
      }
      closeModal();
      await loadAll();
      renderContents();
      toast('URL 콘텐츠를 추가했습니다.');
    } else if (form.id === 'rename-content-form') {
      const data = new FormData(form);
      const error = $('#rename-error');
      try {
        await api(`/api/contents/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: { name: data.get('name') } });
      } catch (errorValue) {
        error.textContent = errorValue.message;
        error.hidden = false;
        return;
      }
      closeModal();
      await loadAll();
      renderContents();
      toast('이름을 변경했습니다.');
    } else if (form.id === 'create-device-form') {
      const data = new FormData(form);
      const error = $('#create-device-error');
      try {
        const result = await api('/api/devices', {
          method: 'POST',
          body: {
            name: data.get('name'),
            location: data.get('location'),
            orientation: data.get('orientation'),
            width: Number(data.get('width')),
            height: Number(data.get('height')),
            playlistId: data.get('playlistId') || null,
            notes: data.get('notes'),
          },
        });
        closeModal();
        await loadAll();
        if (location.hash !== '#/devices') location.hash = '#/devices';
        else renderDevices();
        toast(`기기를 추가했습니다. 등록 코드는 ${result.device.pairingCode}입니다.`);
      } catch (errorValue) {
        error.textContent = errorValue.message;
        error.hidden = false;
      }
    } else if (form.id === 'create-playlist-form') {
      const data = new FormData(form);
      const error = $('#create-playlist-error');
      try {
        const result = await api('/api/playlists', { method: 'POST', body: { name: data.get('name'), description: data.get('description') } });
        await loadAll();
        closeModal();
        location.hash = `#/playlists/${result.playlist.id}`;
      } catch (errorValue) {
        error.textContent = errorValue.message;
        error.hidden = false;
      }
    } else if (form.id === 'playlist-editor-form') {
      await savePlaylistEditor(form);
    } else if (form.id === 'device-settings-form') {
      const after = submitter?.dataset.after === 'publish';
      const error = $('#device-settings-error');
      try {
        await saveDeviceSettings(form, after);
      } catch (errorValue) {
        error.textContent = errorValue.message;
        error.hidden = false;
      }
    }
  } finally {
    setBusy(submitter, false);
    if (submitter && label) submitter.textContent = label;
  }
});

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitter = $('button[type=submit]', el.loginForm);
  setBusy(submitter, true, '확인 중…');
  el.loginError.hidden = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: { password: el.password.value } });
    el.password.value = '';
    await enterApp();
  } catch (error) {
    el.loginError.textContent = error.message;
    el.loginError.hidden = false;
    el.password.select();
  } finally {
    setBusy(submitter, false);
  }
});

$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.booted = false;
  showLogin();
  el.password.value = '';
});

$('#refresh-button').addEventListener('click', async () => {
  try {
    await loadAll();
    await route();
    toast('최신 상태로 새로고침했습니다.');
  } catch (error) {
    showError(error);
  }
});

el.modal.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeModal();
});

(async function boot() {
  try {
    try {
      const publicConfig = await api('/api/player/config');
      if (publicConfig?.sampleMode && publicConfig?.demoDefaultPassword) el.loginDemoHint.hidden = false;
    } catch { /* demo hint is optional */ }
    const me = await api('/api/auth/me');
    if (me.authenticated) await enterApp();
    else showLogin();
  } catch {
    showLogin('서버에 연결하지 못했습니다. 서버 실행 상태를 확인해 주세요.');
  }
})();
