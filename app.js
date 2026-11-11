'use strict';
/* Novalis Implant — pedidos y stock de implantes ETK.
   Los datos se guardan en el dispositivo (localStorage) y, si config.js tiene
   la configuración de Firebase, se comparten entre dispositivos (ver sync.js). */

const KEY = 'novalis-implant-v1';

// Personas que pueden añadir implantes al pedido cuando la app funciona sin datos compartidos.
// Con datos compartidos, la lista la gestiona el administrador desde Ajustes.
const USERS = ['Dr. Martín Aguirre', 'Dr. Carlos Figueroa'];

// Catálogo inicial. Se puede editar desde Ajustes → Catálogo.
const DEFAULTS = {
  settings: { usuario: '', clinica: '', comercial: '', telefono: '', minStock: 2, incluirPacientes: true },
  catalog: {
    diametros: ['3.5', '4.0', '4.5', '5.0'],
    longitudes: ['6', '8', '10', '12', '14', '16'],
  },
  cart: [],
  notas: '',
  stock: { imp: {}, mu: {}, otros: [] },
  history: [],
};

let S = load();
const ui = {
  tab: 'implantes',
  paciente: '',
  imp: { m: 'nat', d: null, l: null, qty: 1 },
  mu: { tipo: null, altura: null, qty: 1 },
  stockSeg: 'imp',
  msg: null, // texto del mensaje si el usuario lo ha editado a mano
};

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* datos corruptos: empezar de cero */ }
  const d = JSON.parse(JSON.stringify(DEFAULTS));
  // La primera versión traía medidas provisionales; si no se tocaron, pasar a las del catálogo oficial.
  const c = saved.catalog;
  if (c && String(c.diametros) === '3.5,4.0,4.5,5.0,6.0' && String(c.longitudes) === '6,8,10,12,14') {
    delete c.diametros; delete c.longitudes;
  }
  return {
    settings: { ...d.settings, ...saved.settings },
    catalog: { ...d.catalog, ...saved.catalog },
    cart: saved.cart || [],
    notas: saved.notas || '',
    stock: { ...d.stock, ...saved.stock },
    history: saved.history || [],
  };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('No se pudo guardar'); }
  if (window.Sync) Sync.push();
}

/* ---------- utilidades ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* Modelos de implante. Naturactis usa las medidas editables de Ajustes;
   i bone E es fijo según el catálogo oficial de ETK. */
// Naturactis: combinaciones que no existen (Ø en décimas de mm | longitud).
const NAT_NO_DISPONIBLE = new Set(['35|6', '40|6', '50|16']);
// i bone E: cuerpo N = Ø3.5, R = Ø4.3; espiras S/M/L.
const IBONE_E = {
  NS: { cuerpo: '3.5', esp: '3.8' }, NM: { cuerpo: '3.5', esp: '4.3' }, NL: { cuerpo: '3.5', esp: '4.8' },
  RS: { cuerpo: '4.3', esp: '4.8' }, RM: { cuerpo: '4.3', esp: '5.5' }, RL: { cuerpo: '4.3', esp: '6.2' },
};
const x10 = v => Math.round(parseFloat(v) * 10);
const MODELS = {
  nat: {
    nombre: 'Naturactis', tituloVar: 'Diámetro (mm)', colVar: 'Ø',
    variantes: () => S.catalog.diametros.map(d => ({ v: d, label: 'Ø' + d, sub: '' })),
    longitudes: () => S.catalog.longitudes,
    existe: (d, l) => !NAT_NO_DISPONIBLE.has(x10(d) + '|' + parseFloat(l)),
    // p. ej. Ø4.0 × 10 mm → NIP_40.100
    ref: (d, l) => (x10(d) && x10(l) ? `NIP_${x10(d)}.${String(x10(l)).padStart(3, '0')}` : ''),
    item: (d, l) => `Naturactis Ø${d} × ${l} mm`,
  },
  ibe: {
    nombre: 'i bone E', tituloVar: 'Cuerpo y espiras', colVar: 'Tipo',
    variantes: () => Object.entries(IBONE_E).map(([v, x]) => ({ v, label: v, sub: `Ø${x.cuerpo} · esp. ${x.esp}` })),
    longitudes: () => ['6', '8', '10', '12', '14'],
    // Cuerpo Ø3.5 (N): 8–14 mm; cuerpo Ø4.3 (R): 6–12 mm.
    existe: (d, l) => !!IBONE_E[d] && (d[0] === 'N' ? l !== '6' : l !== '14'),
    // p. ej. NS × 8 mm → IE3538080
    ref: (d, l) => `IE${x10(IBONE_E[d].cuerpo)}${x10(IBONE_E[d].esp)}${String(x10(l)).padStart(3, '0')}`,
    item: (d, l) => `i bone E ${d} (Ø${IBONE_E[d].cuerpo}/${IBONE_E[d].esp}) × ${l} mm`,
  },
};
const model = m => MODELS[m] || MODELS.nat;
// Las claves de stock de Naturactis no llevan prefijo (compatibilidad con datos ya guardados).
const impKey = (d, l, m = 'nat') => (m && m !== 'nat' ? m + ':' : '') + d + '|' + l;
function parseImpKey(k) {
  const [pre, rest] = k.includes(':') ? k.split(':') : ['nat', k];
  const [d, l] = rest.split('|');
  return { m: pre, d, l };
}
const impExists = (d, l, m) => model(m).existe(d, l);
const impRef = (d, l, m) => (impExists(d, l, m) ? model(m).ref(d, l) : '');
const impName = i => model(i.model).item(i.d, i.l);
/* Pilares cónicos Tetra (Multi-Unit) Ø4.8, según el catálogo oficial de ETK:
   alturas gingivales disponibles por tipo y su referencia. */
const MU = {
  'Recto': { '0.5': 'NPV_PT48.1', '1.5': 'NPV_PT48.2', '2.5': 'NPV_PT48.3', '3.5': 'NPV_PT48.4', '4.5': 'NPV_PT48.5' },
  'Angulado 17°': { '2.5': 'NPV_PTA48.17.25', '3.5': 'NPV_PTA48.17.35', '4.5': 'NPV_PTA48.17.45' },
  'Angulado 30°': { '3.5': 'NPV_PTA48.30.35', '4.5': 'NPV_PTA48.30.45', '5.5': 'NPV_PTA48.30.55' },
};
const muRef = (t, a) => (MU[t] && MU[t][a]) || '';
const muKey = (t, a) => t + '|' + a;
const muName = i => `Pilar Tetra ${i.tipo.toLowerCase()} · altura ${i.altura} mm`;
const itemRef = i => (i.kind === 'imp' ? impRef(i.d, i.l, i.model) : muRef(i.tipo, i.altura));
const itemName = i => (i.kind === 'imp' ? impName(i) : muName(i));
const stockOf = i => (i.kind === 'imp' ? S.stock.imp[impKey(i.d, i.l, i.model)] : S.stock.mu[muKey(i.tipo, i.altura)]) || 0;
const cartCount = () => S.cart.reduce((n, i) => n + i.qty, 0);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

function stockTag(n) {
  const cls = n <= 0 ? 'zero' : n <= S.settings.minStock ? 'low' : '';
  return `<span class="tag ${cls}">Stock: ${n}</span>`;
}
function stepper(act, val, extra = '', sm = false) {
  return `<span class="stepper${sm ? ' sm' : ''}">
    <button data-act="${act}" data-delta="-1" ${extra} aria-label="Menos">−</button>
    <output>${val}</output>
    <button data-act="${act}" data-delta="1" ${extra} aria-label="Más">+</button></span>`;
}

/* ---------- vistas ---------- */
const TITLES = {
  implantes: ['Implantes', 'ETK · Naturactis · i bone E'],
  multiunit: ['Multiunit', 'Pilares cónicos Tetra ETK'],
  pedido: ['Pedido', 'Lista y mensaje para el comercial'],
  stock: ['Stock', 'Existencias en la clínica'],
  ajustes: ['Ajustes', 'Perfil, comercial y catálogo'],
};

function render() {
  const [t, sub] = TITLES[ui.tab];
  $('#title').textContent = t;
  $('#subtitle').textContent = sub;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const n = cartCount();
  $('#badge').hidden = n === 0;
  $('#badge').textContent = n;
  $('#userBtn').textContent = S.settings.usuario || 'Elegir usuario';
  $('#view').innerHTML = VIEWS[ui.tab]();
}

function pacienteField() {
  return `<label class="f">Paciente (iniciales o nº de historia)
    <input data-field="paciente" value="${esc(ui.paciente)}" placeholder="Ej.: M.G. · HC 1234" autocomplete="off" autocapitalize="characters">
  </label>`;
}

function miniCart(kind) {
  const items = S.cart.filter(i => i.kind === kind);
  if (!items.length) return '';
  return `<section class="card"><h2>Añadidos al pedido</h2><ul class="list">${items.map(i => `
    <li><div class="grow"><div class="name">${i.qty} × ${esc(itemName(i))}</div>
      <div class="sub">${i.paciente ? esc(i.paciente) : 'Sin paciente'}${i.por ? ' · ' + esc(i.por) : ''}</div></div>
      <button class="x" data-act="cart-del" data-id="${i.id}" aria-label="Quitar">×</button></li>`).join('')}
  </ul><button class="btn ghost" data-act="go" data-tab="pedido" style="margin-top:8px">Ver pedido completo</button></section>`;
}

const VIEWS = {
  implantes() {
    const { m, d, l, qty } = ui.imp;
    const M = model(m);
    const sel = d && l ? { kind: 'imp', model: m, d, l } : null;
    return `
    <div class="seg">${Object.entries(MODELS).map(([k, x]) => `<button class="${k === m ? 'on' : ''}" data-act="imp-m" data-v="${k}">${x.nombre}</button>`).join('')}</div>
    <section class="card"><h2>Paciente</h2>${pacienteField()}</section>
    <section class="card"><h2>${M.tituloVar}</h2>
      <div class="chips">${M.variantes().map(x => `<button class="chip ${x.v === d ? 'on' : ''}" data-act="imp-d" data-v="${esc(x.v)}">${esc(x.label)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('')}</div>
    </section>
    <section class="card"><h2>Longitud (mm)</h2>
      <div class="chips">${M.longitudes().map(x => {
        const ok = !d || impExists(d, x, m);
        const st = !d ? '' : ok ? `<small>stock ${S.stock.imp[impKey(d, x, m)] || 0}</small>` : '<small>no existe</small>';
        return `<button class="chip ${x === l ? 'on' : ''}" data-act="imp-l" data-v="${esc(x)}" ${ok ? '' : 'disabled'}>${esc(x)}${st}</button>`;
      }).join('')}</div>
    </section>
    <section class="card">
      <div class="row"><div><div class="name"><b>${sel ? esc(impName(sel)) : 'Elige medida y longitud'}</b></div>
        ${sel ? `<span class="sub">${esc(impRef(d, l, m))}</span> ${stockTag(stockOf(sel))}` : ''}</div>${stepper('imp-qty', qty)}</div>
      <button class="btn" data-act="imp-add" style="margin-top:12px" ${sel ? '' : 'disabled'}>Añadir al pedido</button>
    </section>
    ${miniCart('imp')}`;
  },

  multiunit() {
    const { tipo, altura, qty } = ui.mu;
    const sel = tipo && altura ? { kind: 'mu', tipo, altura } : null;
    return `
    <section class="card"><h2>Paciente</h2>${pacienteField()}</section>
    <section class="card"><h2>Tipo de pilar</h2>
      <div class="chips">${Object.keys(MU).map(x => `<button class="chip ${x === tipo ? 'on' : ''}" data-act="mu-t" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    </section>
    <section class="card"><h2>Altura gingival (mm)</h2>
      ${tipo ? `<div class="chips">${Object.keys(MU[tipo]).map(x => `<button class="chip ${x === altura ? 'on' : ''}" data-act="mu-a" data-v="${esc(x)}">${esc(x)}<small>stock ${S.stock.mu[muKey(tipo, x)] || 0}</small></button>`).join('')}</div>`
        : '<p class="hint" style="margin:0">Elige primero el tipo de pilar.</p>'}
    </section>
    <section class="card">
      <div class="row"><div><div class="name"><b>${sel ? esc(muName(sel)) : 'Elige tipo y altura'}</b></div>
        ${sel ? `<span class="sub">${esc(muRef(tipo, altura))}</span> ${stockTag(stockOf(sel))}` : ''}</div>${stepper('mu-qty', qty)}</div>
      <button class="btn" data-act="mu-add" style="margin-top:12px" ${sel ? '' : 'disabled'}>Añadir a la solicitud</button>
    </section>
    ${miniCart('mu')}`;
  },

  pedido() {
    if (!S.cart.length) {
      return `<section class="card"><div class="empty">El pedido está vacío.<br>Añade implantes o multiunit desde sus pestañas.</div></section>${historyCard()}`;
    }
    const groups = groupByPatient(S.cart);
    const text = ui.msg ?? buildMessage();
    const tel = S.settings.telefono.replace(/[^\d+]/g, '');
    const wa = tel.replace(/\D/g, '');
    return `
    <section class="card"><h2>Lista del pedido</h2>
      ${groups.map(([pac, items]) => `<p class="group">${pac ? esc(pac) : 'Sin paciente'}</p><ul class="list">${items.map(i => `
        <li><div class="grow"><div class="name">${esc(itemName(i))}</div>
          <div class="sub">${esc([itemRef(i), i.por].filter(Boolean).join(' · '))}</div>${stockTag(stockOf(i))}</div>
          ${stepper('cart-qty', i.qty, `data-id="${i.id}"`, true)}
          <button class="x" data-act="cart-del" data-id="${i.id}" aria-label="Quitar">×</button></li>`).join('')}</ul>`).join('')}
      <button class="link bad" data-act="cart-clear">Vaciar pedido</button>
    </section>
    <section class="card"><h2>Mensaje para el comercial</h2>
      <label class="switch"><span>Incluir pacientes en el mensaje</span>
        <input type="checkbox" data-field="incluirPacientes" ${S.settings.incluirPacientes ? 'checked' : ''}></label>
      <label class="f">Notas (opcional)
        <input data-field="notas" value="${esc(S.notas)}" placeholder="Ej.: urgente, cirugía el jueves"></label>
      <textarea class="msg" id="msg" data-field="msg">${esc(text)}</textarea>
      ${ui.msg !== null ? '<button class="link" data-act="msg-reset">Regenerar mensaje</button>' : ''}
      <button class="btn" data-act="copy" style="margin-top:8px">Copiar mensaje</button>
      <div class="btns">
        <a class="btn ghost" id="waLink" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}">WhatsApp</a>
        <a class="btn ghost" id="smsLink" href="sms:${tel}?&body=${encodeURIComponent(text)}">SMS</a>
      </div>
      ${navigator.share ? '<button class="btn ghost" data-act="share" style="margin-top:8px">Compartir…</button>' : ''}
      ${tel ? '' : '<p class="hint">Añade el teléfono del comercial en Ajustes para abrir el chat directamente con él.</p>'}
    </section>
    <section class="card">
      <button class="btn" data-act="order-done">Marcar como enviado</button>
      <p class="hint">Guarda el pedido en el historial y vacía la lista. Cuando llegue, podrás sumarlo al stock.</p>
    </section>
    ${historyCard()}`;
  },

  stock() {
    const seg = ui.stockSeg;
    const min = S.settings.minStock;
    const cls = n => (n <= 0 ? 'zero' : n <= min ? 'low' : '');
    let body;
    if (seg === 'imp') {
      body = Object.entries(MODELS).map(([m, M]) => {
        const vars = M.variantes(), longs = M.longitudes();
        const total = vars.reduce((a, x) => a + longs.reduce((b, l) => b + (impExists(x.v, l, m) ? S.stock.imp[impKey(x.v, l, m)] || 0 : 0), 0), 0);
        return `<section class="card"><h2>${M.nombre} · ${plural(total, 'implante', 'implantes')}</h2>
        <div class="scroll"><table class="grid"><thead><tr><th>L \\ ${M.colVar}</th>${vars.map(x => `<th>${esc(x.label)}</th>`).join('')}</tr></thead>
        <tbody>${longs.map(l => `<tr><th>${esc(l)} mm</th>${vars.map(x => {
          if (!impExists(x.v, l, m)) return '<td class="na">–</td>';
          const k = impKey(x.v, l, m), n = S.stock.imp[k] || 0;
          return `<td><button class="${cls(n)}" data-act="stock-edit" data-kind="imp" data-k="${esc(k)}">${n}</button></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div></section>`;
      }).join('') + `<div class="legend" style="margin:-4px 4px 14px"><span><i style="background:var(--bad-bg)"></i>Sin stock</span><span><i style="background:var(--warn-bg)"></i>Stock bajo (≤ ${min})</span><span>Toca una casilla para cambiar la cantidad.</span></div>`;
    } else if (seg === 'mu') {
      body = Object.entries(MU).map(([t, alturas]) => `<section class="card"><h2>Pilar Tetra ${esc(t.toLowerCase())}</h2><ul class="list">${Object.entries(alturas).map(([a, ref]) => {
        const k = muKey(t, a), n = S.stock.mu[k] || 0;
        return `<li><div class="grow"><div class="name">Altura ${esc(a)} mm</div><div class="sub">${esc(ref)}</div>${n <= min ? `<span class="tag ${cls(n)}">${n <= 0 ? 'Sin stock' : 'Stock bajo'}</span>` : ''}</div>
          ${stepper('stock-step', n, `data-kind="mu" data-k="${esc(k)}"`, true)}</li>`;
      }).join('')}</ul></section>`).join('');
    } else {
      body = `<section class="card"><h2>Otros aditamentos</h2>
        ${S.stock.otros.length ? `<ul class="list">${S.stock.otros.map(o => `
          <li><div class="grow"><div class="name">${esc(o.nombre)}</div></div>
            ${stepper('otro-step', o.qty, `data-id="${o.id}"`, true)}
            <button class="x" data-act="otro-del" data-id="${o.id}" aria-label="Eliminar">×</button></li>`).join('')}</ul>`
          : '<div class="empty">Añade pilares de cicatrización, tornillos, transfers, análogos…</div>'}
        <label class="f" style="margin-top:10px">Nuevo aditamento
          <input id="otroNombre" placeholder="Ej.: Pilar de cicatrización Ø4 h3" autocomplete="off"></label>
        <button class="btn ghost" data-act="otro-add">Añadir</button></section>`;
    }
    return `<div class="seg">
      <button class="${seg === 'imp' ? 'on' : ''}" data-act="seg" data-v="imp">Implantes</button>
      <button class="${seg === 'mu' ? 'on' : ''}" data-act="seg" data-v="mu">Multiunit</button>
      <button class="${seg === 'otros' ? 'on' : ''}" data-act="seg" data-v="otros">Otros</button></div>
      ${body}${lowStockCard()}`;
  },

  ajustes() {
    const s = S.settings, c = S.catalog;
    const f = (label, field, val, ph, attrs = '') => `<label class="f">${label}<input data-field="${field}" value="${esc(val)}" placeholder="${ph}" ${attrs}></label>`;
    return `
    <section class="card"><h2>Usuario</h2>
      ${window.Sync ? `<p style="margin:0 0 12px"><b>${esc(s.usuario)}</b>${Sync.isAdmin ? ' <span class="tag">Administrador</span>' : ''}<br><span class="sub">${esc(Sync.email)}</span></p>`
      : `<div class="chips" style="margin-bottom:12px">${USERS.map(u => `<button class="chip ${u === s.usuario ? 'on' : ''}" data-act="user-set" data-v="${esc(u)}">${esc(u)}</button>`).join('')}</div>`}
      ${f('Clínica', 's.clinica', s.clinica, 'Nombre de la clínica')}
    </section>
    ${window.Sync && Sync.isAdmin ? `<section class="card"><h2>Usuarios con acceso</h2>
      <ul class="list">${Sync.users.map(u => `<li><div class="grow"><div class="name">${esc(u.nombre)}${u.admin ? ' <span class="tag">Admin</span>' : ''}</div>
        <div class="sub">${esc(u.email)}</div></div>
        ${u.email === Sync.email ? '' : `<button class="link bad" data-act="user-del" data-v="${esc(u.email)}">Quitar</button>`}</li>`).join('')}</ul>
      <label class="f" style="margin-top:12px">Nombre
        <input id="newUserName" placeholder="Dr./Dra. …" autocomplete="off"></label>
      <label class="f">Correo electrónico
        <input id="newUserEmail" type="email" inputmode="email" autocapitalize="none" autocomplete="off" placeholder="nombre@correo.com"></label>
      <button class="btn ghost" data-act="user-add">Dar acceso</button>
      <p class="hint">La persona debe abrir la app, pulsar «Crear cuenta» con ese mismo correo y verificarlo con el enlace que recibirá.</p>
    </section>` : ''}
    <section class="card"><h2>Comercial ETK</h2>
      ${f('Nombre', 's.comercial', s.comercial, 'Nombre del comercial')}
      ${f('Teléfono (con prefijo)', 's.telefono', s.telefono, '+34 600 000 000', 'type="tel" inputmode="tel"')}
    </section>
    <section class="card"><h2>Stock</h2>
      <div class="row"><span>Avisar de stock bajo con ≤</span>${stepper('min-step', s.minStock, '', true)}</div>
    </section>
    <section class="card"><h2>Catálogo Naturactis</h2>
      ${f('Diámetros de implante (mm)', 'c.diametros', c.diametros.join(', '), '3.5, 4.0, 4.5')}
      ${f('Longitudes de implante (mm)', 'c.longitudes', c.longitudes.join(', '), '8, 10, 12')}
      <p class="hint">Medidas de Naturactis, separadas por comas. i bone E y los pilares Tetra siguen el catálogo oficial de ETK.</p>
    </section>
    <section class="card"><h2>Datos</h2>
      <button class="btn ghost" data-act="export">Exportar copia de seguridad</button>
      ${window.Sync ? `<button class="btn danger" data-act="logout" style="margin-top:8px">Cerrar sesión</button>
      <p class="hint">Sesión iniciada como ${esc(Sync.email)}. El pedido, el stock y el historial se comparten con el resto de usuarios.</p>`
      : `<label class="btn ghost" style="margin-top:8px">Importar copia de seguridad
        <input type="file" id="importFile" accept="application/json,.json" hidden></label>
      <button class="btn danger" data-act="reset" style="margin-top:8px">Borrar todos los datos</button>
      <p class="hint">Los datos se guardan solo en este dispositivo.</p>`}
    </section>`;
  },
};

function lowStockCard() {
  const min = S.settings.minStock, low = [];
  Object.entries(MODELS).forEach(([m, M]) => M.longitudes().forEach(l => M.variantes().forEach(({ v: d }) => {
    const n = S.stock.imp[impKey(d, l, m)] || 0;
    if (impExists(d, l, m) && n <= min) low.push({ kind: 'imp', model: m, d, l, n });
  })));
  Object.entries(MU).forEach(([tipo, alturas]) => Object.keys(alturas).forEach(altura => {
    const n = S.stock.mu[muKey(tipo, altura)] || 0;
    if (n <= min) low.push({ kind: 'mu', tipo, altura, n });
  }));
  const list = low.filter(i => i.kind === (ui.stockSeg === 'mu' ? 'mu' : 'imp'));
  if (ui.stockSeg === 'otros' || !list.length) return '';
  return `<section class="card"><details><summary>Para reponer (${list.length})</summary><ul class="list">${list.map(i => `
    <li><div class="grow"><div class="name">${esc(itemName(i))}</div><div class="sub">${itemRef(i) ? esc(itemRef(i)) + ' · ' : ''}Quedan ${i.n}</div></div>
      <button class="link" data-act="restock" data-item='${esc(JSON.stringify(i))}'>+ Pedir</button></li>`).join('')}</ul></details></section>`;
}

function historyCard() {
  if (!S.history.length) return '';
  return `<section class="card"><h2>Historial de pedidos</h2><ul class="list">${S.history.map(h => `
    <li><div class="grow"><div class="name">${new Date(h.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
      · ${plural(h.items.reduce((n, i) => n + i.qty, 0), 'unidad', 'unidades')}</div>
      <div class="sub">${h.received ? '✓ Recibido y sumado al stock' : 'Pendiente de recibir'}</div></div>
      <button class="link" data-act="hist-view" data-id="${h.id}">Ver</button></li>`).join('')}</ul></section>`;
}

/* ---------- mensaje ---------- */
function groupByPatient(items) {
  const map = new Map();
  items.forEach(i => { const k = i.paciente || ''; if (!map.has(k)) map.set(k, []); map.get(k).push(i); });
  return [...map.entries()];
}

function section(title, items, withPatients) {
  if (!items.length) return [];
  const out = ['', title];
  const line = i => `• ${i.qty} × ${i.kind === 'imp' ? impName(i) : `Pilar Tetra ${i.tipo.toLowerCase()}, altura ${i.altura} mm`}${itemRef(i) ? ` (ref. ${itemRef(i)})` : ''}`;
  // Las líneas iguales (p. ej. añadidas por distintos usuarios) se suman en una sola.
  const merge = list => {
    const merged = new Map();
    list.forEach(i => {
      const k = itemName(i);
      merged.set(k, { ...i, qty: (merged.get(k)?.qty || 0) + i.qty });
    });
    return [...merged.values()];
  };
  if (withPatients) {
    groupByPatient(items).forEach(([pac, list]) => {
      out.push(pac ? `Paciente ${pac}:` : 'Sin paciente asignado:');
      merge(list).forEach(i => out.push(line(i)));
    });
  } else {
    merge(items).forEach(i => out.push(line(i)));
  }
  return out;
}

function buildMessage(items = S.cart) {
  const s = S.settings;
  const imp = items.filter(i => i.kind === 'imp'), mu = items.filter(i => i.kind === 'mu');
  const quien = [s.usuario, s.clinica].filter(Boolean);
  const lines = [`Hola${s.comercial ? ' ' + s.comercial : ''}${quien.length ? `, soy ${quien.join(' de ')}` : ''}.`,
    'Necesito el siguiente pedido de ETK:'];
  lines.push(...section('IMPLANTES', imp, s.incluirPacientes));
  lines.push(...section('PILARES TETRA (MULTI-UNIT)', mu, s.incluirPacientes));
  const tot = [];
  const nImp = imp.reduce((n, i) => n + i.qty, 0), nMu = mu.reduce((n, i) => n + i.qty, 0);
  if (nImp) tot.push(plural(nImp, 'implante', 'implantes'));
  if (nMu) tot.push(plural(nMu, 'pilar Tetra', 'pilares Tetra'));
  lines.push('', `Total: ${tot.join(' y ')}.`);
  if (S.notas.trim()) lines.push('', `Notas: ${S.notas.trim()}`);
  lines.push('', 'Muchas gracias.');
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) return toast('No se pudo copiar');
  }
  toast('Mensaje copiado');
}

/* ---------- panel inferior ---------- */
let sheetState = null;
function openSheet(html, state = null) {
  sheetState = state;
  $('#sheet').innerHTML = html;
  $('#sheetBg').hidden = false;
}
function closeSheet() { $('#sheetBg').hidden = true; sheetState = null; }

function stockSheet() {
  const { k, val } = sheetState;
  const { m, d, l } = parseImpKey(k);
  $('#sheet').innerHTML = `<h3>${esc(model(m).item(d, l))}</h3><p class="hint">${esc(impRef(d, l, m))} · Unidades en la clínica</p>
    <div class="big">${stepper('sheet-step', val)}</div>
    <button class="btn" data-act="sheet-save">Guardar</button>`;
}

/* ---------- acciones ---------- */
// Pide elegir usuario; no se puede cerrar sin elegir mientras no haya ninguno.
function userSheet() {
  openSheet(`<h3>¿Quién eres?</h3><p class="hint">Los implantes que añadas quedarán a tu nombre.</p>
    <div style="display:grid;gap:8px;margin-top:14px">${USERS.map(u =>
      `<button class="btn ${u === S.settings.usuario ? '' : 'ghost'}" data-act="user-set" data-v="${esc(u)}">${esc(u)}</button>`).join('')}</div>`,
    { locked: !USERS.includes(S.settings.usuario) });
}

function addToCart(item) {
  const paciente = ui.paciente.trim(), por = S.settings.usuario;
  const same = S.cart.find(i => i.kind === item.kind && i.paciente === paciente && (i.por || '') === por && itemName(i) === itemName(item));
  if (same) same.qty += item.qty;
  else S.cart.push({ id: uid(), paciente, por, ...item });
  ui.msg = null;
  save();
  toast('Añadido al pedido');
}

const ACTIONS = {
  'user-pick': () => { if (window.FIREBASE_CONFIG) { ui.tab = 'ajustes'; return; } userSheet(); return false; },
  'user-set': el => {
    S.settings.usuario = el.dataset.v; ui.msg = null; save(); closeSheet(); toast(el.dataset.v);
  },
  // Sesión y usuarios (solo con datos compartidos; ver sync.js)
  login: () => { Sync.login(); return false; },
  logout: () => { if (confirm('¿Cerrar sesión en este dispositivo?')) Sync.logout(); return false; },
  'logout-now': () => { Sync.logout(); return false; },
  'auth-mode': () => { Sync.toggleMode(); return false; },
  'auth-reset': () => { Sync.resetPassword(); return false; },
  'auth-retry': () => { Sync.retry(); return false; },
  'auth-resend': () => { Sync.resend(); return false; },
  'user-add': () => { Sync.addUser($('#newUserName').value, $('#newUserEmail').value); return false; },
  'user-del': el => {
    if (confirm(`¿Quitar el acceso a ${el.dataset.v}? Dejará de ver el pedido y el stock al momento.`)) Sync.removeUser(el.dataset.v);
    return false;
  },
  go: el => { ui.tab = el.dataset.tab; window.scrollTo(0, 0); },
  seg: el => { ui.stockSeg = el.dataset.v; },

  'imp-m': el => { ui.imp = { m: el.dataset.v, d: null, l: null, qty: 1 }; },
  'imp-d': el => { ui.imp.d = el.dataset.v; if (ui.imp.l && !impExists(ui.imp.d, ui.imp.l, ui.imp.m)) ui.imp.l = null; },
  'imp-l': el => { ui.imp.l = el.dataset.v; },
  'imp-qty': el => { ui.imp.qty = Math.max(1, ui.imp.qty + +el.dataset.delta); },
  'imp-add': () => { addToCart({ kind: 'imp', model: ui.imp.m, d: ui.imp.d, l: ui.imp.l, qty: ui.imp.qty }); ui.imp = { m: ui.imp.m, d: ui.imp.d, l: null, qty: 1 }; },

  'mu-t': el => { ui.mu.tipo = el.dataset.v; if (!muRef(ui.mu.tipo, ui.mu.altura)) ui.mu.altura = null; },
  'mu-a': el => { ui.mu.altura = el.dataset.v; },
  'mu-qty': el => { ui.mu.qty = Math.max(1, ui.mu.qty + +el.dataset.delta); },
  'mu-add': () => { addToCart({ kind: 'mu', tipo: ui.mu.tipo, altura: ui.mu.altura, qty: ui.mu.qty }); ui.mu = { tipo: ui.mu.tipo, altura: null, qty: 1 }; },

  'cart-qty': el => {
    const i = S.cart.find(x => x.id === el.dataset.id);
    if (i) { i.qty = Math.max(1, i.qty + +el.dataset.delta); ui.msg = null; save(); }
  },
  'cart-del': el => { S.cart = S.cart.filter(x => x.id !== el.dataset.id); ui.msg = null; save(); },
  'cart-clear': () => { if (confirm('¿Vaciar el pedido?')) { S.cart = []; S.notas = ''; ui.msg = null; save(); } },

  'msg-reset': () => { ui.msg = null; },
  copy: () => { copyText($('#msg').value); return false; },
  share: () => { navigator.share({ text: $('#msg').value }).catch(() => {}); return false; },
  'order-done': () => {
    S.history.unshift({ id: uid(), date: Date.now(), items: S.cart, text: $('#msg').value, received: false });
    S.history = S.history.slice(0, 50);
    S.cart = []; S.notas = ''; ui.msg = null; ui.paciente = '';
    save(); toast('Pedido guardado en el historial');
  },

  'hist-view': el => {
    const h = S.history.find(x => x.id === el.dataset.id);
    if (!h) return false;
    openSheet(`<h3>Pedido del ${new Date(h.date).toLocaleDateString('es-ES')}</h3>
      <textarea class="msg" readonly style="margin:10px 0">${esc(h.text)}</textarea>
      ${h.received ? '<p class="hint">✓ Recibido y sumado al stock.</p>' : `<button class="btn" data-act="hist-recv" data-id="${h.id}">Recibido: sumar al stock</button>`}
      <div class="btns"><button class="btn ghost" data-act="hist-copy" data-id="${h.id}">Copiar</button>
      <button class="btn danger" data-act="hist-del" data-id="${h.id}">Eliminar</button></div>`);
    return false;
  },
  'hist-recv': el => {
    const h = S.history.find(x => x.id === el.dataset.id);
    if (!h || h.received) return;
    h.items.forEach(i => {
      if (i.kind === 'imp') { const k = impKey(i.d, i.l, i.model); S.stock.imp[k] = (S.stock.imp[k] || 0) + i.qty; }
      else { const k = muKey(i.tipo, i.altura); S.stock.mu[k] = (S.stock.mu[k] || 0) + i.qty; }
    });
    h.received = true; save(); closeSheet(); toast('Stock actualizado');
  },
  'hist-copy': el => { const h = S.history.find(x => x.id === el.dataset.id); if (h) copyText(h.text); return false; },
  'hist-del': el => { if (confirm('¿Eliminar este pedido del historial?')) { S.history = S.history.filter(x => x.id !== el.dataset.id); save(); closeSheet(); } },

  'stock-edit': el => { const n = S.stock.imp[el.dataset.k] || 0; sheetState = { k: el.dataset.k, base: n, val: n }; stockSheet(); $('#sheetBg').hidden = false; return false; },
  'sheet-step': el => { sheetState.val = Math.max(0, sheetState.val + +el.dataset.delta); stockSheet(); return false; },
  'sheet-save': () => {
    // Se aplica la variación sobre el valor actual, por si otra persona lo cambió mientras el panel estaba abierto.
    const { k, base, val } = sheetState;
    S.stock.imp[k] = Math.max(0, (S.stock.imp[k] || 0) + val - base); save(); closeSheet();
  },
  'stock-step': el => { const k = el.dataset.k; S.stock.mu[k] = Math.max(0, (S.stock.mu[k] || 0) + +el.dataset.delta); save(); },
  'otro-add': () => {
    const nombre = $('#otroNombre').value.trim();
    if (!nombre) return false;
    S.stock.otros.push({ id: uid(), nombre, qty: 1 }); save();
  },
  'otro-step': el => { const o = S.stock.otros.find(x => x.id === el.dataset.id); if (o) { o.qty = Math.max(0, o.qty + +el.dataset.delta); save(); } },
  'otro-del': el => { if (confirm('¿Eliminar este aditamento?')) { S.stock.otros = S.stock.otros.filter(x => x.id !== el.dataset.id); save(); } },
  restock: el => {
    const { n, ...item } = JSON.parse(el.dataset.item);
    const saved = ui.paciente; ui.paciente = 'Reposición stock';
    addToCart({ ...item, qty: 1 }); ui.paciente = saved;
  },

  'min-step': el => { S.settings.minStock = Math.max(0, S.settings.minStock + +el.dataset.delta); save(); },
  export: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = `novalis-implant-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return false;
  },
  reset: () => {
    if (!confirm('Se borrarán el pedido, el stock, el historial y los ajustes. ¿Continuar?')) return false;
    localStorage.removeItem(KEY); S = load();
  },
};

document.addEventListener('click', e => {
  if (e.target.id === 'sheetBg') return sheetState && sheetState.locked ? undefined : closeSheet();
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) { ui.tab = tabBtn.dataset.tab; window.scrollTo(0, 0); return render(); }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (ACTIONS[el.dataset.act](el) !== false) render();
});

// Campos de texto: se guardan al escribir sin volver a pintar (para no perder el foco).
function refreshLinks() {
  const text = $('#msg')?.value;
  if (text == null) return;
  const tel = S.settings.telefono.replace(/[^\d+]/g, '');
  $('#waLink').href = `https://wa.me/${tel.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
  $('#smsLink').href = `sms:${tel}?&body=${encodeURIComponent(text)}`;
}
document.addEventListener('input', e => {
  const field = e.target.dataset.field;
  if (!field) return;
  const v = e.target.value;
  if (field === 'paciente') ui.paciente = v;
  else if (field === 'msg') { ui.msg = v; refreshLinks(); }
  else if (field === 'notas') { S.notas = v; ui.msg = null; $('#msg').value = buildMessage(); refreshLinks(); save(); }
  else if (field === 'incluirPacientes') { S.settings.incluirPacientes = e.target.checked; ui.msg = null; save(); render(); }
  else if (field.startsWith('s.')) { S.settings[field.slice(2)] = v; ui.msg = null; save(); }
});
// El catálogo se aplica al salir del campo, para poder escribir comas con calma.
document.addEventListener('change', e => {
  const field = e.target.dataset.field;
  if (field && field.startsWith('c.')) {
    const list = [...new Set(e.target.value.split(',').map(x => x.trim()).filter(Boolean))];
    if (!list.length) { toast('La lista no puede quedar vacía'); return render(); }
    S.catalog[field.slice(2)] = list; save(); render();
  }
  if (e.target.id === 'importFile' && e.target.files[0]) {
    e.target.files[0].text().then(t => {
      const data = JSON.parse(t);
      if (!data || typeof data !== 'object' || !data.stock || !data.catalog) throw new Error('formato');
      localStorage.setItem(KEY, JSON.stringify(data)); S = load(); render(); toast('Copia importada');
    }).catch(() => toast('Archivo no válido'));
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
// Con datos compartidos, sync.js pide primero iniciar sesión.
if (!window.FIREBASE_CONFIG && !USERS.includes(S.settings.usuario)) userSheet();
