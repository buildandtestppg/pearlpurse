import React from "react";

// PearlPurse icon system — 24-grid stroke glyphs, 1.6px, round caps.
// Matches the Space Grotesk / glass / mint-teal language. No emoji anywhere.

const S = ({ children, size = 22, sw = 1.6, className = "", fill = "none" }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconHome = (p) => (
  <S {...p}>
    {/* pearl in shell */}
    <circle cx="12" cy="13.2" r="3.4" />
    <path d="M4.2 13.2c0 3 3.5 5.4 7.8 5.4s7.8-2.4 7.8-5.4" />
    <path d="M6.6 10.4C7.8 7.2 9.7 5.4 12 5.4s4.2 1.8 5.4 5" opacity=".55" />
  </S>
);

export const IconTools = (p) => (
  <S {...p}>
    {/* spark/diamond */}
    <path d="M12 3.6l1.9 5.7 5.7 1.9-5.7 1.9L12 18.8l-1.9-5.7-5.7-1.9 5.7-1.9z" />
    <path d="M18.4 16.2l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" opacity=".55" />
  </S>
);

export const IconAccount = (p) => (
  <S {...p}>
    <circle cx="12" cy="8.4" r="3.2" />
    <path d="M5.4 19.4c.9-3.2 3.5-5 6.6-5s5.7 1.8 6.6 5" />
  </S>
);

export const IconReceive = (p) => (
  <S {...p}>
    <path d="M12 4.6v11.2" />
    <path d="M7.4 11.4l4.6 4.6 4.6-4.6" />
    <path d="M5.2 19.6h13.6" />
  </S>
);

export const IconSend = (p) => (
  <S {...p}>
    <path d="M12 19.4V8.2" />
    <path d="M7.4 12.8L12 8.2l4.6 4.6" />
    <path d="M5.2 4.6h13.6" />
  </S>
);

export const IconPlus = (p) => (
  <S {...p}>
    <path d="M12 5.4v13.2M5.4 12h13.2" />
  </S>
);

export const IconKey = (p) => (
  <S {...p}>
    <circle cx="8.2" cy="8.2" r="3.6" />
    <path d="M10.8 10.8l8 8" />
    <path d="M15.6 15.6l2.2-2.2 2.2 2.2" opacity=".55" />
  </S>
);

export const IconSlow = (p) => (
  <S {...p}>
    {/* turtle-ish: shell arc + steady footline */}
    <path d="M5 13.6c0-3.4 3.1-6.2 7-6.2s7 2.8 7 6.2" />
    <path d="M5 13.6h14" />
    <path d="M8 16.8c0 1 .9 1.8 2 1.8M14 16.8c1.1 0 2-.8 2-1.8" opacity=".55" />
    <circle cx="12" cy="7.4" r=".5" fill="currentColor" opacity=".55" />
  </S>
);

export const IconFast = (p) => (
  <S {...p}>
    {/* bolt */}
    <path d="M13.2 3.6L6 13.4h4.4l-1.2 7 7.6-9.8h-4.6z" />
  </S>
);

export const IconStandard = (p) => (
  <S {...p}>
    {/* steady double-chevron */}
    <path d="M7.8 6.4L12 10.6l4.2-4.2" />
    <path d="M7.8 13.2l4.2 4.2 4.2-4.2" />
  </S>
);

export const IconSign = (p) => (
  <S {...p}>
    <path d="M15.8 4.6c.9-.9 2.3-.9 3.2 0 .9.9.9 2.3 0 3.2L9.4 17.4l-4.2 1.2 1.2-4.2z" />
    <path d="M14.2 6.2l3.6 3.6" />
  </S>
);

export const IconVerify = (p) => (
  <S {...p}>
    <circle cx="10.8" cy="10.8" r="5.6" />
    <path d="M15 15l4.4 4.4" />
    <path d="M8.4 10.8l1.7 1.7 3-3" />
  </S>
);

export const IconShield = (p) => (
  <S {...p}>
    <path d="M12 3.8l6.8 2.6v5.2c0 4-2.9 7.3-6.8 8.6-3.9-1.3-6.8-4.6-6.8-8.6V6.4z" />
    <path d="M9.2 12l2 2 3.6-3.8" />
  </S>
);

export const IconBook = (p) => (
  <S {...p}>
    <path d="M5 5.4A1.6 1.6 0 016.6 3.8H18.6v14.4H6.6A1.6 1.6 0 005 19.8z" />
    <path d="M5 19.8a1.6 1.6 0 011.6-1.6H18.6" />
    <path d="M9 8h6M9 11h4" opacity=".55" />
  </S>
);

export const IconEye = (p) => (
  <S {...p}>
    <path d="M2.8 12S6 6.4 12 6.4 21.2 12 21.2 12 18 17.6 12 17.6 2.8 12 2.8 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </S>
);

export const IconLock = (p) => (
  <S {...p}>
    <rect x="5.6" y="10.4" width="12.8" height="9.2" rx="2.4" />
    <path d="M8.4 10.4V8a3.6 3.6 0 017.2 0v2.4" />
    <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
  </S>
);

export const IconCopy = (p) => (
  <S {...p}>
    <rect x="8.6" y="8.6" width="11" height="11" rx="2.2" />
    <path d="M15.4 5.6a2.2 2.2 0 00-2.2-2.2H6.6a2.2 2.2 0 00-2.2 2.2v6.6a2.2 2.2 0 002.2 2.2" />
  </S>
);

export const IconRotate = (p) => (
  <S {...p}>
    <path d="M19.6 12a7.6 7.6 0 11-2.2-5.4" />
    <path d="M19.8 3.8v3.4h-3.4" />
  </S>
);

export const IconIn = (p) => (
  <S {...p}>
    <path d="M17.4 6.6l-10.8 10.8" />
    <path d="M16.4 17.4H6.6V7.6" />
  </S>
);

export const IconOut = (p) => (
  <S {...p}>
    <path d="M6.6 17.4l10.8-10.8" />
    <path d="M7.6 6.6h9.8v9.8" />
  </S>
);

export const IconCheck = (p) => (
  <S {...p}>
    <path d="M5 12.8l4.4 4.4L19 7.6" />
  </S>
);

export const IconClose = (p) => (
  <S {...p}>
    <path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" />
  </S>
);

export const IconWarning = (p) => (
  <S {...p}>
    <path d="M12 4.4L2.8 19.6h18.4z" />
    <path d="M12 10v4.2" />
    <circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none" />
  </S>
);

export const IconExternal = (p) => (
  <S {...p}>
    <path d="M13.6 5.6h4.8v4.8" />
    <path d="M18.4 5.6l-8 8" />
    <path d="M16.8 14v3.4a1.6 1.6 0 01-1.6 1.6H6.6A1.6 1.6 0 015 17.4V8.8a1.6 1.6 0 011.6-1.6H10" />
  </S>
);

// Deterministic address avatar: 5-swatch gradient blob from the address hash.
// Same address → same identity colors, computed client-side.
export function AddrAvatar({ address, size = 36 }) {
  let h = 0;
  const a = address || "";
  for (let i = 0; i < a.length; i++) { h = (h * 31 + a.charCodeAt(i)) >>> 0; }
  const hue = h % 360, hue2 = (hue + 40 + (h % 80)) % 360;
  const rot = h % 360;
  const gid = "av" + (h % 99991);
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" style={{ borderRadius: 11, flex: "none", display: "block" }}>
      <defs>
        <linearGradient id={gid} gradientTransform={`rotate(${rot} .5 .5)`}>
          <stop offset="0%" stopColor={`hsl(${hue} 62% 58%)`} />
          <stop offset="100%" stopColor={`hsl(${hue2} 58% 34%)`} />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="11" fill={`url(#${gid})`} />
      <circle cx={(12 + (h % 12))} cy={(11 + ((h >> 4) % 12))} r="4.4" fill="rgba(255,255,255,.16)" />
      <circle cx={(20 + ((h >> 8) % 9))} cy={(19 + ((h >> 6) % 10))} r="6.2" fill="rgba(0,0,0,.14)" />
      <circle cx={(10 + ((h >> 5) % 14))} cy={(22 + ((h >> 9) % 8))} r="2.6" fill="rgba(255,255,255,.10)" />
    </svg>
  );
}

// Animated pearl-drop success mark (send completion moment)
export function PearlSuccess() {
  return (
    <svg width="86" height="86" viewBox="0 0 86 86" aria-hidden="true">
      <circle cx="43" cy="46" r="30" fill="none" stroke="rgba(205,233,134,.28)" strokeWidth="1.5"
        strokeDasharray="4 6" className="pearl-ripple" />
      <circle cx="43" cy="38" r="15" fill="none" stroke="rgba(205,233,134,.5)" strokeWidth="1.5" className="pearl-ring" />
      <radialGradient id="pg" cx=".38" cy=".32" r=".8">
        <stop offset="0%" stopColor="#f4fbef" />
        <stop offset="55%" stopColor="#cde986" />
        <stop offset="100%" stopColor="#8fd4db" />
      </radialGradient>
      <circle cx="43" cy="38" r="10" fill="url(#pg)" className="pearl-core" />
      <path d="M37 38.6l4.2 4.2 8-8.4" fill="none" stroke="#17211a" strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round" className="pearl-check" />
    </svg>
  );
}
