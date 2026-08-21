#!/usr/bin/env node
// Embute o woff2 da Fraunces 600 dentro de docs/styles.css como data URI.
// Roda so em desenvolvimento; o site publicado nao depende disto.
//
//   npm pack @fontsource/fraunces && tar -xzf fontsource-fraunces-*.tgz
//   node scripts/embutir-fonte.mjs package/files/fraunces-latin-600-normal.woff2

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = resolve(raiz, 'docs/styles.css');

const woff2Path = process.argv[2];
if (!woff2Path) {
  console.error('uso: node scripts/embutir-fonte.mjs <caminho/para/fraunces-latin-600-normal.woff2>');
  process.exit(1);
}

const base64 = readFileSync(resolve(woff2Path)).toString('base64');

const bloco = [
  '/* fraunces:inicio */',
  '/* Fraunces 600 (subconjunto latin) embutida — sem Google Fonts, sem CDN.',
  '   Regenerar com: node scripts/embutir-fonte.mjs <arquivo.woff2>',
  '   Fonte: @fontsource/fraunces, licenca SIL Open Font License 1.1. */',
  '@font-face{',
  '  font-family:"Fraunces";',
  '  font-style:normal;',
  '  font-weight:600;',
  '  font-display:block;',
  `  src:url(data:font/woff2;base64,${base64}) format("woff2");`,
  '  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,',
  '    U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,',
  '    U+2215,U+FEFF,U+FFFD;',
  '}',
  '/* fraunces:fim */'
].join('\n');

const css = readFileSync(cssPath, 'utf8');
const marcador = /\/\* fraunces:inicio \*\/[\s\S]*?\/\* fraunces:fim \*\//;

if (!marcador.test(css)) {
  console.error('erro: nao achei o bloco /* fraunces:inicio */ ... /* fraunces:fim */ em docs/styles.css');
  process.exit(1);
}

writeFileSync(cssPath, css.replace(marcador, () => bloco), 'utf8');
console.log(`Fraunces embutida em docs/styles.css (${(base64.length / 1024).toFixed(1)} KB em base64).`);
