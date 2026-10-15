# ModDeck clickable prototype

Hi-fi screens from the MD-15 design canvas, wrapped in a player so they can be clicked through like the real app.

## Run

The screens load their runtime with `fetch`, so open the folder through a local web server, not `file://`:

```sh
npx http-server docs/ux/prototype -p 5179 -c-1
```

Open http://localhost:5179.

## Use

- **▶ Student** starts at S01 Enter PIN. **▶ Host** starts at H00 sign-in.
- Every button, link, tab, switch and option responds. It goes to the matching screen, changes state (switches flip, tabs and options select, rows hide), or shows a short confirmation.
- Tabs and slide thumbnails select and show a "ตัวอย่าง: …" message where the content is not mocked yet.
- Disabled buttons say why they can't be pressed yet. Clicking behind an open dialog tells you to finish the dialog first.
- Screens with no buttons (projector, leaderboards, mirror overlay) advance on click. Loading and reconnecting screens move on by themselves.
- Clicking a dead area flashes the hotspots. Press `H` to keep them visible.
- `←` / `→` step through screens in the current group. `Alt+←` goes back.
- `P` hides the chrome for presenting. `F` toggles fullscreen. `Esc` leaves presentation mode.
- The URL hash holds the current screen, so `#H05-Presenter.dc.html` deep-links to it.

## Demo paths

- Student: PIN > identity > nickname > waiting > Live Poll > answer sent > results > Word Cloud > cloud results > session ended. The Q&A tab opens S13 from any activity screen.
- Host: sign in > My decks > open INT365 บทที่ 4 > session settings > start session > pre-flight > presenter (close voting, show results, next) > Q&A > end session > results > download ZIP.

## Files

- `index.html` is the player.
- `wiring.js` maps every control the canvas left unlinked to a screen, state change or toast. Edit `RULES`, `TAP` and `AUTO` there to change where things go.
- `screens/*.dc.html` are the canvas artboards. Clickable elements carry `data-hot` for the hotspot overlay.
- `screens/support.js` is the Design Component runtime copied from the canvas.
