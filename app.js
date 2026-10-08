// Interactivity for the CV site: the evidence drawer, timeline scrubber, deep
// links, toolbox and problem filters, ⌘K palette, the inheritance playground and
// small motion.
// The page is fully readable without it.
(() => {
  const data = JSON.parse(document.getElementById('site-data').textContent);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  const fmt = m => `${MONTHS[m % 12]} ${Math.floor(m / 12)}`;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollTo = (el, block = 'start') => el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const onVisible = (el, fn, opts = { threshold: 0.25 }) => {
    if (!el) return;
    if (!('IntersectionObserver' in window)) return fn();
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); fn(); } }, opts);
    io.observe(el);
  };

  /* ---------- Deep links: scroll and flash the target ---------- */
  function reveal(target) {
    if (!target) return;
    if (target.tagName === 'DETAILS') target.open = true;
    scrollTo(target);
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
    history.replaceState(null, '', `#${target.id}`);
  }
  document.addEventListener('click', ev => {
    const link = ev.target.closest('a[href^="#"]');
    if (!link || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    const hash = link.getAttribute('href').slice(1);
    if (ROUTE.test(hash)) { ev.preventDefault(); go(hash, link); return; }
    const target = document.getElementById(hash);
    if (target) { ev.preventDefault(); reveal(target); }
  });

  /* ---------- Reveal sections as they enter ---------- */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    $$('.job, .problem, .tb-group, .principle').forEach((el, i) => {
      el.classList.add('rise');
      el.style.setProperty('--i', i % 6);
      io.observe(el);
    });
  }

  /* ---------- Highlights: count up when first seen ---------- */
  onVisible($('.highlights'), () => {
    if (reduceMotion) return;
    $$('.hl-v[data-count]').forEach(el => {
      const raw = el.dataset.count;
      const m = raw.match(/^(\D*)(\d[\d,]*)(.*)$/);
      if (!m) return;
      const target = +m[2].replace(/,/g, '');
      const t0 = performance.now();
      const tick = t => {
        const k = Math.min(1, (t - t0) / 900);
        el.textContent = `${m[1]}${Math.round(target * (1 - Math.pow(1 - k, 3)))}${m[3]}`;
        if (k < 1) requestAnimationFrame(tick); else el.textContent = raw;
      };
      requestAnimationFrame(tick);
    });
  });

  /* ---------- Timeline: grow-in, scrubber, milestones ---------- */
  const tl = $('.tl');
  const T0 = +tl.dataset.t0, T1 = +tl.dataset.t1, NOW = +tl.dataset.now;
  const playhead = $('.tl-playhead');
  const phLabel = $('.tl-ph-label');
  const caption = $('.tl-caption-text');
  const tip = $('.tl-tip');
  const playBtn = $('.tl-play');
  let month = NOW;
  let playing = false;

  if (!reduceMotion) {
    tl.classList.add('tl-pre');
    onVisible(tl, () => { tl.classList.remove('tl-pre'); tl.classList.add('tl-in'); });
  }
  const xOf = m => ((m + 0.5 - T0) / (T1 - T0)) * 100;

  function describe(m) {
    const job = data.jobs.find(j => j.from <= m && m <= j.to);
    if (!job) return `<strong>${fmt(m)}</strong> · Before my first front-end job.`;
    const active = data.bars.filter(b => b.from <= m && m <= b.to && b.job === job.id);
    const recent = data.bars
      .flatMap(b => b.milestones.map(ms => ({ ...ms, b })))
      .filter(ms => ms.m <= m && m - ms.m <= 5)
      .sort((a, b) => b.m - a.m)[0];
    const work = active.length ? ` · ${active.map(b => esc(b.short)).join(', ')}` : '';
    const ms = recent ? `<span class="cap-ms">${esc(recent.date)} · ${esc(recent.label)}</span>` : '';
    return `<strong>${fmt(m)}</strong> · ${esc(job.role)}, ${esc(job.company)}${work}${ms}`;
  }

  function setMonth(m, { scrub = true } = {}) {
    month = Math.max(T0, Math.min(NOW, Math.round(m)));
    playhead.style.left = `${xOf(month)}%`;
    phLabel.textContent = fmt(month);
    playhead.setAttribute('aria-valuenow', month);
    playhead.setAttribute('aria-valuetext', fmt(month));
    caption.innerHTML = describe(month);
    tl.classList.toggle('scrubbing', scrub);
    $$('.tl-bar').forEach(el => {
      const b = data.bars.find(x => x.id === el.dataset.bar);
      el.classList.toggle('on', b.from <= month && month <= b.to);
    });
    $$('.tl-job').forEach(el => {
      const j = data.jobs.find(x => x.id === el.dataset.job);
      el.classList.toggle('on', j.from <= month && month <= j.to);
    });
    $$('.tl-ms').forEach(d => d.classList.toggle('reached', +d.dataset.month <= month));
  }

  function monthAt(clientX) {
    const r = tl.getBoundingClientRect();
    return T0 + ((clientX - r.left) / r.width) * (T1 - T0) - 0.5;
  }

  playhead.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    stopPlay();
    playhead.setPointerCapture(ev.pointerId);
    playhead.classList.add('dragging');
    const move = e => setMonth(monthAt(e.clientX));
    const up = () => {
      playhead.classList.remove('dragging');
      playhead.removeEventListener('pointermove', move);
      playhead.removeEventListener('pointerup', up);
      playhead.removeEventListener('pointercancel', up);
    };
    playhead.addEventListener('pointermove', move);
    playhead.addEventListener('pointerup', up);
    playhead.addEventListener('pointercancel', up);
  });
  tl.addEventListener('click', ev => {
    if (ev.target.closest('a, button, .tl-playhead')) return;
    stopPlay();
    setMonth(monthAt(ev.clientX));
  });
  playhead.addEventListener('keydown', ev => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -12, PageUp: 12 }[ev.key];
    if (step) { ev.preventDefault(); stopPlay(); setMonth(month + step); }
    else if (ev.key === 'Home') { ev.preventDefault(); setMonth(T0); }
    else if (ev.key === 'End') { ev.preventDefault(); setMonth(NOW); }
  });

  async function play() {
    playing = true;
    playBtn.classList.add('playing');
    playBtn.querySelector('span').textContent = 'Pause';
    if (month >= NOW) setMonth(T0);
    while (playing && month < NOW) {
      setMonth(month + 1);
      const hit = data.bars.some(b => b.milestones.some(ms => ms.m === month));
      await sleep(reduceMotion ? 30 : hit ? 650 : 90);
    }
    stopPlay();
  }
  function stopPlay() {
    playing = false;
    playBtn.classList.remove('playing');
    playBtn.querySelector('span').textContent = 'Play';
  }
  playBtn.addEventListener('click', () => (playing ? stopPlay() : play()));

  function showTip(dot) {
    tip.textContent = dot.dataset.label;
    tip.hidden = false;
    const r = dot.getBoundingClientRect(), tr = tl.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(r.left + r.width / 2 - tr.left, 120), tr.width - 120)}px`;
    tip.style.top = `${r.top - tr.top}px`;
  }
  $$('.tl-ms').forEach(dot => {
    dot.addEventListener('mouseenter', () => showTip(dot));
    dot.addEventListener('focus', () => showTip(dot));
    dot.addEventListener('mouseleave', () => (tip.hidden = true));
    dot.addEventListener('blur', () => (tip.hidden = true));
    dot.addEventListener('click', () => {
      stopPlay();
      setMonth(+dot.dataset.month);
      if (dot.dataset.open) { tip.hidden = true; go(dot.dataset.open, dot); } else showTip(dot);
    });
  });

  /* ---------- Problems: filter by company ---------- */
  const segs = $$('#solutions .seg-btn');
  function filterProblems(job) {
    segs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === job)));
    $$('.problem').forEach(p => { p.hidden = !!job && !p.classList.contains(`c-${job}`); });
  }
  segs.forEach(b => b.addEventListener('click', () => filterProblems(b.dataset.filter)));

  /* ---------- Side nav tracking ---------- */
  const tocLinks = $$('.toc a');
  if ('IntersectionObserver' in window && tocLinks.length) {
    const byId = Object.fromEntries(tocLinks.map(a => [a.hash.slice(1), a]));
    const nav = $('.toc');
    const io = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) {
        tocLinks.forEach(a => a.classList.remove('active'));
        const a = byId[en.target.id];
        if (!a) continue;
        a.classList.add('active');
        // on phones the nav is a sideways strip: keep the current section in view
        if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - 24, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }, { rootMargin: '-30% 0px -60% 0px' });
    Object.keys(byId).forEach(id => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ---------- Theme toggle: follows the system until the visitor picks one ---------- */
  const themeBtn = $('.theme-btn');
  if (themeBtn) {
    const root = document.documentElement;
    const sysDark = matchMedia('(prefers-color-scheme: dark)');
    const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : sysDark.matches);
    const sync = () => themeBtn.setAttribute('aria-pressed', String(isDark()));
    themeBtn.hidden = false;
    themeBtn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (err) { /* private mode: the choice lasts this visit */ }
      sync();
    });
    sysDark.addEventListener('change', sync);
    sync();
  }

  /* ---------- AI pipeline: a task marker walks the steps ---------- */
  const pipe = $('.pipe-track');
  if (pipe && !reduceMotion) {
    const marker = $('.token', pipe);
    const steps = $$('.step', pipe);
    onVisible(pipe, async () => {
      pipe.classList.add('running');
      for (;;) {
        for (const s of steps) {
          const n = $('.node', s).getBoundingClientRect(), r = pipe.getBoundingClientRect();
          marker.style.transform = `translate(${n.left + n.width / 2 - r.left}px, ${n.top + n.height / 2 - r.top}px)`;
          steps.forEach(x => x.classList.toggle('at', x === s));
          await sleep(s.classList.contains('human') ? 1600 : 650);
        }
        steps.forEach(x => x.classList.remove('at'));
        await sleep(900);
      }
    });
  }

  /* ---------- Playground: what the game receives ---------- */
  // A made-up config at three tiers. Lower tiers inherit until they override; a
  // restricted key can only be edited by its owner (an access check, not an
  // inheritance rule). The JSON panes show what each environment would receive.
  const pg = $('.pg');
  if (pg) {
    const app = $('.pg-app', pg);
    const note = $('.pg-note', pg);
    const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    const TIERS = [
      { id: 'org', kind: 'Organization', name: 'Studio', depth: 0 },
      { id: 'project', kind: 'Project', name: 'Game A', depth: 1, parent: 'org' },
      { id: 'staging', kind: 'Environment', name: 'staging', depth: 2, parent: 'project' },
      { id: 'production', kind: 'Environment', name: 'production', depth: 2, parent: 'project' },
    ];
    const KEYS = [
      { id: 'daily_bonus', type: 'number' },
      { id: 'event_name', type: 'enum', options: ['none', 'beta', 'halloween', 'summer_sale'] },
      { id: 'shop_enabled', type: 'bool' },
    ];
    const ENVS = ['staging', 'production'];
    const tierOf = Object.fromEntries(TIERS.map(t => [t.id, t]));
    const keyOf = Object.fromEntries(KEYS.map(k => [k.id, k]));
    const set = { org: { daily_bonus: 100, event_name: 'none', shop_enabled: true }, project: { daily_bonus: 120 }, staging: { event_name: 'beta' }, production: { shop_enabled: false } };
    const restricted = { daily_bonus: true };
    let viewer = 'owner';
    let received = null;

    const resolve = (tier, key) => (key in set[tier] ? { value: set[tier][key], from: tier } : resolve(tierOf[tier].parent, key));
    const show = v => (typeof v === 'string' ? `"${v}"` : String(v));
    const canEdit = key => viewer === 'owner' || !restricted[key];
    const nameOf = id => tierOf[id].name;

    function control(t, k) {
      const v = set[t.id][k.id];
      const off = canEdit(k.id) ? '' : ' disabled';
      const at = `${k.id} at ${t.name}`;
      let c;
      if (k.type === 'number') {
        c = `<span class="pg-stepper"><button type="button" data-act="dec" aria-label="Decrease ${at}"${off}>−</button>`
          + `<output class="pg-v">${v}</output><button type="button" data-act="inc" aria-label="Increase ${at}"${off}>+</button></span>`;
      } else if (k.type === 'enum') {
        c = `<select class="pg-select" data-act="pick" aria-label="${at}"${off}>${k.options.map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      } else {
        c = `<label class="pg-toggle"><input type="checkbox" data-act="toggle" aria-label="${at}"${v ? ' checked' : ''}${off}><span class="pg-v">${v}</span></label>`;
      }
      const clear = t.id === 'org' ? '' : `<button type="button" class="pg-clear" data-act="clear" aria-label="Remove the override of ${at}"${off}>×</button>`;
      return c + clear;
    }

    function cell(t, k) {
      const r = resolve(t.id, k.id);
      const own = r.from === t.id;
      const locked = !canEdit(k.id);
      const lock = locked ? `<span class="pg-lock" title="Restricted: only the owner can edit">${LOCK}<span class="sr">Restricted</span></span>` : '';
      const body = own
        ? control(t, k)
        : `<button type="button" class="pg-inherit" data-act="override" aria-label="${k.id} inherits ${show(r.value)} from ${nameOf(r.from)}. Override at ${t.name}"${locked ? ' disabled' : ''}>`
          + `<span class="pg-v">${esc(show(r.value))}</span><span class="pg-from">from ${nameOf(r.from)}</span></button>`;
      return `<div class="pg-cell${own ? ' own' : ''}${locked ? ' locked' : ''}" role="cell" data-tier="${t.id}" data-key="${k.id}">${body}${lock}</div>`;
    }

    function render(message) {
      // keep keyboard focus on the same control across re-renders
      const fx = document.activeElement && app.contains(document.activeElement) ? document.activeElement : null;
      const fcell = fx?.closest('.pg-cell');
      const fsel = fx?.dataset.viewer ? `[data-viewer="${fx.dataset.viewer}"]` : fx?.dataset.restrict ? `[data-restrict="${fx.dataset.restrict}"]` : null;
      const fact = fx?.dataset.act;

      const bar = '<div class="pg-bar">'
        + '<div class="pg-ctl"><span class="pg-label" aria-hidden="true">Viewing as</span><div class="seg" role="group" aria-label="Viewing as">'
        + ['owner', 'teammate'].map(v => `<button type="button" class="seg-btn" data-viewer="${v}" aria-pressed="${viewer === v}">${v === 'owner' ? 'Owner' : 'Teammate'}</button>`).join('')
        + '</div></div>'
        + '<div class="pg-ctl"><span class="pg-label" aria-hidden="true">Restricted to owner</span><div class="pg-chips" role="group" aria-label="Restricted to owner">'
        + KEYS.map(k => `<button type="button" class="pg-chip" data-restrict="${k.id}" aria-pressed="${!!restricted[k.id]}"${viewer === 'owner' ? '' : ' disabled'}>${LOCK}<code>${k.id}</code></button>`).join('')
        + '</div></div></div>';
      const head = '<div class="pg-row pg-head" role="row"><span role="columnheader">Tier</span>'
        + KEYS.map(k => `<span role="columnheader"><code>${k.id}</code>${restricted[k.id] ? `<span class="pg-hlock" title="Restricted">${LOCK}</span>` : ''}</span>`).join('') + '</div>';
      const rows = TIERS.map(t => `<div class="pg-row" role="row" style="--depth:${t.depth}"><span class="pg-node" role="rowheader"><span class="pg-kind">${t.kind}</span><span class="pg-name">${t.name}</span></span>${KEYS.map(k => cell(t, k)).join('')}</div>`).join('');

      const now = Object.fromEntries(ENVS.map(env => [env, Object.fromEntries(KEYS.map(k => [k.id, resolve(env, k.id)]))]));
      const outs = ENVS.map(env => {
        const lines = KEYS.map((k, n) => {
          const r = now[env][k.id];
          const prev = received?.[env][k.id];
          const changed = prev && (prev.value !== r.value || prev.from !== r.from);
          return `<span class="pg-line${changed ? ' bump' : ''}">  <span class="pg-k">"${k.id}"</span>: <span class="pg-jv">${esc(show(r.value))}</span>${n < KEYS.length - 1 ? ',' : ''}<span class="pg-src">${nameOf(r.from)}</span></span>`;
        }).join('\n');
        return `<figure class="pg-json"><figcaption><strong>${env}</strong> receives</figcaption><pre><code>{\n${lines}\n}</code></pre></figure>`;
      }).join('');
      received = now;

      app.innerHTML = `${bar}<div class="pg-grid" role="table" aria-label="Config by tier">${head}${rows}</div><div class="pg-out">${outs}</div>`;
      if (message) note.textContent = message;

      let target = null;
      if (fsel) target = $(fsel, app);
      else if (fcell) {
        const c = $(`.pg-cell[data-tier="${fcell.dataset.tier}"][data-key="${fcell.dataset.key}"]`, app);
        target = (fact && fact !== 'override' && fact !== 'clear' && $(`[data-act="${fact}"]`, c)) || $('button:not(:disabled), select:not(:disabled), input:not(:disabled)', c) || c;
        if (target === c) c.tabIndex = -1;
      }
      target?.focus({ preventScroll: true });
    }

    function receivedLine(key) {
      return ENVS.map(env => { const r = resolve(env, key); return `${env} gets ${show(r.value)} from ${nameOf(r.from)}`; }).join(', ');
    }

    app.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.viewer) {
        viewer = b.dataset.viewer;
        return render(viewer === 'teammate'
          ? 'Viewing as a teammate: restricted keys are read-only. What the games receive does not change.'
          : 'Viewing as the owner: every key is editable, and you can restrict keys.');
      }
      if (b.dataset.restrict) {
        const k = b.dataset.restrict;
        restricted[k] = !restricted[k];
        return render(restricted[k] ? `${k} is now restricted: only its owner can edit it, at every tier.` : `${k} is open again: anyone with access can edit it.`);
      }
      const c = b.closest('.pg-cell');
      if (!c) return;
      const { tier, key } = c.dataset;
      const k = keyOf[key];
      if (b.dataset.act === 'override') set[tier][key] = resolve(tier, key).value;
      else if (b.dataset.act === 'clear') delete set[tier][key];
      else if (b.dataset.act === 'inc') set[tier][key] += 10;
      else if (b.dataset.act === 'dec') set[tier][key] = Math.max(0, set[tier][key] - 10);
      else return;
      const verb = b.dataset.act === 'override' ? `Overridden at ${nameOf(tier)}.` : b.dataset.act === 'clear' ? `${nameOf(tier)} inherits ${k.id} again.` : '';
      render(`${verb} ${receivedLine(key)}.`.trim());
    });
    app.addEventListener('change', ev => {
      const el = ev.target;
      const c = el.closest('.pg-cell');
      if (!c || !el.dataset.act) return;
      const { tier, key } = c.dataset;
      set[tier][key] = el.dataset.act === 'toggle' ? el.checked : el.value;
      render(`${receivedLine(key)}.`);
    });
    render();
  }

  /* ---------- Toolbox: filter by area, highlight by company ---------- */
  // The area tabs filter; the company control only highlights, so no chip, tab or
  // group ever moves when a company is picked.
  const tb = $('#toolbox');
  const tbGrid = $('.tb', tb);
  const tbStatus = $('.tb-status', tb);
  const companyOf = Object.fromEntries(data.jobs.map(j => [j.id, j.company]));
  let tbCat = '', tbCo = '';
  function applyToolbox() {
    $$('.tb-cats .seg-btn', tb).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === tbCat)));
    $$('.tb-co', tb).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.co === tbCo)));
    tbGrid.className = `tb${tbCo ? ` picking c-${tbCo}` : ''}`;
    const counts = {};
    let matched = 0, total = 0;
    $$('.tb-group', tb).forEach(g => {
      let n = 0;
      $$('.tool', g).forEach(a => {
        const hit = !tbCo || a.dataset.jobs.split(' ').includes(tbCo);
        a.classList.toggle('dim', !hit);
        n += hit;
      });
      counts[g.dataset.cat] = n;
      matched += n;
      total += $$('.tool', g).length;
      g.hidden = !!tbCat && g.dataset.cat !== tbCat;
    });
    $$('.tb-cats .seg-btn', tb).forEach(b => {
      const n = b.dataset.cat ? counts[b.dataset.cat] : matched;
      $('.n', b).textContent = n;
      b.classList.toggle('empty', !n);
    });
    tbStatus.textContent = tbCo ? `${matched} of ${total} tools used at ${companyOf[tbCo]}` : `All ${total} tools`;
  }
  $$('.tb-cats .seg-btn', tb).forEach(b => b.addEventListener('click', () => { tbCat = b.dataset.cat; applyToolbox(); }));
  $$('.tb-co', tb).forEach(b => b.addEventListener('click', () => { tbCo = b.dataset.co; applyToolbox(); }));

  /* ---------- Evidence drawer: #tool/…, #feature/…, #problem/… ---------- */
  const ROUTE = /^(tool|feature|problem)\/[\w-]+$/;
  const drawer = $('#drawer');
  const drTitle = $('#dr-title');
  const drKicker = $('.dr-kicker', drawer);
  const drBody = $('.dr-body', drawer);
  const jobOf = id => data.jobs.find(j => j.id === id);
  const jobAt = m => data.jobs.find(j => j.from <= m && m <= j.to);
  const toolOf = id => data.tools.find(t => t.id === id);
  const dot = job => `<span class="dot c-${job}"></span>`;
  const link = (route, label, cls = '') => `<a class="dr-link ${cls}" href="#${route}">${esc(label)}</a>`;
  let opener = null;

  function miniTimeline(onJobs, marks) {
    const span = data.t1 - data.t0;
    const x = m => ((m - data.t0) / span) * 100;
    const segs = data.jobs.map(j => `<span class="mt-seg c-${j.id}${onJobs.includes(j.id) ? ' on' : ''}" style="left:${x(j.from)}%;width:${x(j.to + 1) - x(j.from)}%" title="${esc(j.company)}"></span>`).join('');
    const dots = marks.map(f => `<a class="mt-dot c-${jobAt(f.m)?.id || f.job}" href="#feature/${f.id}" style="left:${x(f.m + 0.5)}%" title="${esc(f.date)} · ${esc(f.name)}"><span class="sr">${esc(f.name)}</span></a>`).join('');
    const years = [];
    for (let y = Math.ceil(data.t0 / 12); y <= Math.floor(data.t1 / 12); y += 1) years.push(`<span style="left:${x(y * 12)}%">${y % 2 ? '' : y}</span>`);
    return `<div class="mt"><div class="mt-track">${segs}${dots}</div><div class="mt-years" aria-hidden="true">${years.join('')}</div></div>`;
  }
  const block = (title, body) => (body ? `<section class="dr-sec"><h3>${title}</h3>${body}</section>` : '');
  const ul = (arr, fn) => (arr.length ? `<ul class="dr-list">${arr.map(x => `<li>${fn(x)}</li>`).join('')}</ul>` : '');
  const chips = arr => (arr.length ? `<ul class="ptech">${arr.map(t => `<li>${link(`tool/${t.id}`, t.name)}</li>`).join('')}</ul>` : '');

  function renderTool(t) {
    const feats = data.features.filter(f => f.tech.includes(t.id)).sort((a, b) => b.m - a.m);
    const probs = data.problems.filter(p => p.tech.includes(t.id));
    const where = data.jobs.filter(j => t.jobs.includes(j.id));
    return {
      kicker: `${data.cats[t.cat]}${t.core ? ' · <span class="dr-core">Core skill</span>' : ''}`,
      title: t.name,
      body: (t.detail ? `<p class="dr-detail">${esc(t.detail)}</p>` : '')
        + `<p class="dr-text">${esc(t.text)}</p>`
        + block('Where I used it', miniTimeline(t.jobs, feats) + ul(where, j => `${dot(j.id)}<span><a href="#j-${j.id}">${esc(j.company)}</a> <span class="dr-muted">· ${esc(j.period)}</span></span>`))
        + block('Shipped with it', ul(feats, f => `${dot(jobAt(f.m)?.id || f.job)}${link(`feature/${f.id}`, f.name)}<span class="dr-muted">${esc(f.date)}</span>`))
        + block('Problems I solved with it', ul(probs, p => `${dot(p.job)}${link(`problem/${p.id}`, p.title)}`)),
      jobs: t.jobs,
      dots: feats.map(f => `feature/${f.id}`),
    };
  }

  function renderFeature(f) {
    const job = jobOf(f.job);
    const era = jobAt(f.m);
    const via = era && era.id !== job.id ? ` · while at ${esc(era.company)}` : '';
    const more = data.features.filter(x => x.job === f.job && x.id !== f.id);
    return {
      kicker: `Feature · ${dot(job.id)} ${esc(job.company)}`,
      title: f.name,
      body: `<p class="dr-detail">${esc(f.date)}${via}</p><p class="dr-text">${esc(f.text)}</p>`
        + block('When', miniTimeline([era?.id || job.id], [f]))
        + block('Built with', chips(f.tech.map(toolOf)))
        + block(`More from ${esc(job.company)}`, `<ul class="dr-feats">${more.map(x => `<li>${link(`feature/${x.id}`, x.name, 'feat')}</li>`).join('')}</ul>`),
      jobs: [era?.id || job.id],
      dots: [`feature/${f.id}`],
    };
  }

  function focusTimeline(view) {
    tl.classList.toggle('focus', !!view);
    $$('.tl-bar', tl).forEach(el => el.classList.toggle('hl', !!view && view.jobs.includes(data.bars.find(b => b.id === el.dataset.bar).job)));
    $$('.tl-ms', tl).forEach(el => el.classList.toggle('hl', !!view && view.dots.includes(el.dataset.open)));
  }

  function openDrawer(view) {
    drKicker.innerHTML = view.kicker;
    drTitle.textContent = view.title;
    drBody.innerHTML = view.body;
    drBody.scrollTop = 0;
    if (drawer.hidden) {
      opener = document.activeElement;
      drawer.hidden = false;
      document.body.classList.add('drawer-open');
    }
    drawer.classList.remove('swap'); void drawer.offsetWidth; drawer.classList.add('swap');
    focusTimeline(view);
    drTitle.focus({ preventScroll: true });
  }

  function closeDrawer({ fromHistory = false } = {}) {
    if (drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove('drawer-open');
    focusTimeline(null);
    if (!fromHistory && ROUTE.test(location.hash.slice(1))) history.replaceState(null, '', location.pathname + location.search);
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  }

  // Render a route. Problems live on the page, so they close the drawer and scroll.
  function route(r) {
    const [kind, id] = r.split('/');
    if (kind === 'problem') {
      closeDrawer({ fromHistory: true });
      filterProblems('');
      reveal(document.getElementById(`pr-${id}`));
      return;
    }
    const item = kind === 'tool' ? toolOf(id) : data.features.find(f => f.id === id);
    if (!item) return;
    openDrawer(kind === 'tool' ? renderTool(item) : renderFeature(item));
  }
  // Each opened item is a history entry, so Back steps through what you looked at.
  function go(r, from) {
    if (from && drawer.hidden) opener = from;
    if (location.hash !== `#${r}` && !r.startsWith('problem/')) history.pushState(null, '', `#${r}`);
    route(r);
  }
  window.addEventListener('popstate', () => {
    const h = location.hash.slice(1);
    if (ROUTE.test(h)) route(h); else closeDrawer({ fromHistory: true });
  });
  $('.dr-close', drawer).addEventListener('click', () => closeDrawer());

  /* ---------- ⌘K palette ---------- */
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  if (!isMac) $$('.kbd-mod').forEach(k => (k.textContent = 'Ctrl K'));
  const palette = $('.palette');
  const input = $('.pal-input');
  const list = $('.pal-list');
  const items = [
    ...data.tools.map(t => ({ kind: t.cat === 'int' ? 'Integration' : 'Tech', label: t.name, sub: t.detail || data.cats[t.cat], more: t.text, run: () => go(`tool/${t.id}`) })),
    ...data.features.map(f => ({ kind: 'Feature', label: f.name, sub: `${jobOf(f.job).company} · ${f.date}`, more: f.text, run: () => go(`feature/${f.id}`) })),
    ...data.problems.map(p => ({ kind: 'Problem', label: p.title, sub: p.company, run: () => go(`problem/${p.id}`) })),
    ...data.jobs.map(j => ({ kind: 'Company', label: j.company, sub: j.role, run: () => reveal(document.getElementById(`j-${j.id}`)) })),
    ...data.sections.map(s => ({ kind: 'Section', label: s.label, sub: '', run: () => scrollTo(document.getElementById(s.id)) })),
  ];
  let shown = [];
  let active = 0;
  const score = (item, q) => {
    if (!q) return item.kind === 'Section' ? 1 : 0;
    const l = item.label.toLowerCase();
    if (l.startsWith(q)) return 3;
    if (l.includes(q)) return 2;
    return `${item.sub} ${item.kind} ${item.more || ''}`.toLowerCase().includes(q) ? 1 : 0;
  };
  function renderList() {
    const q = input.value.trim().toLowerCase();
    shown = items.map(it => [it, score(it, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([it]) => it);
    active = Math.min(active, Math.max(shown.length - 1, 0));
    list.innerHTML = shown.length
      ? shown.map((it, i) => `<li role="option" id="pal-${i}" aria-selected="${i === active}" data-i="${i}"><span class="pal-kind">${it.kind}</span><span class="pal-label">${esc(it.label)}</span><span class="pal-sub">${esc(it.sub)}</span></li>`).join('')
      : '<li class="pal-empty">Nothing found</li>';
    input.setAttribute('aria-activedescendant', shown.length ? `pal-${active}` : '');
    $(`#pal-${active}`)?.scrollIntoView({ block: 'nearest' });
  }
  function openPalette() {
    if (palette.open) return;
    input.value = '';
    active = 0;
    renderList();
    palette.showModal();
    input.focus();
  }
  function choose(i) {
    const it = shown[i];
    if (!it) return;
    palette.close();
    it.run();
  }
  $$('[data-open-palette]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); openPalette(); }));
  input.addEventListener('input', () => { active = 0; renderList(); });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { active = (active + 1) % Math.max(shown.length, 1); renderList(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = (active - 1 + shown.length) % Math.max(shown.length, 1); renderList(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { choose(active); ev.preventDefault(); }
  });
  list.addEventListener('click', ev => { const li = ev.target.closest('li[data-i]'); if (li) choose(+li.dataset.i); });
  palette.addEventListener('click', ev => { if (ev.target === palette) palette.close(); });
  document.addEventListener('keydown', ev => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if (ev.key === 'Escape' && !drawer.hidden && !palette.open) { closeDrawer(); return; }
    if ((ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); openPalette(); }
    else if (ev.key === '/' && !typing) { ev.preventDefault(); openPalette(); }
  });

  /* ---------- Print: collapsed case studies print in full ---------- */
  let closedForPrint = [];
  window.addEventListener('beforeprint', () => {
    closedForPrint = $$('details.problem:not([open])');
    closedForPrint.forEach(d => (d.open = true));
  });
  window.addEventListener('afterprint', () => closedForPrint.forEach(d => (d.open = false)));

  /* ---------- Initial state ---------- */
  setMonth(NOW, { scrub: false });
  if (ROUTE.test(location.hash.slice(1))) route(location.hash.slice(1));
  else if (location.hash.length > 1) {
    const t = document.getElementById(location.hash.slice(1));
    if (t) requestAnimationFrame(() => reveal(t));
  }
})();
