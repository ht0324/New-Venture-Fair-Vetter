import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type GaitMode = "walk" | "gallop";
export type DemoScene =
  | "healthy-walk"
  | "healthy-gallop"
  | "mild-stress"
  | "recovery";
export type StatusLevel = "healthy" | "watch" | "alert";
export type EventKind = "note" | "event" | "alert";

export type MetricKey =
  | "heartRate"
  | "respiration"
  | "lactate"
  | "glucose"
  | "temperature";

export interface MetricState {
  key: MetricKey;
  label: string;
  unit: string;
  shortUnit?: string;
  value: number;
  decimals: number;
  color: string;
  history: number[];
  displayRange: MetricRange;
  status: StatusLevel;
}

export interface EventItem {
  id: string;
  timeLabel: string;
  kind: EventKind;
  label: string;
  severityLabel?: string;
}

export interface HoofLoads {
  LF: number;
  RF: number;
  LH: number;
  RH: number;
}

export interface StrideWindow {
  start: number;
  end: number;
}

export type StridePattern = Record<keyof HoofLoads, StrideWindow>;

export interface SimulationState {
  mode: GaitMode;
  scene: DemoScene;
  status: StatusLevel;
  overallScore: number;
  sessionLabel: string;
  timestampLabel: string;
  metrics: MetricState[];
  hoofLoads: HoofLoads;
  stridePhase: number;
  stridePattern: StridePattern;
  strideFrequencyLabel: string;
  contactSummary: string;
  symmetryScore: number;
  summaryText: string;
  events: EventItem[];
  profile: {
    name: string;
    breed: string;
    age: string;
  };
  commandsLabel: string;
  muted: boolean;
  setMode: (mode: GaitMode) => void;
  setScene: (scene: DemoScene) => void;
  reset: () => void;
  toggleMute: () => void;
}

type MetricRange = [number, number];
type MetricRanges = Record<MetricKey, MetricRange>;

const UPDATE_INTERVAL_MS = 320;
const HISTORY_LENGTH = 64;
const EMA_FACTOR = 0.12;
const VITAL_TIME_SCALE = 0.5;
const GAIT_TRANSITION_FACTOR = 0.035;

const METRIC_META: Array<
  Omit<MetricState, "value" | "history" | "displayRange" | "status"> & { initial: number }
> = [
  {
    key: "heartRate",
    label: "Heart Rate",
    unit: "bpm",
    shortUnit: "bpm",
    initial: 33,
    decimals: 1,
    color: "#72f3ff",
  },
  {
    key: "respiration",
    label: "Respiration",
    unit: "b/m",
    shortUnit: "b/m",
    initial: 11,
    decimals: 1,
    color: "#7aecff",
  },
  {
    key: "lactate",
    label: "Lactate",
    unit: "mmol/L",
    shortUnit: "mmol/L",
    initial: 0.5,
    decimals: 1,
    color: "#68eb96",
  },
  {
    key: "glucose",
    label: "Glucose",
    unit: "mg/dL",
    shortUnit: "mg/dL",
    initial: 92,
    decimals: 1,
    color: "#71f3ed",
  },
  {
    key: "temperature",
    label: "Temperature",
    unit: "°C",
    shortUnit: "°C",
    initial: 38.0,
    decimals: 1,
    color: "#8cf3f5",
  },
];

const BASE_RANGES: Record<GaitMode, MetricRanges> = {
  walk: {
    heartRate: [32, 34],
    respiration: [10.5, 11.5],
    lactate: [0.45, 0.55],
    glucose: [91, 93],
    temperature: [37.95, 38.05],
  },
  gallop: {
    heartRate: [148, 158],
    respiration: [42, 46],
    lactate: [3.6, 4.0],
    glucose: [99, 103],
    temperature: [39.3, 39.6],
  },
};

const GRAPH_MIN_SPAN: Record<MetricKey, number> = {
  heartRate: 4,
  respiration: 1.2,
  lactate: 0.18,
  glucose: 4,
  temperature: 0.18,
};

const SCENE_RANGE_ADJUSTMENTS: Record<DemoScene, Partial<MetricRanges>> = {
  "healthy-walk": {},
  "healthy-gallop": {},
  "mild-stress": {
    heartRate: [8, 12],
    respiration: [3, 5],
    lactate: [0.35, 0.55],
    glucose: [-4, -2],
    temperature: [0.18, 0.28],
  },
  recovery: {
    heartRate: [-7, -4],
    respiration: [-3, -2],
    lactate: [-0.2, -0.1],
    glucose: [-1, 1],
    temperature: [-0.12, -0.05],
  },
};

const NOISE_AMPLITUDE: Record<DemoScene, Record<GaitMode, Record<MetricKey, number>>> = {
  "healthy-walk": {
    walk: {
      heartRate: 0.34,
      respiration: 0.14,
      lactate: 0.02,
      glucose: 0.26,
      temperature: 0.018,
    },
    gallop: {
      heartRate: 0.5,
      respiration: 0.16,
      lactate: 0.03,
      glucose: 0.45,
      temperature: 0.02,
    },
  },
  "healthy-gallop": {
    walk: {
      heartRate: 0.3,
      respiration: 0.11,
      lactate: 0.02,
      glucose: 0.24,
      temperature: 0.015,
    },
    gallop: {
      heartRate: 1.5,
      respiration: 0.5,
      lactate: 0.08,
      glucose: 0.9,
      temperature: 0.05,
    },
  },
  "mild-stress": {
    walk: {
      heartRate: 0.5,
      respiration: 0.2,
      lactate: 0.05,
      glucose: 0.45,
      temperature: 0.02,
    },
    gallop: {
      heartRate: 3.2,
      respiration: 1.0,
      lactate: 0.15,
      glucose: 1.2,
      temperature: 0.08,
    },
  },
  recovery: {
    walk: {
      heartRate: 0.3,
      respiration: 0.12,
      lactate: 0.025,
      glucose: 0.22,
      temperature: 0.018,
    },
    gallop: {
      heartRate: 0.65,
      respiration: 0.2,
      lactate: 0.04,
      glucose: 0.5,
      temperature: 0.03,
    },
  },
};

const SCENE_TO_MODE: Record<DemoScene, GaitMode> = {
  "healthy-walk": "walk",
  "healthy-gallop": "gallop",
  "mild-stress": "gallop",
  recovery: "walk",
};

const SCENE_STATUS: Record<DemoScene, StatusLevel> = {
  "healthy-walk": "healthy",
  "healthy-gallop": "healthy",
  "mild-stress": "watch",
  recovery: "healthy",
};

const SCENE_SCORE: Record<DemoScene, number> = {
  "healthy-walk": 98,
  "healthy-gallop": 96,
  "mild-stress": 86,
  recovery: 92,
};

const SCENE_SUMMARY = {
  "healthy-walk":
    "Thunderbolt is exhibiting optimal physiological markers. All vital systems are stable within healthy ranges. Stride symmetry and ground contact are excellent.",
  "healthy-gallop":
    "Thunderbolt is performing cleanly under elevated load. Heart rate and respiration have risen into the expected gallop band while contact timing remains symmetrical.",
  "mild-stress":
    "A mild stress signature is developing. Heart rate and lactate are drifting beyond the preferred envelope, while hoof symmetry remains mostly controlled.",
  recovery:
    "Recovery is progressing well. Core metrics are trending back toward baseline and stride balance is settling into a healthier pattern.",
} satisfies Record<DemoScene, string>;

const SCENE_SYMMETRY: Record<DemoScene, number> = {
  "healthy-walk": 99.1,
  "healthy-gallop": 97.8,
  "mild-stress": 92.3,
  recovery: 95.4,
};

const STRIDE_DURATION_MS: Record<GaitMode, number> = {
  walk: 1100,
  gallop: 450,
};

const STRIDE_PHASE_TIME_SCALE = 0.38;

const STRIDE_PHASE_OFFSET: Record<GaitMode, number> = {
  walk: 0.18,
  gallop: 0.16,
};

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const EVENT_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const GAIT_PATTERNS: Record<GaitMode, StridePattern> = {
  walk: {
    LH: { start: 0.0, end: 0.62 },
    LF: { start: 0.25, end: 0.87 },
    RH: { start: 0.5, end: 1.12 },
    RF: { start: 0.75, end: 1.37 },
  },
  gallop: {
    LH: { start: 0.0, end: 0.15 },
    RH: { start: 0.12, end: 0.27 },
    LF: { start: 0.25, end: 0.4 },
    RF: { start: 0.37, end: 0.52 },
  },
};

function midpoint([min, max]: MetricRange) {
  return (min + max) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(current: number, target: number, factor: number) {
  return current + (target - current) * factor;
}

function interpolateRange(start: MetricRange, end: MetricRange, amount: number): MetricRange {
  return [lerp(start[0], end[0], amount), lerp(start[1], end[1], amount)];
}

function formatTimestamp(date: Date) {
  return TIMESTAMP_FORMATTER.format(date);
}

function formatSession(elapsedMs: number) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function addRange(base: MetricRange, adjustment?: MetricRange): MetricRange {
  if (!adjustment) {
    return base;
  }

  return [base[0] + adjustment[0], base[1] + adjustment[1]];
}

function sceneRanges(gaitBlend: number, scene: DemoScene): MetricRanges {
  const adjustment = SCENE_RANGE_ADJUSTMENTS[scene];

  return {
    heartRate: addRange(
      interpolateRange(BASE_RANGES.walk.heartRate, BASE_RANGES.gallop.heartRate, gaitBlend),
      adjustment.heartRate
    ),
    respiration: addRange(
      interpolateRange(BASE_RANGES.walk.respiration, BASE_RANGES.gallop.respiration, gaitBlend),
      adjustment.respiration
    ),
    lactate: addRange(
      interpolateRange(BASE_RANGES.walk.lactate, BASE_RANGES.gallop.lactate, gaitBlend),
      adjustment.lactate
    ),
    glucose: addRange(
      interpolateRange(BASE_RANGES.walk.glucose, BASE_RANGES.gallop.glucose, gaitBlend),
      adjustment.glucose
    ),
    temperature: addRange(
      interpolateRange(BASE_RANGES.walk.temperature, BASE_RANGES.gallop.temperature, gaitBlend),
      adjustment.temperature
    ),
  };
}

function interpolateStridePattern(gaitBlend: number): StridePattern {
  return {
    LF: {
      start: lerp(GAIT_PATTERNS.walk.LF.start, GAIT_PATTERNS.gallop.LF.start, gaitBlend),
      end: lerp(GAIT_PATTERNS.walk.LF.end, GAIT_PATTERNS.gallop.LF.end, gaitBlend),
    },
    RF: {
      start: lerp(GAIT_PATTERNS.walk.RF.start, GAIT_PATTERNS.gallop.RF.start, gaitBlend),
      end: lerp(GAIT_PATTERNS.walk.RF.end, GAIT_PATTERNS.gallop.RF.end, gaitBlend),
    },
    LH: {
      start: lerp(GAIT_PATTERNS.walk.LH.start, GAIT_PATTERNS.gallop.LH.start, gaitBlend),
      end: lerp(GAIT_PATTERNS.walk.LH.end, GAIT_PATTERNS.gallop.LH.end, gaitBlend),
    },
    RH: {
      start: lerp(GAIT_PATTERNS.walk.RH.start, GAIT_PATTERNS.gallop.RH.start, gaitBlend),
      end: lerp(GAIT_PATTERNS.walk.RH.end, GAIT_PATTERNS.gallop.RH.end, gaitBlend),
    },
  };
}

function pushHistory(history: number[], value: number) {
  const next = history.length >= HISTORY_LENGTH ? history.slice(1) : history.slice();
  next.push(value);
  return next;
}

function computeGraphRange(metricKey: MetricKey, history: number[]): MetricRange {
  if (!history.length) {
    return BASE_RANGES.walk[metricKey];
  }

  const historyMin = Math.min(...history);
  const historyMax = Math.max(...history);
  const historySpan = historyMax - historyMin;
  const span = Math.max(historySpan * 1.3, GRAPH_MIN_SPAN[metricKey]);
  const center = (historyMin + historyMax) / 2;

  return [center - span / 2, center + span / 2];
}

function roundToDecimals(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sinusoidalNoise(
  tick: number,
  metricKey: MetricKey,
  gaitBlend: number,
  scene: DemoScene
) {
  const scaledTick = tick * VITAL_TIME_SCALE;
  const amplitude = lerp(
    NOISE_AMPLITUDE[scene].walk[metricKey],
    NOISE_AMPLITUDE[scene].gallop[metricKey],
    gaitBlend
  );
  const metricIndex = METRIC_META.findIndex((metric) => metric.key === metricKey) + 1;
  let base = 0;

  switch (metricKey) {
    case "heartRate":
      base =
        Math.sin(scaledTick * 0.14 + metricIndex * 0.7) * amplitude +
        Math.cos(scaledTick * 0.052 + metricIndex * 1.7) * amplitude * 0.4 +
        Math.sin(scaledTick * 0.33 + metricIndex) * amplitude * 0.14;
      break;
    case "respiration":
      base =
        Math.sin(scaledTick * 0.1 + metricIndex * 0.9) * amplitude * 0.9 +
        Math.cos(scaledTick * 0.038 + metricIndex * 1.5) * amplitude * 0.36;
      break;
    case "lactate":
      base =
        Math.sin(scaledTick * 0.078 + metricIndex * 0.66) * amplitude * 0.58 +
        Math.cos(scaledTick * 0.026 + metricIndex * 1.28) * amplitude * 0.24;
      break;
    case "glucose":
      base =
        Math.sin(scaledTick * 0.115 + metricIndex * 0.82) * amplitude * 0.84 +
        Math.cos(scaledTick * 0.044 + metricIndex * 1.58) * amplitude * 0.42;
      break;
    case "temperature":
      base =
        Math.sin(scaledTick * 0.082 + metricIndex * 0.72) * amplitude * 0.52 +
        Math.cos(scaledTick * 0.024 + metricIndex * 1.18) * amplitude * 0.18;
      break;
  }

  if (scene === "mild-stress" && ["heartRate", "lactate", "temperature"].includes(metricKey)) {
    return base + Math.sin(scaledTick * 0.5 + metricIndex) * amplitude * 0.3;
  }

  return base;
}

function createBaselineMetrics() {
  return METRIC_META.map((metric) => {
    const history = Array.from({ length: HISTORY_LENGTH }, (_, index) => {
      const amplitude = NOISE_AMPLITUDE["healthy-walk"].walk[metric.key];
      const phase = index - HISTORY_LENGTH;
      const seededValue =
        metric.initial +
        Math.sin(phase * 0.32 + (METRIC_META.findIndex((entry) => entry.key === metric.key) + 1) * 0.8) *
          amplitude *
          0.82 +
        Math.cos(phase * 0.11 + (METRIC_META.findIndex((entry) => entry.key === metric.key) + 1) * 1.6) *
          amplitude *
          0.28;

      return roundToDecimals(seededValue, metric.decimals);
    });

    return {
      ...metric,
      value: roundToDecimals(metric.initial, metric.decimals),
      history,
      displayRange: computeGraphRange(metric.key, history),
      status: "healthy" as StatusLevel,
    };
  });
}

function inWrappedWindow(phase: number, start: number, end: number) {
  if (end > 1) {
    return phase >= start || phase <= end - 1;
  }

  return phase >= start && phase <= end;
}

function bellCurveContact(phase: number, start: number, end: number) {
  if (!inWrappedWindow(phase, start, end)) {
    return 0;
  }

  const duration = end > 1 ? end - start : end - start;
  const progress =
    end > 1 && phase < start
      ? (phase + 1 - start) / duration
      : (phase - start) / duration;

  return Math.sin(progress * Math.PI);
}

function getHoofLoads(pattern: StridePattern, phase: number): HoofLoads {
  return {
    LF: bellCurveContact(phase, pattern.LF.start, pattern.LF.end),
    RF: bellCurveContact(phase, pattern.RF.start, pattern.RF.end),
    LH: bellCurveContact(phase, pattern.LH.start, pattern.LH.end),
    RH: bellCurveContact(phase, pattern.RH.start, pattern.RH.end),
  };
}

function metricStatus(
  key: MetricKey,
  value: number,
  ranges: MetricRanges,
  scene: DemoScene,
  gaitBlend: number
): StatusLevel {
  const [min, max] = ranges[key];

  if (scene === "mild-stress" && ["heartRate", "lactate", "temperature"].includes(key)) {
    return "watch";
  }

  if (
    (scene === "healthy-walk" || scene === "healthy-gallop") &&
    gaitBlend > 0.02 &&
    gaitBlend < 0.98
  ) {
    const transitionMin = Math.min(BASE_RANGES.walk[key][0], BASE_RANGES.gallop[key][0]);
    const transitionMax = Math.max(BASE_RANGES.walk[key][1], BASE_RANGES.gallop[key][1]);
    const transitionSpan = transitionMax - transitionMin || 1;

    if (value < transitionMin - transitionSpan * 0.35 || value > transitionMax + transitionSpan * 0.35) {
      return "alert";
    }

    if (value < transitionMin || value > transitionMax) {
      return "watch";
    }

    return "healthy";
  }

  if (value < min - (max - min) * 0.8 || value > max + (max - min) * 0.8) {
    return "alert";
  }

  if (value < min || value > max) {
    return "watch";
  }

  return "healthy";
}

export function useDashboardSimulation(): SimulationState {
  const [mode, setModeState] = useState<GaitMode>("walk");
  const [scene, setSceneState] = useState<DemoScene>("healthy-walk");
  const [metrics, setMetrics] = useState<MetricState[]>(createBaselineMetrics);
  const [events, setEvents] = useState<EventItem[]>([
    {
      id: "baseline",
      timeLabel: "10:01:30",
      kind: "note",
      label: "Baseline established.",
    },
    {
      id: "shift",
      timeLabel: "10:15:00",
      kind: "event",
      label: "Gait Shift: WALK (Keyboard: W)",
    },
    {
      id: "resp",
      timeLabel: "10:32:15",
      kind: "alert",
      label: "Mild Resp Tachycardia (Resolved)",
      severityLabel: "YELLOW",
    },
  ]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [phaseClockMs, setPhaseClockMs] = useState(0);
  const [timestampLabel, setTimestampLabel] = useState(formatTimestamp(new Date()));
  const [muted, setMuted] = useState(true);

  const startedAtRef = useRef(Date.now());
  const tickRef = useRef(0);
  const gaitBlendRef = useRef(0);

  const appendEvent = useCallback((kind: EventKind, label: string, severityLabel?: string) => {
    setEvents((current) =>
      [
        {
          id: `${kind}-${Date.now()}-${label}`,
          timeLabel: EVENT_TIME_FORMATTER.format(new Date()),
          kind,
          label,
          severityLabel,
        },
        ...current,
      ].slice(0, 6)
    );
  }, []);

  const setMode = useCallback(
    (nextMode: GaitMode) => {
      setModeState(nextMode);
      appendEvent(
        "event",
        `Gait Shift: ${nextMode === "walk" ? "WALK" : "GALLOP"} (Keyboard: ${
          nextMode === "walk" ? "W" : "G"
        })`
      );
      setSceneState((current) => {
        if (current === "mild-stress" || current === "recovery") {
          return current;
        }

        return nextMode === "walk" ? "healthy-walk" : "healthy-gallop";
      });
    },
    [appendEvent]
  );

  const setScene = useCallback(
    (nextScene: DemoScene) => {
      setSceneState(nextScene);
      setModeState(SCENE_TO_MODE[nextScene]);
      if (nextScene === "mild-stress") {
        appendEvent("alert", "Stress Signature Escalating", "YELLOW");
      } else if (nextScene === "recovery") {
        appendEvent("event", "Recovery Sequence Initiated");
      } else {
        appendEvent("event", `Demo Scene: ${nextScene.replaceAll("-", " ").toUpperCase()}`);
      }
    },
    [appendEvent]
  );

  const reset = useCallback(() => {
    startedAtRef.current = Date.now();
    tickRef.current = 0;
    gaitBlendRef.current = 0;
    setElapsedMs(0);
    setPhaseClockMs(0);
    setTimestampLabel(formatTimestamp(new Date()));
    setMetrics(createBaselineMetrics());
    setSceneState("healthy-walk");
    setModeState("walk");
    appendEvent("note", "Baseline re-established.");
  }, [appendEvent]);

  const toggleMute = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      setPhaseClockMs(Date.now() - startedAtRef.current);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      tickRef.current += 1;
      const gaitTarget = mode === "gallop" ? 1 : 0;
      const nextGaitBlend = lerp(gaitBlendRef.current, gaitTarget, GAIT_TRANSITION_FACTOR);
      gaitBlendRef.current =
        Math.abs(nextGaitBlend - gaitTarget) < 0.001 ? gaitTarget : nextGaitBlend;
      setElapsedMs(Date.now() - startedAtRef.current);
      setTimestampLabel(formatTimestamp(new Date()));

      setMetrics((currentMetrics) => {
        const ranges = sceneRanges(gaitBlendRef.current, scene);

        return currentMetrics.map((metric) => {
          const target = midpoint(ranges[metric.key]);
          const noise = sinusoidalNoise(tickRef.current, metric.key, gaitBlendRef.current, scene);
          const nextValue = lerp(metric.value, target + noise, EMA_FACTOR);

          const clamped =
            metric.key === "heartRate"
              ? clamp(nextValue, 26, 220)
              : metric.key === "respiration"
                ? clamp(nextValue, 8, 120)
                : metric.key === "lactate"
                  ? clamp(nextValue, 0.4, 8)
                  : metric.key === "glucose"
                  ? clamp(nextValue, 60, 170)
                    : clamp(nextValue, 37.5, 40.6);
          const displayedValue = roundToDecimals(clamped, metric.decimals);
          const nextHistory = pushHistory(metric.history, displayedValue);

          return {
            ...metric,
            value: displayedValue,
            history: nextHistory,
            displayRange: computeGraphRange(metric.key, nextHistory),
            status: metricStatus(metric.key, displayedValue, ranges, scene, gaitBlendRef.current),
          };
        });
      });
    }, UPDATE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [mode, scene]);

  const gaitBlend = gaitBlendRef.current;
  const stridePattern = useMemo(() => interpolateStridePattern(gaitBlend), [gaitBlend]);

  const stridePhase = useMemo(() => {
    const duration = lerp(STRIDE_DURATION_MS.walk, STRIDE_DURATION_MS.gallop, gaitBlend);
    const phaseOffset = lerp(STRIDE_PHASE_OFFSET.walk, STRIDE_PHASE_OFFSET.gallop, gaitBlend);
    const phaseElapsed = phaseClockMs * STRIDE_PHASE_TIME_SCALE;
    return (((phaseElapsed % duration) / duration) + phaseOffset) % 1;
  }, [gaitBlend, phaseClockMs]);

  const hoofLoads = useMemo(() => getHoofLoads(stridePattern, stridePhase), [stridePattern, stridePhase]);

  const symmetryScore = useMemo(() => {
    const base = SCENE_SYMMETRY[scene];
    const drift = Math.sin(elapsedMs * 0.0013) * 0.35;
    return clamp(base + drift, 86, 99.8);
  }, [elapsedMs, scene]);

  const overallScore = useMemo(() => SCENE_SCORE[scene], [scene]);

  const status = useMemo(() => SCENE_STATUS[scene], [scene]);
  const summaryText = useMemo(() => SCENE_SUMMARY[scene], [scene]);

  const strideFrequencyLabel = `${lerp(1.14, 0.45, gaitBlend).toFixed(2)} s/m`;
  const contactSummary = `LF(${lerp(0.2, 0.15, gaitBlend).toFixed(2)}s), RF(${lerp(
    0.21,
    0.15,
    gaitBlend
  ).toFixed(2)}s), LH(${lerp(0.19, 0.15, gaitBlend).toFixed(2)}s), RH(${lerp(
    0.2,
    0.15,
    gaitBlend
  ).toFixed(2)}s)`;

  return {
    mode,
    scene,
    status,
    overallScore,
    sessionLabel: formatSession(elapsedMs),
    timestampLabel,
    metrics,
    hoofLoads,
    stridePhase,
    stridePattern,
    strideFrequencyLabel,
    contactSummary,
    symmetryScore,
    summaryText,
    events,
    profile: {
      name: "Thunderbolt",
      breed: "Thoroughbred",
      age: "6 yr",
    },
    commandsLabel: "W/G/1/2/3/4/R/M",
    muted,
    setMode,
    setScene,
    reset,
    toggleMute,
  };
}
