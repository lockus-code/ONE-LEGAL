/*
 * LEGAL · Portal — arranque, ingreso, menú por rol, enrutamiento y sincronización.
 * El portal consulta al servidor cada 15 s para mostrar lo que se indexa desde la extensión.
 */
(function () {
  'use strict';
  const L = window.LEGAL;
  const { $, esc } = L;

  const MENUS = {
    admin: [
      ['Gestión', [['panel', 'Panel institucional'], ['procesos', 'Cartera de procesos'], ['tramites', 'Trámites SGD'], ['alertas', 'Alertas'], ['plantillas', 'Plantillas']]],
      ['Administración', [['usuarios', 'Usuarios'], ['taxonomia', 'Taxonomía de procesos'], ['bd', 'Base de datos'], ['config', 'Configuración'], ['extension', 'Extensión Conector SGD']]]
    ],
    gerente: [
      ['Gerencia', [['panel', 'Panel institucional'], ['procesos', 'Cartera de procesos'], ['alertas', 'Alertas'], ['plantillas', 'Plantillas por aprobar'], ['tramites', 'Trámites SGD']]]
    ],
    profesional: [
      ['Mi trabajo', [['panel', 'Mi panel'], ['procesos', 'Mis procesos'], ['tareas', 'Mis tareas'], ['plazos', 'Plazos por definir'], ['alertas', 'Alertas']]],
      ['Configuración', [['plantillas', 'Mis plantillas'], ['tramites', 'Trámites SGD'], ['extension', 'Extensión Conector SGD']]]
    ],
    asistente: [
      ['Mi trabajo', [['panel', 'Mi panel'], ['procesos', 'Procesos'], ['tramites', 'Trámites SGD'], ['alertas', 'Alertas']]],
      ['Herramientas', [['extension', 'Extensión Conector SGD']]]
    ]
  };
  const permitidas = () => new Set([...MENUS[L.rol()].flatMap(([, items]) => items.map(([k]) => k)), 'proceso']);

  // ------------------------------------------------------------- ingreso
  function mostrarIngreso(mensaje) {
    $('#app').hidden = true;
    $('#pantalla-ingreso').hidden = false;
    const m = $('#ingreso-mensaje');
    m.hidden = !mensaje;
    m.textContent = mensaje || '';
    fetch('/api/estado').then((r) => r.json()).then((e) => { $('#ingreso-servidor').textContent = `${e.nombre} ${e.version} · ${e.urlPublica}`; }).catch(() => {});
    $('#form-ingreso').usuario.focus();
  }

  $('#form-ingreso').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await L.api('POST', '/api/sesion', { usuario: f.usuario.value.trim(), clave: f.clave.value, origen: 'portal' });
      f.clave.value = '';
      iniciar();
    } catch (e) {
      mostrarIngreso(e.estado === 401 ? 'Usuario o contraseña incorrectos.' : e.message);
    }
  });

  L.alExpirar = () => { detenerSincronizacion(); L.cerrarModal(); mostrarIngreso('La sesión expiró. Vuelva a ingresar.'); };

  function cambiarClave(obligatorio) {
    const c = L.modal(`${L.cabModal(obligatorio ? 'Cambie su contraseña' : 'Cambiar contraseña', obligatorio ? 'Es su primer ingreso o tiene una clave temporal' : '')}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-clave" novalidate>
        <label>Contraseña actual<input type="password" name="actual" autocomplete="current-password"></label>
        <label>Nueva contraseña (mín. 8 caracteres)<input type="password" name="nueva" autocomplete="new-password"></label>
        <label>Repita la nueva contraseña<input type="password" name="repite" autocomplete="new-password"></label>
        <div class="modal__pie" style="padding:0">${obligatorio ? '<button type="button" class="btn" id="btn-salir-clave">Cerrar sesión</button>' : '<button type="button" class="btn" data-cerrar>Cancelar</button>'}<button class="btn btn--primario">Guardar</button></div>
      </form>`, { angosto: true });
    if (obligatorio) { $('#modal').dataset.bloqueado = '1'; $('#btn-salir-clave', c).addEventListener('click', salir); }
    $('#f-clave', c).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      if (f.nueva.value !== f.repite.value) { L.notificar('Las contraseñas nuevas no coinciden.', 'error'); return; }
      try {
        await L.api('POST', '/api/sesion/clave', { actual: f.actual.value, nueva: f.nueva.value });
        delete $('#modal').dataset.bloqueado;
        L.cerrarModal();
        L.notificar('Contraseña actualizada.');
        await L.refrescar();
      } catch (e) { L.error(e); }
    });
  }

  async function salir() {
    detenerSincronizacion();
    try { await L.api('DELETE', '/api/sesion', {}); } catch (e) { /* ya cerrada */ }
    delete $('#modal').dataset.bloqueado;
    L.cerrarModal();
    L.D = null;
    mostrarIngreso();
  }

  // ------------------------------------------------------------- interfaz
  function pintarMenu() {
    const actual = L.ruta;
    const alertas = L.D.alertas.filter((a) => a.nivel !== 'info').length;
    $('#menu').innerHTML = MENUS[L.rol()].map(([grupo, items]) => `<div class="menu__grupo">${esc(grupo)}</div>${items.map(([k, t]) => `<a href="#${k}" ${actual === k || (actual === 'proceso' && k === 'procesos') ? 'aria-current="page"' : ''}>${esc(t)}${k === 'alertas' && alertas ? ` <span class="cuenta">${alertas}</span>` : ''}${k === 'plazos' && L.D.alertas.some((a) => a.tipo === 'plazo-no-definido') ? ` <span class="cuenta">${L.D.alertas.filter((a) => a.tipo === 'plazo-no-definido').length}</span>` : ''}${k === 'plantillas' && L.es('gerente', 'admin') && L.D.plantillas.some((x) => x.estado === 'pendiente') ? ` <span class="cuenta">${L.D.plantillas.filter((x) => x.estado === 'pendiente').length}</span>` : ''}</a>`).join('')}`).join('');
    const u = L.yo();
    $('#usuario-nombre').textContent = u.nombre;
    $('#usuario-rol').textContent = L.ROLES[u.rol];
    $('#avatar').textContent = L.iniciales(u.nombre);
    $('#marca-entidad').textContent = L.D.config.nombreEntidad;
    $('#campana-n').textContent = alertas;
    $('#campana').classList.toggle('campana--activa', alertas > 0);
    $('#estado-bd').textContent = `BD conectada · ${L.D.procesos.length} proceso(s) · act. ${new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;
  }

  L.pintar = async function () {
    if (!L.D) return;
    const [ruta, parametro] = (location.hash.slice(1) || 'panel').split('/');
    L.ruta = permitidas().has(ruta) && L.vistas[ruta] ? ruta : 'panel';
    L.parametro = parametro;
    const vista = L.vistas[L.ruta];
    const valor = (x) => (typeof x === 'function' ? x.call(vista) : x || '');
    $('#titulo-vista').textContent = valor(vista.titulo);
    $('#subtitulo-vista').textContent = valor(vista.subtitulo);
    document.title = `${valor(vista.titulo)} · LEGAL`;
    pintarMenu();
    // Un contenedor nuevo en cada pintado evita acumular manejadores de eventos.
    const anterior = $('#vista');
    const nuevo = anterior.cloneNode(false);
    anterior.replaceWith(nuevo);
    L.editando = false;
    await vista.render(nuevo);
    L.rotularTablas(nuevo);
  };

  L.refrescar = async function () {
    await L.recargar();
    await L.pintar();
  };

  // --------------------------------------------- sincronización periódica
  let temporizador = null;
  let firma = '';
  const firmaDatos = (d) => JSON.stringify([d.procesos, d.tareas, d.tramites, d.solicitudes, d.plantillas, d.usuarios.length, d.alertas.length]);
  function detenerSincronizacion() { clearInterval(temporizador); temporizador = null; }
  function sincronizar() {
    detenerSincronizacion();
    temporizador = setInterval(async () => {
      if (document.hidden || !$('#modal').hidden || L.editando) return;
      const activo = document.activeElement;
      if (activo && activo.closest('#vista') && /INPUT|TEXTAREA|SELECT/.test(activo.tagName)) return;
      try {
        const d = await L.api('GET', '/api/datos');
        const f = firmaDatos(d);
        if (f !== firma) { firma = f; L.D = d; L.indexar(); await L.pintar(); } else { pintarMenu(); }
      } catch (e) { $('#estado-bd').textContent = 'Sin conexión con el servidor'; }
    }, 15000);
  }

  async function iniciar() {
    try {
      await L.recargar();
    } catch (e) {
      if (e.estado === 401) { mostrarIngreso(); return; }
      mostrarIngreso(e.message);
      return;
    }
    firma = firmaDatos(L.D);
    $('#pantalla-ingreso').hidden = true;
    $('#app').hidden = false;
    await L.pintar();
    sincronizar();
    if (L.D.usuario.debeCambiarClave) cambiarClave(true);
  }

  // ---------------------------------------------------------------- eventos
  window.addEventListener('hashchange', () => { L.cerrarModal(); L.refrescar().catch(() => L.pintar()); window.scrollTo(0, 0); $('#lateral').classList.remove('abierto'); });
  // Menú de la cuenta.
  const menuCuenta = $('#menu-cuenta');
  const alternarMenu = (abrir) => { menuCuenta.hidden = !abrir; $('#btn-cuenta').setAttribute('aria-expanded', abrir); if (abrir) menuCuenta.querySelector('button').focus(); };
  $('#btn-cuenta').addEventListener('click', (ev) => { ev.stopPropagation(); alternarMenu(menuCuenta.hidden); });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.cuenta-menu')) alternarMenu(false); });
  menuCuenta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { alternarMenu(false); $('#btn-cuenta').focus(); } });
  menuCuenta.addEventListener('click', (ev) => {
    const a = ev.target.dataset.cuenta;
    if (!a) return;
    alternarMenu(false);
    if (a === 'clave') cambiarClave(false);
    if (a === 'extension') location.hash = '#extension';
    if (a === 'salir') salir();
  });
  $('#btn-menu').addEventListener('click', () => {
    const lat = $('#lateral');
    lat.classList.toggle('abierto');
    $('#btn-menu').setAttribute('aria-expanded', lat.classList.contains('abierto'));
  });
  // Enlaces «Abrir» de tareas en cualquier vista.
  document.addEventListener('click', (ev) => { const a = ev.target.closest('a[data-abrir]'); if (a) { ev.preventDefault(); L.abrirTarea(a.dataset.abrir); } });
  $('#modal').addEventListener('click', (ev) => { if (ev.target.closest('[data-cerrar]') && !$('#modal').dataset.bloqueado) L.cerrarModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#modal').hidden && !$('#modal').dataset.bloqueado && $('#confirmacion').hidden) L.cerrarModal(); });

  // Información emergente de los gráficos.
  const tip = $('#tooltip');
  const mostrarTip = (el) => {
    tip.innerHTML = `<strong>${esc(el.dataset.tip)}</strong><br>${esc(el.dataset.tipDetalle || '')}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
    tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 8}px`;
  };
  document.addEventListener('mouseover', (ev) => { const el = ev.target.closest('[data-tip]'); if (el) mostrarTip(el); else tip.hidden = true; });
  document.addEventListener('focusin', (ev) => { const el = ev.target.closest('[data-tip]'); if (el) mostrarTip(el); });

  iniciar();
})();
