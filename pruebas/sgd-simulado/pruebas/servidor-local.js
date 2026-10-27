#!/usr/bin/env node
/*
 * SGD de pruebas · servidor local (Node 18+, sin dependencias).
 *
 * Sirve /sgd-simulado/ con las mismas rutas (rutas.json) y la misma API de
 * almacenamiento que LEGAL.exe (servidor/sgd_pruebas.go), pero en memoria.
 * Útil para probar sin compilar el servidor y para las pruebas automáticas.
 *
 *   node pruebas/sgd-simulado/pruebas/servidor-local.js [puerto]   (defecto 8791)
 *   → http://localhost:8791/sgd-simulado/
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const RUTAS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'rutas.json'), 'utf8'));
const PATRONES = RUTAS.patrones.map((p) => ({ re: new RegExp(p.patron), pagina: p.pagina }));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const TIPOS_ARCHIVO = { '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.jpg': 'image/jpeg', '.png': 'image/png' };
const MAX_ARCHIVO = 20 << 20;

function crearServidor() {
  const almacen = { version: 0, estado: null, archivos: new Map() };
  const json = (res, codigo, cuerpo) => { res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(cuerpo)); };
  const leerCuerpo = (req, max) => new Promise((ok, mal) => {
    const partes = []; let total = 0;
    req.on('data', (c) => { total += c.length; if (total > max) { mal(new Error('grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', mal);
  });

  async function api(req, res, ruta) {
    if (req.method !== 'GET' && req.headers['x-sgd-pruebas'] !== '1') return json(res, 403, { mensaje: 'Falta la cabecera X-SGD-Pruebas.' });
    if (ruta === 'estado' && req.method === 'GET') return json(res, 200, { version: almacen.version, estado: almacen.estado });
    if (ruta === 'estado' && req.method === 'PUT') {
      let cuerpo;
      try { cuerpo = JSON.parse(await leerCuerpo(req, 64 << 20)); } catch (e) { return json(res, 400, { mensaje: 'El estado no tiene el formato esperado.' }); }
      if (!cuerpo || typeof cuerpo.estado !== 'object' || !cuerpo.estado) return json(res, 400, { mensaje: 'El estado no tiene el formato esperado.' });
      if (cuerpo.version !== almacen.version) return json(res, 409, { mensaje: 'Otro usuario modificó los datos; se reintentará.', version: almacen.version });
      almacen.estado = cuerpo.estado;
      almacen.version++;
      return json(res, 200, { version: almacen.version });
    }
    if (ruta === 'archivos' && req.method === 'POST') {
      const nombre = new URL(req.url, 'http://x').searchParams.get('nombre') || '';
      const tipo = TIPOS_ARCHIVO[path.extname(nombre).toLowerCase()];
      if (!tipo || nombre.length > 200) return json(res, 400, { mensaje: 'Extensión no permitida (RN-14).' });
      let datos;
      try { datos = await leerCuerpo(req, MAX_ARCHIVO); } catch (e) { return json(res, 413, { mensaje: 'El archivo debe pesar entre 1 byte y 20 MB (RN-14).' }); }
      if (!datos.length) return json(res, 413, { mensaje: 'El archivo debe pesar entre 1 byte y 20 MB (RN-14).' });
      const id = crypto.randomBytes(16).toString('hex');
      almacen.archivos.set(id, { nombre, tipo, datos });
      return json(res, 201, { id, bytes: datos.length });
    }
    const m = ruta.match(/^archivos\/([0-9a-f]{32})$/);
    if (m && req.method === 'GET') {
      const a = almacen.archivos.get(m[1]);
      if (!a) return json(res, 404, { mensaje: 'El archivo no existe.' });
      const descargar = new URL(req.url, 'http://x').searchParams.get('descargar') || a.tipo.includes('openxmlformats');
      res.writeHead(200, { 'Content-Type': a.tipo, 'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.nombre)}`, 'X-Content-Type-Options': 'nosniff' });
      return res.end(a.datos);
    }
    if (ruta === 'reiniciar' && req.method === 'POST') {
      almacen.version = 0; almacen.estado = null; almacen.archivos.clear();
      return json(res, 200, { version: 0 });
    }
    return json(res, 404, { mensaje: 'Ruta no encontrada en la API del SGD de pruebas.' });
  }

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/sgd-simulado/')) { res.writeHead(302, { Location: '/sgd-simulado/' }); return res.end(); }
    const ruta = url.pathname.slice('/sgd-simulado/'.length).replace(/\/$/, '');
    if (ruta.startsWith('api/')) return api(req, res, ruta.slice(4)).catch(() => json(res, 500, { mensaje: 'Error interno.' }));
    let archivo = RUTAS.paginas[ruta];
    if (archivo === undefined) { const p = PATRONES.find((x) => x.re.test(ruta)); archivo = p ? p.pagina : path.normalize(ruta).replace(/^(\.\.[/\\])+/, ''); }
    const destino = path.join(RAIZ, archivo);
    if (!destino.startsWith(RAIZ + path.sep) || path.relative(RAIZ, destino).split(path.sep)[0] === 'pruebas') { res.writeHead(404); return res.end(); }
    fs.readFile(destino, (err, datos) => {
      if (err) { res.writeHead(404); return res.end('No encontrado'); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(destino)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(datos);
    });
  });
  return { servidor, almacen };
}

module.exports = { crearServidor };

if (require.main === module) {
  const puerto = Number(process.argv[2]) || 8791;
  crearServidor().servidor.listen(puerto, () => console.log(`SGD de pruebas en http://localhost:${puerto}/sgd-simulado/ (datos en memoria)`));
}
