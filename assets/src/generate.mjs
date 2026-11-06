// Generates the SVG artwork for the GitHub profile README.
// Text is converted to outlines (Onest + JetBrains Mono), so the images look
// the same everywhere and need no web fonts. Every image has a light and a dark
// version; the README picks one with <picture> and prefers-color-scheme.
//
//   npm install && node generate.mjs [outDir]
//
// Copy lives in the `content` object below — edit it and re-run.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const OUT = path.resolve(process.argv[2] || '../');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- fonts
const fontFile = (fam, w) =>
  require.resolve(`@fontsource/${fam}/files/${fam}-latin-${w}-normal.woff`);
const load = (file) => {
  const b = fs.readFileSync(file);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const F = {
  o4: load(fontFile('onest', 400)),
  o5: load(fontFile('onest', 500)),
  o6: load(fontFile('onest', 600)),
  o7: load(fontFile('onest', 700)),
  m4: load(fontFile('jetbrains-mono', 400)),
  m5: load(fontFile('jetbrains-mono', 500)),
};

// ---------------------------------------------------------------- themes
// Same tokens as the portfolio (src/app/tokens.css).
const THEMES = {
  light: {
    bg: '#F3F3F1', bg2: '#E8E8E5', card: '#F3F3F1', ink: '#111112', ink2: '#3B3B3F',
    mute: '#67676D', line: 'rgba(17,17,18,.14)', acc: '#2443F5', onAcc: '#FFFFFF',
    accMute: 'rgba(255,255,255,.72)', accLine: 'rgba(255,255,255,.38)',
    ticket: '#FFFFFF', ticketInk: '#111112', ticketMute: '#67676D',
    inv: '#111112', onInv: '#F3F3F1', invMute: '#A1A1A6', invAcc: '#8196FF',
    status: '#1FA463',
  },
  dark: {
    bg: '#0E0E10', bg2: '#18181B', card: '#141417', ink: '#F1F1EE', ink2: '#C2C2C5',
    mute: '#8D8D93', line: 'rgba(241,241,238,.14)', acc: '#7086FF', onAcc: '#0E0E10',
    accMute: 'rgba(14,14,16,.72)', accLine: 'rgba(14,14,16,.32)',
    ticket: '#0E0E10', ticketInk: '#F1F1EE', ticketMute: '#8D8D93',
    inv: '#F1F1EE', onInv: '#0E0E10', invMute: '#55555B', invAcc: '#2443F5',
    status: '#2BBF75',
  },
};

// ---------------------------------------------------------------- text → paths
function layout(font, str, size, tracking = 0) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(str);
  const xs = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    xs.push(x);
    x += g.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      x += font.getKerningValue(g, glyphs[i + 1]) * scale;
      x += tracking * size;
    }
  });
  return { glyphs, xs, width: x };
}
const measure = (font, str, size, tracking = 0) => layout(font, str, size, tracking).width;

// opentype's toPathData drops separators around rounded "-0", so format by hand.
function pathData(cmds) {
  const n = (v) => { const r = Math.round(v); return Object.is(r, -0) ? '0' : String(r); };
  return cmds.map((c) => {
    if (c.type === 'M' || c.type === 'L') return `${c.type}${n(c.x)} ${n(c.y)}`;
    if (c.type === 'Q') return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
    if (c.type === 'C') return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
    return 'Z';
  }).join('');
}

// Each glyph is defined once per image (in font units) and placed with <use>.
let DEFS = new Map();
const fontIds = new Map();
function glyphRef(font, g) {
  if (!fontIds.has(font)) fontIds.set(font, `f${fontIds.size}`);
  const id = `${fontIds.get(font)}g${g.index}`;
  if (!DEFS.has(id)) {
    const d = pathData(g.getPath(0, 0, font.unitsPerEm).commands);
    DEFS.set(id, d ? `<path id="${id}" d="${d}"/>` : '');
  }
  return DEFS.get(id) ? id : null;
}
const r2 = (n) => Math.round(n * 100) / 100;
function text(font, str, x, y, size, { fill, tracking = 0, anchor = 'start', opacity } = {}) {
  const { glyphs, xs, width } = layout(font, str, size, tracking);
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const uses = glyphs.map((g, i) => {
    const id = glyphRef(font, g);
    return id ? `<use href="#${id}" transform="translate(${r2(x0 + xs[i])} ${r2(y)}) scale(${size / font.unitsPerEm})"/>` : '';
  }).join('');
  const op = opacity != null ? ` fill-opacity="${opacity}"` : '';
  return { svg: uses ? `<g fill="${fill}"${op}>${uses}</g>` : '', width, x0 };
}

// Rich line: segments [{t, font, fill}] laid out one after another.
function rich(segments, x, y, size, tracking = 0) {
  let cx = x;
  const out = [];
  for (const s of segments) {
    const r = text(s.font, s.t, cx, y, size, { fill: s.fill, tracking });
    out.push(r.svg);
    cx += r.width + tracking * size;
  }
  return { svg: out.join(''), width: cx - x };
}

function wrap(font, str, size, maxWidth, tracking = 0) {
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(font, next, size, tracking) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// "Products with real ==business== complexity." → segments with accent
function accentSegments(str, font, fill, accFill) {
  return str.split(/(==[^=]+==)/).filter(Boolean).map((p) =>
    p.startsWith('==') ? { t: p.slice(2, -2), font, fill: accFill } : { t: p, font, fill });
}

const arrowNE = (x, y, s, stroke, w = 2.5) =>
  `<path d="M${x} ${y + s}L${x + s} ${y}M${x + s * 0.28} ${y}H${x + s}V${y + s * 0.72}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="square"/>`;

function chips(list, x, y, { font = F.m5, size = 16, h = 38, padX = 16, gap = 10, stroke, fill, bg = 'none' }) {
  let cx = x;
  const out = [];
  for (const c of list) {
    const w = measure(font, c, size) + padX * 2;
    out.push(`<rect x="${cx}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${bg}" stroke="${stroke}" stroke-width="1.5"/>`);
    out.push(text(font, c, cx + padX, y + h / 2 + size * 0.36, size, { fill }).svg);
    cx += w + gap;
  }
  return { svg: out.join(''), width: cx - gap - x };
}

function svgDoc(w, h, title, body, style = '') {
  const defs = [...DEFS.values()].join('');
  DEFS = new Map();
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${style ? `<style>${style.replace(/\s*\n\s*/g, '')}</style>` : ''}<defs>${defs}</defs>${body}</svg>\n`;
}

const write = (name, svg) => fs.writeFileSync(path.join(OUT, name), svg);

// ---------------------------------------------------------------- content
const content = {
  banner: {
    handle: 'GITHUB.COM/SHEHAB20089',
    status: 'OPEN TO NEW ROLES',
    name: 'Shehab Mohsen',
    role: 'Senior Full-Stack Engineer & Frontend Lead',
    lead: 'I build',
    phrases: [
      'products end to end.',
      'design systems that scale.',
      'real-time platforms.',
      'AI-powered product features.',
      'Arabic & English RTL interfaces.',
    ],
    meta: [
      ['BASED IN', 'Cairo, Egypt · UTC+2'],
      ['EXPERIENCE', '6+ years'],
      ['CORE STACK', 'React · TypeScript · Node.js · .NET'],
      ['NOW', 'BitBang · Turath Studios'],
    ],
  },
  sections: [
    ['01', 'ABOUT', 'Frontend-first. ==Full-stack== by default.', 'about'],
    ['02', 'SELECTED WORK', 'Products with real ==business== complexity.', 'work'],
    ['03', 'STACK', 'The tools I ==ship== with.', 'stack'],
    ['04', 'TURATH STUDIOS', 'Heritage, told through ==games== and art.', 'turath'],
    ['05', 'PUBLIC CODE', 'Small repos, ==clean== code.', 'code'],
  ],
  featured: {
    num: '01',
    label: 'FEATURED · MY INITIATIVE AT BITBANG',
    name: 'SparkFlow',
    blurb: "BitBang's internal project-management platform. I pitched it, designed it and built it end to end. It replaced our Jira subscription, and every team in the company runs on it today.",
    chips: ['NestJS', 'PostgreSQL · Prisma', 'Redis · BullMQ', 'React', 'MCP'],
    ticket: { id: 'SPK-142', via: 'CREATED VIA MCP', title: 'Add CSV export to sprint report', who: 'Assigned to AI agent' },
    stats: [['94', 'DATA MODELS'], ['600+', 'AUTOMATED TEST FILES']],
  },
  cards: [
    { slug: 'gopay', num: '02', sector: 'FINTECH · BILLING', name: 'GoPay',
      blurb: 'SADAD-integrated B2B billing and collections for Saudi Arabia. I own the frontend: payments, invoicing, reconciliation and approvals.',
      chips: ['React', 'TypeScript', 'Next.js', 'ZATCA'] },
    { slug: 'amplifidor', num: '03', sector: 'CREATOR ECONOMY', name: 'Amplifidor',
      blurb: 'A two-sided influencer × brand platform. I led the frontend: creator profiles, audience insights and wallets, in English and Arabic.',
      chips: ['React', 'GraphQL', 'Apollo', 'RTL'] },
    { slug: 'shamel360', num: '04', sector: 'SUPPLY CHAIN · FULFILLMENT', name: 'Shamel360',
      blurb: 'A warehouse fulfillment console. I set the frontend foundations and built the inventory, product and approval flows.',
      chips: ['React 19', 'TanStack Query', 'shadcn/ui'] },
    { slug: 'fatura', num: '05', sector: 'FINTECH · B2B DISTRIBUTION', name: 'Fatura',
      blurb: 'B2B ordering and credit for FMCG distribution in Egypt. Frontend-led, plus Google sign-in, backend changes and migration scripts.',
      chips: ['React', 'Vue', 'Node · Express'] },
  ],
  footer: {
    label: "06 · LET’S TALK",
    lines: ['Let’s build something', 'that ==lasts.=='],
    note: 'Open to senior full-stack, frontend lead and product engineering roles. Remote, full-time or contract.',
    link: 'shehab20089.github.io',
  },
};

// ---------------------------------------------------------------- banner
function banner(t, th) {
  const c = content.banner;
  const W = 1280, H = 492, P = 64;
  const b = [];
  b.push(`<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="18" fill="${th.bg}" stroke="${th.line}" stroke-width="1.5"/>`);

  // top row
  b.push(text(F.m5, c.handle, P, 80, 14, { fill: th.mute, tracking: 0.08 }).svg);
  const st = text(F.m5, c.status, W - P, 80, 14, { fill: th.ink2, tracking: 0.08, anchor: 'end' });
  b.push(st.svg);
  const dx = st.x0 - 18, dy = 75;
  b.push(`<circle class="pulse" cx="${dx}" cy="${dy}" r="5" fill="${th.status}"/>`);
  b.push(`<circle cx="${dx}" cy="${dy}" r="5" fill="${th.status}"/>`);
  b.push(`<line x1="${P}" y1="106" x2="${W - P}" y2="106" stroke="${th.line}" stroke-width="1.5"/>`);

  // name + accent full stop
  const nm = text(F.o7, c.name, P - 4, 238, 124, { fill: th.ink, tracking: -0.05 });
  b.push(nm.svg);
  b.push(text(F.o7, '.', P - 4 + nm.width + 2, 238, 124, { fill: th.acc }).svg);

  // role
  b.push(text(F.o5, c.role, P, 302, 36, { fill: th.ink, tracking: -0.02 }).svg);

  // rotating line
  const lead = text(F.o5, c.lead, P, 352, 32, { fill: th.mute, tracking: -0.01 });
  b.push(lead.svg);
  const px = P + lead.width + 11;
  c.phrases.forEach((p, i) => {
    b.push(`<g class="ph ph${i}">${text(F.o5, p, px, 352, 32, { fill: th.acc, tracking: -0.01 }).svg}</g>`);
  });

  // mark: blue square with a slowly turning eight-point star
  const S = 214, mx = W - P - S, my = 132, cx = mx + S / 2, cy = my + S / 2, r = 62;
  b.push(`<rect x="${mx}" y="${my}" width="${S}" height="${S}" rx="6" fill="${th.acc}"/>`);
  const sq = (rot) => `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" fill="${th.onAcc}" transform="rotate(${rot} ${cx} ${cy})"/>`;
  b.push(`<g class="spin">${sq(0)}${sq(45)}<circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="${th.acc}"/></g>`);

  // meta row
  b.push(`<line x1="${P}" y1="396" x2="${W - P}" y2="396" stroke="${th.line}" stroke-width="1.5"/>`);
  let x = P;
  for (const [label, value] of c.meta) {
    const l = text(F.m5, label, x, 430, 12, { fill: th.mute, tracking: 0.1 });
    const v = text(F.o5, value, x, 458, 19, { fill: th.ink, tracking: -0.01 });
    b.push(l.svg, v.svg);
    x += Math.max(l.width, v.width) + 64;
  }
  if (x - 64 > W - P) console.warn('banner meta overflows', x - 64);
  if (px + measure(F.o5, c.phrases.reduce((a, s) => (s.length > a.length ? s : a)), 32) > mx - 24) console.warn('banner phrase overlaps mark');

  const n = c.phrases.length, slot = 3; // seconds per phrase
  const dur = n * slot, share = (100 / n);
  const style = `
.ph{opacity:0;animation:ph ${dur}s infinite both}
${c.phrases.map((_, i) => `.ph${i}{animation-delay:${i * slot}s}`).join('')}
@keyframes ph{0%{opacity:0;transform:translateY(14px)}${(share * 0.12).toFixed(2)}%{opacity:1;transform:translateY(0)}${(share * 0.85).toFixed(2)}%{opacity:1;transform:translateY(0)}${share.toFixed(2)}%{opacity:0;transform:translateY(-12px)}100%{opacity:0;transform:translateY(-12px)}}
.spin{transform-origin:${cx}px ${cy}px;animation:spin 48s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.pulse{transform-origin:${dx}px ${dy}px;animation:pulse 2s ease-out infinite}
@keyframes pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(3.2);opacity:0}}
@media (prefers-reduced-motion:reduce){.ph,.spin,.pulse{animation:none}.ph0{opacity:1}.pulse{opacity:0}}`;
  write(`banner-${t}.svg`, svgDoc(W, H, `${c.name} — ${c.role}. ${c.lead} ${c.phrases[0]}`, b.join(''), style));
}

// ---------------------------------------------------------------- section headers
function section(t, th, [num, label, heading, slug]) {
  const W = 1280, H = 150;
  const b = [];
  b.push(`<line x1="0" y1="1" x2="${W}" y2="1" stroke="${th.line}" stroke-width="2"/>`);
  const n = text(F.m5, num, 0, 46, 16, { fill: th.acc, tracking: 0.08 });
  b.push(n.svg);
  b.push(text(F.m5, label, n.width + 16, 46, 16, { fill: th.mute, tracking: 0.1 }).svg);
  b.push(rich(accentSegments(heading, F.o6, th.ink, th.acc), -2, 122, 58, -0.045).svg);
  write(`section-${slug}-${t}.svg`, svgDoc(W, H, `${num} ${label} — ${heading.replace(/==/g, '')}`, b.join('')));
}

// ---------------------------------------------------------------- featured card
function featured(t, th) {
  const c = content.featured;
  const W = 1280, H = 500, P = 56;
  const b = [];
  b.push(`<rect width="${W}" height="${H}" rx="18" fill="${th.acc}"/>`);
  const n = text(F.m5, c.num, P, 78, 17, { fill: th.onAcc, tracking: 0.08 });
  b.push(n.svg, text(F.m5, c.label, P + n.width + 16, 78, 17, { fill: th.accMute, tracking: 0.1 }).svg);
  b.push(text(F.o7, c.name, P - 5, 190, 100, { fill: th.onAcc, tracking: -0.05 }).svg);
  wrap(F.o4, c.blurb, 25, 640).forEach((ln, i) => b.push(text(F.o4, ln, P, 246 + i * 36, 25, { fill: th.onAcc }).svg));
  const fc = chips(c.chips, P, H - P - 40, { size: 16, h: 40, stroke: th.accLine, fill: th.onAcc });
  if (P + fc.width > 760) console.warn('featured chips too wide', P + fc.width);
  b.push(fc.svg);

  // ticket mock with a status that moves on its own
  const tx = 800, ty = 56, tw = W - P - tx, thh = 214;
  b.push(arrowNE(W - P - 22, 58, 22, th.onAcc));
  const T = c.ticket;
  b.push(`<rect x="${tx}" y="${ty + 40}" width="${tw}" height="${thh}" rx="14" fill="${th.ticket}"/>`);
  const ty0 = ty + 40;
  b.push(text(F.m5, T.id, tx + 24, ty0 + 40, 15, { fill: th.ticketMute, tracking: 0.06 }).svg);
  b.push(text(F.m5, T.via, tx + tw - 24, ty0 + 40, 12, { fill: th.ticketMute, tracking: 0.1, anchor: 'end' }).svg);
  b.push(text(F.o6, T.title, tx + 24, ty0 + 84, 23, { fill: th.ticketInk, tracking: -0.02 }).svg);
  // assignee
  b.push(`<circle cx="${tx + 40}" cy="${ty0 + 128}" r="16" fill="${th.acc}"/>`);
  b.push(text(F.m5, 'AI', tx + 40, ty0 + 133, 13, { fill: th.onAcc, anchor: 'middle' }).svg);
  b.push(text(F.o5, T.who, tx + 66, ty0 + 134, 17, { fill: th.ticketMute }).svg);
  // status pills
  const pills = [
    ['TO DO', th.ticketMute],
    ['IN PROGRESS', '#E3A008'],
    ['DONE', th.status],
  ];
  const py = ty0 + 162, ph = 32;
  pills.forEach(([lbl, col], i) => {
    const w = measure(F.m5, lbl, 13, 0.08) + 34 + (lbl === 'DONE' ? 20 : 0);
    const g = [];
    g.push(`<rect x="${tx + 24}" y="${py}" width="${w}" height="${ph}" rx="${ph / 2}" fill="${col}" fill-opacity=".14"/>`);
    g.push(`<circle cx="${tx + 41}" cy="${py + ph / 2}" r="4.5" fill="${col}"/>`);
    g.push(text(F.m5, lbl, tx + 54, py + ph / 2 + 4.8, 13, { fill: col, tracking: 0.08 }).svg);
    if (lbl === 'DONE') {
      const kx = tx + 54 + measure(F.m5, lbl, 13, 0.08) + 8, ky = py + ph / 2;
      g.push(`<path d="M${kx} ${ky}l4 4 8-9" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    b.push(`<g class="st st${i}">${g.join('')}</g>`);
  });
  // progress bar under the pills
  b.push(`<rect x="${tx + tw - 24 - 120}" y="${py + 13}" width="120" height="6" rx="3" fill="${th.ticketMute}" fill-opacity=".2"/>`);
  b.push(`<rect class="bar" x="${tx + tw - 24 - 120}" y="${py + 13}" width="120" height="6" rx="3" fill="${th.status}"/>`);

  // stats
  let sx = tx;
  for (const [num, lbl] of c.stats) {
    const nn = text(F.o7, num, sx - 2, H - P - 30, 54, { fill: th.onAcc, tracking: -0.04 });
    const ll = text(F.m5, lbl, sx, H - P, 13, { fill: th.accMute, tracking: 0.1 });
    b.push(nn.svg, ll.svg);
    sx += Math.max(nn.width, ll.width) + 48;
  }

  const style = `
.st{opacity:0;animation:st 9s infinite both}.st0{animation-delay:0s}.st1{animation-delay:3s}.st2{animation-delay:6s}
@keyframes st{0%{opacity:0}4%{opacity:1}30%{opacity:1}34%{opacity:0}100%{opacity:0}}
.bar{transform-origin:${tx + tw - 24 - 120}px 0;animation:bar 9s infinite}
@keyframes bar{0%{transform:scaleX(0)}33%{transform:scaleX(0)}63%{transform:scaleX(1)}96%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@media (prefers-reduced-motion:reduce){.st,.bar{animation:none}.st2{opacity:1}}`;
  write(`card-sparkflow-${t}.svg`, svgDoc(W, H, `${c.name} — ${c.blurb}`, b.join(''), style));
}

// ---------------------------------------------------------------- project cards
function card(t, th, c) {
  const W = 640, H = 420, P = 40;
  const b = [];
  b.push(`<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="18" fill="${th.card}" stroke="${th.line}" stroke-width="1.5"/>`);
  const n = text(F.m5, c.num, P, 66, 17, { fill: th.acc, tracking: 0.08 });
  b.push(n.svg, text(F.m5, c.sector, P + n.width + 14, 66, 17, { fill: th.mute, tracking: 0.08 }).svg);
  b.push(arrowNE(W - P - 20, 48, 20, th.ink));
  b.push(text(F.o7, c.name, P - 3, 162, 66, { fill: th.ink, tracking: -0.045 }).svg);
  const lines = wrap(F.o4, c.blurb, 23, W - P * 2);
  if (lines.length > 4) console.warn('card blurb too long:', c.name);
  lines.forEach((ln, i) => b.push(text(F.o4, ln, P, 214 + i * 33, 23, { fill: th.ink2 }).svg));
  const ch = chips(c.chips, P, H - P - 38, { size: 16, h: 38, stroke: th.line, fill: th.ink2 });
  if (ch.width > W - P * 2) console.warn('card chips overflow:', c.name);
  b.push(ch.svg);
  write(`card-${c.slug}-${t}.svg`, svgDoc(W, H, `${c.name} — ${c.blurb}`, b.join('')));
}

// ---------------------------------------------------------------- footer
function footer(t, th) {
  const c = content.footer;
  const W = 1280, H = 330, P = 56;
  const b = [];
  b.push(`<rect width="${W}" height="${H}" rx="18" fill="${th.inv}"/>`);
  b.push(text(F.m5, c.label, P, 78, 16, { fill: th.invMute, tracking: 0.1 }).svg);
  c.lines.forEach((ln, i) => b.push(rich(accentSegments(ln, F.o6, th.onInv, th.invAcc), P - 4, 168 + i * 84, 80, -0.05).svg));
  const nx = 820;
  wrap(F.o4, c.note, 22, W - P - nx).forEach((ln, i) => b.push(text(F.o4, ln, nx, 144 + i * 32, 22, { fill: th.onInv, opacity: 0.8 }).svg));
  const lk = text(F.o6, c.link, nx, 252, 24, { fill: th.onInv, tracking: -0.01 });
  b.push(lk.svg, arrowNE(nx + lk.width + 12, 234, 16, th.invAcc, 2.4));
  b.push(`<line x1="${nx}" y1="266" x2="${nx + lk.width + 30}" y2="266" stroke="${th.invAcc}" stroke-width="2"/>`);
  write(`footer-${t}.svg`, svgDoc(W, H, `Let's build something that lasts. ${c.note}`, b.join('')));
}

for (const [t, th] of Object.entries(THEMES)) {
  banner(t, th);
  content.sections.forEach((s) => section(t, th, s));
  featured(t, th);
  content.cards.forEach((c) => card(t, th, c));
  footer(t, th);
}
console.log('wrote', fs.readdirSync(OUT).filter((f) => f.endsWith('.svg')).length, 'svgs to', OUT);
