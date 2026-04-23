import {
  useCallback,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { interpolateRgbBasis } from "d3-interpolate";
import { scaleSequential } from "d3-scale";
import horseGallopLoopVideo from "../Horse_Gallop_Loop.mp4";
import horseGallopStartVideo from "../Horse_Gallop_Start.mp4";
import horseGallopToWalkVideo from "../Horse_Gallop_To_Walk.mp4";
import horseWalkLoopVideo from "../Horse_Treadmill_Animation_Generated_noaudio.mp4";
import {
  type EventItem,
  type GaitMode,
  type HoofLoads,
  type HoofPressures,
  type MetricState,
  type PhysiologyProfile,
  type StatusLevel,
  type StridePattern,
  type StrideWindow,
  useDashboardSimulation,
} from "./simulation";

const STATUS_LABELS: Record<StatusLevel, string> = {
  healthy: "HEALTHY",
  watch: "WATCH",
  alert: "ALERT",
};

const METRIC_STATUS_LABELS: Record<StatusLevel, string> = {
  healthy: "STABLE",
  watch: "WATCH",
  alert: "ALERT",
};

const PROFILE_SHORTCUTS: Record<string, PhysiologyProfile> = {
  "1": "healthy-walk",
  "2": "healthy-gallop",
  "3": "mild-stress",
  "4": "recovery",
};

const GAIT_KEY_SHORTCUTS: Record<string, GaitMode> = {
  w: "walk",
  "ㅈ": "walk",
  g: "gallop",
  "ㅎ": "gallop",
};

const GAIT_CODE_SHORTCUTS: Record<string, GaitMode> = {
  KeyW: "walk",
  KeyG: "gallop",
};

const HOOF_ORDER: Array<keyof HoofLoads> = ["LF", "RF", "LH", "RH"];
const HORSE_VIDEO_LAYERS = [0, 1] as const;
const VISIBLE_ALERT_LOG_ROWS = 8;
const VIDEO_SWAP_SETTLE_MS = 48;

type HorseClip = "walk-loop" | "walk-to-gallop" | "gallop-loop" | "gallop-to-walk";
type HorseVideoLayerIndex = (typeof HORSE_VIDEO_LAYERS)[number];
type HorseVideoLayer = {
  clip: HorseClip;
  src: string;
  token: number;
};
type DeviceIconName = "battery" | "bluetooth" | "girth" | "hoof";
type FullscreenHostElement = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

const DEVICE_STATUS_ITEMS: Array<{
  id: string;
  battery: number;
  detail: string;
  icon: DeviceIconName;
  label: string;
}> = [
  {
    id: "girth",
    battery: 84,
    detail: "Core strap",
    icon: "girth",
    label: "Girth Band",
  },
  {
    id: "hoof",
    battery: 73,
    detail: "LF RF LH RH",
    icon: "hoof",
    label: "Hoof Pods",
  },
];

function getNextHorseClip(clip: HorseClip, targetMode: GaitMode): HorseClip | null {
  if (clip === "walk-loop") {
    return targetMode === "gallop" ? "walk-to-gallop" : null;
  }

  if (clip === "walk-to-gallop") {
    return targetMode === "gallop" ? "gallop-loop" : "walk-loop";
  }

  if (clip === "gallop-loop") {
    return targetMode === "walk" ? "gallop-to-walk" : null;
  }

  return targetMode === "walk" ? "walk-loop" : "gallop-loop";
}

function shouldLoopHorseClip(clip: HorseClip, targetMode: GaitMode) {
  return (
    (clip === "walk-loop" && targetMode === "walk") ||
    (clip === "gallop-loop" && targetMode === "gallop")
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

async function toggleFullscreen(element: FullscreenHostElement | null) {
  if (!element) {
    return;
  }

  const fullscreenDocument = document as FullscreenDocument;
  const fullscreenElement =
    fullscreenDocument.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;

  try {
    if (fullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (fullscreenDocument.webkitExitFullscreen) {
        await fullscreenDocument.webkitExitFullscreen();
      }
      return;
    }

    if (element.requestFullscreen) {
      try {
        await element.requestFullscreen({ navigationUI: "hide" });
      } catch {
        await element.requestFullscreen();
      }
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    }
  } catch {
    // Ignore transient browser gesture or fullscreen API failures.
  }
}

type PressureBlob = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  weight: number;
};

type HoofAccentShape =
  | { kind: "path"; d: string; weight: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; weight: number };

const pressureColorScale = scaleSequential(
  interpolateRgbBasis(["#071221", "#0f3549", "#26c7da", "#dffcff"])
).domain([0, 1]);

const HOOF_OUTLINE_PATH =
  "M60 8 C78 8 92 18 99 39 C106 63 102 109 85 135 C77 145 68 149 60 151 C52 149 43 145 35 135 C18 109 14 63 21 39 C28 18 42 8 60 8 Z";
const HOOF_CLIP_PATH =
  "M60 16 C75 16 87 26 93 44 C99 66 94 105 80 127 C73 136 66 140 60 142 C54 140 47 136 40 127 C26 105 21 66 27 44 C33 26 45 16 60 16 Z";
const HOOF_FROG_PATH =
  "M60 60 C69 74 72 92 69 118 C64 126 56 126 51 118 C48 92 51 74 60 60 Z";

const HOOF_BLOB_LAYOUTS: Record<keyof HoofLoads, PressureBlob[]> = {
  LF: [
    { x: 58, y: 46, rx: 21, ry: 24, weight: 0.36 },
    { x: 48, y: 88, rx: 12, ry: 15, weight: 0.72 },
    { x: 39, y: 41, rx: 6, ry: 10, weight: 0.26 },
    { x: 66, y: 68, rx: 10, ry: 15, weight: 0.22 },
  ],
  RF: [
    { x: 60, y: 41, rx: 26, ry: 29, weight: 0.96 },
    { x: 47, y: 68, rx: 14, ry: 19, weight: 0.7 },
    { x: 75, y: 70, rx: 16, ry: 19, weight: 0.76 },
    { x: 60, y: 88, rx: 16, ry: 18, weight: 0.34 },
  ],
  LH: [
    { x: 60, y: 43, rx: 26, ry: 30, weight: 0.98 },
    { x: 45, y: 73, rx: 14, ry: 18, weight: 0.68 },
    { x: 72, y: 64, rx: 15, ry: 18, weight: 0.62 },
    { x: 57, y: 88, rx: 16, ry: 18, weight: 0.32 },
  ],
  RH: [
    { x: 44, y: 43, rx: 11, ry: 17, weight: 0.52 },
    { x: 75, y: 40, rx: 10, ry: 13, weight: 0.38 },
    { x: 42, y: 84, rx: 12, ry: 14, weight: 0.7 },
    { x: 74, y: 81, rx: 10, ry: 13, weight: 0.64 },
  ],
};

const HOOF_ACCENT_SHAPES: Record<keyof HoofLoads, HoofAccentShape[]> = {
  LF: [
    { kind: "path", d: "M36 38 C43 25 74 24 84 41 C81 58 72 77 61 91 C48 79 40 60 36 38 Z", weight: 0.22 },
    { kind: "ellipse", cx: 47, cy: 89, rx: 11, ry: 14, weight: 0.74 },
    { kind: "ellipse", cx: 39, cy: 40, rx: 4, ry: 9, weight: 0.22 },
  ],
  RF: [
    { kind: "path", d: "M32 35 C41 20 79 21 89 39 C86 63 75 83 60 97 C46 82 35 61 32 35 Z", weight: 1.02 },
    { kind: "path", d: "M40 50 C46 40 72 41 80 52 C77 69 69 82 60 89 C52 82 44 69 40 50 Z", weight: 0.78 },
    { kind: "ellipse", cx: 48, cy: 73, rx: 11, ry: 13, weight: 0.66 },
    { kind: "ellipse", cx: 73, cy: 69, rx: 12, ry: 15, weight: 0.64 },
  ],
  LH: [
    { kind: "path", d: "M34 34 C43 18 80 19 88 38 C85 62 75 84 60 99 C45 84 36 61 34 34 Z", weight: 1.08 },
    { kind: "ellipse", cx: 60, cy: 52, rx: 14, ry: 16, weight: 0.8 },
    { kind: "path", d: "M42 53 C48 43 71 44 77 55 C73 69 65 82 59 88 C53 82 46 69 42 53 Z", weight: 0.74 },
    { kind: "ellipse", cx: 45, cy: 77, rx: 10, ry: 13, weight: 0.58 },
  ],
  RH: [
    { kind: "ellipse", cx: 44, cy: 45, rx: 11, ry: 17, weight: 0.6 },
    { kind: "ellipse", cx: 76, cy: 40, rx: 9, ry: 13, weight: 0.42 },
    { kind: "ellipse", cx: 43, cy: 84, rx: 12, ry: 14, weight: 0.74 },
    { kind: "ellipse", cx: 75, cy: 81, rx: 10, ry: 13, weight: 0.68 },
  ],
};

const MAX_HOOF_PRESSURE_KPA = 360;

const INTEGER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const ONE_DECIMAL_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatNumber(value: number, decimals: number) {
  return decimals === 0
    ? INTEGER_FORMATTER.format(value)
    : ONE_DECIMAL_FORMATTER.format(value);
}

function App() {
  const simulation = useDashboardSimulation();
  const deferredMetrics = useDeferredValue(simulation.metrics);
  const { reset, setMode, setPhysiologyProfile, toggleMute } = simulation;
  const dashboardFullscreenRef = useRef<FullscreenHostElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.isComposing ||
        isEditableTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const gaitShortcut = GAIT_CODE_SHORTCUTS[event.code] ?? GAIT_KEY_SHORTCUTS[key];

      if (gaitShortcut) {
        startTransition(() => setMode(gaitShortcut));
      } else if (key in PROFILE_SHORTCUTS) {
        startTransition(() => setPhysiologyProfile(PROFILE_SHORTCUTS[key]));
      } else if (key === "r") {
        startTransition(() => reset());
      } else if (key === "m") {
        toggleMute();
      } else if ((event.code === "KeyF" || key === "f") && !event.repeat) {
        event.preventDefault();
        void toggleFullscreen(dashboardFullscreenRef.current);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reset, setMode, setPhysiologyProfile, toggleMute]);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="dashboard-frame" ref={dashboardFullscreenRef}>
        <TopBar
          mode={simulation.mode}
          muted={simulation.muted}
          profile={simulation.profile}
          status={simulation.status}
          timestampLabel={simulation.timestampLabel}
        />

        <div className="panel-grid">
          <HorsePanel
            gallopLoopSrc={horseGallopLoopVideo}
            gallopToWalkSrc={horseGallopToWalkVideo}
            mode={simulation.mode}
            status={simulation.status}
            walkLoopSrc={horseWalkLoopVideo}
            walkToGallopSrc={horseGallopStartVideo}
          />

          <VitalsPanel
            metrics={deferredMetrics}
            mode={simulation.mode}
          />

          <HoofForcePanel
            hoofPressures={simulation.hoofPressures}
            gaitBlend={simulation.gaitBlend}
            strideFrequencyLabel={simulation.strideFrequencyLabel}
            symmetryScore={simulation.symmetryScore}
            contactSummary={simulation.contactSummary}
            stridePhase={simulation.stridePhase}
            stridePattern={simulation.stridePattern}
            mode={simulation.mode}
          />

          <AlertPanel
            events={simulation.events}
            overallScore={simulation.overallScore}
            status={simulation.status}
            summaryText={simulation.summaryText}
          />
        </div>
      </section>
    </main>
  );
}

function TopBar({
  mode,
  muted,
  profile,
  status,
  timestampLabel,
}: {
  mode: GaitMode;
  muted: boolean;
  profile: {
    name: string;
    breed: string;
    age: string;
  };
  status: StatusLevel;
  timestampLabel: string;
}) {
  return (
    <header className="topbar panel">
      <div className="topbar-copy">
        <p className="eyebrow">Vetter Prototype Dashboard</p>
        <div className="topbar-title-row">
          <h1>Equine Health Monitor</h1>
          <StatusPill status={status} />
        </div>
      </div>

      <div className="topbar-profile panel inset-panel">
        <div>
          <p className="micro-label">Horse</p>
          <p className="profile-line">
            <span translate="no">{profile.name}</span> /{" "}
            <span translate="no">{profile.breed}</span> / {profile.age}
          </p>
        </div>
      </div>

      <div className="topbar-meta">
        <p>{timestampLabel}</p>
        <div className="wordmark" translate="no">
          <span className="wordmark-mark" aria-hidden="true" />
          <div>
            <p>Vetter</p>
            <p className="muted-line">{mode.toUpperCase()} DEMO</p>
          </div>
        </div>
      </div>
    </header>
  );
}

function StatusPill({ status }: { status: StatusLevel }) {
  return (
    <div className={`status-pill status-pill--${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </div>
  );
}

function HorsePanel({
  gallopLoopSrc,
  gallopToWalkSrc,
  mode,
  status,
  walkLoopSrc,
  walkToGallopSrc,
}: {
  gallopLoopSrc: string;
  gallopToWalkSrc: string;
  mode: GaitMode;
  status: StatusLevel;
  walkLoopSrc: string;
  walkToGallopSrc: string;
}) {
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const [activeClip, setActiveClip] = useState<HorseClip>("walk-loop");
  const [activeLayer, setActiveLayer] = useState<HorseVideoLayerIndex>(0);
  const [pendingSwitch, setPendingSwitch] = useState<{
    clip: HorseClip;
    layer: HorseVideoLayerIndex;
    token: number;
  } | null>(null);
  const [videoLayers, setVideoLayers] = useState<[HorseVideoLayer, HorseVideoLayer]>(() => [
    { clip: "walk-loop", src: walkLoopSrc, token: 0 },
    { clip: "walk-loop", src: walkLoopSrc, token: 1 },
  ]);
  const activeClipRef = useRef(activeClip);
  const activeLayerRef = useRef(activeLayer);
  const modeRef = useRef(mode);
  const switchTokenRef = useRef(2);

  const clipSources = useMemo<Record<HorseClip, string>>(
    () => ({
      "gallop-loop": gallopLoopSrc,
      "gallop-to-walk": gallopToWalkSrc,
      "walk-loop": walkLoopSrc,
      "walk-to-gallop": walkToGallopSrc,
    }),
    [gallopLoopSrc, gallopToWalkSrc, walkLoopSrc, walkToGallopSrc]
  );

  useEffect(() => {
    activeClipRef.current = activeClip;
  }, [activeClip]);

  useEffect(() => {
    activeLayerRef.current = activeLayer;
  }, [activeLayer]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const activeVideo = videoRefs.current[activeLayer];

    if (activeVideo) {
      void activeVideo.play().catch(() => {});
    }
  }, [activeClip, activeLayer]);

  const prepareClipSwitch = useCallback((clip: HorseClip) => {
    const nextLayer = activeLayerRef.current === 0 ? 1 : 0;
    const token = switchTokenRef.current;
    switchTokenRef.current += 1;

    setVideoLayers((currentLayers) => {
      const nextLayers: [HorseVideoLayer, HorseVideoLayer] = [...currentLayers];
      nextLayers[nextLayer] = {
        clip,
        src: clipSources[clip],
        token,
      };
      return nextLayers;
    });
    setPendingSwitch({ clip, layer: nextLayer, token });
  }, [clipSources]);

  useEffect(() => {
    if (!pendingSwitch) {
      return;
    }

    const incomingLayer = videoLayers[pendingSwitch.layer];
    const incomingVideo = videoRefs.current[pendingSwitch.layer];
    const outgoingVideo = videoRefs.current[activeLayerRef.current];

    if (!incomingVideo || incomingLayer.token !== pendingSwitch.token) {
      return;
    }

    let cancelled = false;
    let revealed = false;
    const revealIncomingVideo = () => {
      if (cancelled || revealed) {
        return;
      }

      revealed = true;
      incomingVideo.loop = shouldLoopHorseClip(pendingSwitch.clip, modeRef.current);
      void incomingVideo.play().catch(() => {});
      setActiveLayer(pendingSwitch.layer);
      setActiveClip(pendingSwitch.clip);
      setPendingSwitch(null);

      window.setTimeout(() => {
        if (outgoingVideo) {
          outgoingVideo.pause();
        }
      }, VIDEO_SWAP_SETTLE_MS);
    };

    const handleReady = () => revealIncomingVideo();

    incomingVideo.pause();
    incomingVideo.currentTime = 0;
    incomingVideo.load();

    if (incomingVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      revealIncomingVideo();
    } else {
      incomingVideo.addEventListener("loadeddata", handleReady, { once: true });
      incomingVideo.addEventListener("canplay", handleReady, { once: true });
    }

    return () => {
      cancelled = true;
      incomingVideo.removeEventListener("loadeddata", handleReady);
      incomingVideo.removeEventListener("canplay", handleReady);
    };
  }, [pendingSwitch, videoLayers]);

  const handleVideoEnded = useCallback((layer: HorseVideoLayerIndex) => {
    if (layer !== activeLayerRef.current || pendingSwitch) {
      return;
    }

    const nextClip = getNextHorseClip(activeClipRef.current, modeRef.current);

    if (nextClip) {
      prepareClipSwitch(nextClip);
    }
  }, [pendingSwitch, prepareClipSwitch]);

  return (
    <section className="panel horse-panel">
      <div className="panel-heading">
        <h2>3D Horse Simulation</h2>
      </div>

      <div className="horse-panel-content">
        <div className="horse-sidebar">
          <DeviceStatusCard />
          <StatCard
            label="Current Gait"
            value={mode === "walk" ? "Walk" : "Gallop"}
            accent={status === "healthy" ? "green" : "amber"}
          />
        </div>

        <div className="horse-video-frame">
          <div className="horse-video-shell">
            {HORSE_VIDEO_LAYERS.map((layer) => {
              const videoLayer = videoLayers[layer];
              const isActive = layer === activeLayer;

              return (
                <video
                  aria-hidden={!isActive}
                  autoPlay={isActive}
                  className={`horse-video ${isActive ? "horse-video--active" : "horse-video--buffer"}`}
                  key={layer}
                  loop={isActive && shouldLoopHorseClip(videoLayer.clip, mode)}
                  muted
                  onEnded={() => handleVideoEnded(layer)}
                  playsInline
                  preload="auto"
                  ref={(element) => {
                    videoRefs.current[layer] = element;
                  }}
                  src={videoLayer.src}
                />
              );
            })}
            <div className="horse-grid-overlay" />
            <div className="horse-vignette" />
          </div>
        </div>
      </div>
    </section>
  );
}

function DeviceStatusCard() {
  return (
    <div className="device-status-card inset-panel">
      <div className="device-status-heading">
        <span className="micro-label">Device Status</span>
        <span className="device-link-pill">
          <StatusIcon name="bluetooth" />
          Linked
        </span>
      </div>

      <div className="device-status-list">
        {DEVICE_STATUS_ITEMS.map((item) => (
          <div className="device-row" key={item.id}>
            <span className="device-row-icon" aria-hidden="true">
              <StatusIcon name={item.icon} />
            </span>

            <div className="device-row-body">
              <div className="device-row-title">
                <span>{item.label}</span>
                <span className="device-chip">
                  <StatusIcon name="battery" />
                  {item.battery}%
                </span>
              </div>

              <div className="device-row-meta">
                <span>{item.detail}</span>
                <span className="device-chip device-chip--ble">
                  <StatusIcon name="bluetooth" />
                  BLE
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ name }: { name: DeviceIconName }) {
  if (name === "battery") {
    return (
      <svg className="status-icon" aria-hidden="true" viewBox="0 0 20 20">
        <rect x="2.5" y="6" width="13" height="8" rx="2" />
        <path d="M16.5 8.2 h1.4 v3.6 h-1.4" />
        <rect className="status-icon-fill" x="4.4" y="7.9" width="8.4" height="4.2" rx="1.1" />
      </svg>
    );
  }

  if (name === "bluetooth") {
    return (
      <svg className="status-icon" aria-hidden="true" viewBox="0 0 20 20">
        <path d="M9 2.8 l5 4.2 -4 3 4 3 -5 4.2 V2.8 Z" />
        <path d="M5.2 6.1 l8.4 7.8" />
        <path d="M5.2 13.9 l8.4 -7.8" />
      </svg>
    );
  }

  if (name === "girth") {
    return (
      <svg className="status-icon status-icon--device" aria-hidden="true" viewBox="0 0 20 20">
        <path d="M4.1 10.2 C4.1 5.8 7 3.4 10 3.4 c3 0 5.9 2.4 5.9 6.8" />
        <path d="M5.5 10.2 c0 3.2 2 5.5 4.5 5.5 s4.5 -2.3 4.5 -5.5" />
        <path d="M7.6 9.8 h4.8" />
        <path d="M8.8 12.1 h2.4" />
      </svg>
    );
  }

  return (
    <svg className="status-icon status-icon--device" aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 2.8 C13.2 2.8 15.7 5.1 16.2 8.7 c0.5 3.4 -0.8 6.5 -3.6 8.1 -1.7 1 -3.5 1 -5.2 0 -2.8 -1.6 -4.1 -4.7 -3.6 -8.1 C4.3 5.1 6.8 2.8 10 2.8 Z" />
      <path d="M7.5 10.5 c-0.4 2 0.2 3.4 2.5 4.1 2.3 -0.7 2.9 -2.1 2.5 -4.1" />
      <path d="M10 7.2 v5.1" />
    </svg>
  );
}

function StatCard({
  accent,
  label,
  suffix,
  value,
}: {
  accent: "cyan" | "green" | "amber" | "blue";
  label: string;
  suffix?: React.ReactNode;
  value: string;
}) {
  return (
    <div className="stat-card inset-panel">
      <span className="micro-label">{label}</span>
      <div className={`stat-card-value stat-card-value--${accent}`}>
        <span>{value}</span>
        {suffix}
      </div>
    </div>
  );
}

function VitalsPanel({
  metrics,
  mode,
}: {
  metrics: MetricState[];
  mode: GaitMode;
}) {
  return (
    <section className="panel vitals-panel">
      <div className="panel-heading panel-heading--spread">
        <h2>Physiological Console</h2>
        <span className="panel-hint">Presentation Mode Active</span>
      </div>

      <div className="metric-list">
        {metrics.map((metric) => (
          <MetricRow
            key={metric.key}
            metric={metric}
          />
        ))}
      </div>

      <div className="vitals-footer">
        <span>Mode: {mode.toUpperCase()}</span>
        <span>Continuous telemetry</span>
      </div>
    </section>
  );
}

function MetricRow({ metric }: { metric: MetricState }) {
  return (
    <div className="metric-row">
      <div className="metric-meta">
        <span className="micro-label">{metric.label}</span>
        <div className="metric-value">
          {formatNumber(metric.value, metric.decimals)}
          <small>{metric.shortUnit ?? metric.unit}</small>
        </div>
      </div>

      <SparklineChart
        color={metric.color}
        metricKey={metric.key}
        points={metric.history}
        range={metric.displayRange}
        status={metric.status}
      />

      <div className={`mini-status mini-status--${metric.status}`}>
        {METRIC_STATUS_LABELS[metric.status]}
      </div>
    </div>
  );
}

function SparklineChart({
  color,
  metricKey,
  points,
  range,
  status,
}: {
  color: string;
  metricKey: MetricState["key"];
  points: number[];
  range: [number, number];
  status: StatusLevel;
}) {
  const { linePath } = useMemo(
    () => buildSparklineGeometry(points, range),
    [points, range]
  );

  return (
    <svg
      className={`sparkline sparkline--${status}`}
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeOpacity="0.96"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HoofForcePanel({
  contactSummary,
  gaitBlend,
  hoofPressures,
  mode,
  strideFrequencyLabel,
  stridePhase,
  stridePattern,
  symmetryScore,
}: {
  contactSummary: string;
  gaitBlend: number;
  hoofPressures: HoofPressures;
  mode: GaitMode;
  strideFrequencyLabel: string;
  stridePhase: number;
  stridePattern: StridePattern;
  symmetryScore: number;
}) {
  return (
    <section className="panel hoof-panel">
      <div className="hoof-visuals">
        <div className="panel-heading">
          <h2>Hoof Force Map</h2>
        </div>

        <div className="hoof-map">
          {HOOF_ORDER.map((hoof) => (
            <div className="hoof-node" key={hoof}>
              <HoofGlyph
                label={hoof}
                pressureKpa={hoofPressures[hoof]}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="stride-summary">
        <div className="panel-heading">
          <h2>Stride Analytics Summary</h2>
        </div>

        <dl className="stride-details">
          <div>
            <dt>Hoof Symmetry Score</dt>
            <dd>{ONE_DECIMAL_FORMATTER.format(symmetryScore)}%</dd>
          </div>
          <div>
            <dt>Stride Frequency</dt>
            <dd>{strideFrequencyLabel}</dd>
          </div>
          <div>
            <dt>Ground Contact Time</dt>
            <dd>{contactSummary}</dd>
          </div>
        </dl>

        <StridePhaseTimeline
          gaitBlend={gaitBlend}
          mode={mode}
          stridePhase={stridePhase}
          stridePattern={stridePattern}
        />
      </div>
    </section>
  );
}

function StridePhaseTimeline({
  gaitBlend,
  mode,
  stridePhase,
  stridePattern,
}: {
  gaitBlend: number;
  mode: GaitMode;
  stridePhase: number;
  stridePattern: StridePattern;
}) {
  return (
    <div className="phase-timeline">
      <div className="phase-timeline__header">
        <span>Stride Phase</span>
        <span>{mode.toUpperCase()} · {Math.round(stridePhase * 100)}%</span>
      </div>

      <div className="phase-timeline__body">
        <div className="phase-timeline__playhead-column" aria-hidden="true">
          <div
            className="phase-timeline__playhead"
            style={{ left: `${stridePhase * 100}%` }}
          />
        </div>

        {HOOF_ORDER.map((hoof) => {
          const window = stridePattern[hoof];
          const segments = buildStrideDisplaySegments(window, gaitBlend);
          const active = isStrideWindowActive(window, stridePhase);
          const continuationReveal = getStrideContinuationReveal(gaitBlend);

          return (
            <div
              className={`phase-lane${active ? " phase-lane--active" : ""}`}
              key={hoof}
            >
              <span className="phase-lane__label">{hoof}</span>
              <div className="phase-lane__rail">
                {segments.map((segment, index) => (
                  <span
                    className={`phase-lane__window${
                      segment.kind === "continuation" ? " phase-lane__window--continuation" : ""
                    }${
                      active && segment.kind === "primary"
                        ? " phase-lane__window--active"
                        : ""
                    }`}
                    key={`${hoof}-${segment.kind}-${index}-${segment.start}-${segment.end}`}
                    style={{
                      left: `${segment.start * 100}%`,
                      width: `${Math.max(2, (segment.end - segment.start) * 100)}%`,
                      opacity:
                        segment.kind === "continuation"
                          ? continuationReveal * 0.52
                          : undefined,
                      transform:
                        segment.kind === "continuation"
                          ? `scaleX(${continuationReveal})`
                          : undefined,
                      transformOrigin:
                        segment.kind === "continuation"
                          ? mode === "walk"
                            ? "right center"
                            : "left center"
                          : undefined,
                    }}
                  />
                ))}
                {active ? (
                  <span
                    className="phase-lane__marker"
                    style={{ left: `${stridePhase * 100}%` }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildStrideDisplaySegments(window: StrideWindow, gaitBlend: number) {
  const primarySegments = expandStrideSegments(window).map((segment) => ({
    ...segment,
    kind: "primary" as const,
  }));

  if (gaitBlend < 0.02) {
    return primarySegments;
  }

  const duration = window.end - window.start;
  const continuationSegments = expandStrideSegments({
    start: window.start + 0.5,
    end: window.start + 0.5 + duration,
  })
    .map((segment) => ({
      start: Math.max(0.5, segment.start),
      end: segment.end,
      kind: "continuation" as const,
    }))
    .filter((segment) => segment.end > segment.start && segment.end > 0.5);

  return [...primarySegments, ...continuationSegments];
}

function getStrideContinuationReveal(gaitBlend: number) {
  return Math.min(1, Math.max(0, (gaitBlend - 0.08) / 0.72));
}

function expandStrideSegments(window: StrideWindow) {
  const normalizedStart = normalizePhase(window.start);
  const duration = window.end - window.start;

  if (duration <= 0) {
    return [{ start: 0, end: 1 }];
  }

  const firstEnd = Math.min(1, normalizedStart + duration);
  const segments = [{ start: normalizedStart, end: firstEnd }];

  if (normalizedStart + duration > 1) {
    segments.push({ start: 0, end: normalizedStart + duration - 1 });
  }

  return segments;
}

function normalizePhase(value: number) {
  return ((value % 1) + 1) % 1;
}

function isStrideWindowActive(window: StrideWindow, stridePhase: number) {
  return expandStrideSegments(window).some(
    (segment) => stridePhase >= segment.start && stridePhase <= segment.end
  );
}

function HoofGlyph({
  label,
  pressureKpa,
}: {
  label: keyof HoofLoads;
  pressureKpa: number;
}) {
  const blobLayouts = HOOF_BLOB_LAYOUTS[label];
  const accentShapes = HOOF_ACCENT_SHAPES[label];
  const idBase = `hoof-${label.toLowerCase()}`;
  const visibleIntensity = Math.max(0, Math.min(1, pressureKpa / MAX_HOOF_PRESSURE_KPA));
  const glowIntensity =
    visibleIntensity <= 0 ? 0 : Math.min(1, Math.pow(visibleIntensity, 0.72) * 1.18);
  const coreColor = pressureColorScale(Math.max(0.18, glowIntensity));
  const midColor = pressureColorScale(Math.max(0.14, glowIntensity * 0.9));
  const auraColor = pressureColorScale(Math.max(0.1, glowIntensity * 0.72));
  const outerGlowOpacity = glowIntensity <= 0 ? 0 : 0.08 + glowIntensity * 0.28;
  const blobs = blobLayouts.map((blob, index) => {
    const blobValue = Math.min(1, glowIntensity * blob.weight);
    return {
      ...blob,
      id: `${idBase}-grad-${index}`,
      value: blobValue,
      rx: blob.rx + glowIntensity * 8,
      ry: blob.ry + glowIntensity * 9,
      opacity: blobValue <= 0 ? 0 : 0.18 + blobValue * 0.98,
    };
  });
  const renderedAccentShapes = accentShapes.map((shape, index) => ({
    ...shape,
    id: `${idBase}-accent-${index}`,
    opacity: glowIntensity * shape.weight * 0.96,
  }));

  return (
    <div className="hoof-glyph-wrap">
      <svg className="hoof-glyph" viewBox="0 0 120 152">
        <defs>
          <clipPath id={`${idBase}-clip`}>
            <path d={HOOF_CLIP_PATH} />
          </clipPath>
          <filter id={`${idBase}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={6 + glowIntensity * 8} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`${idBase}-outer`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={12 + glowIntensity * 10} />
          </filter>
          {blobs.map((blob) => (
            <radialGradient id={blob.id} cx="50%" cy="50%" key={blob.id} r="65%">
              <stop
                offset="0%"
                stopColor={pressureColorScale(Math.min(1, blob.value + 0.2))}
                stopOpacity={1}
              />
              <stop
                offset="58%"
                stopColor={pressureColorScale(Math.max(0.12, blob.value * 0.96))}
                stopOpacity={Math.min(1, blob.opacity)}
              />
              <stop
                offset="100%"
                stopColor={pressureColorScale(Math.max(0.08, blob.value * 0.58))}
                stopOpacity="0"
              />
            </radialGradient>
          ))}
        </defs>
        <ellipse
          cx="60"
          cy="64"
          fill={auraColor}
          filter={`url(#${idBase}-outer)`}
          opacity={outerGlowOpacity}
          rx={32 + glowIntensity * 18}
          ry={46 + glowIntensity * 20}
        />
        <path
          d={HOOF_OUTLINE_PATH}
          fill="rgba(7, 16, 30, 0.88)"
          stroke="rgba(192, 230, 255, 0.56)"
          strokeWidth="2"
        />
        <path d={HOOF_CLIP_PATH} fill="rgba(13, 28, 44, 0.82)" />
        <g clipPath={`url(#${idBase}-clip)`}>
          <ellipse
            cx="60"
            cy="49"
            fill={midColor}
            opacity={glowIntensity * 0.28}
            rx="24"
            ry="34"
          />
          <g filter={`url(#${idBase}-glow)`}>
            {blobs.map((blob) => (
              <ellipse
                className="hoof-blob"
                cx={blob.x}
                cy={blob.y}
                fill={`url(#${blob.id})`}
                key={blob.id}
                opacity={blob.opacity}
                rx={blob.rx}
                ry={blob.ry}
              />
            ))}
            {renderedAccentShapes.map((shape) =>
              shape.kind === "path" ? (
                <path
                  className="hoof-accent"
                  d={shape.d}
                  fill={coreColor}
                  key={shape.id}
                  opacity={shape.opacity}
                />
              ) : (
                <ellipse
                  className="hoof-accent"
                  cx={shape.cx}
                  cy={shape.cy}
                  fill={coreColor}
                  key={shape.id}
                  opacity={shape.opacity}
                  rx={shape.rx}
                  ry={shape.ry}
                />
              )
            )}
          </g>
        </g>
        <path d={HOOF_CLIP_PATH} fill="none" stroke="rgba(115, 190, 215, 0.32)" strokeWidth="1.35" />
        <path d={HOOF_FROG_PATH} fill="rgba(5, 12, 22, 0.76)" stroke="rgba(118, 165, 182, 0.22)" strokeWidth="1.2" />
        <path
          d="M45 82 C45 100 42 118 36 130"
          fill="none"
          stroke="rgba(6, 13, 24, 0.92)"
          strokeLinecap="round"
          strokeWidth="9"
        />
        <path
          d="M75 82 C75 100 78 118 84 130"
          fill="none"
          stroke="rgba(6, 13, 24, 0.92)"
          strokeLinecap="round"
          strokeWidth="9"
        />
        <path
          d="M60 18 C76 18 87 30 90 48"
          fill="none"
          opacity={glowIntensity * 0.58}
          stroke={coreColor}
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </svg>
      <span className="hoof-label">{label}</span>
      <span className="hoof-pressure">
        {INTEGER_FORMATTER.format(pressureKpa)} <small>kPa</small>
      </span>
    </div>
  );
}

function AlertPanel({
  events,
  overallScore,
  status,
  summaryText,
}: {
  events: EventItem[];
  overallScore: number;
  status: StatusLevel;
  summaryText: string;
}) {
  const summaryLines = summaryText
    .split(". ")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => (line.endsWith(".") ? line : `${line}.`));

  return (
    <section className="panel alert-panel">
      <div className="panel-heading">
        <h2>Alert Log &amp; Status</h2>
      </div>

      <div className="alert-top">
        <div className={`score-card score-card--${status}`}>
          <span className="micro-label">Overall Physiological Score:</span>
          <div className="score-card__value">
            <strong>{overallScore}</strong>
            <span>/ 100</span>
          </div>
        </div>

        <div className="summary-card inset-panel">
          <span className="micro-label">AI Summary</span>
          <div className="summary-card__copy">
            {summaryLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="alert-log inset-panel">
        <span className="micro-label">Alert Log (History)</span>
        <div className="alert-log__items">
          {events.slice(0, VISIBLE_ALERT_LOG_ROWS).map((event) => (
            <AlertRow event={event} key={event.id} />
          ))}
        </div>
      </div>
    </section>
  );
}

function AlertRow({ event }: { event: EventItem }) {
  return (
    <div className="alert-row">
      <span className="alert-time">{event.timeLabel}</span>
      <span className="alert-divider">-</span>
      <span className={`severity severity--${event.kind}`}>
        {event.kind.toUpperCase()}
      </span>
      <span className="alert-divider">-</span>
      <span className="alert-label">{event.label}</span>
      {event.severityLabel ? (
        <>
          <span className="alert-divider">-</span>
          <span className="alert-tail">
            SEVERITY: <strong>{event.severityLabel}</strong>
          </span>
        </>
      ) : null}
    </div>
  );
}

function buildSparklineGeometry(points: number[], displayRange: [number, number]) {
  if (!points.length) {
    return { linePath: "" };
  }

  const displaySpan = displayRange[1] - displayRange[0] || 1;
  const min = displayRange[0] - displaySpan * 0.1;
  const max = displayRange[1] + displaySpan * 0.1;
  const span = max - min || 1;

  const coordinates = points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * 100;
    const normalized = Math.min(1, Math.max(0, (point - min) / span));
    const y = 84 - normalized * 56;
    return {
      x,
      y,
    };
  });

  if (coordinates.length === 1) {
    const single = coordinates[0];
    return {
      linePath: `M ${single.x.toFixed(2)} ${single.y.toFixed(2)}`,
    };
  }

  let linePath = `M ${coordinates[0].x.toFixed(2)} ${coordinates[0].y.toFixed(2)}`;

  for (let index = 1; index < coordinates.length; index += 1) {
    const current = coordinates[index];
    linePath += ` L ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
  }

  return {
    linePath,
  };
}

export default App;
