'use strict';
/* Sincronización opcional con Firebase (inicio de sesión + Firestore).
   Solo se activa si config.js define FIREBASE_CONFIG. Comparte entre dispositivos el pedido,
   el stock, el historial y los datos de la clínica; el usuario activo y las preferencias
   de pantalla siguen siendo de cada dispositivo.

   Funciona por diferencias: app.js modifica S como siempre y llama a save(); aquí se compara
   con la última copia sincronizada (prev) y se envía solo lo que ha cambiado. */
(async () => {
  if (!window.FIREBASE_CONFIG) return;

  const loadScript = src => new Promise((ok, ko) => {
    const el = document.createElement('script');
    el.src = src; el.onload = ok; el.onerror = ko;
    document.head.appendChild(el);
  });
  try {
    for (const f of ['app', 'auth', 'firestore']) await loadScript(`vendor/firebase-${f}-compat.js`);
  } catch (e) { return toast('No se pudo cargar la sincronización'); }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth(), db = firebase.firestore();
  if (window.FIREBASE_EMULATOR) {
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    db.useEmulator('127.0.0.1', 8080);
  } else {
    // Caché local de Firestore: permite trabajar sin conexión y sincroniza al volver.
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  }
  const increment = firebase.firestore.FieldValue.increment;
  const root = db.collection('clinica').doc('principal');
  const LISTS = ['cart', 'history', 'otros']; // un documento por elemento
  const STOCKS = ['imp', 'mu'];               // un documento con un contador por medida
  const CFG = ['clinica', 'comercial', 'telefono', 'minStock'];

  const clone = x => JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Parte compartida del estado, en la forma en que se guarda en la nube.
  const shared = () => clone({
    cart: S.cart, history: S.history, otros: S.stock.otros, imp: S.stock.imp, mu: S.stock.mu,
    cfg: { ...Object.fromEntries(CFG.map(k => [k, S.settings[k]])), catalog: S.catalog, notas: S.notas },
  });
  const empty = () => ({ cart: [], history: [], otros: [], imp: {}, mu: {}, cfg: {} });

  let prev = null; // última copia sincronizada; null = sin sesión
  let timer = null, unsub = [], pendingRender = false, loginError = '';

  function flush() {
    clearTimeout(timer); timer = null;
    if (!prev) return;
    const cur = shared(), batch = db.batch();
    let n = 0;
    LISTS.forEach(name => {
      const col = root.collection(name), before = new Map(prev[name].map(x => [x.id, x]));
      cur[name].forEach(x => {
        if (!same(before.get(x.id), x)) { batch.set(col.doc(x.id), x); n++; }
        before.delete(x.id);
      });
      before.forEach((_, id) => { batch.delete(col.doc(id)); n++; });
    });
    STOCKS.forEach(name => {
      // Se envía la variación (no el total) para que dos personas puedan tocar el stock a la vez.
      const delta = {};
      new Set([...Object.keys(prev[name]), ...Object.keys(cur[name])]).forEach(k => {
        const d = (cur[name][k] || 0) - (prev[name][k] || 0);
        if (d) delta[k] = increment(d);
      });
      if (Object.keys(delta).length) { batch.set(root.collection('stock').doc(name), delta, { merge: true }); n++; }
    });
    if (!same(prev.cfg, cur.cfg)) { batch.set(root, cur.cfg, { merge: true }); n++; }
    prev = cur;
    if (n) batch.commit().catch(() => toast('No se pudo sincronizar'));
  }

  // No repintar mientras se escribe en un campo: se perdería el foco.
  const typing = () => {
    const el = document.activeElement;
    return el && el.closest('#view') && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox'));
  };
  function refresh() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* sin espacio: la nube sigue siendo la copia buena */ }
    if (typing()) pendingRender = true; else render();
  }
  document.addEventListener('focusout', () => {
    if (pendingRender) setTimeout(() => { if (!typing()) { pendingRender = false; render(); } }, 0);
  });

  function listen() {
    const on = (ref, apply) => unsub.push(ref.onSnapshot(snap => {
      if (!prev) return;
      if (timer) flush(); // enviar antes los cambios locales pendientes para no pisarlos
      apply(snap);
      prev = shared();
      refresh();
    }, () => toast('Sin acceso a los datos compartidos')));

    const docs = snap => snap.docs.map(d => d.data());
    on(root.collection('cart'), s => { S.cart = docs(s).sort((a, b) => (a.id < b.id ? -1 : 1)); ui.msg = null; });
    on(root.collection('history'), s => { S.history = docs(s).sort((a, b) => b.date - a.date); });
    on(root.collection('otros'), s => { S.stock.otros = docs(s).sort((a, b) => (a.id < b.id ? -1 : 1)); });
    STOCKS.forEach(name => on(root.collection('stock').doc(name), d => { S.stock[name] = d.data() || {}; }));
    on(root, d => {
      const c = d.data() || {};
      CFG.forEach(k => { if (k in c) S.settings[k] = c[k]; });
      if (c.catalog) S.catalog = { ...S.catalog, ...c.catalog };
      if ('notas' in c && c.notas !== S.notas) { S.notas = c.notas; ui.msg = null; }
    });
  }

  async function start(user) {
    if (USERS.includes(user.displayName)) S.settings.usuario = user.displayName;
    let exists = true;
    try { exists = (await root.get()).exists; } catch (e) {
      if (e.code === 'permission-denied') {
        loginError = 'Esta cuenta no tiene acceso a los datos de la clínica.';
        return auth.signOut();
      }
      // Sin conexión ni caché: se asume que ya hay datos.
    }
    if (exists) {
      // La nube manda: se descartan los datos locales compartidos y se cargan los suyos.
      S.cart = []; S.history = []; S.stock = { imp: {}, mu: {}, otros: [] };
      prev = shared();
    } else {
      // Primera vez: se suben los datos que ya hubiera en este dispositivo.
      prev = empty();
      flush();
    }
    listen();
    closeSheet();
    render();
    if (!USERS.includes(S.settings.usuario)) userSheet();
  }

  function loginSheet(error = '') {
    openSheet(`<h3>Iniciar sesión</h3><p class="hint">Accede con tu cuenta de la clínica.</p>
      <label class="f" style="margin-top:12px">Correo electrónico
        <input id="loginEmail" type="email" autocomplete="username" autocapitalize="none" inputmode="email"></label>
      <label class="f">Contraseña
        <input id="loginPass" type="password" autocomplete="current-password"></label>
      ${error ? `<p class="hint" style="color:var(--bad);margin-bottom:10px">${esc(error)}</p>` : ''}
      <button class="btn" data-act="login">Entrar</button>`, { locked: true });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.id === 'loginEmail' || e.target.id === 'loginPass')) $('[data-act=login]').click();
  });

  const ERRORS = {
    'auth/network-request-failed': 'Sin conexión. Inténtalo de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/invalid-email': 'El correo no es válido.',
  };

  window.Sync = {
    get email() { return auth.currentUser ? auth.currentUser.email : ''; },
    push() { if (prev) { clearTimeout(timer); timer = setTimeout(flush, 400); } },
    setName(name) { if (auth.currentUser) auth.currentUser.updateProfile({ displayName: name }).catch(() => {}); },
    async login() {
      const email = $('#loginEmail').value.trim(), pass = $('#loginPass').value;
      if (!email || !pass) return;
      try { await auth.signInWithEmailAndPassword(email, pass); }
      catch (e) { loginSheet(ERRORS[e.code] || 'Correo o contraseña incorrectos.'); $('#loginEmail').value = email; }
    },
    async logout() {
      flush();
      unsub.forEach(f => f()); unsub = []; prev = null;
      // No dejar datos de la clínica en un dispositivo sin sesión.
      const usuario = S.settings.usuario;
      localStorage.removeItem(KEY); S = load(); S.settings.usuario = usuario;
      await auth.signOut();
    },
  };

  auth.onAuthStateChanged(user => {
    if (user) start(user);
    else { closeSheet(); render(); loginSheet(loginError); loginError = ''; }
  });
})();
