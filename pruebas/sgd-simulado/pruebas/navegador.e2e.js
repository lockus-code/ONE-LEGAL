#!/usr/bin/env node
/*
 * Prueba de extremo a extremo del SGD de pruebas en Chromium (Playwright).
 *
 *   node pruebas/sgd-simulado/pruebas/navegador.e2e.js
 *
 * 1. Lector: abre cada escenario y ejecuta leerPaginaSedapar (extension/shared/lector-sedapar.js)
 *    sobre la página ya pintada; compara con `esperado`. Criterio de docs/11 §9: 0 falsos positivos.
 * 2. Multiusuario: «logistica» registra un trámite con un archivo, lo deriva a «abogado.uno»;
 *    este, en otro navegador (otra sesión), lo recibe, abre el documento en el visor, redacta
 *    una respuesta y lo atiende. Ambos ven el mismo estado (API del servidor).
 * 3. Sesión expirada: con TTL corto, la página vuelve al login.
 * Con SGD_URL=http://host:puerto/sgd-simulado se prueba un servidor ya en marcha (p. ej. LEGAL.exe)
 * en lugar del servidor local; conviene que sus datos estén recién restablecidos.
 * Requiere Playwright (preinstalado en el entorno de desarrollo; si no: npm i -D playwright).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { crearServidor } = require('./servidor-local.js');
const ESCENARIOS = require('../escenarios.js');

const LECTOR = fs.readFileSync(path.join(__dirname, '../../../extension/shared/lector-sedapar.js'), 'utf8');

async function principal() {
  const externo = process.env.SGD_URL;
  const { servidor } = crearServidor();
  if (!externo) await new Promise((ok) => servidor.listen(0, ok));
  const BASE = externo ? externo.replace(/\/$/, '') : `http://localhost:${servidor.address().port}/sgd-simulado`;
  const navegador = await chromium.launch();
  const fallos = [];
  const errores = [];

  async function sesion(usuario) {
    const ctx = await navegador.newContext({ acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errores.push(`${usuario}: ${e.message}`));
    await p.goto(BASE + '/pages/login');
    await p.fill('#usuario', usuario);
    await p.fill('#clave', 'prueba');
    await p.click('button[type=submit]');
    await p.waitForURL(/mistramites/);
    return p;
  }

  try {
    // Latencia reducida para que la prueba sea rápida (salvo el escenario lento, que la conserva relativa).
    const admin = await (await navegador.newContext()).newPage();
    await admin.goto(BASE + '/consola');
    await admin.waitForSelector('#escenarios tr');
    await admin.fill('input[name=factorLatencia]', '0.3');
    await admin.click('#opciones button[type=submit]');
    await admin.waitForSelector('.exito');

    // Contraseña incorrecta
    const intruso = await (await navegador.newContext()).newPage();
    await intruso.goto(BASE + '/pages/login');
    await intruso.fill('#usuario', 'usuario.prueba');
    await intruso.fill('#clave', 'mala');
    await intruso.click('button[type=submit]');
    await intruso.waitForFunction(() => document.getElementById('error').textContent.includes('incorrectos'));

    // 1 · Lector de la extensión contra cada escenario
    const p = await sesion('usuario.prueba');
    let correctos = 0, falsosPositivos = 0;
    for (const e of ESCENARIOS) {
      await p.goto(`${BASE}/tramites/detalletramite/${e.id}`);
      await p.addScriptTag({ content: LECTOR });
      const r = await p.evaluate(() => leerPaginaSedapar({ topeMs: 4000 }));
      const esp = e.esperado;
      const problemas = [];
      if (r.numero !== esp.numero) problemas.push(`número ${r.numero} ≠ ${esp.numero}`);
      if ((r.motivo || null) !== (esp.motivo || null)) problemas.push(`motivo ${r.motivo} ≠ ${esp.motivo}`);
      if (r.confidencial !== esp.confidencial) problemas.push(`confidencial ${r.confidencial}`);
      if (r.idInterno !== String(e.id)) problemas.push(`ID ${r.idInterno}`);
      if (esp.fechaIngreso && r.fechaIngreso !== esp.fechaIngreso) problemas.push(`fecha ${r.fechaIngreso} ≠ ${esp.fechaIngreso}`);
      if (esp.asunto && r.asunto !== esp.asunto) problemas.push(`asunto «${r.asunto}»`);
      if (esp.estrategias) for (const k of Object.keys(esp.estrategias)) if (r.estrategias[k] !== esp.estrategias[k]) problemas.push(`estrategia ${k}=${r.estrategias[k]}`);
      if (r.numero && r.numero !== esp.numero) falsosPositivos++;
      if (problemas.length) fallos.push(`Escenario ${e.id} (${e.etiquetas.join(', ')}): ${problemas.join('; ')}`);
      else correctos++;
      console.log(`${problemas.length ? '✗' : '✓'} ${e.id} ${e.numero.padEnd(20)} → ${r.numero || r.motivo} (${r.msDeteccion} ms)`);
    }
    console.log(`Lector: ${correctos}/${ESCENARIOS.length} correctos, ${falsosPositivos} falsos positivos.`);

    // 2 · Flujo multiusuario con archivos
    const logistica = await sesion('logistica');
    await logistica.goto(BASE + '/tramites/nuevotramiteint');
    await logistica.selectOption('select[name=tipo]', 'INFORME');
    await logistica.fill('textarea[name=asunto]', 'SOLICITA OPINIÓN SOBRE PENALIDADES (PRUEBA E2E)');
    const archivo = path.join(os.tmpdir(), `informe-e2e-${Date.now()}.txt`);
    fs.writeFileSync(archivo, 'INFORME E2E\nContenido del informe de prueba con tildes: opinión, penalidad.');
    await logistica.setInputFiles('input[name=archivo]', archivo);
    await logistica.selectOption('select[name=areaDestino]', 'GERENCIA DE ASESORÍA JURÍDICA');
    await logistica.selectOption('select[name=usuarioDestino]', 'abogado.uno');
    await logistica.click('#nuevo button[type=submit]');
    await logistica.waitForURL(/detalletramite\/\d+/);
    const idNuevo = logistica.url().match(/detalletramite\/(\d+)/)[1];
    await logistica.waitForSelector('app-detalletramite legend.title strong');
    assert.match(await logistica.textContent('app-detalletramite'), /DERIVADO/);

    const abogado = await sesion('abogado.uno');
    await abogado.goto(BASE + '/tramites/mistramites?mios=1');
    await abogado.waitForSelector(`a[data-recibir="${idNuevo}"]`);
    await abogado.click(`a[data-recibir="${idNuevo}"]`);
    await abogado.waitForSelector('.exito');
    await abogado.goto(`${BASE}/tramites/detalletramite/${idNuevo}`);
    await abogado.waitForSelector('[data-ver="0"]');
    await abogado.click('[data-ver="0"]');
    await abogado.waitForSelector('pre.documento');
    assert.match(await abogado.textContent('pre.documento'), /opinión, penalidad/);
    await abogado.click('[data-abrir="iniciar"]');
    await abogado.click('.form-accion button[type=submit]');
    await abogado.waitForSelector('.exito');
    await abogado.click('[data-abrir="adjuntar"]');
    await abogado.check('input[name=modo][value=texto]');
    await abogado.fill('input[name=nombreTexto]', 'OPINION-E2E.txt');
    await abogado.fill('textarea[name=texto]', 'OPINIÓN LEGAL E2E: procede la penalidad.');
    await abogado.click('.form-accion button[type=submit]');
    await abogado.waitForFunction(() => document.querySelector('.exito') && document.body.textContent.includes('OPINION-E2E.txt'));
    await abogado.click('[data-abrir="atender"]');
    await abogado.click('.form-accion button[type=submit]');
    await abogado.waitForFunction(() => document.querySelector('.exito') && document.querySelector('.col-sm-7 .badge').textContent === 'ATENDIDO');

    // El remitente ve los cambios hechos por el otro usuario (estado compartido)
    await logistica.goto(BASE + `/tramites/listadotramites?numero=&asunto=PENALIDADES`);
    await logistica.waitForSelector('app-listadotramites tbody tr td');
    assert.match(await logistica.textContent('app-listadotramites tbody'), /ATENDIDO/);
    // Regla rechazada en la interfaz: «consulta» no tiene acciones
    const consulta = await sesion('consulta');
    await consulta.goto(`${BASE}/tramites/detalletramite/${idNuevo}`);
    await consulta.waitForSelector('.card-acciones');
    assert.match(await consulta.textContent('.card-acciones'), /no tiene acciones/);
    console.log(`✓ Flujo multiusuario: trámite ${idNuevo} registrado, derivado, recibido, documentado y atendido.`);

    // 3 · Expiración de sesión
    await admin.reload();
    await admin.waitForSelector('#escenarios tr');
    await admin.fill('input[name=ttlMinutos]', '0.05'); // 3 s
    await admin.click('#opciones button[type=submit]');
    await admin.waitForSelector('.exito');
    const corta = await sesion('usuario.prueba');
    await corta.waitForURL(/pages\/login/, { timeout: 15000 });
    console.log('✓ Sesión expirada: vuelve al login.');
  } catch (e) {
    fallos.push(e.stack || String(e));
  } finally {
    await navegador.close();
    if (!externo) servidor.close();
  }
  if (errores.length) fallos.push('Errores de JavaScript en las páginas:\n' + errores.join('\n'));
  if (fallos.length) {
    console.error('\nFALLAS:\n' + fallos.join('\n'));
    process.exit(1);
  }
  console.log('\nTodas las pruebas de navegador pasaron.');
}

principal();
