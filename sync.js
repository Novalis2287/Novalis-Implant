'use strict';
/* Sincronización opcional con Firebase (inicio de sesión + Firestore).
   Solo se activa si config.js define FIREBASE_CONFIG. Comparte entre dispositivos el pedido,
   el stock, el historial y los datos de la clínica. Tiene acceso quien figura en la colección
   `usuarios` (la gestiona el administrador desde Ajustes) y ha verificado su correo.

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
  auth.languageCode = 'es';
  if (window.FIREBASE_EMULATOR) {
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    db.useEmulator('127.0.0.1', 8080);
  } else {
    // Caché local de Firestore: permite trabajar sin conexión y sincroniza al volver.
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  }
  const increment = firebase.firestore.FieldValue.increment;
  const root = db.collection('clinica').doc('principal');
  const users = db.collection('usuarios'); // un documento por correo: { email, nombre, admin }
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
  let timer = null, unsub = [], pendingRender = false;
  let me = null, userList = [], signup = false; // mi ficha, lista de usuarios, modo «crear cuenta»

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
    }, denied));

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
    // Lista de usuarios: si el administrador me quita, pierdo el acceso al momento.
    unsub.push(users.onSnapshot(snap => {
      userList = docs(snap).sort((a, b) => a.nombre.localeCompare(b.nombre));
      const mine = userList.find(u => u.email === auth.currentUser.email);
      if (!mine) return denied();
      me = mine; S.settings.usuario = me.nombre;
      refresh();
    }, denied));
  }

  function stop() {
    unsub.forEach(f => f()); unsub = []; prev = null; me = null; userList = [];
    clearTimeout(timer); timer = null;
  }
  // No dejar datos de la clínica en un dispositivo sin sesión o sin acceso.
  function wipe() { localStorage.removeItem(KEY); S = load(); }

  // Pantallas de bloqueo: no se pueden cerrar sin resolverlas.
  function gate(title, text, buttons) {
    openSheet(`<h3>${title}</h3><p class="hint">${text}</p>
      <div style="display:grid;gap:8px;margin-top:14px">${buttons}
        <button class="btn ghost" data-act="logout-now">Cerrar sesión</button></div>`, { locked: true });
  }
  const verifySheet = user => gate('Verifica tu correo',
    `Hemos enviado un enlace a <b>${esc(user.email)}</b>. Ábrelo (mira también en correo no deseado) y vuelve aquí.`,
    `<button class="btn" data-act="auth-retry">Ya lo he verificado</button>
     <button class="btn ghost" data-act="auth-resend">Reenviar correo</button>`);
  const noAccessSheet = user => gate('Sin acceso',
    `La cuenta <b>${esc(user.email)}</b> no tiene acceso a los datos de la clínica. Pide al administrador que añada este correo.`,
    `<button class="btn" data-act="auth-retry">Reintentar</button>`);
  function denied() {
    if (!auth.currentUser) return;
    stop(); wipe(); render(); noAccessSheet(auth.currentUser);
  }

  async function start(user) {
    stop();
    if (!user.emailVerified) return verifySheet(user);
    try {
      const d = await users.doc(user.email).get();
      me = d.exists ? d.data() : null;
    } catch (e) { me = null; }
    if (!me) return noAccessSheet(user);
    S.settings.usuario = me.nombre;
    let exists = true;
    try { exists = (await root.get()).exists; } catch (e) { /* sin conexión ni caché: se asume que ya hay datos */ }
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
  }

  function loginSheet(error = '', email = '') {
    openSheet(`<h3>${signup ? 'Crear cuenta' : 'Iniciar sesión'}</h3>
      <p class="hint">${signup ? 'Usa el correo al que el administrador ha dado acceso y elige una contraseña.' : 'Accede con tu cuenta de la clínica.'}</p>
      <label class="f" style="margin-top:12px">Correo electrónico
        <input id="loginEmail" type="email" value="${esc(email)}" autocomplete="username" autocapitalize="none" inputmode="email"></label>
      <label class="f">Contraseña
        <input id="loginPass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
      ${error ? `<p class="hint" style="color:var(--bad);margin-bottom:10px">${esc(error)}</p>` : ''}
      <button class="btn" data-act="login">${signup ? 'Crear cuenta' : 'Entrar'}</button>
      <div class="row" style="margin-top:6px">
        <button class="link" data-act="auth-mode">${signup ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>
        ${signup ? '' : '<button class="link" data-act="auth-reset">He olvidado mi contraseña</button>'}</div>`, { locked: true });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.id === 'loginEmail' || e.target.id === 'loginPass')) $('[data-act=login]').click();
  });

  const ERRORS = {
    'auth/network-request-failed': 'Sin conexión. Inténtalo de nuevo.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Inicia sesión.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  };
  const typed = () => ({ email: $('#loginEmail').value.trim().toLowerCase(), pass: $('#loginPass').value });

  window.Sync = {
    get email() { return auth.currentUser ? auth.currentUser.email : ''; },
    get isAdmin() { return !!(me && me.admin); },
    get users() { return userList; },
    push() { if (prev) { clearTimeout(timer); timer = setTimeout(flush, 400); } },

    async login() {
      const { email, pass } = typed();
      if (!email || !pass) return;
      try {
        if (signup) {
          const { user } = await auth.createUserWithEmailAndPassword(email, pass);
          signup = false;
          await user.sendEmailVerification();
        } else await auth.signInWithEmailAndPassword(email, pass);
      } catch (e) { loginSheet(ERRORS[e.code] || 'Correo o contraseña incorrectos.', email); }
    },
    toggleMode() { signup = !signup; loginSheet('', typed().email); },
    async resetPassword() {
      const { email } = typed();
      if (!email) return loginSheet('Escribe tu correo y vuelve a pulsar «He olvidado mi contraseña».');
      try { await auth.sendPasswordResetEmail(email); } catch (e) { /* no revelar si la cuenta existe */ }
      toast('Si la cuenta existe, te llegará un correo');
    },
    // Tras verificar el correo hay que renovar la sesión para que el servidor lo vea.
    async retry() {
      const user = auth.currentUser;
      if (!user) return;
      try { await user.reload(); await user.getIdToken(true); } catch (e) { return toast('Sin conexión'); }
      start(auth.currentUser);
    },
    async resend() {
      try { await auth.currentUser.sendEmailVerification(); toast('Correo enviado'); }
      catch (e) { toast('Espera un momento antes de reenviar'); }
    },
    async logout() {
      flush(); stop(); wipe();
      await auth.signOut();
    },

    // Administración de usuarios (las reglas del servidor solo se lo permiten al administrador).
    async addUser(nombre, email) {
      email = email.trim().toLowerCase(); nombre = nombre.trim();
      if (!nombre || !/^\S+@\S+\.\S+$/.test(email)) return toast('Escribe nombre y un correo válido');
      if (userList.some(u => u.email === email)) return toast('Ese correo ya tiene acceso');
      try { await users.doc(email).set({ email, nombre, admin: false }); toast('Acceso concedido'); }
      catch (e) { toast('No se pudo añadir'); }
    },
    async removeUser(email) {
      try { await users.doc(email).delete(); toast('Acceso retirado'); }
      catch (e) { toast('No se pudo quitar'); }
    },
  };

  auth.onAuthStateChanged(user => {
    if (user) start(user);
    else { stop(); closeSheet(); render(); loginSheet(); }
  });
})();
