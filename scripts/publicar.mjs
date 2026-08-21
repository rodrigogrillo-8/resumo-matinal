#!/usr/bin/env node
// publicar.mjs — valida um brief e grava em docs/data/latest.json.
//
//   node scripts/publicar.mjs caminho/para/brief.json
//   cat brief.json | node scripts/publicar.mjs
//
// Um JSON invalido falha dizendo qual campo esta errado e NAO encosta no
// latest.json que ja esta publicado.

import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destino = resolve(raiz, 'docs/data/latest.json');
const pastaArquivo = resolve(raiz, 'docs/data/arquivo');

/* ------------------------------------------------------------- schema */

const FORMAS = ['HEAVY', 'NORMAL', 'OPEN'];
const PESOS = ['full', 'light'];
const DIRECOES = ['up', 'down', 'flat'];
const TIPOS_SECAO = ['rows', 'prose'];

// ISO 8601 com fuso explicito. Sem fuso o dia fica ambiguo, e o app desenha
// o relevo a partir da hora de parede escrita aqui.
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const CHAVES = {
  raiz: ['schemaVersion', 'generatedAt', 'timezone', 'dayDate', 'dayShape',
    'headline', 'events', 'acts', 'needsAttention', 'resolved', 'sections'],
  evento: ['title', 'start', 'end', 'weight'],
  ato: ['time', 'text'],
  item: ['title', 'text', 'linkText', 'href'],
  secao: ['heading', 'kind', 'rows', 'text', 'sourceNote', 'sources'],
  linha: ['label', 'delta', 'dir', 'value'],
  fonte: ['label', 'href'],
};

const erros = [];
const errar = (campo, queixa) => erros.push(`${campo}: ${queixa}`);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function texto(valor, campo, { obrigatorio = true } = {}) {
  if (valor === undefined || valor === null) {
    if (obrigatorio) errar(campo, 'campo obrigatorio ausente');
    return;
  }
  if (typeof valor !== 'string') {
    errar(campo, `esperava texto, veio ${Array.isArray(valor) ? 'lista' : typeof valor}`);
    return;
  }
  if (obrigatorio && !valor.trim()) errar(campo, 'texto vazio');
}

function umDe(valor, permitidos, campo, { obrigatorio = true } = {}) {
  if (valor === undefined || valor === null) {
    if (obrigatorio) errar(campo, 'campo obrigatorio ausente');
    return;
  }
  if (!permitidos.includes(valor)) {
    errar(campo, `valor "${valor}" fora de [${permitidos.join(', ')}]`);
  }
}

function instante(valor, campo) {
  if (typeof valor !== 'string' || !RE_ISO.test(valor)) {
    errar(campo, `esperava data ISO 8601 com fuso (ex.: 2026-08-21T09:00:00-03:00), veio ${JSON.stringify(valor)}`);
    return false;
  }
  if (Number.isNaN(Date.parse(valor))) {
    errar(campo, `data ISO invalida: ${valor}`);
    return false;
  }
  return true;
}

function url(valor, campo) {
  if (valor === undefined || valor === null) return;   // href e opcional em toda parte
  if (typeof valor !== 'string') {
    errar(campo, `esperava texto, veio ${typeof valor}`);
    return;
  }
  let u;
  try {
    u = new URL(valor);
  } catch (e) {
    errar(campo, `nao e uma URL absoluta: ${valor}`);
    return;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    errar(campo, `esquema "${u.protocol}" nao permitido; use http ou https`);
  }
}

function chavesConhecidas(obj, permitidas, campo) {
  for (const k of Object.keys(obj)) {
    if (!permitidas.includes(k)) {
      errar(`${campo}.${k}`, `campo desconhecido — adicione ao schema e documente no README antes de usar`);
    }
  }
}

function lista(valor, campo) {
  if (valor === undefined) return [];
  if (!Array.isArray(valor)) {
    errar(campo, `esperava uma lista, veio ${ehObjeto(valor) ? 'objeto' : typeof valor}`);
    return [];
  }
  return valor;
}

function validar(brief) {
  if (!ehObjeto(brief)) {
    errar('(raiz)', 'esperava um objeto JSON');
    return;
  }
  chavesConhecidas(brief, CHAVES.raiz, '(raiz)');

  if (brief.schemaVersion !== 1) {
    errar('schemaVersion', `esperava 1, veio ${JSON.stringify(brief.schemaVersion)}`);
  }
  instante(brief.generatedAt, 'generatedAt');
  texto(brief.timezone, 'timezone');
  texto(brief.dayDate, 'dayDate');
  umDe(brief.dayShape, FORMAS, 'dayShape');
  texto(brief.headline, 'headline');

  lista(brief.events, 'events').forEach((ev, i) => {
    const campo = `events[${i}]`;
    if (!ehObjeto(ev)) return errar(campo, 'esperava um objeto');
    chavesConhecidas(ev, CHAVES.evento, campo);
    texto(ev.title, `${campo}.title`);
    const ini = instante(ev.start, `${campo}.start`);
    const fim = instante(ev.end, `${campo}.end`);
    if (ini && fim && Date.parse(ev.end) <= Date.parse(ev.start)) {
      errar(`${campo}.end`, 'termina antes de comecar (ou dura zero)');
    }
    umDe(ev.weight, PESOS, `${campo}.weight`);
  });

  lista(brief.acts, 'acts').forEach((ato, i) => {
    const campo = `acts[${i}]`;
    if (!ehObjeto(ato)) return errar(campo, 'esperava um objeto');
    chavesConhecidas(ato, CHAVES.ato, campo);
    texto(ato.time, `${campo}.time`, { obrigatorio: false });
    texto(ato.text, `${campo}.text`);
  });

  for (const nome of ['needsAttention', 'resolved']) {
    lista(brief[nome], nome).forEach((item, i) => {
      const campo = `${nome}[${i}]`;
      if (!ehObjeto(item)) return errar(campo, 'esperava um objeto');
      chavesConhecidas(item, CHAVES.item, campo);
      texto(item.title, `${campo}.title`);
      texto(item.text, `${campo}.text`, { obrigatorio: false });
      texto(item.linkText, `${campo}.linkText`, { obrigatorio: false });
      url(item.href, `${campo}.href`);
    });
  }

  lista(brief.sections, 'sections').forEach((secao, i) => {
    const campo = `sections[${i}]`;
    if (!ehObjeto(secao)) return errar(campo, 'esperava um objeto');
    chavesConhecidas(secao, CHAVES.secao, campo);
    texto(secao.heading, `${campo}.heading`);
    umDe(secao.kind, TIPOS_SECAO, `${campo}.kind`);
    texto(secao.sourceNote, `${campo}.sourceNote`, { obrigatorio: false });

    if (secao.kind === 'rows') {
      if (!Array.isArray(secao.rows)) {
        errar(`${campo}.rows`, 'secao com kind "rows" precisa de uma lista rows');
      }
      lista(secao.rows, `${campo}.rows`).forEach((linha, j) => {
        const c = `${campo}.rows[${j}]`;
        if (!ehObjeto(linha)) return errar(c, 'esperava um objeto');
        chavesConhecidas(linha, CHAVES.linha, c);
        texto(linha.label, `${c}.label`);
        texto(linha.delta, `${c}.delta`, { obrigatorio: false });
        texto(linha.value, `${c}.value`, { obrigatorio: false });
        umDe(linha.dir, DIRECOES, `${c}.dir`, { obrigatorio: false });
      });
      if (secao.text !== undefined) {
        errar(`${campo}.text`, 'secao com kind "rows" nao usa text');
      }
    } else if (secao.kind === 'prose') {
      texto(secao.text, `${campo}.text`);
      if (secao.rows !== undefined) {
        errar(`${campo}.rows`, 'secao com kind "prose" nao usa rows');
      }
    }

    lista(secao.sources, `${campo}.sources`).forEach((fonte, j) => {
      const c = `${campo}.sources[${j}]`;
      if (!ehObjeto(fonte)) return errar(c, 'esperava um objeto');
      chavesConhecidas(fonte, CHAVES.fonte, c);
      texto(fonte.label, `${c}.label`);
      url(fonte.href, `${c}.href`);
    });
  });
}

/* -------------------------------------------------------------- entrada */

async function lerEntrada() {
  const caminho = process.argv[2];
  if (caminho) {
    try {
      return readFileSync(resolve(caminho), 'utf8');
    } catch (e) {
      falhar([`nao consegui ler ${caminho}: ${e.message}`]);
    }
  }
  if (process.stdin.isTTY) {
    falhar([
      'nada na entrada.',
      '',
      '  uso:  node scripts/publicar.mjs brief.json',
      '        cat brief.json | node scripts/publicar.mjs',
    ]);
  }
  const pedacos = [];
  for await (const p of process.stdin) pedacos.push(p);
  return Buffer.concat(pedacos).toString('utf8');
}

function falhar(linhas) {
  console.error('\nNao publiquei. O latest.json atual continua intacto.\n');
  for (const l of linhas) console.error(l);
  console.error('');
  process.exit(1);
}

/* ------------------------------------------------------------- gravacao */

// Grava num temporario e so entao troca de lugar: um erro no meio do caminho
// nunca deixa um latest.json pela metade.
function gravarAtomico(caminho, conteudo) {
  const temp = caminho + '.tmp';
  try {
    writeFileSync(temp, conteudo, 'utf8');
    renameSync(temp, caminho);
  } catch (e) {
    try { unlinkSync(temp); } catch (_) { /* ja era */ }
    throw e;
  }
}

/* ---------------------------------------------------------------- main */

const bruto = await lerEntrada();

let brief;
try {
  brief = JSON.parse(bruto);
} catch (e) {
  falhar([`o texto recebido nao e JSON valido — ${e.message}`]);
}

validar(brief);

if (erros.length) {
  falhar([
    `${erros.length} ${erros.length === 1 ? 'problema' : 'problemas'} no brief:`,
    '',
    ...erros.map((e) => '  - ' + e),
  ]);
}

const conteudo = JSON.stringify(brief, null, 2) + '\n';
const dia = brief.generatedAt.slice(0, 10);

mkdirSync(dirname(destino), { recursive: true });
mkdirSync(pastaArquivo, { recursive: true });

gravarAtomico(destino, conteudo);
gravarAtomico(resolve(pastaArquivo, `${dia}.json`), conteudo);

const nEventos = Array.isArray(brief.events) ? brief.events.length : 0;
console.log(`Publicado: ${brief.dayDate}  ·  ${brief.dayShape}  ·  ${nEventos} evento(s)`);
console.log(`  docs/data/latest.json`);
console.log(`  docs/data/arquivo/${dia}.json`);
