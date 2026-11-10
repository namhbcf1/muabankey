/**
 * Sinh ảnh SVG gradient mang thương hiệu cho từng sản phẩm.
 * Lưu vào public/img/*.svg rồi cập nhật image_url trong D1.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = new URL('../public/img/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/** Bảng màu + icon theo nhóm sản phẩm */
const THEMES = {
  windows:   { c1: '#0a5bd3', c2: '#00a4ef', icon: 'M3 5.5 11 4v7H3zM12 3.8 21 2.4V11h-9zM3 13h8v7l-8-1.5zM12 13h9v8.6l-9-1.4z', label: 'WINDOWS' },
  office:    { c1: '#c4342b', c2: '#f25c3c', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', label: 'OFFICE' },
  m365:      { c1: '#0364b8', c2: '#28a8ea', icon: 'M12 2 3 6.5v11L12 22l9-4.5v-11zM12 5.2l6 3v7.6l-6 3-6-3V8.2z', label: 'MICROSOFT 365' },
  openai:    { c1: '#0d8a72', c2: '#10a37f', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3.6 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3zm-4.6 2.7 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3zm9.2 0 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3zM12 12.8l2.6 1.5v3L12 18.8l-2.6-1.5v-3z', label: 'AI' },
  claude:    { c1: '#b8562f', c2: '#d97757', icon: 'M12 2 4 6.8v10.4L12 22l8-4.8V6.8zM12 7l4 2.4v5.2L12 17l-4-2.4V9.4z', label: 'CLAUDE' },
  google:    { c1: '#1a60d8', c2: '#4e8dfb', icon: 'M12 2 3 7v10l9 5 9-5V7zM12 6.4l5 2.8v5.6l-5 2.8-5-2.8V9.2z', label: 'GEMINI' },
  perplex:   { c1: '#0a6f74', c2: '#17a2a8', icon: 'M12 2 3 7.5 12 13l9-5.5zM3 16.5 12 22l9-5.5-4.5-2.7L12 16.6l-4.5-2.8z', label: 'PERPLEXITY' },
  adobe:     { c1: '#c8102e', c2: '#ff3b30', icon: 'M14.6 3H21v18zM9.4 3H3v18zM12 10.2 15.8 21h-2.5l-1.1-3h-1.9z', label: 'ADOBE' },
  canva:     { c1: '#00a8b5', c2: '#31d0dd', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.4 5.8c2.2 0 3.6 1.6 3.6 3.4 0 2.4-2.4 3.4-4.2 3.4-1 0-1.8-.4-1.8-.4s-.6 1.6-1.8 1.6c-1 0-1.4-.8-1.4-1.8 0-2.6 3.2-6.2 5.6-6.2z', label: 'CANVA' },
  figma:     { c1: '#9b51e0', c2: '#e06464', icon: 'M9 2h3v6H9a3 3 0 0 1 0-6zm0 6h3v6H9a3 3 0 0 1 0-6zm0 6h3v3a3 3 0 1 1-3-3zm6-12h-3v6h3a3 3 0 1 0 0-6zm0 6h-3v6h3a3 3 0 1 0 0-6z', label: 'FIGMA' },
  netflix:   { c1: '#8b0000', c2: '#e50914', icon: 'M8 2h3l5 12V2h3v20h-3l-5-12v12H8z', label: 'NETFLIX' },
  spotify:   { c1: '#0d6b2f', c2: '#1db954', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.4a.8.8 0 0 1-1.1.3c-3-1.8-6.7-2.2-11.1-1.2a.8.8 0 0 1-.4-1.6c4.8-1.1 9-.6 12.3 1.4.4.2.5.7.3 1.1zm1.1-2.5a1 1 0 0 1-1.4.3c-3.4-2.1-8.6-2.7-12.6-1.5a1 1 0 1 1-.6-1.9c4.6-1.4 10.4-.7 14.3 1.7.5.3.6 1 .3 1.4zm.1-2.6C13.4 9 7.4 8.8 3.6 10a1.2 1.2 0 1 1-.7-2.3C7.3 6.3 14 6.5 18.6 9.2a1.2 1.2 0 0 1-1.2 2.1z', label: 'SPOTIFY' },
  youtube:   { c1: '#8b0000', c2: '#ff0000', icon: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12s0-3.2-.4-4.8zM10 15V9l5.2 3z', label: 'YOUTUBE' },
  github:    { c1: '#16233b', c2: '#3d4f6b', icon: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z', label: 'GITHUB' },
  jetbrains: { c1: '#0f1b2d', c2: '#ff5c39', icon: 'M3 4h7v2H3zm0 6h7v2H3zm0 6h7v2H3zm10-12h8v16h-8zm2 2v12h4V6z', label: 'JETBRAINS' },
  vpn:       { c1: '#12306b', c2: '#2f6fd0', icon: 'M12 2 4 5.5v6c0 5 3.4 9.4 8 10.5 4.6-1.1 8-5.5 8-10.5v-6zm0 3.2 5 2.2v4.1c0 3.5-2.1 6.6-5 7.7-2.9-1.1-5-4.2-5-7.7V7.4z', label: 'VPN' },
  antivirus: { c1: '#0d5c3a', c2: '#22a35c', icon: 'M12 2 3.5 5.5v6.2c0 5.1 3.6 9.6 8.5 10.3 4.9-.7 8.5-5.2 8.5-10.3V5.5zm-1.2 13.6-3.6-3.6 1.5-1.5 2.1 2.1 5-5 1.5 1.5z', label: 'SECURITY' },
  wps:       { c1: '#b32b32', c2: '#e8453c', icon: 'M2 6h3l2 9 2-9h3l2 9 2-9h3l-3.5 13h-3l-2-8.5-2 8.5h-3z', label: 'WPS' },
};

/** [slug, theme, tên hiển thị] */
const PRODUCTS = [
  ['windows-11-pro', 'windows', 'Windows 11 Pro'],
  ['office-2021-pro-plus', 'office', 'Office 2021 Pro Plus'],
  ['microsoft-365-family', 'm365', 'Microsoft 365 Family'],
  ['chatgpt-plus', 'openai', 'ChatGPT Plus'],
  ['claude-pro', 'claude', 'Claude Pro'],
  ['gemini-advanced', 'google', 'Gemini Advanced'],
  ['perplexity-pro', 'perplex', 'Perplexity Pro'],
  ['adobe-creative-cloud', 'adobe', 'Adobe Creative Cloud'],
  ['canva-pro', 'canva', 'Canva Pro'],
  ['figma-professional', 'figma', 'Figma Professional'],
  ['netflix-premium', 'netflix', 'Netflix Premium 4K'],
  ['spotify-premium', 'spotify', 'Spotify Premium'],
  ['youtube-premium', 'youtube', 'YouTube Premium'],
  ['github-copilot', 'github', 'GitHub Copilot'],
  ['jetbrains-all-products', 'jetbrains', 'JetBrains All Products'],
  ['expressvpn', 'vpn', 'ExpressVPN'],
  ['kaspersky-plus', 'antivirus', 'Kaspersky Plus'],
  ['wps-office-pro', 'wps', 'WPS Office Pro'],
];

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let count = 0;
for (const [slug, themeKey, title] of PRODUCTS) {
  const th = THEMES[themeKey];
  const gid = 'g' + createHash('md5').update(slug).digest('hex').slice(0, 6);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${th.c1}"/>
      <stop offset="100%" stop-color="${th.c2}"/>
    </linearGradient>
    <radialGradient id="${gid}g" cx="0.72" cy="0.18" r="0.85">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${gid}s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
    </linearGradient>
    <filter id="${gid}b"><feGaussianBlur stdDeviation="42"/></filter>
  </defs>

  <rect width="800" height="500" fill="url(#${gid})"/>
  <rect width="800" height="500" fill="url(#${gid}g)"/>

  <!-- Vệt sáng trang trí -->
  <g opacity="0.16" filter="url(#${gid}b)">
    <circle cx="130" cy="420" r="120" fill="#ffffff"/>
    <circle cx="700" cy="90" r="100" fill="#ffffff"/>
  </g>

  <!-- Lưới mờ -->
  <g stroke="#ffffff" stroke-opacity="0.07" stroke-width="1">
    ${Array.from({ length: 9 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="500"/>`).join('')}
    ${Array.from({ length: 6 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="800" y2="${i * 100}"/>`).join('')}
  </g>

  <!-- Icon sản phẩm -->
  <g transform="translate(400,215)">
    <circle r="86" fill="#ffffff" fill-opacity="0.14"/>
    <circle r="86" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>
    <g transform="translate(-46,-46) scale(3.833)">
      <path d="${th.icon}" fill="#ffffff"/>
    </g>
  </g>

  <!-- Nhãn -->
  <text x="400" y="365" text-anchor="middle" fill="#ffffff" fill-opacity="0.96"
        font-family="'Segoe UI',system-ui,-apple-system,sans-serif" font-size="34" font-weight="700"
        letter-spacing="1">${esc(title)}</text>
  <text x="400" y="404" text-anchor="middle" fill="#ffffff" fill-opacity="0.62"
        font-family="'Segoe UI',system-ui,-apple-system,sans-serif" font-size="17" font-weight="600"
        letter-spacing="4.5">${esc(th.label)}</text>

  <!-- Chân trang -->
  <g opacity="0.55">
    <text x="400" y="460" text-anchor="middle" fill="#ffffff"
          font-family="'Segoe UI',system-ui,sans-serif" font-size="14" font-weight="600"
          letter-spacing="2.5">MUABANKEY · BẢN QUYỀN CHÍNH HÃNG</text>
  </g>
  <rect y="330" width="800" height="170" fill="url(#${gid}s)"/>
</svg>
`;

  writeFileSync(new URL(`${slug}.svg`, OUT), svg, 'utf8');
  count++;
}

console.log(`✅ Đã tạo ${count} ảnh SVG trong public/img/`);
