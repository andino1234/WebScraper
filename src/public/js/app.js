/* Licitaciones · Insight Latam — interacción del cliente (sin dependencias) */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const csrf = () => ($('meta[name=csrf-token]') || {}).content || '';

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf(), Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
    if (res.status === 401) { location.href = '/login?volver=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sesión vencida'); }
    if (!res.ok) throw new Error((data && data.error) || 'Algo salió mal. Intenta de nuevo.');
    return data;
  }
  window.api = api;

  function toast(message, { undo, error, ms = 5000 } = {}) {
    const wrap = $('#toasts');
    if (!wrap) return alert(message);
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.textContent = message;
    if (undo) {
      const b = document.createElement('button');
      b.textContent = 'Deshacer';
      b.onclick = () => { el.remove(); undo(); };
      el.appendChild(b);
    }
    wrap.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  window.toast = toast;

  // ---------- Generales ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-toggle-nav],[data-theme-toggle],[data-logout],[data-copy],[data-run-all]');
    if (!t) return;
    if (t.matches('[data-toggle-nav]')) document.body.classList.toggle('nav-open');
    if (t.matches('[data-theme-toggle]')) {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (_) {}
    }
    if (t.matches('[data-logout]')) { await api('POST', '/logout').catch(() => {}); location.href = '/login'; }
    if (t.matches('[data-copy]')) {
      try { await navigator.clipboard.writeText(t.dataset.copy); toast('Enlace copiado'); } catch (_) { prompt('Copia el enlace:', t.dataset.copy); }
    }
    if (t.matches('[data-run-all]')) runAll(t);
  });

  async function runAll(btn) {
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/busqueda');
      toast(r.message, { ms: 7000 });
      watchRun(btn);
    } catch (e) { toast(e.message, { error: true }); btn.disabled = false; }
  }

  async function watchRun(btn) {
    const original = btn ? btn.innerHTML : '';
    const tick = async () => {
      const s = await api('GET', '/api/busqueda/estado').catch(() => ({ isRunning: false }));
      if (s.isRunning) {
        if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${s.done || 0}/${s.total || '?'} fuentes`; btn.title = s.current ? `Revisando: ${s.current}` : ''; }
        setTimeout(tick, 3000);
      } else if (btn && btn.disabled) {
        btn.disabled = false; btn.innerHTML = original;
        toast('Búsqueda terminada. Actualizando…', { ms: 2500 });
        setTimeout(() => location.reload(), 1200);
      }
    };
    tick();
  }
  // Si al cargar la página ya hay una búsqueda corriendo, mostrar el progreso.
  const runBtn = $('[data-run-all]');
  if (runBtn) api('GET', '/api/busqueda/estado').then(s => { if (s.isRunning) { runBtn.disabled = true; watchRun(runBtn); } }).catch(() => {});

  // ---------- Bandeja ----------
  const list = $('#list');
  const form = $('#filterForm');
  if (form) {
    form.addEventListener('change', (e) => { if (e.target.name !== 'q') form.submit(); });
  }
  if (window.INBOX) initInbox();

  function initInbox() {
    const drawer = $('#drawer');
    const body = $('#drawerBody');
    const state = { cursor: -1, openId: null };
    const items = () => $$('.item', list || document.createElement('div'));
    const tab = window.INBOX.status;

    function setCursor(i, scroll = true) {
      const all = items();
      if (!all.length) return;
      state.cursor = Math.max(0, Math.min(i, all.length - 1));
      all.forEach((el, idx) => el.classList.toggle('cursor', idx === state.cursor));
      if (scroll) all[state.cursor].scrollIntoView({ block: 'nearest' });
    }

    async function openDetail(id) {
      state.openId = Number(id);
      document.body.classList.add('drawer-open');
      drawer.setAttribute('aria-hidden', 'false');
      body.innerHTML = '<div class="drawer-empty"><span class="spinner"></span></div>';
      const idx = items().findIndex(el => Number(el.dataset.id) === state.openId);
      if (idx > -1) setCursor(idx);
      try {
        body.innerHTML = await api('GET', `/api/oportunidades/${id}/panel`);
        body.scrollTop = 0;
        const url = new URL(location.href); url.searchParams.set('abrir', id); history.replaceState(null, '', url);
      } catch (e) { body.innerHTML = `<div class="drawer-empty">${e.message}</div>`; }
    }

    function closeDetail() {
      document.body.classList.remove('drawer-open');
      drawer.setAttribute('aria-hidden', 'true');
      state.openId = null;
      const url = new URL(location.href); url.searchParams.delete('abrir'); history.replaceState(null, '', url);
    }

    function bumpCount(status, delta) {
      const a = $(`.tabs a[href*="estado=${status}"] .n`);
      if (a) a.textContent = Math.max(0, Number(a.textContent || 0) + delta);
    }

    /** Cambia el estado y, si la oportunidad ya no pertenece a esta pestaña, la quita con opción de deshacer. */
    async function changeStatus(ids, status, { fromDrawer = false } = {}) {
      ids = ids.map(Number);
      let result;
      try { result = await api('POST', '/api/oportunidades/estado', { ids, status }); }
      catch (e) { toast(e.message, { error: true }); return; }
      if (!result.changed) return;
      const label = (window.INBOX.statuses.find(s => s.id === status) || {}).label || status;
      (result.previous || []).forEach(p => { bumpCount(p.status, -1); bumpCount(status, 1); });

      const leaving = tab !== 'todas' && tab !== status;
      const els = ids.map(id => list && $(`.item[data-id="${id}"]`, list)).filter(Boolean);
      const openIdx = state.openId ? items().findIndex(el => Number(el.dataset.id) === state.openId) : -1;
      if (leaving) {
        const total = $('#totalCount');
        if (total) total.textContent = Math.max(0, Number(total.textContent) - els.length);
        els.forEach(el => el.classList.add('leaving'));
        setTimeout(() => {
          els.forEach(el => el.remove());
          updateBulk();
          if (fromDrawer || (state.openId && ids.includes(state.openId))) {
            const next = items()[Math.min(openIdx, items().length - 1)];
            if (next) openDetail(next.dataset.id); else closeDetail();
          } else if (state.cursor > -1) setCursor(Math.min(state.cursor, items().length - 1), false);
          if (!items().length && list) list.outerHTML = '<div class="card empty"><div class="big">✅</div><h2>Listo</h2><p>No quedan oportunidades en esta vista.</p></div>';
        }, 220);
      } else {
        els.forEach(el => { el.dataset.status = status; });
        if (state.openId && ids.includes(state.openId)) openDetail(state.openId);
      }
      const what = ids.length === 1 ? 'Movida a' : `${ids.length} movidas a`;
      toast(`${what} “${label}”`, {
        undo: async () => {
          await api('POST', '/api/oportunidades/deshacer', { previous: result.previous });
          location.reload();
        }
      });
    }

    // Clics dentro de la lista
    if (list) {
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-set]');
        const item = e.target.closest('.item');
        if (!item) return;
        if (btn) { e.stopPropagation(); changeStatus([item.dataset.id], btn.dataset.set); return; }
        if (e.target.closest('input')) return;
        openDetail(item.dataset.id);
      });
      list.addEventListener('change', (e) => { if (e.target.matches('.sel')) { e.target.closest('.item').classList.toggle('selected', e.target.checked); updateBulk(); } });
      list.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('item')) openDetail(e.target.dataset.id); });
    }

    // Selección múltiple
    const selectAll = $('#selectAll');
    function selectedIds() { return $$('.item .sel:checked', list || document.body).map(c => c.closest('.item').dataset.id); }
    function updateBulk() {
      const ids = selectedIds();
      $('#bulkBar').classList.toggle('show', ids.length > 0);
      $('#bulkCount').textContent = ids.length;
      if (selectAll) selectAll.checked = ids.length > 0 && ids.length === items().length;
    }
    if (selectAll) selectAll.addEventListener('change', () => {
      items().forEach(el => { const c = $('.sel', el); c.checked = selectAll.checked; el.classList.toggle('selected', c.checked); });
      updateBulk();
    });
    $$('[data-bulk]').forEach(b => b.addEventListener('click', () => changeStatus(selectedIds(), b.dataset.bulk)));
    const bulkMove = $('#bulkMove');
    if (bulkMove) bulkMove.addEventListener('change', () => { if (bulkMove.value) changeStatus(selectedIds(), bulkMove.value); bulkMove.value = ''; });

    // Panel de detalle
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-drawer]')) closeDetail();
      const nav = e.target.closest('[data-nav]');
      if (nav) move(Number(nav.dataset.nav));
      if (!body.contains(e.target)) return;
      const set = e.target.closest('[data-set]');
      if (set && state.openId) changeStatus([state.openId], set.dataset.set, { fromDrawer: true });
      if (e.target.closest('[data-expand]')) { $('[data-desc]', body).classList.add('open'); e.target.remove(); }
    });

    let notesTimer;
    body.addEventListener('input', (e) => {
      if (!e.target.matches('[data-notes]')) return;
      const id = state.openId;
      const label = $('[data-save-state]', body);
      label.textContent = 'Guardando…';
      clearTimeout(notesTimer);
      notesTimer = setTimeout(async () => {
        try { await api('POST', `/api/oportunidades/${id}/notas`, { notes: e.target.value }); label.textContent = 'Guardado ✓'; }
        catch (err) { label.textContent = 'No se pudo guardar: ' + err.message; }
      }, 700);
    });

    function move(delta) {
      const all = items();
      if (!all.length) return;
      const idx = state.cursor < 0 ? 0 : state.cursor + delta;
      setCursor(idx);
      if (state.openId) openDetail(all[state.cursor].dataset.id);
    }

    // Atajos de teclado
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      const all = items();
      const current = state.openId || (all[state.cursor] && Number(all[state.cursor].dataset.id));
      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); move(1); break;
        case 'k': case 'ArrowUp': e.preventDefault(); move(-1); break;
        case 'Enter': case 'o': if (all[state.cursor]) openDetail(all[state.cursor].dataset.id); break;
        case 'Escape': closeDetail(); break;
        case '/': e.preventDefault(); $('#searchBox') && $('#searchBox').focus(); break;
        case 'i': if (current) changeStatus([current], 'interesa', { fromDrawer: Boolean(state.openId) }); break;
        case 'd': if (current) changeStatus([current], 'descartada', { fromDrawer: Boolean(state.openId) }); break;
        case 'x': if (all[state.cursor]) { const c = $('.sel', all[state.cursor]); c.checked = !c.checked; all[state.cursor].classList.toggle('selected', c.checked); updateBulk(); } break;
        default: break;
      }
    });

    if (window.INBOX.openId) openDetail(window.INBOX.openId);
  }

  // ---------- Fuentes ----------
  if ($('#sourcesPage')) initSources();

  function initSources() {
    const dialog = $('#sourceDialog');
    const sform = $('#sourceForm');
    const result = $('#testDialog');

    document.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-source-new],[data-source-edit],[data-source-test],[data-source-delete],[data-source-runs]');
      if (!t) return;
      if (t.matches('[data-source-new]')) {
        sform.reset(); sform.elements.id.value = ''; sform.elements.config.value = '{}'; sform.elements.active.checked = true;
        $('#sourceDialogTitle').textContent = 'Nueva fuente'; $('#deleteSourceBtn').hidden = true;
        dialog.showModal();
      }
      if (t.matches('[data-source-edit]')) {
        try {
          const s = await api('GET', `/api/fuentes/${t.dataset.sourceEdit}`);
          sform.elements.id.value = s.Id; sform.elements.name.value = s.Name; sform.elements.url.value = s.Url;
          sform.elements.connector.value = s.Connector || 'html'; sform.elements.countryId.value = s.CountryId || '';
          sform.elements.frequencyMinutes.value = s.FrequencyMinutes || 1440; sform.elements.notes.value = s.Notes || '';
          sform.elements.category.value = s.Category || '';
          let cfg = s.Config || '{}'; try { cfg = JSON.stringify(JSON.parse(cfg), null, 2); } catch (_) {}
          sform.elements.config.value = cfg; sform.elements.active.checked = Boolean(s.IsActive);
          $('#sourceDialogTitle').textContent = 'Editar fuente'; $('#deleteSourceBtn').hidden = false;
          dialog.showModal();
        } catch (err) { toast(err.message, { error: true }); }
      }
      if (t.matches('[data-source-test]')) testSource(t);
      if (t.matches('[data-source-runs]')) showRuns(t.dataset.sourceRuns, t.dataset.name);
    });

    $$('[data-source-toggle]').forEach(sw => sw.addEventListener('change', async () => {
      try { await api('POST', `/api/fuentes/${sw.dataset.sourceToggle}/activa`, { active: sw.checked }); toast(sw.checked ? 'Fuente activada' : 'Fuente desactivada'); }
      catch (err) { sw.checked = !sw.checked; toast(err.message, { error: true }); }
    }));

    sform.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(sform));
      data.active = sform.elements.active.checked;
      try {
        if (data.id) await api('PUT', `/api/fuentes/${data.id}`, data); else await api('POST', '/api/fuentes', data);
        dialog.close(); toast('Fuente guardada'); setTimeout(() => location.reload(), 500);
      } catch (err) { $('#sourceFormError').textContent = err.message; }
    });
    $('#deleteSourceBtn').addEventListener('click', async () => {
      const id = sform.elements.id.value;
      if (!id || !confirm('¿Borrar esta fuente? Esta acción no se puede deshacer.')) return;
      try { await api('DELETE', `/api/fuentes/${id}`); dialog.close(); location.reload(); }
      catch (err) { $('#sourceFormError').textContent = err.message; }
    });
    $$('[data-close-dialog]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

    async function testSource(btn) {
      const original = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Probando…';
      try {
        const r = await api('POST', `/api/fuentes/${btn.dataset.sourceTest}/probar`);
        const rows = Object.entries(r.reasons).filter(([k]) => r[k]).map(([k, label]) => `<div><b>${r[k]}</b> ${label.toLowerCase()}</div>`).join('');
        $('#testTitle').textContent = r.name;
        $('#testBody').innerHTML = `
          <p><span class="pill ${r.status === 'ok' ? 'ok' : r.status === 'vacio' ? 'warn' : 'danger'}">${r.status === 'ok' ? 'Funciona' : r.status === 'vacio' ? 'Sin resultados' : 'Error'}</span>
          &nbsp;${escapeHtml(r.summary)}</p>
          ${r.found ? `<div class="result-box"><div class="grid">${rows || '<div>Sin detalle</div>'}</div></div>` : ''}
          <div class="section-label">Registro</div><pre style="white-space:pre-wrap;font-size:.8rem;max-height:220px;overflow:auto" class="result-box">${escapeHtml((r.messages || []).join('\n'))}</pre>`;
        result.showModal();
        result.addEventListener('close', () => location.reload(), { once: true });
      } catch (err) { toast(err.message, { error: true }); }
      btn.disabled = false; btn.innerHTML = original;
    }

    async function showRuns(id, name) {
      try {
        const runs = await api('GET', `/api/fuentes/${id}/corridas`);
        $('#testTitle').textContent = `Historial: ${name}`;
        $('#testBody').innerHTML = runs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Resultado</th><th>Encontradas</th><th>Nuevas</th><th>Descartadas</th></tr></thead><tbody>${
          runs.map(r => `<tr><td>${new Date(r.StartedAt).toLocaleString('es-GT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
            <td><span class="pill ${r.Status === 'ok' ? 'ok' : r.Status === 'vacio' ? 'warn' : r.Status === 'running' ? 'accent' : 'danger'}">${r.Status}</span></td>
            <td>${r.Found}</td><td><b>${r.Saved}</b></td>
            <td class="faint" style="font-size:.8rem">${[['Duplicates', 'ya existían'], ['OutOfRegion', 'fuera de región'], ['NoCountry', 'sin país'], ['LowScore', 'poco relevantes'], ['Expired', 'vencidas'], ['Excluded', 'excluidas']].filter(([k]) => r[k]).map(([k, l]) => `${r[k]} ${l}`).join(' · ') || '—'}</td></tr>`).join('')
        }</tbody></table></div>` : '<p class="muted">Esta fuente todavía no se ha ejecutado.</p>';
        result.showModal();
      } catch (err) { toast(err.message, { error: true }); }
    }
  }

  // ---------- Palabras clave ----------
  if ($('#keywordsPage')) {
    $('#kwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/palabras', Object.fromEntries(new FormData(e.target))); location.reload(); }
      catch (err) { toast(err.message, { error: true }); }
    });
    $('#exForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/exclusiones', Object.fromEntries(new FormData(e.target))); location.reload(); }
      catch (err) { toast(err.message, { error: true }); }
    });
    document.addEventListener('change', async (e) => {
      const el = e.target.closest('[data-kw]');
      if (!el) return;
      const body = {}; body[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
      try { await api('PATCH', `/api/palabras/${el.dataset.kw}`, body); toast('Guardado'); }
      catch (err) { toast(err.message, { error: true }); }
    });
    document.addEventListener('click', async (e) => {
      const ban = e.target.closest('[data-kw-ban]');
      if (ban) {
        if (!confirm('¿Pasar esta palabra a la lista negra? Dejará de sumar puntos y los títulos que la contengan no se guardarán.')) return;
        try { await api('POST', `/api/palabras/${ban.dataset.kwBan}/lista-negra`); location.reload(); }
        catch (err) { toast(err.message, { error: true }); }
        return;
      }
      const del = e.target.closest('[data-kw-delete],[data-ex-delete]');
      if (!del) return;
      if (!confirm('¿Eliminar?')) return;
      const url = del.dataset.kwDelete ? `/api/palabras/${del.dataset.kwDelete}` : `/api/exclusiones/${del.dataset.exDelete}`;
      try { await api('DELETE', url); del.closest('tr').remove(); toast('Eliminada'); }
      catch (err) { toast(err.message, { error: true }); }
    });
    let tryTimer;
    $('#tryText').addEventListener('input', (e) => {
      clearTimeout(tryTimer);
      tryTimer = setTimeout(async () => {
        const out = $('#tryResult');
        if (!e.target.value.trim()) { out.innerHTML = ''; return; }
        const r = await api('POST', '/api/palabras/probar', { text: e.target.value });
        out.innerHTML = `<b>${r.score} puntos · prioridad ${r.level}</b> ${r.excludedBy ? `<span class="pill danger">no se guardaría: “${escapeHtml(r.excludedBy)}” está en la lista negra</span>` : (r.score < Number(out.dataset.min) || !r.matches.some(m => m.where === 'título')) ? '<span class="pill warn">no se guardaría</span>' : '<span class="pill ok">se guardaría</span>'}<br>` +
          (r.matches.length ? r.matches.map(m => `<span class="kw title">${escapeHtml(m.keyword)} +${m.points}</span>`).join('') : '<span class="faint">Ninguna palabra clave coincide.</span>');
      }, 300);
    });
  }

  // ---------- Usuarios y cuenta ----------
  if ($('#usersPage')) {
    $('#userForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/usuarios', Object.fromEntries(new FormData(e.target))); location.reload(); }
      catch (err) { $('#userFormError').textContent = err.message; }
    });
    document.addEventListener('change', async (e) => {
      const el = e.target.closest('[data-user]');
      if (!el) return;
      const body = {}; body[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
      try { await api('PATCH', `/api/usuarios/${el.dataset.user}`, body); toast('Guardado'); }
      catch (err) { toast(err.message, { error: true }); if (el.type === 'checkbox') el.checked = !el.checked; }
    });
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-user-reset]');
      if (!b) return;
      const pw = prompt('Nueva contraseña para ' + b.dataset.name + ' (mínimo 8 caracteres):');
      if (!pw) return;
      try { await api('PATCH', `/api/usuarios/${b.dataset.userReset}`, { password: pw }); toast('Contraseña actualizada'); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }
  if ($('#passwordForm')) {
    $('#passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (d.next !== d.confirm) { $('#pwError').textContent = 'Las contraseñas nuevas no coinciden.'; return; }
      try { await api('POST', '/api/cuenta/clave', d); e.target.reset(); $('#pwError').textContent = ''; toast('Contraseña cambiada'); }
      catch (err) { $('#pwError').textContent = err.message; }
    });
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
})();
