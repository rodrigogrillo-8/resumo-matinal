#!/usr/bin/env node
// verificar.mjs — roda os criterios de aceite num Chromium de verdade e
// guarda as capturas em capturas/. Dependencia de desenvolvimento apenas.
//
//   npm run verificar

import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, join } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(raiz, 'docs');
const capturas = join(raiz, 'capturas');
mkdirSync(capturas, { recursive: true });

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Servidor estatico simples: sem redirecionamento, para nao esconder problemas.
function servir() {
  const app = createServer(async (req, res) => {
    const caminho = decodeURIComponent(req.url.split('?')[0]);
    const arquivo = join(docs, caminho.endsWith('/') ? caminho + 'index.html' : caminho);
    if (!arquivo.startsWith(docs)) { res.writeHead(403).end(); return; }
    try {
      const corpo = await readFile(arquivo);
      res.writeHead(200, {
        'content-type': TIPOS[extname(arquivo)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(corpo);
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
    }
  });
  return new Promise((ok) => app.listen(0, '127.0.0.1', () => ok(app)));
}

/* ------------------------------------------------------------- placar */

let falhas = 0;

function checar(nome, condicao, detalhe) {
  if (condicao) {
    console.log('  ok   ' + nome);
  } else {
    falhas++;
    console.log('  FALHA ' + nome + (detalhe ? '  → ' + detalhe : ''));
  }
}

/* ----------------------------------------------------------- fixtures */

const BASE = {
  schemaVersion: 1,
  generatedAt: '2026-08-21T09:00:00-03:00',
  timezone: 'America/Sao_Paulo',
  dayDate: 'Sexta-feira · 21 de agosto de 2026',
  dayShape: 'NORMAL',
  headline: 'Um dia de teste.',
  events: [],
  acts: [],
  needsAttention: [],
  resolved: [],
  sections: [],
};

const evento = (h1, m1, h2, m2, peso, titulo) => ({
  title: titulo || 'Evento',
  start: `2026-08-21T${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}:00-03:00`,
  end: `2026-08-21T${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}:00-03:00`,
  weight: peso,
});

const brief = (extra) => ({ ...BASE, ...extra });

/* --------------------------------------------------- leitura da pagina */

// Le a geometria do relevo direto do SVG renderizado.
const LER_TERRENO = `(() => {
  const svg = document.getElementById('terreno');
  const path = svg.querySelector(':scope > path');
  const total = path.getTotalLength();

  const yEm = (x) => {
    let lo = 0, hi = total;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (path.getPointAtLength(m).x < x) lo = m; else hi = m;
    }
    return path.getPointAtLength((lo + hi) / 2).y;
  };

  const amostras = [];
  for (let i = 0; i <= 100; i++) amostras.push(path.getPointAtLength((total * i) / 100).y);

  // So os filhos diretos: os motivos ficam dentro de um <g> e alguns tambem
  // usam <circle>, mas nao sao pontos de compromisso.
  const circulos = [...svg.querySelectorAll(':scope > circle')].map((c) => ({
    cx: +c.getAttribute('cx'),
    cy: +c.getAttribute('cy'),
    r: +c.getAttribute('r'),
    fill: c.getAttribute('fill'),
    stroke: c.getAttribute('stroke'),
    desvio: Math.abs(+c.getAttribute('cy') - yEm(+c.getAttribute('cx'))),
  }));

  return {
    yMin: Math.min(...amostras),
    yMax: Math.max(...amostras),
    yEm: Object.fromEntries([9, 9.5, 10, 10.5, 11, 11.5, 12]
      .map((h) => [h, yEm(((h * 60 - 360) / 960) * 840)])),
    circulos,
    vazados: circulos.filter((c) => c.fill === 'var(--wash)').length,
    motivos: [...svg.querySelectorAll('g[data-motivo]')].map((g) => ({
      tipo: g.getAttribute('data-motivo'),
      cor: g.getAttribute('color'),
    })),
    clay: svg.innerHTML.includes('var(--clay)'),
  };
})()`;

/* --------------------------------------------------------------- main */

const app = await servir();
const base = 'http://127.0.0.1:' + app.address().port + '/';

const navegador = await chromium.launch();
const iPhone = devices['iPhone 13'];

// Abre uma pagina com o brief pedido, sem service worker no caminho.
async function comBrief(dados, opcoes = {}) {
  const ctx = await navegador.newContext({
    ...iPhone,
    serviceWorkers: 'block',
    colorScheme: opcoes.tema || 'light',
  });
  const pedidos = [];
  const errosConsole = [];
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errosConsole.push(m.text()); });
  page.on('pageerror', (e) => errosConsole.push(String(e)));
  page.on('request', (r) => pedidos.push(r.url()));

  if (dados) {
    await page.route('**/data/latest.json', (rota) =>
      rota.fulfill({ contentType: 'application/json', body: JSON.stringify(dados) }));
  }

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#pagina:not([hidden]), #estado:not([hidden])');
  return { ctx, page, pedidos, errosConsole };
}

console.log('\nCriterios de aceite\n');

/* 1 — brief real, sem erro no console, sem host externo, capturas */
{
  console.log('brief publicado (docs/data/latest.json)');
  for (const tema of ['light', 'dark']) {
    const { ctx, page, pedidos, errosConsole } = await comBrief(null, { tema });
    await page.waitForTimeout(400);

    checar(`sem erro no console (${tema})`, errosConsole.length === 0, errosConsole[0]);

    const externos = pedidos.filter((u) => !u.startsWith(base) && !u.startsWith('data:'));
    checar(`nenhuma requisicao externa (${tema})`, externos.length === 0, externos.join(', '));

    const fonte = await page.evaluate(
      () => getComputedStyle(document.getElementById('headline')).fontFamily);
    checar(`headline em Fraunces (${tema})`, /Fraunces/.test(fonte), fonte);

    const fraunces = await page.evaluate(() => document.fonts.check('600 32px Fraunces'));
    checar(`Fraunces carregada de verdade (${tema})`, fraunces);

    await page.screenshot({ path: join(capturas, `iphone-${tema}.png`), fullPage: true });
    await ctx.close();
  }
}

/* 2 — events: [] vira uma linha quase reta */
{
  console.log('\nevents: [] — agua parada');
  const { ctx, page } = await comBrief(brief({ headline: 'Nenhum compromisso hoje.' }));
  const t = await page.evaluate(LER_TERRENO);
  checar('linha quase reta', t.yMax - t.yMin < 6, `variacao de ${(t.yMax - t.yMin).toFixed(2)}px`);
  checar('fica no vale, sem montanha inventada', t.yMin > 140, `yMin=${t.yMin.toFixed(1)}`);
  checar('nenhum ponto de compromisso', t.circulos.length === 0);
  await ctx.close();
}

/* 3 — tres eventos colados viram um plato com os pontos grudados */
{
  console.log('\ntres eventos colados — plato');
  const { ctx, page } = await comBrief(brief({
    dayShape: 'HEAVY',
    events: [evento(9, 0, 10, 0, 'full'), evento(10, 0, 11, 0, 'full'), evento(11, 0, 12, 0, 'full')],
  }));
  const t = await page.evaluate(LER_TERRENO);
  checar('tres pontos', t.circulos.length === 3);
  checar('plato bem acima do vale', t.yEm[10.5] < 45, `y=${t.yEm[10.5].toFixed(1)}`);

  // Plato de verdade: topo chato entre 10h e 11h, com ombros descendo dos lados.
  const topo = [t.yEm[10], t.yEm[10.5], t.yEm[11]];
  checar('topo chato de 10h a 11h',
    Math.max(...topo) - Math.min(...topo) < 1.5,
    `variacao de ${(Math.max(...topo) - Math.min(...topo)).toFixed(2)}px`);
  checar('ombros descem dos dois lados',
    t.yEm[9] > t.yEm[10] + 15 && t.yEm[12] > t.yEm[11] + 15,
    `9h=${t.yEm[9].toFixed(0)} 10h=${t.yEm[10].toFixed(0)} 11h=${t.yEm[11].toFixed(0)} 12h=${t.yEm[12].toFixed(0)}`);

  const alturas = t.circulos.map((c) => c.cy);
  checar('os tres pontos bem acima do vale', Math.max(...alturas) < 80,
    `mais baixo em y=${Math.max(...alturas).toFixed(0)}`);

  const pior = Math.max(...t.circulos.map((c) => c.desvio));
  checar('pontos grudados na curva', pior < 0.6, `desvio maximo de ${pior.toFixed(3)}px`);
  checar('nenhum circulo vazado', t.vazados === 0);
  await ctx.close();
}

/* 4 — sobreposicao real vira dois circulos vazados */
{
  console.log('\ndois eventos sobrepostos — circulos vazados');
  const { ctx, page } = await comBrief(brief({
    events: [evento(9, 0, 11, 0, 'full'), evento(10, 0, 12, 0, 'full')],
  }));
  const t = await page.evaluate(LER_TERRENO);
  checar('exatamente dois vazados', t.vazados === 2, `vazados=${t.vazados}`);
  checar('vazados tem contorno', t.circulos.filter((c) => c.fill === 'var(--wash)')
    .every((c) => c.stroke && c.stroke !== 'none'));

  const [a, b] = t.circulos;
  checar('os dois circulos se cruzam de verdade',
    Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r,
    `distancia ${Math.hypot(a.cx - b.cx, a.cy - b.cy).toFixed(1)} vs raios ${(a.r + b.r).toFixed(1)}`);

  checar('rabisco de tensao em clay', t.motivos.some((m) => m.tipo === 'tensao'));
  await ctx.close();
}

/* 5 — listas vazias viram uma linha calma so */
{
  console.log('\nneedsAttention e resolved vazios');
  const { ctx, page } = await comBrief(brief({ events: [evento(9, 0, 10, 0, 'full')] }));
  const calmo = await page.textContent('.calmo').catch(() => null);
  checar('linha calma unica', calmo === 'Nada precisa de você nesta manhã.', String(calmo));
  checar('nenhuma rubrica de lista', await page.locator('.rubrica').count() === 0);
  await ctx.close();
}

/* 6 — secao sem conteudo some inteira, e href ausente vira texto */
{
  console.log('\nsecao vazia e href ausente');
  const { ctx, page } = await comBrief(brief({
    needsAttention: [{ title: 'Sem link', text: 'Uma frase.', linkText: 'isto e texto puro' }],
    sections: [
      { heading: 'Some inteira (rows)', kind: 'rows', rows: [] },
      { heading: 'Some inteira (prose)', kind: 'prose', text: '   ' },
      { heading: 'Fica', kind: 'prose', text: 'Tenho conteudo.' },
    ],
  }));

  const html = await page.content();
  checar('secao rows vazia fora do DOM', !html.includes('Some inteira (rows)'));
  checar('secao prose vazia fora do DOM', !html.includes('Some inteira (prose)'));
  checar('secao com conteudo permanece', html.includes('Fica'));
  checar('uma unica secao no DOM', await page.locator('.secao').count() === 1);

  checar('linkText sem href virou texto', html.includes('isto e texto puro'));
  checar('nenhum <a> na pagina', await page.locator('a').count() === 0);
  checar('nenhum <a> sem href', await page.locator('a:not([href]), a[href=""]').count() === 0);

  // Sem nenhum link e sem colisao: o desenho precisa de um acento em clay.
  const t = await page.evaluate(LER_TERRENO);
  checar('pagina nao fica monocromatica', t.clay, JSON.stringify(t.motivos));
  await ctx.close();
}

/* 7 — texto do JSON entra escapado */
{
  console.log('\nconteudo nao confiavel');
  const { ctx, page } = await comBrief(brief({
    headline: '<img src=x onerror="window.__furou=1">',
    needsAttention: [{
      title: 'Script',
      text: '<script>window.__furou=1<\/script>',
      linkText: 'clique',
      href: 'javascript:window.__furou=1',
    }],
  }));
  await page.waitForTimeout(200);
  checar('nada foi executado', await page.evaluate(() => !window.__furou));
  checar('a headline virou texto visivel',
    (await page.textContent('#headline')).includes('<img src=x'));
  checar('href javascript: nao virou link', await page.locator('a').count() === 0);
  await ctx.close();
}

/* 8 — brief de ontem mostra a linha discreta */
{
  console.log('\nbrief de um dia anterior');
  const { ctx, page } = await comBrief(brief({
    generatedAt: '2026-08-19T09:00:00-03:00',
    events: [evento(9, 0, 10, 0, 'full')],
  }));
  const aviso = await page.textContent('#aviso');
  checar('linha discreta com a data', aviso === 'Mostrando o resumo de 19 de agosto.', aviso);
  const cor = await page.evaluate(() => getComputedStyle(document.getElementById('aviso')).color);
  checar('em --ink-grey', cor === 'rgb(180, 179, 168)', cor);
  await ctx.close();
}

/* 9 — primeira abertura sem rede e sem cache */
{
  console.log('\nprimeira abertura sem rede e sem cache');
  const ctx = await navegador.newContext({ ...iPhone, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.route('**/data/latest.json', (r) => r.abort());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#estado:not([hidden])');
  const linhas = await page.locator('.estado-linha').allTextContents();
  checar('duas frases amigaveis', linhas.length === 2 && linhas.every((l) => l.length > 10),
    JSON.stringify(linhas));
  checar('nada de tela de erro do navegador', !(await page.content()).includes('ERR_'));
  await page.screenshot({ path: join(capturas, 'iphone-sem-rede.png') });
  await ctx.close();
}

/* 10 — service worker: modo aviao depois de uma abertura */
{
  console.log('\nmodo aviao depois de uma abertura');
  const ctx = await navegador.newContext({ ...iPhone });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null,
    { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const cascaOk = await page.evaluate(async () => {
    const nomes = await caches.keys();
    let n = 0;
    for (const nome of nomes) n += (await (await caches.open(nome)).keys()).length;
    return { nomes, n };
  });
  checar('casca e brief em cache', cascaOk.n >= 7, JSON.stringify(cascaOk));

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pagina:not([hidden])', { timeout: 10000 });

  // Confere contra o brief que esta publicado agora, nao contra numeros fixos.
  const publicado = JSON.parse(await readFile(join(docs, 'data/latest.json'), 'utf8'));
  const esperado = {
    headline: publicado.headline,
    atos: (publicado.acts || []).length,
    circulos: (publicado.events || []).length,
  };

  const offline = await page.evaluate(() => ({
    headline: document.getElementById('headline').textContent,
    atos: document.querySelectorAll('#atos li').length,
    circulos: document.querySelectorAll('#terreno > circle').length,
    fonte: document.fonts.check('600 32px Fraunces'),
  }));
  checar('brief completo offline',
    offline.headline === esperado.headline
    && offline.atos === esperado.atos
    && offline.circulos === esperado.circulos,
    `esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(offline)}`);
  checar('fonte embutida tambem offline', offline.fonte);
  await page.screenshot({ path: join(capturas, 'iphone-offline.png'), fullPage: true });
  await ctx.close();
}

/* 11 — brief novo troca a tela sem piscar */
{
  console.log('\nchegou um brief mais novo');
  const ctx = await navegador.newContext({ ...iPhone, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let versao = 1;
  await page.route('**/data/latest.json', (rota) => rota.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(brief({
      generatedAt: versao === 1 ? '2026-08-21T09:00:00-03:00' : '2026-08-21T11:00:00-03:00',
      headline: versao === 1 ? 'Primeira versao.' : 'Chegou uma versao nova.',
    })),
  }));
  await page.goto(base, { waitUntil: 'networkidle' });
  checar('mostra a primeira versao',
    (await page.textContent('#headline')) === 'Primeira versao.');

  versao = 2;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(
    () => document.getElementById('headline').textContent === 'Chegou uma versao nova.',
    null, { timeout: 5000 });
  checar('trocou para a versao nova', true);
  checar('a pagina nunca ficou em branco', await page.evaluate(
    () => !document.getElementById('pagina').hidden));
  await ctx.close();
}

/* 12 — criterios de instalabilidade, um por um */
{
  console.log('\ninstalavel');
  const ctx = await navegador.newContext({ ...iPhone });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });

  const html = await page.content();
  for (const meta of [
    'apple-mobile-web-app-capable',
    'apple-mobile-web-app-status-bar-style',
    'apple-mobile-web-app-title',
    'apple-touch-icon',
  ]) {
    checar(`meta de iOS: ${meta}`, html.includes(meta));
  }
  checar('viewport-fit=cover', html.includes('viewport-fit=cover'));
  checar('theme-color claro e escuro',
    (html.match(/name="theme-color"/g) || []).length === 2
    && html.includes('(prefers-color-scheme: light)')
    && html.includes('(prefers-color-scheme: dark)'));

  const m = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const resp = await fetch(link.href);
    return { ok: resp.ok, tipo: resp.headers.get('content-type'), corpo: await resp.json() };
  });
  checar('manifest carrega', m.ok);
  checar('name e short_name', !!m.corpo.name && m.corpo.short_name === 'Resumo');
  checar('display standalone', m.corpo.display === 'standalone');
  checar('orientation portrait', m.corpo.orientation === 'portrait');
  checar('start_url e scope relativos',
    m.corpo.start_url === './' && m.corpo.scope === './');
  checar('background_color e theme_color combinam com a faixa de cima',
    m.corpo.background_color === '#F9F9F7' && m.corpo.theme_color === '#F9F9F7');

  const tamanhos = m.corpo.icons.map((i) => i.sizes + ' ' + i.purpose);
  checar('icone 192 any', tamanhos.includes('192x192 any'));
  checar('icone 512 any', tamanhos.includes('512x512 any'));
  checar('icone 512 maskable', tamanhos.includes('512x512 maskable'));

  const icones = await page.evaluate(async (lista) => {
    const fora = [];
    for (const ic of lista) {
      const r = await fetch(new URL(ic.src, location.href));
      const bmp = await createImageBitmap(await r.blob());
      const esperado = +ic.sizes.split('x')[0];
      if (bmp.width !== esperado || bmp.height !== esperado) {
        fora.push(`${ic.src} tem ${bmp.width}x${bmp.height}`);
      }
    }
    return fora;
  }, m.corpo.icons);
  checar('icones tem o tamanho declarado', icones.length === 0, icones.join(', '));

  const apple = await page.evaluate(async () => {
    const r = await fetch(document.querySelector('link[rel="apple-touch-icon"]').href);
    const b = await createImageBitmap(await r.blob());
    return `${b.width}x${b.height}`;
  });
  checar('apple-touch-icon 180x180', apple === '180x180', apple);

  checar('service worker controla a pagina', await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  }));

  await ctx.close();
}

await navegador.close();
app.close();

console.log('\n' + (falhas === 0
  ? 'Tudo passou. Capturas em capturas/.'
  : `${falhas} ${falhas === 1 ? 'criterio falhou' : 'criterios falharam'}.`) + '\n');

process.exit(falhas === 0 ? 0 : 1);
