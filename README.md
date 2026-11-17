# LLM 3D sphere tests

Experiments comparing how large language models handle the same front-end task: a Three.js "image sphere" gallery. Each folder holds the output of one model, named after the model and version that produced it.

| Folder                          | Model                              |
| :------------------------------ | :--------------------------------- |
| `gemini_2.5_pro_preview_05-06/` | Gemini 2.5 Pro (preview, 05-06)    |

## What the demo does

- Fetches 1,000 photo URLs from the [Lorem Picsum](https://picsum.photos) API and maps a 150 px thumbnail of each onto a plane.
- Spreads the planes evenly over a sphere with a golden-ratio (Fibonacci) distribution, then plays a staggered intro animation.
- Lets you rotate and zoom the sphere with the mouse (Three.js `OrbitControls`, with damping).
- Clicking a photo brings it to the front, dims the sphere and fades in an 800 px version. Clicking the photo again sends it back.

It is plain HTML and JavaScript (ES modules). Three.js 0.160.0 loads from the unpkg CDN through an import map, so there is no install or build step.

## Requirements

- A modern browser with WebGL and import map support (current Chrome, Edge, Firefox or Safari)
- An internet connection (Three.js comes from unpkg and the photos from picsum.photos)
- Node.js 18 or newer, only to run a local static server with `npx`

## Run

The page uses ES modules, so open it through a local web server rather than as a `file://` URL. Serve the model's folder directly:

```bash
npx serve gemini_2.5_pro_preview_05-06
```

Then open the URL it prints (by default `http://localhost:3000`). Any static server works, for example `python3 -m http.server` run from inside the folder.

Serving the repository root with `npx serve .` and opening the folder shows a file listing instead of the page. Serving the folder itself avoids that.
