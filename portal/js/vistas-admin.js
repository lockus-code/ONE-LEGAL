/*
 * LEGAL · Portal — administración: usuarios, taxonomía, base de datos,
 * configuración y página de instalación de la extensión.
 */
(function () {
  'use strict';
  const L = window.LEGAL;
  const { esc } = L;

  // --------------------------------------------------------------- usuarios
  L.vistas.usuarios = {
    titulo: 'Usuarios', subtitulo: 'Cuentas y roles de acceso',
    render(v) {
      const lista = [...L.D.usuarios].sort((a, b) => a.rol.localeCompare(b.rol) || a.nombre.localeCompare(b.nombre));
      v.innerHTML = `
        <div class="barra-filtros"><span class="secundario">${lista.length} usuario(s)</span><span class="espacio"></span><button class="btn btn--primario" id="btn-nuevo">+ Nuevo usuario</button></div>
        <section class="tarjeta"><div class="tabla-envoltura"><table class="tabla">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead>
          <tbody>${lista.map((u) => `<tr>
            <td><strong>${esc(u.nombre)}</strong><div class="secundario">${esc(u.cargo || '')}${u.correo ? ` · ${esc(u.correo)}` : ''}</div></td>
            <td class="mono">${esc(u.usuario)}</td>
            <td>${esc(L.ROLES[u.rol] || u.rol)}</td>
            <td>${u.activo ? '<span class="chip chip--estado-activo">Activo</span>' : '<span class="chip">Inactivo</span>'}${u.debeCambiarClave ? ' <span class="chip chip--advertencia">Clave temporal</span>' : ''}</td>
            <td>${L.fmtFechaHora(u.ultimoIngreso)}</td>
            <td><select data-usuario="${esc(u.id)}" aria-label="Acciones">${L.opciones([['editar', 'Editar'], ['clave', 'Asignar clave temporal'], [u.activo ? 'desactivar' : 'activar', u.activo ? 'Desactivar' : 'Activar'], ['eliminar', 'Eliminar']], '', 'Acciones…')}</select></td></tr>`).join('')}</tbody>
        </table></div></section>
        <div class="aviso aviso--info"><span><strong>Roles:</strong> el <em>administrador</em> gestiona usuarios, taxonomía y base de datos; el <em>gerente</em> ve los indicadores y toda la cartera; el <em>profesional</em> gestiona sus procesos, tareas, plazos y plantillas; el <em>asistente administrativo</em> indexa trámites del SGD, registra procesos y solicita plazos.</span></div>`;
      L.$('#btn-nuevo', v).addEventListener('click', () => formUsuario(null));
      v.addEventListener('change', async (ev) => {
        const id = ev.target.dataset.usuario;
        if (!id) return;
        const a = ev.target.value; ev.target.value = '';
        const u = L.D.porUsuario[id];
        try {
          if (a === 'editar') return formUsuario(u);
          if (a === 'clave') return formClave(u);
          if (a === 'activar' || a === 'desactivar') await L.api('PUT', `/api/usuarios/${id}`, { activo: a === 'activar', cargo: u.cargo, correo: u.correo });
          if (a === 'eliminar') {
            if (!(await L.confirmar(`¿Eliminar a ${u.nombre}? Si tiene historial, es preferible desactivarlo.`, { peligro: true, aceptar: 'Eliminar' }))) return;
            await L.api('DELETE', `/api/usuarios/${id}`);
          }
          await L.refrescar();
        } catch (e) { L.error(e); }
      });
    }
  };

  function formUsuario(u) {
    const c = L.modal(`${L.cabModal(u ? 'Editar usuario' : 'Nuevo usuario')}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-u" novalidate>
        <div class="doble"><label>Nombre completo<input name="nombre" required value="${esc(u ? u.nombre : '')}" placeholder="Abg. Ana Torres Medina"></label>
        <label>Usuario<input name="usuario" required value="${esc(u ? u.usuario : '')}" ${u ? 'disabled' : ''} placeholder="atorres" autocomplete="off"></label></div>
        <div class="doble"><label>Rol<select name="rol">${L.opciones(Object.entries(L.ROLES), u ? u.rol : 'profesional')}</select></label>
        <label>Cargo<input name="cargo" value="${esc(u ? u.cargo || '' : '')}" placeholder="Especialista legal"></label></div>
        <label>Correo (opcional)<input name="correo" type="email" value="${esc(u ? u.correo || '' : '')}"></label>
        ${u ? '' : '<label>Clave temporal (mín. 8 caracteres; se pedirá cambiarla)<input name="clave" type="text" autocomplete="off" required></label>'}
        <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Guardar</button></div>
      </form>`, { angosto: true });
    L.$('#f-u', c).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const cuerpo = { nombre: f.nombre.value, rol: f.rol.value, cargo: f.cargo.value, correo: f.correo.value };
      try {
        if (u) await L.api('PUT', `/api/usuarios/${u.id}`, cuerpo);
        else await L.api('POST', '/api/usuarios', { ...cuerpo, usuario: f.usuario.value, clave: f.clave.value });
        L.cerrarModal();
        L.notificar('Usuario guardado.');
        await L.refrescar();
      } catch (e) { L.error(e); }
    });
  }

  function formClave(u) {
    const c = L.modal(`${L.cabModal('Clave temporal', esc(u.nombre))}
      <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-c"><label>Nueva clave temporal (mín. 8)<input name="clave" autocomplete="off"></label>
      <p class="secundario">Se cerrarán sus sesiones y deberá cambiarla al ingresar.</p>
      <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Asignar</button></div></form>`, { angosto: true });
    L.$('#f-c', c).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await L.api('PUT', `/api/usuarios/${u.id}`, { clave: ev.target.clave.value, cargo: u.cargo, correo: u.correo }); L.cerrarModal(); L.notificar('Clave temporal asignada.'); await L.refrescar(); } catch (e) { L.error(e); }
    });
  }

  // -------------------------------------------------------------- taxonomía
  L.vistas.taxonomia = {
    titulo: 'Taxonomía de procesos', subtitulo: 'Categoría → vía procedimental → etapas normativas base (normativa peruana)',
    render(v) {
      const tax = JSON.parse(JSON.stringify(L.D.taxonomia));
      const enUso = new Set([...L.D.procesos.map((p) => p.via), ...L.D.plantillas.map((p) => p.via)]);
      v.innerHTML = `
        <div class="barra-filtros"><span class="secundario">${tax.categorias.length} categorías · ${tax.categorias.reduce((n, c) => n + c.vias.length, 0)} vías</span><span class="espacio"></span><button class="btn" id="btn-cat">+ Categoría</button></div>
        ${tax.categorias.map((c, i) => `<section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>${esc(c.nombre)} <span class="secundario mono">${esc(c.codigo)}</span></h2><p>${esc(c.baseLegal || '')}</p></div>
            <select data-cat="${i}" aria-label="Acciones de la categoría">${L.opciones([['editar', 'Editar categoría'], ['via', 'Agregar vía'], ['quitar', 'Quitar categoría']], '', 'Acciones…')}</select></div>
          <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Vía procedimental</th><th>Base legal</th><th>Etapas base</th><th>Estado</th><th></th></tr></thead><tbody>
          ${c.vias.map((x, j) => `<tr><td><strong>${esc(x.nombre)}</strong> <span class="secundario mono">${esc(x.codigo)}</span></td><td>${esc(x.baseLegal || '')}</td>
            <td>${x.etapas.length} (${x.etapas.filter((e) => e.plazoDias === null || e.plazoDias === undefined).length} por definir)</td>
            <td>${x.desactivada ? '<span class="chip">Desactivada</span>' : '<span class="chip chip--estado-activo">Activa</span>'}${enUso.has(x.codigo) ? ' <span class="secundario">en uso</span>' : ''}</td>
            <td><select data-via="${i}:${j}" aria-label="Acciones de la vía">${L.opciones([['etapas', 'Editar etapas y datos'], [x.desactivada ? 'activar' : 'desactivar', x.desactivada ? 'Activar' : 'Desactivar'], ...(enUso.has(x.codigo) ? [] : [['quitar', 'Quitar']])], '', 'Acciones…')}</select></td></tr>`).join('')}
          </tbody></table></div></section>`).join('')}`;
      const guardar = async () => { try { await L.api('PUT', '/api/taxonomia', tax); L.notificar('Taxonomía guardada.'); await L.refrescar(); } catch (e) { L.error(e); } };
      const pedir = (titulo, campos, alGuardar) => {
        const c = L.modal(`${L.cabModal(titulo)}<form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-x">${campos.map(([k, t, val, dis]) => `<label>${t}<input name="${k}" value="${esc(val || '')}" ${dis ? 'disabled' : ''}></label>`).join('')}<div id="editor-etapas"></div><div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Guardar</button></div></form>`);
        return { c, f: L.$('#f-x', c), alGuardar };
      };
      L.$('#btn-cat', v).addEventListener('click', () => {
        const { f } = pedir('Nueva categoría', [['codigo', 'Código (p. ej. FAM)'], ['nombre', 'Nombre'], ['baseLegal', 'Base legal']]);
        f.addEventListener('submit', (ev) => { ev.preventDefault(); tax.categorias.push({ codigo: f.codigo.value.trim().toUpperCase(), nombre: f.nombre.value.trim(), baseLegal: f.baseLegal.value.trim(), vias: [] }); L.cerrarModal(); guardar(); });
      });
      v.addEventListener('change', async (ev) => {
        const a = ev.target.value; if (!a) return; ev.target.value = '';
        if (ev.target.dataset.cat !== undefined) {
          const c = tax.categorias[Number(ev.target.dataset.cat)];
          if (a === 'quitar') { if (await L.confirmar(`¿Quitar la categoría ${c.nombre}?`, { peligro: true })) { tax.categorias.splice(Number(ev.target.dataset.cat), 1); guardar(); } return; }
          if (a === 'editar') {
            const { f } = pedir('Editar categoría', [['codigo', 'Código', c.codigo, true], ['nombre', 'Nombre', c.nombre], ['baseLegal', 'Base legal', c.baseLegal]]);
            f.addEventListener('submit', (e2) => { e2.preventDefault(); c.nombre = f.nombre.value.trim(); c.baseLegal = f.baseLegal.value.trim(); L.cerrarModal(); guardar(); });
          }
          if (a === 'via') editarVia(c, null);
        }
        if (ev.target.dataset.via) {
          const [i, j] = ev.target.dataset.via.split(':').map(Number);
          const c = tax.categorias[i];
          const x = c.vias[j];
          if (a === 'activar' || a === 'desactivar') { x.desactivada = a === 'desactivar'; guardar(); }
          if (a === 'quitar' && (await L.confirmar(`¿Quitar la vía ${x.nombre}?`, { peligro: true }))) { c.vias.splice(j, 1); guardar(); }
          if (a === 'etapas') editarVia(c, x);
        }
      });
      function editarVia(c, x) {
        const { f, c: caja } = pedir(x ? 'Editar vía procedimental' : `Nueva vía en ${c.nombre}`, [['codigo', 'Código (p. ej. CIV-XYZ)', x && x.codigo, Boolean(x)], ['nombre', 'Nombre', x && x.nombre], ['baseLegal', 'Base legal', x && x.baseLegal]]);
        const editor = L.editorTareas(L.$('#editor-etapas', caja), x ? x.etapas : []);
        f.addEventListener('submit', (ev) => {
          ev.preventDefault();
          const etapas = editor.valor().filter((e) => e.nombre);
          if (x) Object.assign(x, { nombre: f.nombre.value.trim(), baseLegal: f.baseLegal.value.trim(), etapas });
          else c.vias.push({ codigo: f.codigo.value.trim().toUpperCase(), nombre: f.nombre.value.trim(), baseLegal: f.baseLegal.value.trim(), etapas });
          L.cerrarModal();
          guardar();
        });
      }
    }
  };

  // ---------------------------------------------------------- base de datos
  L.vistas.bd = {
    titulo: 'Base de datos', subtitulo: 'Explorar, editar, respaldar o vaciar la base de datos NoSQL',
    coleccion: '',
    async render(v) {
      v.innerHTML = '<p class="secundario">Cargando…</p>';
      let info, docs = null;
      try {
        info = await L.api('GET', '/api/admin/bd');
        if (this.coleccion) docs = (await L.api('GET', `/api/admin/bd/${this.coleccion}`)).documentos;
      } catch (e) { v.innerHTML = `<p class="vacio">${esc(e.message)}</p>`; return; }
      const col = this.coleccion;
      v.innerHTML = `
        <div class="rejilla rejilla--2">
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Archivo de la base de datos</h2><p>${esc(info.motor)}</p></div></div>
            <div class="campos"><div><span class="secundario">Ruta</span><div class="valor mono">${esc(info.ruta)}</div></div>
            <div><span class="secundario">Creada</span><div class="valor">${L.fmtFechaHora(info.creadaEn)}</div></div>
            <div><span class="secundario">Configuración del servidor</span><div class="valor mono">${esc(info.rutaEnv)}</div></div></div>
            <div class="acciones-linea"><a class="btn" href="/api/admin/respaldo" download>Descargar respaldo (JSON)</a>
              <label class="btn archivo">Restaurar respaldo…<input type="file" id="archivo-respaldo" accept="application/json"></label></div>
          </section>
          <section class="tarjeta tarjeta--peligro"><div class="tarjeta__cab"><div><h2>Limpiar la base de datos</h2><p>Acciones irreversibles: descargue antes un respaldo</p></div></div>
            <label>Acción<select id="vaciar-modo">${L.opciones([['operativos', 'Vaciar datos operativos (procesos, tareas, trámites, solicitudes, auditoría); conserva usuarios, plantillas y taxonomía'], ['total', 'Vaciar TODO (queda como recién instalada: taxonomía base y el administrador del .env)']], '', 'Seleccione…')}</select></label>
            <label>Escriba VACIAR para confirmar<input id="vaciar-conf" autocomplete="off"></label>
            <button class="btn btn--peligro" id="btn-vaciar">Vaciar</button>
          </section>
        </div>
        <section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>Colecciones</h2><p>Cada documento es un JSON con su clave</p></div>
            <label>Colección<select id="f-col">${L.opciones(info.colecciones.map((c) => [c.nombre, `${c.nombre} · ${c.documentos} doc. — ${c.descripcion}`]), col, 'Seleccione una colección…')}</select></label></div>
          ${docs ? `<div class="barra-filtros"><input type="search" id="f-doc" placeholder="Filtrar documentos…"><span class="espacio"></span>${col !== 'sesiones' ? '<button class="btn btn--sm" id="btn-doc-nuevo">+ Nuevo documento</button>' : ''}</div>
          <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Clave</th><th>Contenido</th><th></th></tr></thead><tbody>
            ${docs.map((d, i) => `<tr data-i="${i}" data-texto="${esc(L.normal(d.clave + JSON.stringify(d.valor)))}"><td class="mono">${esc(d.clave)}</td><td><code class="json-previo">${esc(JSON.stringify(d.valor).slice(0, 220))}${JSON.stringify(d.valor).length > 220 ? '…' : ''}</code></td>
              <td><select data-doc="${i}" aria-label="Acciones">${L.opciones([...(col !== 'sesiones' ? [['editar', 'Ver / editar JSON']] : []), ['eliminar', 'Eliminar documento']], '', 'Acciones…')}</select></td></tr>`).join('') || '<tr><td colspan="3" class="vacio">Colección vacía.</td></tr>'}
          </tbody></table></div>` : '<p class="vacio">Elija una colección para ver sus documentos.</p>'}
        </section>`;
      L.$('#f-col', v).addEventListener('change', (ev) => { this.coleccion = ev.target.value; L.pintar(); });
      const fd = L.$('#f-doc', v);
      if (fd) fd.addEventListener('input', () => { const q = L.normal(fd.value); L.$$('tr[data-texto]', v).forEach((tr) => { tr.hidden = q && !tr.dataset.texto.includes(q); }); });
      const editarDoc = (clave, valor) => {
        const c = L.modal(`${L.cabModal(clave ? `${esc(col)} / ${esc(clave)}` : `Nuevo documento en ${esc(col)}`, 'Edición manual: el JSON se guarda tal cual')}
          <form class="modal__cuerpo modal__cuerpo--simple formulario" id="f-doc-ed">
            ${clave ? '' : '<label>Clave<input name="clave" required></label>'}
            <label>Documento (JSON)<textarea name="json" rows="18" class="mono" spellcheck="false">${esc(JSON.stringify(valor, null, 2))}</textarea></label>
            <div class="modal__pie" style="padding:0"><button type="button" class="btn" data-cerrar>Cancelar</button><button class="btn btn--primario">Guardar documento</button></div></form>`);
        L.$('#f-doc-ed', c).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          let doc;
          try { doc = JSON.parse(ev.target.json.value); } catch (e) { L.notificar(`JSON no válido: ${e.message}`, 'error'); return; }
          const k = clave || ev.target.clave.value.trim();
          try { await L.api('PUT', `/api/admin/bd/${col}/${encodeURIComponent(k)}`, doc); L.cerrarModal(); L.notificar('Documento guardado.'); await L.refrescar(); } catch (e) { L.error(e); }
        });
      };
      const bn = L.$('#btn-doc-nuevo', v); if (bn) bn.addEventListener('click', () => editarDoc(null, {}));
      v.addEventListener('change', async (ev) => {
        if (ev.target.dataset.doc === undefined) return;
        const d = docs[Number(ev.target.dataset.doc)];
        const a = ev.target.value; ev.target.value = '';
        if (a === 'editar') editarDoc(d.clave, d.valor);
        if (a === 'eliminar' && (await L.confirmar(`¿Eliminar el documento ${d.clave} de ${col}?`, { peligro: true, aceptar: 'Eliminar' }))) {
          try { await L.api('DELETE', `/api/admin/bd/${col}/${encodeURIComponent(d.clave)}`); L.notificar('Documento eliminado.'); await L.refrescar(); } catch (e) { L.error(e); }
        }
      });
      L.$('#btn-vaciar', v).addEventListener('click', async () => {
        const modo = L.$('#vaciar-modo', v).value;
        if (!modo) { L.notificar('Elija qué vaciar.', 'error'); return; }
        if (!(await L.confirmar(modo === 'total' ? '¿Vaciar TODA la base de datos? Se borran usuarios, plantillas y procesos; se cerrará su sesión.' : '¿Vaciar los datos operativos?', { peligro: true, aceptar: 'Vaciar' }))) return;
        try {
          const r = await L.api('POST', '/api/admin/vaciar', { modo, confirmacion: L.$('#vaciar-conf', v).value });
          if (r.sesionCerrada) { location.reload(); return; }
          L.notificar('Base de datos vaciada.');
          await L.refrescar();
        } catch (e) { L.error(e); }
      });
      L.$('#archivo-respaldo', v).addEventListener('change', async (ev) => {
        const archivo = ev.target.files[0];
        if (!archivo) return;
        if (!(await L.confirmar('Restaurar reemplaza TODA la base de datos con el respaldo y cierra su sesión. ¿Continuar?', { peligro: true, aceptar: 'Restaurar' }))) return;
        try { await L.api('POST', '/api/admin/restaurar', JSON.parse(await archivo.text())); location.reload(); } catch (e) { L.error(e); }
      });
    }
  };

  // ---------------------------------------------------------- configuración
  L.vistas.config = {
    titulo: 'Configuración', subtitulo: 'Parámetros de alertas, feriados y datos del servidor',
    render(v) {
      const c = L.D.config;
      const s = L.D.servidor;
      v.innerHTML = `
        <div class="rejilla rejilla--2">
          <form class="tarjeta formulario" id="f-cfg">
            <div class="tarjeta__cab"><div><h2>Alertas y plazos</h2><p>Se aplican a todos los usuarios</p></div></div>
            <label>Nombre de la unidad<input name="nombreEntidad" value="${esc(c.nombreEntidad)}"></label>
            <div class="doble"><label>Aviso «por vencer» (días hábiles antes)<input type="number" min="0" max="60" name="diasAlertaPorVencer" value="${c.diasAlertaPorVencer}"></label>
            <label>Proceso «sin movimiento» (días)<input type="number" min="1" name="diasSinMovimiento" value="${c.diasSinMovimiento}"></label></div>
            <label>Umbral de tareas vencidas por profesional para alertar a la gerencia (%)<input type="number" min="1" max="100" name="umbralVencidasPct" value="${c.umbralVencidasPct}"></label>
            <label>Días no laborables adicionales (AAAA-MM-DD, uno por línea)<textarea name="feriados" rows="5" placeholder="2026-12-24">${esc(c.feriadosAdicionales.join('\n'))}</textarea></label>
            <p class="secundario">Los feriados nacionales (incluidos Jueves y Viernes Santo) ya se consideran en el cómputo de días hábiles.</p>
            <div class="pie"><button class="btn btn--primario">Guardar</button></div>
          </form>
          <section class="tarjeta"><div class="tarjeta__cab"><div><h2>Servidor</h2><p>Se cambia en el archivo .env junto a LEGAL.exe</p></div></div>
            <div class="campos">
              <div><span class="secundario">Dirección en la intranet (LEGAL_URL_PUBLICA)</span><div class="valor mono">${esc(s.urlPublica)}</div></div>
              <div><span class="secundario">SGD habilitados (LEGAL_SGD_URLS)</span><div class="valor mono">${s.sgdUrls.map(esc).join('<br>')}</div></div>
              <div><span class="secundario">SGD simulado de pruebas</span><div class="valor">${s.sgdSimulado ? `Activo en <a href="/sgd-simulado/" target="_blank">/sgd-simulado/</a>` : 'Desactivado'}</div></div>
              <div><span class="secundario">Versión</span><div class="valor">${esc(s.version)}</div></div>
            </div>
            <p class="secundario">Para cambiar la dirección, edite el .env (ícono LEGAL junto al reloj › <em>Editar configuración</em>), reinicie LEGAL y vuelva a descargar la extensión.</p>
          </section>
        </div>`;
      L.$('#f-cfg', v).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        try {
          await L.api('PUT', '/api/config', { nombreEntidad: f.nombreEntidad.value, diasAlertaPorVencer: Number(f.diasAlertaPorVencer.value), diasSinMovimiento: Number(f.diasSinMovimiento.value), umbralVencidasPct: Number(f.umbralVencidasPct.value), feriadosAdicionales: f.feriados.value.split('\n').map((x) => x.trim()).filter(Boolean) });
          L.notificar('Configuración guardada.');
          await L.refrescar();
        } catch (e) { L.error(e); }
      });
    }
  };

  // -------------------------------------------------------------- extensión
  L.vistas.extension = {
    titulo: 'Extensión Conector SGD', subtitulo: 'Indexe trámites del SGD desde el panel lateral de Chrome',
    render(v) {
      const s = L.D.servidor;
      v.innerHTML = `
        <section class="tarjeta">
          <div class="tarjeta__cab"><div><h2>Instalación en cada equipo</h2><p>La extensión descargada ya apunta a ${esc(s.urlPublica)}</p></div><a class="btn btn--primario" href="/descargas/conector-sgd.zip">Descargar extensión (.zip)</a></div>
          <ol class="pasos">
            <li>Descargue el .zip y descomprímalo en una carpeta fija (p. ej. <span class="mono">Documentos\\legal-conector-sgd</span>).</li>
            <li>En Chrome abra <span class="mono">chrome://extensions</span> y active <strong>Modo de desarrollador</strong>.</li>
            <li>Pulse <strong>Cargar descomprimida</strong> y elija la carpeta <span class="mono">legal-conector-sgd</span>.</li>
            <li>Abra el SGD (${s.sgdUrls.map(esc).join(', ')}), inicie sesión y entre al detalle de un trámite.</li>
            <li>Pulse el ícono <strong>LEGAL</strong>: se abre el panel lateral. Ingrese con su usuario del portal.</li>
            <li>Elija la acción en el desplegable: <strong>Crear un proceso nuevo</strong> (profesional → vía, o categoría → vía → profesional) o <strong>Anexar a un proceso existente</strong>. Pulse <strong>Indexar en LEGAL</strong>.</li>
          </ol>
          <p class="secundario">Lo indexado se guarda en la base de datos del servidor y aparece en el portal en segundos (Trámites SGD y en el proceso). Si cambia la dirección del servidor, vuelva a descargar la extensión o cámbiela en su Configuración.</p>
          ${s.sgdSimulado ? `<div class="aviso aviso--info"><span>Para practicar sin el SGD real use el <a href="/sgd-simulado/" target="_blank" rel="noopener">SGD simulado</a> (acepta cualquier usuario y contraseña).</span></div>` : ''}
        </section>`;
    }
  };
})();
