// app.js — busca o JSON e monta a tela.
//
// Este arquivo nao gera conteudo. Ele renderiza, com fidelidade, o que o brief
// disser — e todo texto que vem do JSON entra como textContent, nunca como HTML.

import { desenharTerreno } from './terrain.js';

const CAMINHO_DADOS = './data/latest.json';

const el = (id) => document.getElementById(id);

const pagina = el('pagina');
const estado = el('estado');

let briefAtual = null;
let terreno = null;

/* ------------------------------------------------------------ utilitarios */

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

function tag(nome, classe, conteudo) {
  const n = document.createElement(nome);
  if (classe) n.className = classe;
  if (conteudo != null && conteudo !== '') n.textContent = String(conteudo);
  return n;
}

function limpar(no) {
  while (no.firstChild) no.removeChild(no.firstChild);
}

// So http(s), e so absoluto o suficiente para o navegador resolver.
// Qualquer outra coisa vira texto simples — nunca um link morto ou perigoso.
function hrefSeguro(bruto) {
  const s = texto(bruto);
  if (!s) return null;
  try {
    const u = new URL(s, location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch (e) {
    return null;
  }
}

// Devolve um <a> se der, um nó de texto se nao der, e null se nao houver rotulo.
function linkOuTexto(rotulo, href) {
  const t = texto(rotulo);
  if (!t) return null;
  const alvo = hrefSeguro(href);
  if (!alvo) return document.createTextNode(t);
  const a = tag('a', null, t);
  a.href = alvo;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/* --------------------------------------------------------------- datas */

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// Le a data tal como escrita no ISO, sem converter de fuso.
function dataDoBrief(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(iso));
  return m ? { ano: +m[1], mes: +m[2], dia: +m[3], chave: m[0] } : null;
}

function porExtensoCurto(d) {
  return d.dia + ' de ' + MESES[d.mes - 1];
}

function chaveDeHoje() {
  const agora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return agora.getFullYear() + '-' + pad(agora.getMonth() + 1) + '-' + pad(agora.getDate());
}

/* --------------------------------------------------------- render: topo */

function renderTopo(brief) {
  const aviso = el('aviso');
  const d = dataDoBrief(brief.generatedAt);

  // Sem alarme, sem icone de erro: uma linha discreta e so.
  if (d && d.chave !== chaveDeHoje()) {
    aviso.textContent = 'Mostrando o resumo de ' + porExtensoCurto(d) + '.';
    aviso.hidden = false;
  } else {
    aviso.textContent = '';
    aviso.hidden = true;
  }

  const data = el('data');
  const rotuloData = texto(brief.dayDate);
  data.textContent = rotuloData;
  data.hidden = !rotuloData;

  const headline = el('headline');
  const frase = texto(brief.headline);
  headline.textContent = frase;
  headline.hidden = !frase;
}

/* ------------------------------------------------------------- render: atos */

function renderAtos(atos) {
  const lista = el('atos');
  limpar(lista);

  const validos = (Array.isArray(atos) ? atos : [])
    .filter((a) => a && (texto(a.time) || texto(a.text)));

  lista.hidden = validos.length === 0;

  for (const ato of validos) {
    const li = document.createElement('li');
    const hora = texto(ato.time);
    const corpo = texto(ato.text);
    if (hora) li.appendChild(tag('span', 'ato-hora', hora));
    if (corpo) li.appendChild(tag('span', 'ato-texto', corpo));
    lista.appendChild(li);
  }
}

/* --------------------------------------------------------- render: listas */

function itemDeLista(item) {
  const li = document.createElement('li');
  const titulo = texto(item.title);
  const corpo = texto(item.text);
  const link = linkOuTexto(item.linkText, item.href);

  if (titulo) li.appendChild(tag('span', 'item-titulo', titulo));

  if (corpo || link) {
    const p = tag('span', 'item-texto');
    if (corpo) p.appendChild(document.createTextNode(corpo));
    if (link) {
      if (corpo) p.appendChild(document.createTextNode(' '));
      p.appendChild(link);
    }
    li.appendChild(p);
  }

  return li;
}

function blocoDeLista(rubrica, itens, classeExtra) {
  const validos = (Array.isArray(itens) ? itens : []).filter(
    (i) => i && (texto(i.title) || texto(i.text) || texto(i.linkText))
  );
  if (!validos.length) return null;

  const bloco = tag('div', 'bloco');
  bloco.appendChild(tag('p', 'rubrica', rubrica));

  const ul = tag('ul', classeExtra ? 'lista ' + classeExtra : 'lista');
  for (const item of validos) ul.appendChild(itemDeLista(item));
  bloco.appendChild(ul);
  return bloco;
}

function renderListas(brief) {
  const alvo = el('listas');
  limpar(alvo);

  const atencao = blocoDeLista('Precisa de você', brief.needsAttention);
  const resolvido = blocoDeLista('Já resolvido', brief.resolved, 'lista-resolvido');

  if (!atencao && !resolvido) {
    alvo.appendChild(tag('p', 'calmo', 'Nada precisa de você nesta manhã.'));
    return;
  }

  if (atencao) alvo.appendChild(atencao);
  if (resolvido) alvo.appendChild(resolvido);
}

/* -------------------------------------------------------- render: secoes */

const SETAS = { up: '↑', down: '↓' };

function linhaDeSecao(linha) {
  const li = document.createElement('li');

  const rotulo = texto(linha.label);
  const delta = texto(linha.delta);
  const valor = texto(linha.value);

  if (rotulo || delta) {
    const topo = tag('div', 'linha-topo');
    topo.appendChild(tag('span', 'linha-rotulo', rotulo));
    if (delta) {
      const d = tag('span', 'linha-delta');
      const seta = SETAS[linha.dir];
      if (seta) d.appendChild(tag('span', 'seta', seta));
      d.appendChild(document.createTextNode(delta));
      topo.appendChild(d);
    }
    li.appendChild(topo);
  }

  if (valor) li.appendChild(tag('span', 'linha-valor', valor));
  return li;
}

function notaDeFonte(secao) {
  const nota = texto(secao.sourceNote);
  const fontes = (Array.isArray(secao.sources) ? secao.sources : [])
    .map((f) => (f ? linkOuTexto(f.label, f.href) : null))
    .filter(Boolean);

  if (!nota && !fontes.length) return null;

  const p = tag('p', 'nota-fonte');
  if (nota) p.appendChild(document.createTextNode(nota));

  fontes.forEach((f, i) => {
    if (nota || i > 0) p.appendChild(tag('span', 'separador', '·'));
    p.appendChild(f);
  });

  return p;
}

function corpoDaSecao(secao) {
  if (secao.kind === 'rows') {
    const linhas = (Array.isArray(secao.rows) ? secao.rows : []).filter(
      (l) => l && (texto(l.label) || texto(l.delta) || texto(l.value))
    );
    if (!linhas.length) return null;
    const ul = tag('ul', 'linhas');
    for (const linha of linhas) ul.appendChild(linhaDeSecao(linha));
    return ul;
  }

  const corpo = texto(secao.text);
  if (!corpo) return null;

  const div = tag('div', 'prosa');
  for (const paragrafo of corpo.split(/\n\s*\n/)) {
    const p = texto(paragrafo);
    if (p) div.appendChild(tag('p', null, p));
  }
  return div;
}

function renderSecoes(secoes) {
  const alvo = el('secoes');
  limpar(alvo);

  for (const secao of Array.isArray(secoes) ? secoes : []) {
    if (!secao) continue;

    const corpo = corpoDaSecao(secao);
    // Secao sem conteudo sai inteira do DOM. Nunca um placeholder, nunca desculpa.
    if (!corpo) continue;

    const bloco = tag('section', 'secao');
    const titulo = texto(secao.heading);
    if (titulo) bloco.appendChild(tag('h2', 'secao-titulo', titulo));
    bloco.appendChild(corpo);

    const nota = notaDeFonte(secao);
    if (nota) bloco.appendChild(nota);

    alvo.appendChild(bloco);
  }
}

/* -------------------------------------------------------------- render */

function render(brief) {
  briefAtual = brief;

  renderTopo(brief);
  renderAtos(brief.acts);
  renderListas(brief);
  renderSecoes(brief.sections);

  const svg = el('terreno');
  terreno = desenharTerreno(svg, brief);
  svg.setAttribute('aria-label', terreno.descricao);

  // A pagina nao pode ficar monocromatica: sem nenhum link e sem acento no
  // desenho, o terreno ganha um elemento em clay.
  if (!terreno.temAcentoClay && !pagina.querySelector('a')) {
    terreno.aplicarAcentoClay();
  }

  estado.hidden = true;
  pagina.hidden = false;
  document.title = texto(brief.dayDate)
    ? 'Resumo Matinal · ' + texto(brief.dayDate)
    : 'Resumo Matinal';
}

function trocarSuave(brief) {
  if (!pagina.hidden && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    render(brief);
    return;
  }
  pagina.classList.add('trocando');
  setTimeout(() => {
    render(brief);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => pagina.classList.remove('trocando'));
  }, 280);
}

function aplicarSeNovo(brief) {
  if (!brief || typeof brief !== 'object') return;
  if (briefAtual && brief.generatedAt === briefAtual.generatedAt) return;
  if (!briefAtual) render(brief);
  else trocarSuave(brief);
}

/* ---------------------------------------------- primeira abertura sem nada */

function mostrarSemBrief() {
  el('estado-linha-1').textContent = 'Ainda não tenho o resumo de hoje.';
  el('estado-linha-2').textContent =
    'Ele chega assim que você estiver on-line de novo — é só abrir o app mais tarde.';
  pagina.hidden = true;
  estado.hidden = false;
}

/* --------------------------------------------------------------- rede */

async function doCache() {
  if (!('caches' in window)) return null;
  try {
    const resp = await caches.match(CAMINHO_DADOS);
    return resp ? await resp.json() : null;
  } catch (e) {
    return null;
  }
}

async function carregar() {
  // Com o service worker no controle, isto volta na hora do cache e a
  // revalidacao acontece atras. Sem ele, e uma busca normal na rede.
  try {
    const resp = await fetch(CAMINHO_DADOS, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (e) {
    return await doCache();
  }
}

let revalidando = false;

async function revalidar() {
  if (revalidando) return;
  revalidando = true;
  try {
    const reg = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (reg) {
      // O service worker revalida e avisa de volta se o brief tiver mudado.
      reg.postMessage({ tipo: 'revalidar' });
      return;
    }
    const resp = await fetch(CAMINHO_DADOS, { cache: 'reload' });
    if (resp.ok) aplicarSeNovo(await resp.json());
  } catch (e) {
    // Sem rede: fica com o que ja esta na tela.
  } finally {
    revalidando = false;
  }
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', async (ev) => {
    if (!ev.data || ev.data.tipo !== 'brief-atualizado') return;
    revalidando = false;
    const brief = await doCache();
    aplicarSeNovo(brief);
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}

/* ------------------------------------------------------ puxar para atualizar */

function ligarPuxarParaAtualizar() {
  let inicioY = null;

  addEventListener('touchstart', (ev) => {
    inicioY = window.scrollY <= 0 && ev.touches.length === 1 ? ev.touches[0].clientY : null;
  }, { passive: true });

  addEventListener('touchmove', (ev) => {
    if (inicioY === null) return;
    if (ev.touches[0].clientY - inicioY > 70) {
      inicioY = null;
      revalidar();
    }
  }, { passive: true });

  addEventListener('touchend', () => { inicioY = null; }, { passive: true });
}

/* --------------------------------------------------------------- inicio */

async function iniciar() {
  registrarServiceWorker();
  ligarPuxarParaAtualizar();

  const brief = await carregar();
  if (brief && typeof brief === 'object') render(brief);
  else mostrarSemBrief();

  // Voltar para o app de manha ja mostra o brief do dia.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidar();
  });
}

iniciar();
