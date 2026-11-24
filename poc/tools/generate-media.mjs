// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_MEDIA } from '../apps/server/demo-media.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../media');

const THEMES = {
  navy: { bg1: '#091b2e', bg2: '#173f5f', ink: '#f4efe3', muted: '#b9c8d6', accent: '#d8a23a', line: '#5e88a8' },
  celadon: { bg1: '#123c39', bg2: '#3d756c', ink: '#f2eee0', muted: '#c2ddd5', accent: '#c9a45a', line: '#8fc2b4' },
  hanji: { bg1: '#decda9', bg2: '#f3e9d2', ink: '#19304a', muted: '#5f6a6f', accent: '#b4533f', line: '#a9a08a' },
  vermilion: { bg1: '#5d1f1b', bg2: '#9d3f31', ink: '#fff3df', muted: '#e9c8b7', accent: '#e0b261', line: '#d8866f' },
};

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function svgFor(spec, index) {
  const theme = THEMES[spec.theme] ?? THEMES.navy;
  const w = spec.width;
  const h = spec.height;
  const unit = Math.min(w, h);
  const titleSize = Math.round(unit * 0.115);
  const subSize = Math.round(unit * 0.032);
  const kickerSize = Math.round(unit * 0.018);
  const numeralSize = Math.round(unit * 0.34);
  const margin = Math.round(unit * 0.075);
  const lineHeight = subSize * 1.65;
  const subtitleLines = spec.subtitle.split('\n');
  const circleX = w - unit * 0.18;
  const circleY = h * 0.24;
  const circleR = unit * 0.2;
  const barY = h - margin * 1.55;
  const barW = Math.max(8, Math.round(unit * 0.006));
  const bars = Array.from({ length: 14 }, (_, bar) => {
    const height = unit * (0.018 + ((bar * 37 + index * 19) % 13) * 0.009);
    return `<rect x="${margin + bar * barW * 1.9}" y="${barY - height}" width="${barW}" height="${height}" rx="${barW / 2}" fill="${theme.accent}" opacity="${0.35 + (bar % 4) * 0.12}"/>`;
  }).join('\n  ');
  const rings = Array.from({ length: 3 }, (_, ring) => {
    const radius = circleR - ring * unit * 0.035;
    return `<circle cx="${circleX}" cy="${circleY}" r="${radius}" fill="none" stroke="${theme.line}" stroke-width="${Math.max(3, unit * 0.004)}" opacity="${0.6 - ring * 0.14}"/>`;
  }).join('\n  ');
  const wave = Array.from({ length: 9 }, (_, waveIndex) => {
    const x = margin + (waveIndex * (w - margin * 2)) / 8;
    const y = h * 0.66 + Math.sin((waveIndex + index) * 0.9) * unit * 0.035;
    return waveIndex === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
  }).join(' ');
  return `<!-- SPDX-License-Identifier: Apache-2.0 -->
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(spec.title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.bg1}"/>
      <stop offset="1" stop-color="${theme.bg2}"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${theme.accent}" stop-opacity="0"/>
      <stop offset="1" stop-color="${theme.accent}" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${w * 0.08}" cy="${h * 0.9}" r="${unit * 0.42}" fill="${theme.line}" opacity="0.08"/>
  <g transform="translate(${circleX} ${circleY})">
    ${rings}
  </g>
  <text x="${w - margin}" y="${h * 0.9}" text-anchor="end" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="${numeralSize}" font-weight="700" fill="${theme.ink}" opacity="0.07">${escapeXml(spec.numeral)}</text>
  <text x="${margin}" y="${margin + kickerSize}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="${kickerSize}" letter-spacing="${kickerSize * 0.14}" fill="${theme.accent}">${escapeXml(spec.kicker)}</text>
  <rect x="${margin}" y="${margin * 1.65}" width="${unit * 0.16}" height="${Math.max(4, unit * 0.005)}" fill="${theme.accent}"/>
  <text x="${margin}" y="${h * 0.38}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="${titleSize}" font-weight="700" fill="${theme.ink}">${escapeXml(spec.title)}</text>
  ${subtitleLines
    .map(
      (line, lineIndex) =>
        `<text x="${margin}" y="${h * 0.38 + titleSize * 0.84 + subSize * 1.85 + lineIndex * lineHeight}" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="${subSize}" fill="${theme.muted}">${escapeXml(line)}</text>`,
    )
    .join('\n  ')}
  <path d="${wave}" fill="none" stroke="url(#fade)" stroke-width="${Math.max(3, unit * 0.005)}" stroke-linecap="round"/>
  ${bars}
  <text x="${w - margin}" y="${h - margin * 0.35}" text-anchor="end" font-family="'Malgun Gothic', 'Noto Sans KR', sans-serif" font-size="${kickerSize * 0.9}" fill="${theme.muted}" opacity="0.85">원본 데모 자산 · ORIGINAL DEMO ASSET</text>
</svg>
`;
}

await fs.mkdir(publicDir, { recursive: true });
for (const [index, spec] of DEMO_MEDIA.entries()) {
  await fs.writeFile(path.join(publicDir, spec.filename), svgFor(spec, index), 'utf8');
}
await fs.writeFile(
  path.join(publicDir, 'README.txt'),
  'Original SVG demo artwork generated by poc/tools/generate-media.mjs. No third-party artwork is included.\n',
  'utf8',
);
console.log(`Wrote ${DEMO_MEDIA.length} original SVG demo assets to ${publicDir}`);
