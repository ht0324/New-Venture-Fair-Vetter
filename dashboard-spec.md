# Dashboard Prototype Dashboard Spec

## Purpose

Build a fair-demo dashboard that makes the horse-monitoring technology feel believable, premium, and easy to understand at a glance.

This is not a clinical product in v1. It is a controlled demo experience that should:

- look impressive on a large display
- respond immediately to operator input
- show "under the hood" telemetry in a way that feels plausible
- let us swap visual assets and tuning rules quickly before the fair
- make the horse panel feel like the visual centerpiece
- create one synchronized "wow" moment when all panels react together

## Product Direction

### Recommendation

Build this first as a **web app**, not a Swift app.

### Why Web First

- Fastest path to a polished demo
- Easy fullscreen or kiosk mode on any laptop
- No install friction for collaborators
- Best fit for layered UI, video, charts, and timed simulation logic
- Easy to later wrap into a desktop shell if needed

### Why Not Swift First

- Better if we needed deep macOS integration, native menus, device APIs, or App Store packaging
- Slower for rapid visual iteration
- Harder to hand off to web-first designers or frontend collaborators
- Less flexible for later reuse on the web, tablets, or touch displays

### Packaging Path

If the demo becomes a product, we can keep the web dashboard and later:

- package it with Electron or Tauri for desktop delivery
- connect it to live sensors or a backend stream

## Recommended Stack

### Core App

- **React + TypeScript + Vite**
- Reason: fast local iteration, clean component model, easy media handling, easy fullscreen deployment

### Styling

- Plain CSS modules or Tailwind are both viable
- Recommendation: **plain CSS with design tokens**
- Reason: the UI is heavily custom and should not feel template-driven

### State and Simulation

- Lightweight global store such as **Zustand**
- A small simulation engine module outside the UI
- Reason: the renderer should not own the demo logic

### Charts

- **Apache ECharts** as the first choice
- Alternative: **uPlot** if we later need extremely high-frequency chart rendering
- Recommendation: ECharts first, because we want polish, stacked mini-panels, and easy animated updates

### Animation and Motion

- CSS transitions and small custom animation helpers for most UI motion
- Optional: **Motion** for panel transitions if we want smoother view-state changes

### Media

- Native HTML **`<video>`** for the horse motion panel
- PNG or SVG overlays for sensor nodes, glow points, and panel chrome

### Position on Horse Rendering

For this project, the horse should stay a **looped video panel**.

We are intentionally not designing around a future real-time 3D renderer right now.

## High-Level Architecture

### Rule

The simulation state should live in a dedicated logic layer.

The UI should only render:

- current horse motion state
- current vitals
- current hoof contact and pressure
- derived alert summaries
- selected demo scene

### Main Modules

1. **Simulation Engine**
   - owns time, gait mode, stride phase, hoof contact, derived vitals, alert score, and scripted demo scenes
2. **Dashboard Layout**
   - owns screen composition and panel placement
3. **Horse Motion Panel**
   - owns the current looped video and visual overlays
4. **Physiological Console**
   - owns time-series chart rendering
5. **Hoof Force Map**
   - owns the four hoof pressure displays
6. **Alert and Summary Panel**
   - owns the score, event log, and AI narration text
7. **Operator Controls**
   - owns keyboard or hidden control panel for switching between modes

## Feature Specs

## 1. Horse Motion Panel

### Goal

Create the illusion of a sophisticated biomechanical monitoring scene without needing true 3D.

### Recommended v1 Approach

Use **two looped horse videos**:

- `walk`
- `gallop`

The app switches between them based on operator command.

### Why This Is Better Than Real 3D For v1

- Faster to ship
- Easier to make beautiful
- No rigging, animation blending, or performance headaches
- More controllable for a fair demo

### Behavior

- Default mode starts in `walk`
- Operator can toggle to `gallop`
- Transition should crossfade or quick-dissolve rather than hard cut
- Overlay sensor-node glows should remain synchronized with the active motion mode
- The panel should feel like a treadmill lab or diagnostic bay, not just a raw video player

### Scene Framing

- Keep the horse panel as the visual centerpiece of the screen
- Use a dark lab-like frame with subtle floor or treadmill cues
- Add glow markers at the sensor locations so viewers immediately understand where sensing happens
- Avoid visible playback controls or anything that makes it feel like a normal video embed

### Visual Construction

- Background video layer
- Sensor highlight overlay
- UI badge overlay for active gait
- Optional treadmill glow or floor FX overlay
- Optional header details such as sensor count and current gait

### Asset Requirements

- One looping `walk` video
- One looping `gallop` video
- Poster frame or still fallback image
- Transparent sensor-node artwork if we want extra glow beyond what is baked into the video

## 2. Physiological Console

### Goal

Show real-time telemetry that feels scientific, active, and stable.

### Metrics

- heart rate
- respiration
- lactate
- glucose
- temperature

### Recommended Visual Pattern

Use **stacked mini time-series panels**, not one combined chart.

Reason:

- easier to read in a demo setting
- each metric can keep its own scale
- visually closer to the mockup image

### Data Model

Each metric should have:

- current value
- status label such as `stable`, `watch`, or `alert`
- short rolling history window

### Recommended Update Rules

- simulation clock ticks continuously
- metric values update every simulation step
- chart window shows a recent rolling time range
- subtle drift and noise make it feel live
- monitoring continues even in calmer scenes so the dashboard never feels frozen

### Simulation Style

Do not make the vitals purely random.

Instead, each metric should be:

- anchored to a base range per gait mode
- influenced by recent gait state
- smoothed so the line feels plausible
- lightly noisy so it looks alive

### Example Direction

- walk: lower heart rate and respiration
- gallop: higher heart rate and respiration
- lactate climbs more slowly than heart rate
- temperature changes slowly
- glucose shifts modestly unless we intentionally dramatize it

### Display Ideas Worth Keeping

- one mini-panel per metric
- current value shown prominently beside each chart
- status chip per metric such as `stable`, `watch`, or `alert`
- optional tiny live indicator if we want more broadcast-monitor energy

### Recommended Library

- **Apache ECharts**

### Why ECharts

- strong animated updates
- easy sparkline-like panels
- good tooltip and axis control
- good styling for a premium dashboard look

## 3. Hoof Force Map

### Goal

Show hoof-ground contact and pressure in a way that syncs with the horse motion state.

### Display Shape

Four hoof panels:

- LF
- RF
- LH
- RH

Each hoof should brighten and intensify as load increases.

The layout should be top-down and anatomically readable from across the room.

### Recommended v1 Approach

Use a **deterministic gait-cycle model**, not physics simulation.

Each gait mode owns a repeating cycle from `0.0` to `1.0`.

For each hoof, we define:

- contact window
- peak-load timing
- fade-in and fade-out curve

### Why This Is Right For v1

- predictable
- easy to tune
- synchronizes well with video playback
- believable without needing a full biomechanics engine

### Pressure Rendering

Each hoof image should be built from layered visuals:

- hoof outline
- base fill
- pressure glow
- hot-spot bloom

The pressure value can drive:

- fill brightness
- color intensity
- blur radius
- outer glow

### Visual Direction

Do not render this as a classic red thermal map by default.

Instead, match the look of your mockup:

- base palette in teal, cyan, and aqua
- stronger load shown as brighter, denser glow
- peak contact can push toward white-cyan rather than orange-red
- faint body connector lines can tie the four hooves together for context

### Gait Logic Direction

Start with codified rule sets for each motion mode:

- `walk`
- `gallop`

The exact contact timing should be stored as editable config, not buried in rendering code.

That gives us two ways to improve later:

- calibrate by eye to match the horse video
- replace timing curves with research-backed gait data later

### Important Note

We should not over-promise biomechanical truth in v1.

This panel should be described internally as **demo-grade visualized load logic**, not validated force-plate analytics.

## 4. Alert Log and Physiological Score

### Goal

Give viewers a fast summary that says whether the horse is doing well.

### Components

- overall score from 0 to 100
- current alert level
- short event history
- narration summary text
- fixed horse profile such as `Thunderbolt / Thoroughbred / 6 yr`
- current gait and session duration

### Recommended Logic

The score should be derived from:

- vitals being inside target bands
- gait symmetry
- smoothness of hoof contact timing
- absence of simulated alert events

### Narration Style

The summary should read like an AI interpretation layer:

- concise
- slightly technical
- reassuring in healthy mode

### Demo Control

We should be able to trigger:

- healthy baseline
- healthy gallop
- mild stress
- recovery

That will make the booth demo more interactive.

### Meaning Layer Direction

This panel should feel like the place where the system explains itself.

The raw charts and hoof loads are interesting, but this panel should answer:

- Is the horse okay right now?
- What changed?
- Why should the viewer care?

## 5. Operator Interaction

### Goal

Allow us to control the demo live without showing ugly controls to viewers.

### Recommended Controls

- `W` for walk
- `G` for gallop
- optional keys for scene presets
- optional key for resetting the simulation timeline

### UI Strategy

- show subtle keyboard hints in the panel
- keep advanced controls hidden behind a dev overlay

### Recommended Presets

- `healthy-walk`
- `healthy-gallop`
- `mild-stress`
- `recovery`

These are better than tying the whole demo to a single disease story.

## Data and State Model

### Core State

- `mode`: walk or gallop
- `clock`: elapsed demo time
- `stridePhase`: repeating normalized cycle
- `scene`: active demo preset
- `hoofLoad`: LF, RF, LH, RH values from 0 to 1
- `metrics`: current physiological values and rolling histories
- `status`: healthy, warning, alert
- `score`: overall physiological score
- `events`: alert log entries
- `profile`: horse identity shown in the UI

### Derived State

- hoof symmetry score
- contact duration summary
- narration text
- chart color states

## Simulation Strategy

### Recommended Philosophy

Treat the entire demo as a **state-driven illusion engine**.

That means:

- the operator changes the horse mode
- or the operator changes the demo scene
- the mode drives the stride cycle
- the stride cycle drives hoof pressure
- the mode and scene influence vitals
- vitals and symmetry generate the summary and alerts

This gives us one coherent source of truth.

## Borrowed Ideas We Are Keeping

- The horse panel should be the attention magnet
- All four quadrants should react together when the operator changes state
- The hoof panel should be anatomically arranged and immediately readable
- The alert panel should act as the "meaning layer" instead of just another data block
- Hidden operator controls are better than visible public controls for the fair

## Ideas We Are Explicitly Dropping

- Real-time 3D horse rendering for v1
- Orbit camera or any interaction that depends on a 3D scene
- Trot, canter, and idle as required launch states
- A disease-specific demo tied only to colic
- A default red-orange thermal hoof style that conflicts with your mockup

## Accuracy Strategy

### v1

- visually plausible
- internally consistent
- tunable by hand

### v2

- add literature-backed gait timing
- add recorded telemetry traces
- add a richer model-driven ruleset

## Web vs Swift Decision Summary

### Choose Web App Now

- best for this fair demo
- fastest iteration loop
- easiest media integration
- easiest fullscreen deployment

### Consider Swift Later Only If

- we need a polished macOS-only launcher
- we need local hardware integration
- we need a native kiosk shell

## Proposed Build Phases

### Phase 0

- finalize spec
- collect design assets
- choose exact color system and typography
- decide the final four demo presets

### Phase 1

- build static dashboard layout
- place placeholder media and panel shells
- place fixed horse profile, timestamp, and top-bar information

### Phase 2

- implement simulation engine
- wire gait mode and scene presets to vitals and hoof loads

### Phase 3

- implement chart rendering
- implement hoof heatmap intensity logic

### Phase 4

- add alert states, narration, and operator presets
- tune healthy and stress scenes so the fair storytelling feels intentional

### Phase 5

- polish transitions
- tune values to feel believable on a big screen

## Open Questions Before Implementation

- Do we want the horse panel to look like a true treadmill lab scene or a more abstract holographic scene?
- Do we want the sensor-node glows baked into the video or rendered as overlay graphics?
- Do we want the fair demo to stay in healthy mode most of the time, or do we want a scripted walkthrough of the presets?
- Do we want the hoof visuals to stay purely turquoise/cyan, or should peak contact briefly push toward white?
- Do we want the chart panel to show real numeric units at all times, or sometimes prioritize visual cleanliness over realism?
- Do we want a small live indicator in the vitals panel, or should it stay more clinical and restrained?

## Final Recommendation

Build this as a **single-screen React web app** with:

- a looped horse **video** for motion
- a deterministic **simulation engine** for gait, scene presets, hoof contact, and derived vitals
- **ECharts** for real-time telemetry panels
- layered SVG or PNG **hoof heatmaps**
- a fixed-profile alert panel that explains what the telemetry means

This gives us the best mix of speed, polish, and controllability.
