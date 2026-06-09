import type { DoseEvent, ModelPoint, PkCandidate, SimulationResult } from "./types";

const HALF_HOUR = 0.5;

export function parseDosingTimes(value: string): number[] {
  const times = value
    .split(/[,\n、，\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseTimeToHour)
    .filter((hour): hour is number => hour !== null);

  return Array.from(new Set(times)).sort((a, b) => a - b);
}

export function simulateCandidate(
  candidate: PkCandidate,
  dosingTimesText: string,
  days: number,
  doseMultiplier = 1,
  timingJitterHours = 0,
): SimulationResult | null {
  const cmax = candidate.cmax?.mean;
  const tmax = hoursFromParameter(candidate.tmax);
  const halfLife = hoursFromParameter(candidate.halfLife);
  const dosingTimes = parseDosingTimes(dosingTimesText);
  const jitterHours = Math.max(0, timingJitterHours);

  if (
    !cmax ||
    !tmax ||
    !halfLife ||
    dosingTimes.length === 0 ||
    days <= 0 ||
    !Number.isFinite(doseMultiplier) ||
    doseMultiplier <= 0 ||
    !Number.isFinite(timingJitterHours)
  ) {
    return null;
  }

  const warnings: string[] = [];
  if (candidate.tmax?.mean !== tmax || candidate.halfLife?.mean !== halfLife) {
    warnings.push("tmax または t1/2 の単位を時間に換算して計算しています。");
  }
  if (doseMultiplier !== 1) {
    warnings.push(
      "1回量倍率は、添文のCmaxに対して線形に比例するとみなす簡略仮定です。",
    );
  }
  if (jitterHours > 0) {
    warnings.push(
      `服用時刻のゆらぎは、各服用時刻を日ごとに±${jitterHours}時間の範囲で固定乱数的にずらす観察用設定です。`,
    );
  }
  const ke = Math.log(2) / halfLife;
  const kaResult = estimateKa(ke, tmax);
  const ka = kaResult.ka;
  warnings.push(...kaResult.warnings);

  const peakBase = singleDoseBase(tmax, ke, ka);
  if (peakBase <= 0) {
    return null;
  }

  const scale = cmax / peakBase;
  const totalHours = Math.round(days * 24);
  const doses = buildDoseEvents(dosingTimes, days, doseMultiplier, jitterHours);
  const points: ModelPoint[] = [];

  for (let hour = 0; hour <= totalHours; hour += HALF_HOUR) {
    let concentration = 0;
    for (const dose of doses) {
      if (hour >= dose.hour) {
        concentration += singleDose(hour - dose.hour, ke, ka, scale, dose.amountMultiplier);
      }
    }
    points.push({
      hour: Number(hour.toFixed(2)),
      day: Math.floor(hour / 24) + 1,
      concentration,
    });
  }

  return {
    points,
    doses,
    ke,
    ka,
    scale,
    doseMultiplier,
    peak: Math.max(...points.map((point) => point.concentration)),
    warnings,
  };
}

function parseTimeToHour(value: string): number | null {
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour + minute / 60;
}

function buildDoseEvents(
  times: number[],
  days: number,
  amountMultiplier = 1,
  timingJitterHours = 0,
): DoseEvent[] {
  const events: DoseEvent[] = [];
  const totalHours = days * 24;
  for (let day = 0; day < days; day += 1) {
    for (const [index, time] of times.entries()) {
      const jitter =
        timingJitterHours > 0 ? deterministicJitter(day, index, time, timingJitterHours) : 0;
      const eventHour = day * 24 + time + jitter;
      if (eventHour < 0 || eventHour > totalHours) {
        continue;
      }
      events.push({
        hour: Number(eventHour.toFixed(2)),
        amountMultiplier,
        label: formatClockHour(eventHour),
      });
    }
  }
  return events;
}

function deterministicJitter(day: number, index: number, time: number, amplitude: number): number {
  const seed = (day + 1) * 12.9898 + (index + 1) * 78.233 + time * 37.719;
  const wave = Math.sin(seed) * 43758.5453;
  const unit = wave - Math.floor(wave);
  return (unit * 2 - 1) * amplitude;
}

function formatClockHour(hour: number): string {
  const minutesInDay = 24 * 60;
  const totalMinutes = ((Math.round(hour * 60) % minutesInDay) + minutesInDay) % minutesInDay;
  const clockHour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(clockHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function estimateKa(
  ke: number,
  tmax: number,
): {
  ka: number;
  warnings: string[];
} {
  const maxTmax = 1 / ke;
  const warnings: string[] = [];

  if (tmax >= maxTmax) {
    warnings.push(
      "tmax が半減期から推定される上限に近いため、ka は ke に近い値として近似しています。",
    );
    return { ka: ke * 1.001, warnings };
  }

  let low = ke * 1.0001;
  let high = Math.max(ke * 2, 1);

  while (tmaxFromRates(high, ke) > tmax && high < 10000) {
    high *= 2;
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (tmaxFromRates(mid, ke) > tmax) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return { ka: (low + high) / 2, warnings };
}

function hoursFromParameter(parameter: PkCandidate["tmax"]): number | null {
  if (!parameter?.mean) {
    return null;
  }

  const unit = parameter.unit.toLowerCase();
  if (unit.includes("日") || unit.includes("day")) {
    return parameter.mean * 24;
  }
  if (unit.includes("分") || unit.includes("min")) {
    return parameter.mean / 60;
  }

  return parameter.mean;
}

function tmaxFromRates(ka: number, ke: number): number {
  return Math.log(ka / ke) / (ka - ke);
}

function singleDoseBase(t: number, ke: number, ka: number): number {
  if (t < 0) {
    return 0;
  }
  return Math.exp(-ke * t) - Math.exp(-ka * t);
}

function singleDose(
  t: number,
  ke: number,
  ka: number,
  scale: number,
  amountMultiplier: number,
): number {
  return Math.max(0, amountMultiplier * scale * singleDoseBase(t, ke, ka));
}
