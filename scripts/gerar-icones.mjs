#!/usr/bin/env node
// gerar-icones.mjs — gera todos os icones a partir de scripts/icone-fonte.svg.
//
//   npm run icones
//
// sharp e dependencia de desenvolvimento. O site publicado e 100% estatico.

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(resolve(raiz, 'scripts/icone-fonte.svg'));
const saida = resolve(raiz, 'docs/icons');

const FUNDO = '#F9F9F7';   // --wash, igual ao background_color do manifest

mkdirSync(saida, { recursive: true });

/**
 * Renderiza o SVG a um tamanho final, deixando uma margem de respiro.
 *
 * @param {string} arquivo   nome do PNG
 * @param {number} tamanho   lado final, em pixels
 * @param {number} ocupacao  fracao do lado que o desenho ocupa (1 = sangra)
 */
async function icone(arquivo, tamanho, ocupacao) {
  const interno = Math.round(tamanho * ocupacao);
  const borda = Math.round((tamanho - interno) / 2);

  const desenho = await sharp(fonte, { density: 512 })
    .resize(interno, interno, { fit: 'contain', background: FUNDO })
    .png()
    .toBuffer();

  await sharp(desenho)
    .extend({
      top: borda,
      bottom: tamanho - interno - borda,
      left: borda,
      right: tamanho - interno - borda,
      background: FUNDO,
    })
    .flatten({ background: FUNDO })   // nada de transparencia: o iOS pinta preto atras
    .png({ compressionLevel: 9 })
    .toFile(resolve(saida, arquivo));

  console.log(`  ${arquivo}  ${tamanho}x${tamanho}  (desenho em ${Math.round(ocupacao * 100)}%)`);
}

console.log('Gerando icones a partir de scripts/icone-fonte.svg:');

// any: o desenho ja tem a propria margem interna, entao sangra.
await icone('icone-192.png', 192, 1);
await icone('icone-512.png', 512, 1);

// maskable: o sistema pode recortar ate 20% de cada lado. Tudo o que importa
// precisa caber no circulo de seguranca central.
await icone('icone-512-maskable.png', 512, 0.8);

// apple-touch: o iOS arredonda os cantos, entao um pouco de folga basta.
await icone('apple-touch-180.png', 180, 0.88);

console.log('Pronto.');
