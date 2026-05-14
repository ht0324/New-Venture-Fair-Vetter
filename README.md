# New Venture Fair Vetter

<p align="center">
  <a href="./media/new-venture-fair-vetter-demo.mp4">
    <img src="./media/new-venture-fair-vetter-demo-poster.jpg" alt="New Venture Fair Vetter demo" width="900">
  </a>
</p>

<p align="center">
  <a href="./media/new-venture-fair-vetter-demo.mp4">Open the demo video</a>
</p>

New Venture Fair Vetter is a polished React/Vite dashboard prototype built for the UCSB 2026 New Venture Fair. The demo presents Vetter as a live equine monitoring system: a horse-motion centerpiece, simulated vitals, hoof pressure maps, sensor status, operator controls, and alert narration designed to read clearly on a fair display.

The [New Venture Fair event page](https://innovation.ucsb.edu/events/2026-new-venture-fair) listed the 2026 fair for April 23, 2026 at 5:00 PM in Corwin Pavilion, presented by Technology Management.

## Demo Media

The demo video and poster image are kept in `media/` so the project preview works directly from the repository.

## Run Locally

```sh
npm install
npm run dev
```

Build the production bundle with:

```sh
npm run build
```

## Demo Controls

- `W`: switch to walk mode
- `G`: switch to gallop mode
- `1`: healthy walk profile
- `2`: healthy gallop profile
- `3`: mild stress profile
- `4`: recovery profile
- `F`: toggle fullscreen

## Project Notes

- The dashboard is intentionally a web app for fast fair-floor iteration and kiosk-style presentation.
- The simulation is local and deterministic enough for a controlled demo; it is not connected to live hardware.
- Horse motion assets are tracked in the repository so the app can run without external media hosting.
