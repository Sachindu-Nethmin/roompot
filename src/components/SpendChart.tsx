"use client";

import { useState } from "react";

type Point = { day: string; total: number };

const W = 600;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };

function niceMax(v: number) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const fmtDay = (k: string) =>
  new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Last-30-days daily spend: one series, columns from a shared baseline, average as a reference line. */
export default function SpendChart({ series, avg, currency }: { series: Point[]; avg: number; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(avg, ...series.map((s) => s.total)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / series.length;
  const barW = Math.min(14, band - 2);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Daily spend for the last 30 days. Average ${money(avg)} per day.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {t >= 1000 ? `${(t / 1000).toLocaleString("en-US")}k` : t}
            </text>
          </g>
        ))}

        {series.map((s, i) => {
          const x = PAD.left + i * band + (band - barW) / 2;
          const h = Math.max(0, y(0) - y(s.total));
          const r = Math.min(4, h, barW / 2);
          return (
            <g key={s.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD.left + i * band} y={PAD.top} width={band} height={innerH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(s.total) + r} Q${x},${y(s.total)} ${x + r},${y(s.total)} H${x + barW - r} Q${x + barW},${y(s.total)} ${x + barW},${y(s.total) + r} V${y(0)} Z`}
                  fill="var(--bar)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}

        {avg > 0 && (
          <g pointerEvents="none">
            <line x1={PAD.left} x2={W - PAD.right} y1={y(avg)} y2={y(avg)} stroke="var(--ink-2)" strokeWidth={1.5} />
            <text x={W - PAD.right} y={y(avg) - 5} textAnchor="end" fontSize={10} fill="var(--ink-2)" fontWeight={600}>
              avg {money(avg)}
            </text>
          </g>
        )}

        {[0, 14, series.length - 1].map((i) => (
          <text key={i} x={PAD.left + i * band + band / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
            {i === series.length - 1 ? "Today" : fmtDay(series[i].day)}
          </text>
        ))}
      </svg>

      {hover !== null && (
        <div
          className="absolute -top-2 pointer-events-none card px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
          style={{
            left: `${((PAD.left + hover * band + band / 2) / W) * 100}%`,
            transform: `translate(${hover > series.length / 2 ? "-100%" : "0"}, -100%)`,
          }}
        >
          <div className="text-ink-3">{fmtDay(series[hover].day)}</div>
          <div className="font-semibold">{money(series[hover].total)}</div>
        </div>
      )}
    </div>
  );
}
