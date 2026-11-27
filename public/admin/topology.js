/* SPDX-License-Identifier: Apache-2.0 */
(function () {
  'use strict';

  let active = { siteId: '', detail: null, preview: null };
  let monitorRefreshTimer = 0;
  let monitorChangeHistory = [];

  const page = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  async function request(path, options = {}) {
    const requestOptions = { ...options, headers: { ...(options.headers || {}) } };
    if (options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)) {
      requestOptions.body = JSON.stringify(options.body);
      requestOptions.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, requestOptions);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* plain response */ }
    if (response.status === 401) {
      if (window.showLogin) window.showLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      throw new Error('로그인이 필요합니다.');
    }
    if (!response.ok) throw new Error(data?.error || `요청을 처리하지 못했습니다. (${response.status})`);
    return data;
  }

  function toast(message) {
    if (window.toast) window.toast(message);
  }

  function errorToast(error) {
    console.error(error);
    if (window.toast) window.toast(error.message || '요청을 처리하지 못했습니다.', 'error');
  }

  function dateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ko-KR');
  }

  function modeLabel(mode) {
    return ({
      individual: '화면별 순환',
      'synchronized-cycle': '서버 시각 동기',
      mirror: '동시 복제',
      canvas: '통합 캔버스',
    })[mode] || mode || '—';
  }

  async function render(siteId, view) {
    clearTimeout(monitorRefreshTimer);
    active = { siteId, detail: null, preview: null };
    view.innerHTML = '<div class="loading">장소와 화면 배치를 불러오는 중…</div>';
    try {
      if (!siteId) await renderList(view);
      else await renderEditor(view, siteId);
    } catch (error) {
      view.innerHTML = `<div class="empty"><div class="empty-mark">!</div><h3>화면 관리 정보를 열 수 없습니다</h3><p>${page(error.message)}</p><button class="btn btn-primary" type="button" data-topology-action="reload">다시 시도</button></div>`;
    }
  }

  async function renderList(view) {
    const data = await request('/api/sites');
    view.innerHTML = `
      <div class="stack">
        <section class="card card-pad topology-intro">
          <div class="card-head" style="margin:0">
            <div><p class="eyebrow" style="margin:0 0 5px">SITE → GROUP → DISPLAY</p><h2>장소별 다중 모니터</h2><p class="muted" style="margin:7px 0 0">PC 기기 한 대에 여러 모니터를 붙이거나, 모니터마다 다른 PC를 연결할 수 있습니다.</p></div>
            <a class="btn btn-ghost" href="#/devices">PC 기기 관리</a>
          </div>
        </section>
        <section class="card card-pad">
          <div class="card-head"><div><h3>새 장소</h3><span class="tiny muted">기본 1개 화면과 단일 배치가 함께 만들어집니다.</span></div></div>
          <form class="form-grid topology-create" data-topology-form="create-site">
            <label class="field"><span>장소 이름</span><input name="name" maxlength="120" required placeholder="예: 1층 로비" /></label>
            <label class="field"><span>시간대</span><input name="timezone" value="Asia/Seoul" maxlength="80" /></label>
            <label class="field topology-wide"><span>메모 <span class="muted">(선택)</span></span><input name="notes" maxlength="1000" placeholder="설치 위치나 운영 메모" /></label>
            <div class="form-actions topology-wide"><button class="btn btn-primary" type="submit">장소 만들기</button></div>
          </form>
        </section>
        <section>
          <div class="card-head"><div><h3>등록된 장소</h3><span class="tiny muted">장소 → 화면 그룹 → 모니터 순서로 구성됩니다.</span></div><span class="tag">${data.sites.length}개 장소</span></div>
          ${data.sites.length ? `<div class="site-grid">${data.sites.map((site) => `
            <a class="card site-card" href="#/sites/${encodeURIComponent(site.id)}">
              <span class="site-card-mark">▤</span>
              <div><h3>${page(site.name)}</h3><p>${page(site.timezone)} · ${site.displayCount}개 모니터</p></div>
              <dl><dt>화면 그룹</dt><dd>${site.groupCount}</dd><dt>연결 PC</dt><dd>${site.assignedDeviceCount}</dd></dl>
              <span class="site-card-open">배치 열기 →</span>
            </a>`).join('')}</div>` : `
            <div class="empty"><div class="empty-mark">▤</div><h3>아직 장소가 없습니다</h3><p>장소를 만들고 모니터 수·해상도·배치를 정하세요. 기존 기기도 첫 실행 시 기본 장소로 자동 이전됩니다.</p></div>`}
        </section>
      </div>`;
  }

  async function renderEditor(view, siteId) {
    const [detail, playlists, nativeMonitorResult] = await Promise.all([
      request(`/api/sites/${encodeURIComponent(siteId)}`),
      request('/api/playlists'),
      request('/api/native-monitors'),
    ]);
    active = { siteId, detail, preview: active.preview };
    const group = detail.groups[0];
    const monitorsByDevice = new Map();
    const monitorErrorsByDevice = new Map();
    for (const device of detail.devices) {
      if (device.localHost) {
        monitorsByDevice.set(device.id, nativeMonitorResult.supported && !nativeMonitorResult.error ? nativeMonitorResult.monitors : []);
        if (nativeMonitorResult.error) monitorErrorsByDevice.set(device.id, nativeMonitorResult.error);
      } else {
        const remoteResult = await request(`/api/native-monitors?deviceId=${encodeURIComponent(device.id)}`);
        monitorsByDevice.set(device.id, remoteResult.supported && !remoteResult.error ? remoteResult.monitors : []);
        if (remoteResult.error) monitorErrorsByDevice.set(device.id, remoteResult.error);
      }
    }
    if (!group) {
      view.innerHTML = '<div class="empty"><h3>화면 그룹이 없습니다</h3><p>장소 정보를 확인하거나 다시 만들어 주세요.</p></div>';
      return;
    }
    const first = group.displays[0] || { width: 1920, height: 1080, rotation: 0, fit_mode: 'contain' };
    const playlistOptions = (selected, noneLabel) => `<option value="">${page(noneLabel)}</option>${playlists.playlists.map((playlist) => `<option value="${page(playlist.id)}" ${playlist.id === selected ? 'selected' : ''}>${page(playlist.name)}</option>`).join('')}`;
    const nativeMonitorsFor = (deviceId) => monitorsByDevice.get(deviceId) || [];
    const deviceOptions = (selected, devices = detail.devices) => `<option value="">PC 연결 안 함</option>${devices.map((device) => {
      const monitorList = nativeMonitorsFor(device.id).filter((monitor) => typeof monitor.bindingId === 'string' && /^MONITOR\\/iu.test(monitor.bindingId));
      return `<option value="${page(device.id)}" data-local-host="${device.localHost ? 'true' : 'false'}" data-monitors="${page(JSON.stringify(monitorList))}" ${device.id === selected ? 'selected' : ''}>${page(device.name)} · ${device.displayCount}화면</option>`;
    }).join('')}`;
    const nativeMonitorOptions = (selected, deviceId) => {
      const monitors = nativeMonitorsFor(deviceId);
      const err = monitorErrorsByDevice.get(deviceId);
      const selectedExists = monitors.some((monitor) => monitor.bindingId === selected);
      const savedBindingStatus = selected && !/^MONITOR\\/iu.test(selected)
        ? '안정 식별자가 아니므로 다시 배정해야 함'
        : selected && !err && monitors.some((monitor) => monitor.stableId === selected && !monitor.bindingId)
          ? '안정 식별자가 아니므로 다시 배정해야 함'
        : err ? '현재 PC에서 확인할 수 없음' : '현재 감지되지 않음';
      return `<option value="">물리 모니터 지정 안 함</option>${selected && !selectedExists ? `<option value="${page(selected)}" selected>저장된 모니터 ${page(selected)} · ${savedBindingStatus}</option>` : ''}${monitors.map((monitor) => monitor.bindingId ? `<option value="${page(monitor.bindingId)}" ${monitor.bindingId === selected ? 'selected' : ''}>${page(monitor.friendlyName)} · ${page(monitor.deviceName)} · ${monitor.resolution.width}×${monitor.resolution.height}</option>` : '').join('')}`;
    };
    const groupDevices = group.devices || detail.devices;
    const assignedDevice = group.displays.find((display) => display.device_id)?.device_id || '';

    view.innerHTML = `
      <div class="topology-head">
        <div><a class="btn btn-ghost btn-sm" href="#/sites">← 장소 목록</a><h2>${page(detail.site.name)}</h2><p class="muted">${page(detail.site.timezone)} · PC 기기 ${detail.devices.length}대 · 모니터 ${group.displays.length}개</p></div>
        <div class="button-row"><button class="btn btn-ghost" type="button" data-topology-action="refresh-preview">미리보기 새로고침</button><button class="btn btn-primary" type="button" data-topology-action="publish" data-group-id="${page(group.id)}">게시</button></div>
      </div>

      <div class="topology-layout">
        <div class="stack">
          <section class="card card-pad">
            <div class="card-head"><div><p class="eyebrow" style="margin:0 0 5px">1. MONITORS & LAYOUT</p><h3>모니터와 배치</h3><span class="tiny muted">화면 수는 1~256개 범위에서 자유롭게 정할 수 있습니다. 저장 전에는 실제 송출이 바뀌지 않습니다.</span></div><span class="tag">${page(modeLabel(group.playback_mode))}</span></div>
            <form class="form-grid topology-config" data-topology-form="configure-group" data-group-id="${page(group.id)}">
              <label class="field"><span>PC 기본 배정</span><select name="deviceId">${deviceOptions(assignedDevice, groupDevices)}</select><span class="help">새 화면과 아직 연결되지 않은 화면에만 적용됩니다. 연결된 화면의 PC는 아래에서 각각 바꿉니다.</span></label>
              <label class="field"><span>모니터 수</span><input name="displayCount" type="number" min="1" max="256" value="${group.displays.length}" required /></label>
              <label class="field"><span>해상도</span><div class="resolution-fields"><input name="width" type="number" min="320" max="16384" value="${first.width}" aria-label="가로 픽셀" /><span>×</span><input name="height" type="number" min="320" max="16384" value="${first.height}" aria-label="세로 픽셀" /></div></label>
              <label class="field"><span>화면 방향</span><select name="orientation"><option value="landscape" ${first.orientation !== 'portrait' ? 'selected' : ''}>가로</option><option value="portrait" ${first.orientation === 'portrait' ? 'selected' : ''}>세로</option></select></label>
              <label class="field"><span>회전</span><select name="rotation">${[0,90,180,270].map((rotation) => `<option value="${rotation}" ${Number(first.rotation) === rotation ? 'selected' : ''}>${rotation}°</option>`).join('')}</select></label>
              <label class="field"><span>원본 맞춤</span><select name="fitMode"><option value="contain" ${first.fit_mode === 'contain' ? 'selected' : ''}>전체 보이기</option><option value="cover" ${first.fit_mode === 'cover' ? 'selected' : ''}>채우기</option><option value="stretch" ${first.fit_mode === 'stretch' ? 'selected' : ''}>늘이기</option></select></label>
              <label class="field"><span>배치</span><select name="layoutType">${['row','column','grid'].map((type) => `<option value="${type}" ${group.layout?.type === type ? 'selected' : ''}>${{row:'가로 한 줄',column:'세로 한 줄',grid:'격자'}[type]}</option>`).join('')}</select></label>
              <label class="field"><span>열 <span class="muted">(격자 선택 시)</span></span><input name="columns" type="number" min="1" max="256" placeholder="자동" /></label>
              <label class="field"><span>행 <span class="muted">(격자 선택 시)</span></span><input name="rows" type="number" min="1" max="256" placeholder="자동" /></label>
              <label class="field"><span>화면 간격</span><input name="gap" type="number" min="0" max="0.25" step="0.005" value="${group.layout?.gap ?? 0.01}" /></label>
              <label class="field"><span>재생 모드</span><select name="playbackMode"><option value="individual" ${group.playback_mode === 'individual' ? 'selected' : ''}>화면별 순환</option><option value="synchronized-cycle" ${group.playback_mode === 'synchronized-cycle' ? 'selected' : ''}>서버 시각 동기 순환</option><option value="mirror" ${group.playback_mode === 'mirror' ? 'selected' : ''}>동시 복제</option><option value="canvas" ${group.playback_mode === 'canvas' ? 'selected' : ''}>하나의 캔버스</option></select></label>
              <label class="field"><span>전환 간격(초)</span><input name="dwellSeconds" type="number" min="1" max="3600" value="${Math.round(group.dwell_ms / 1000)}" /></label>
              <label class="field"><span>그룹 기본 재생목록</span><select name="playlistId">${playlistOptions(group.playlist_id, '지정 안 함')}</select></label>
              <label class="field checkbox-field"><span>&nbsp;</span><span><input name="resetEpoch" type="checkbox" /> 저장 시 동기 기준 시각 새로 시작</span></label>
              <div class="form-actions topology-wide"><button class="btn btn-primary" type="submit">모니터·배치 저장</button></div>
            </form>
          </section>

          <section class="card card-pad">
            <div class="card-head"><div><p class="eyebrow" style="margin:0 0 5px">2. SCREEN ASSIGNMENT</p><h3>화면별 콘텐츠·PC 배정</h3><span class="tiny muted">재생목록과 실행 PC를 화면마다 지정합니다. 재생목록을 비워 두면 그룹 기본을 씁니다.</span></div></div>
            <div class="screen-assignment-list">
              ${group.displays.map((display, index) => `
                <div class="screen-assignment" data-display-id="${page(display.id)}" data-device-id="${page(display.device_id || '')}" data-local-host="${display.localHost ? 'true' : 'false'}">
                  <div class="screen-assignment-name"><span>${index + 1}</span><div><strong>${page(display.name)}</strong><small>${display.width}×${display.height} · ${page(display.deviceName || 'PC 미연결')}</small></div></div>
                  <label><span>PC 기기</span><select data-screen-device>${deviceOptions(display.device_id, groupDevices)}</select></label>
                  <label><span>물리 모니터 (${page(display.deviceName || 'PC 미연결')})</span><select data-screen-native-monitor ${display.device_id ? '' : 'disabled'}>${nativeMonitorOptions(display.nativeMonitorId, display.device_id)}</select><small class="muted" data-screen-monitor-help>${monitorErrorsByDevice.get(display.device_id) ? page(monitorErrorsByDevice.get(display.device_id)) : 'PC를 바꾸면 이 PC에서 감지된 모니터를 선택할 수 있습니다.'}</small></label>
                  <label><span>재생목록</span><select data-screen-playlist>${playlistOptions(display.playlist_id, '그룹 기본 사용')}</select></label>
                  <label><span>회전</span><select data-screen-rotation>${[0,90,180,270].map((rotation) => `<option value="${rotation}" ${display.rotation === rotation ? 'selected' : ''}>${rotation}°</option>`).join('')}</select></label>
                  <label><span>맞춤</span><select data-screen-fit><option value="contain" ${display.fit_mode === 'contain' ? 'selected' : ''}>전체</option><option value="cover" ${display.fit_mode === 'cover' ? 'selected' : ''}>채우기</option><option value="stretch" ${display.fit_mode === 'stretch' ? 'selected' : ''}>늘이기</option></select></label>
                  <button class="btn btn-ghost btn-sm" type="button" data-topology-action="save-screen">배정 저장</button>
                </div>`).join('')}
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="card card-pad">
            <div class="card-head"><div><p class="eyebrow" style="margin:0 0 5px">HOST DISPLAY STATUS</p><h3>이 PC에 연결된 실제 모니터</h3><span class="tiny muted" data-native-monitors-status>감지 정보를 불러오는 중…</span></div></div>
            <div data-native-monitors-list><div class="loading">Windows 디스플레이 확인 중…</div></div>
          </section>
          <section class="card card-pad topology-preview-card">
            <div class="card-head"><div><p class="eyebrow" style="margin:0 0 5px">3. RENDERPLAN PREVIEW</p><h3>게시 전 미리보기</h3><span class="tiny muted">송출과 같은 순수 엔진의 RenderPlan을 사용합니다.</span></div></div>
            <div id="topology-preview"><div class="loading">미리보기를 계산하는 중…</div></div>
          </section>
          <section class="card card-pad">
            <div class="card-head"><h3>게시 정보</h3><span class="badge badge-plain">캐시 유지</span></div>
            <dl class="topology-facts"><dt>장소</dt><dd>${page(detail.site.name)}</dd><dt>모니터</dt><dd>${group.displays.length}개</dd><dt>배치</dt><dd>${page(group.layout?.type || '—')}</dd><dt>동기 기준</dt><dd>${dateTime(group.epoch)}</dd></dl>
            <p class="tiny muted">게시하면 배치·화면별 재생목록·해상도·회전이 불변 스냅샷으로 저장됩니다. 기존 게시본은 새 게시가 성공할 때까지 유지됩니다.</p>
            <button class="btn btn-primary btn-block" type="button" data-topology-action="publish" data-group-id="${page(group.id)}">이 배치를 게시</button>
          </section>
        </aside>
      </div>`;
    await refreshPreview(view);
    await refreshNativeMonitors(view);
  }

  async function refreshNativeMonitors(view) {
    const list = view.querySelector('[data-native-monitors-list]');
    const status = view.querySelector('[data-native-monitors-status]');
    if (!list || !status || !view.isConnected) return;
    try {
      const result = await request('/api/native-monitors');
      if (!list.isConnected) return;
      if (!result.supported || result.error) {
        status.textContent = result.error || '모니터 감지를 지원하지 않습니다.';
        list.innerHTML = `<p class="tiny muted">${page(result.error || '실제 모니터 정보를 사용할 수 없습니다.')}</p>`;
      } else {
        const changes = result.changes || [];
        monitorChangeHistory = [...monitorChangeHistory, ...changes.map((change) => ({ ...change, detectedAt: result.detectedAt }))].slice(-20);
        status.textContent = `마지막 감지 ${dateTime(result.detectedAt)} · 15초 간격 확인`;
        const changeNames = { bounds: '위치·영역', resolution: '해상도', orientation: '방향', primary: '주 디스플레이' };
        const changeLabels = { connected: '연결됨', disconnected: '연결 해제됨', changed: '정보 변경됨' };
        const history = monitorChangeHistory.length
          ? `<div class="preview-plans">${monitorChangeHistory.slice().reverse().map((change) => `<div><span>${page(changeLabels[change.type])} · ${page(change.monitor.friendlyName)}</span><strong>${change.type === 'changed' ? page(change.changedAttributes.map((attribute) => changeNames[attribute]).join(', ')) : page(change.stableId)}</strong><small>${page(change.stableId)} · ${dateTime(change.detectedAt)}</small></div>`).join('')}</div>`
          : '<p class="tiny muted">아직 모니터 변경을 감지하지 않았습니다.</p>';
        const currentDisplays = result.monitors.length ? `<div class="screen-assignment-list">${result.monitors.map((monitor) => `
          <div class="screen-assignment"><div class="screen-assignment-name"><span>${monitor.primary ? '★' : '•'}</span><div><strong>${page(monitor.friendlyName)}</strong><small>${page(monitor.deviceName)} · ${monitor.resolution.width}×${monitor.resolution.height} · ${page(monitor.orientation)}</small></div></div>
          <small>${monitor.primary ? '주 디스플레이' : '보조 디스플레이'} · ${monitor.attached ? '연결됨' : '분리됨'} · (${monitor.bounds.x}, ${monitor.bounds.y})</small><small title="${page(monitor.stableId)}">${monitor.bindingId ? page(monitor.bindingId) : '안정 식별자 없음 · 배정할 수 없음'}</small></div>`).join('')}</div>` : '<p class="tiny muted">현재 연결된 모니터가 없습니다.</p>';
        list.innerHTML = `<h4>감지된 모니터</h4>${currentDisplays}<h4>변경 이력</h4>${history}`;
      }
    } catch (error) {
      status.textContent = '감지 상태를 확인하지 못했습니다.';
      list.innerHTML = `<p class="form-error">${page(error.message)}</p>`;
    } finally {
      clearTimeout(monitorRefreshTimer);
      if (list.isConnected) monitorRefreshTimer = setTimeout(() => refreshNativeMonitors(view), 15000);
    }
  }

  function planCard(plan, display, slot) {
    const portrait = plan.viewport.height > plan.viewport.width;
    const source = plan.sourceRect || {
      x: 0,
      y: 0,
      w: plan.image?.width || plan.viewport.width,
      h: plan.image?.height || plan.viewport.height,
    };
    const destination = plan.destinationRect;
    const imageWidth = plan.image?.width || source.w;
    const imageHeight = plan.image?.height || source.h;
    const rotatedQuarter = plan.rotation === 90 || plan.rotation === 270;
    const layerStyle = rotatedQuarter
      ? `left:${(destination.w - destination.h) / 2 / destination.w * 100}%;top:${(destination.h - destination.w) / 2 / destination.h * 100}%;width:${destination.h / destination.w * 100}%;height:${destination.w / destination.h * 100}%;transform:rotate(${plan.rotation}deg)`
      : `inset:0;transform:${plan.rotation ? `rotate(${plan.rotation}deg)` : 'none'}`;
    const mediaStyle = `left:${-source.x / source.w * 100}%;top:${-source.y / source.h * 100}%;width:${imageWidth / source.w * 100}%;height:${imageHeight / source.h * 100}%`;
    let media = '';
    if (plan.kind === 'url') {
      media = `<iframe src="${page(plan.contentUrl)}" title="${page(plan.content?.name || 'URL 콘텐츠')}" loading="eager" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-popups"></iframe>`;
    } else if (plan.kind === 'video') {
      media = `<video src="${page(plan.imageUrl)}" muted loop autoplay playsinline style="${mediaStyle}"></video>`;
    } else {
      media = `<img src="${page(plan.imageUrl)}" alt="" style="${mediaStyle}" />`;
    }
    const body = plan.placeholder
      ? '<div class="preview-placeholder">배정된 콘텐츠 없음</div>'
      : `<div class="preview-media-clip" style="left:${destination.x / plan.viewport.width * 100}%;top:${destination.y / plan.viewport.height * 100}%;width:${destination.w / plan.viewport.width * 100}%;height:${destination.h / plan.viewport.height * 100}%"><div class="preview-rotation-layer" style="${layerStyle}">${media}</div></div>`;
    const style = slot
      ? `left:${slot.x * 100}%;top:${slot.y * 100}%;width:${slot.w * 100}%;height:${slot.h * 100}%`
      : 'inset:0';
    return `<div class="preview-screen ${portrait ? 'portrait' : ''}" data-display-id="${page(display.id)}" style="${style}">${body}<span class="preview-screen-label">${page(display.name)} · ${plan.viewport.width}×${plan.viewport.height} · ${plan.rotation}°</span></div>`;
  }

  async function refreshPreview(view) {
    const group = active.detail?.groups[0];
    const target = view.querySelector('#topology-preview');
    if (!group || !target) return;
    target.innerHTML = '<div class="loading">미리보기를 계산하는 중…</div>';
    try {
      const preview = await request(`/api/groups/${encodeURIComponent(group.id)}/preview`);
      active.preview = preview;
      const wall = preview.wall;
      const slots = new Map((wall.layout?.slots || []).map((slot) => [slot.id, slot]));
      const displays = new Map(wall.displays.map((display) => [display.id, display]));
      target.innerHTML = `
        <div class="preview-meta"><span>${page(modeLabel(wall.group.playbackMode))}</span><span>서버 시각 ${dateTime(preview.serverTime)}</span></div>
        <div class="preview-canvas" style="--preview-aspect:${wall.layout.canvasWidth / Math.max(1, wall.layout.canvasHeight)}">
          ${preview.plans.map((plan) => planCard(plan, displays.get(plan.displayId), slots.get(plan.slotId))).join('')}
        </div>
        <div class="preview-plans">${preview.plans.map((plan) => `<div><span>${page(plan.displayName)}</span><strong>${plan.placeholder ? '대기' : `${plan.kind === 'url' ? 'URL' : plan.kind === 'video' ? '동영상' : '이미지'} ${plan.imageIndex + 1}/${plan.itemCount ?? plan.imageCount}`}</strong><small>다음 전환 ${plan.nextChangeAt ? dateTime(plan.nextChangeAt) : '고정'}</small></div>`).join('')}</div>`;
    } catch (error) {
      target.innerHTML = `<p class="form-error">${page(error.message)}</p>`;
    }
  }

  async function createSite(form) {
    const data = new FormData(form);
    const result = await request('/api/sites', {
      method: 'POST',
      body: {
        name: data.get('name'),
        timezone: data.get('timezone'),
        notes: data.get('notes'),
      },
    });
    location.hash = `#/sites/${result.site.id}`;
    toast('장소와 기본 화면을 만들었습니다.');
  }

  async function configureGroup(form) {
    const data = new FormData(form);
    const groupId = form.dataset.groupId;
    await request(`/api/groups/${encodeURIComponent(groupId)}/configuration`, {
      method: 'PUT',
      body: {
        displayCount: Number(data.get('displayCount')),
        width: Number(data.get('width')),
        height: Number(data.get('height')),
        orientation: data.get('orientation'),
        rotation: Number(data.get('rotation')),
        layoutType: data.get('layoutType'),
        columns: data.get('columns') ? Number(data.get('columns')) : undefined,
        rows: data.get('rows') ? Number(data.get('rows')) : undefined,
        gap: Number(data.get('gap')),
        deviceId: data.get('deviceId') || null,
        playlistId: data.get('playlistId') || null,
        playbackMode: data.get('playbackMode'),
        dwellMs: Number(data.get('dwellSeconds')) * 1000,
        fitMode: data.get('fitMode'),
        resetEpoch: data.get('resetEpoch') === 'on',
      },
    });
    toast('모니터와 배치를 저장했습니다.');
    await renderEditor(document.querySelector('#view'), active.siteId);
  }

  async function saveScreen(row) {
    const displayId = row.dataset.displayId;
    const selectedDeviceId = row.querySelector('[data-screen-device]').value || null;
    const deviceChanged = selectedDeviceId !== (row.dataset.deviceId || null);
    const monitorSelect = row.querySelector('[data-screen-native-monitor]');
    const selectedDevice = row.querySelector('[data-screen-device]').selectedOptions[0];
    let reportedMonitors = [];
    try { reportedMonitors = JSON.parse(selectedDevice?.dataset.monitors || '[]'); } catch { reportedMonitors = []; }
    const hasReportedStableMonitor = reportedMonitors.some((monitor) =>
      monitor.bindingId === monitorSelect.value && /^MONITOR\\/iu.test(monitor.bindingId));
    const nativeMonitorId = hasReportedStableMonitor
      ? monitorSelect.value
      : (deviceChanged || !monitorSelect.value ? null : undefined);
    const body = {
      deviceId: selectedDeviceId,
      playlistId: row.querySelector('[data-screen-playlist]').value || null,
      rotation: Number(row.querySelector('[data-screen-rotation]').value),
      fitMode: row.querySelector('[data-screen-fit]').value,
    };
    if (nativeMonitorId !== undefined) body.nativeMonitorId = nativeMonitorId;
    await request(`/api/displays/${encodeURIComponent(displayId)}`, {
      method: 'PUT',
      body,
    });
    toast(deviceChanged && !nativeMonitorId ? 'PC를 변경했습니다. 해당 PC의 모니터 정보가 준비된 뒤 지정할 수 있습니다.' : '화면 배정을 저장했습니다.');
    await renderEditor(document.querySelector('#view'), active.siteId);
  }

  async function publish(groupId) {
    const result = await request(`/api/groups/${encodeURIComponent(groupId)}/publish`, { method: 'POST' });
    toast(`${result.deviceIds.length}대 PC에 v${result.version} 배치를 게시했습니다.`);
    await renderEditor(document.querySelector('#view'), active.siteId);
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-topology-form]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      if (form.dataset.topologyForm === 'create-site') await createSite(form);
      else if (form.dataset.topologyForm === 'configure-group') await configureGroup(form);
    } catch (error) {
      errorToast(error);
    } finally {
      if (button) button.disabled = false;
    }
  });

  document.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-topology-action]');
    if (!trigger) return;
    event.preventDefault();
    try {
      const action = trigger.dataset.topologyAction;
      if (action === 'save-screen') await saveScreen(trigger.closest('[data-display-id]'));
      else if (action === 'publish') await publish(trigger.dataset.groupId);
      else if (action === 'refresh-preview') await refreshPreview(document.querySelector('#view'));
      else if (action === 'reload') await render(active.siteId, document.querySelector('#view'));
    } catch (error) {
      errorToast(error);
    }
  });

  document.addEventListener('change', (event) => {
    const deviceSelect = event.target.closest('[data-screen-device]');
    if (!deviceSelect) return;
    const row = deviceSelect.closest('[data-display-id]');
    const monitorSelect = row?.querySelector('[data-screen-native-monitor]');
    if (!monitorSelect) return;
    const selected = deviceSelect.selectedOptions[0];
    const localHost = selected?.dataset.localHost === 'true';
    row.dataset.localHost = localHost ? 'true' : 'false';
    monitorSelect.value = '';
    let monitors = [];
    try { monitors = JSON.parse(selected?.dataset.monitors || '[]'); } catch { monitors = []; }
    monitorSelect.innerHTML = `<option value="">물리 모니터 지정 안 함</option>${monitors.map((monitor) =>
      `<option value="${page(monitor.bindingId)}">${page(monitor.friendlyName)} · ${page(monitor.deviceName)} · ${monitor.resolution.width}×${monitor.resolution.height}</option>`,
    ).join('')}`;
    const hasStableMonitors = monitors.some((monitor) => typeof monitor.bindingId === 'string' && /^MONITOR\\/iu.test(monitor.bindingId));
    monitorSelect.disabled = !hasStableMonitors;
    const help = row.querySelector('[data-screen-monitor-help]');
    if (help) help.textContent = hasStableMonitors
      ? (localHost ? 'PC를 바꾸면 이 PC에서 감지된 모니터를 선택할 수 있습니다.' : '재생기가 보고한 모니터를 선택할 수 있습니다.')
      : (localHost ? '이 PC에서 안정적인 모니터 식별자를 확인할 수 없습니다.' : '해당 Player PC의 모니터 정보가 아직 보고되지 않았습니다.');
  });

  window.GugakTopology = { render };
})();
