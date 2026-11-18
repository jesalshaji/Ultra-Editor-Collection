# Effects toolkit (on request only)

The ultra-edit default is a clean, neutral edit. Use the recipes below **only when the user asks for them**
("add zooms", "highlight the button", "show the logos", "animated captions", "make transitions like X") or
when they share a reference that uses them. Never stack them all onto an edit by default, and never apply
one creator's look to another's video.

Tools referenced here come from `connectors/ultra-premiere-mcp` (Premiere) and the scripts in this folder.
Colours always come from the active theme (`ULTRA_THEME`, default `neutral`) or the user's own references.

| The user asks for... | Recipe |
|---|---|
| "zoom in on my screen", "follow my mouse" | [Screen zoom that follows the action](#screen-zoom-that-follows-the-action) |
| "highlight / point out / circle this" | [Editable spotlight](#editable-spotlight) |
| "show the logo", "show the app" | [Real thing first](#real-thing-first), then [Logo and concept cards](#logo-and-concept-cards) |
| "show the article / website" | [Article rebuild](#article-rebuild) |
| "b-roll for this", "show it, don't just say it" | [Relatable b-roll](#relatable-b-roll) |
| "animated captions", "word by word captions" | [Word-by-word captions](#word-by-word-captions) |
| "transitions", "flash", "light burst" | [Transitions](#transitions) |
| "sound effects", "whooshes" | [Sound hits](#sound-hits) |
| "don't show my face so much" | [Face and screen modes](#face-and-screen-modes) |

---

## Real thing first

Before adding any graphic, keyword or logo over a moment, **look at what is on screen at that moment**
(`render_frame`, or pull the source frame with ffmpeg). If the voice is talking about something the screen
recording already shows - a model picker, a web page headline, a settings table, a downloaded file - show
**that**: leave the screen visible, zoom to it, or spotlight it. Do not cover it with a text keyword or a
generated card that says the same thing.

Only when the thing is *not* on screen: use the real asset (official logo, real footage, real page), never a
generic icon, AI-drawn stand-in, or plain words. Text graphics are for ideas, numbers and lists.

## Screen zoom that follows the action

- Rounded crop frame stays fixed; the **whole screen** scales up smoothly and glides to where the action is
  (top of a page when talking about it, a click at the bottom -> glide there). Eased (expo/power out), never linear.
- Don't crop out a small piece as the main zoom. A cut-out "crop + scale + shadow pop" (`screen_zoom`) is an
  occasional accent only.
- Premiere: `screen_follow` (auto action detection from clicks/typing/cursor, or given points).
  Stack order on the clip: Transform BEFORE Rounded Crop. Hold the camera still during a highlight.

## Editable spotlight

Never bake a highlight into one full-frame image - build parts the user can fix in the editor:

| Part | Track | How |
|---|---|---|
| SPOTLIGHT | own track (e.g. V5) | copy of the screen clip with the editor's own Crop + a drop shadow |
| DIM | ZOOM clip | Opacity keyframes (about 45%) while the spotlight is up |
| OUTLINE | graphics track | thin accent rounded rectangle (`theme_graphic` kind `highlight`) |
| LABEL | labels track | small chip naming the thing, draggable |
| marker | timeline | says where each part lives |

Read the exact rectangle from a rendered frame before placing - never guess positions.
Premiere: `add_highlight`.

## Logo and concept cards

`templates/make.py` renders short cards with HyperFrames + GSAP (2-6 s, 1280x720 30 fps by default):

```
python templates/fetch_logos.py                     # once: official SVGs -> templates/logos/ (not in git)
python templates/make.py concept spec.json out.mp4 --dur 4
python templates/make.py article spec.json out.mp4 --dur 5
python templates/make.py chapter '{"n":2,"total":5,"title":"Why *this* works"}' out.mp4
```

Concept spec - 2 to 4 tiles joined by animated arrows; a tile shows a **real logo** with `"logo"`:

```json
{"tag": "Works with", "title": "Hooks into your *editor*",
 "nodes": [{"label": "Premiere", "logo": "premiere"}, {"label": "After Effects", "logo": "aftereffects"},
           {"label": "DaVinci", "logo": "davinci"}, {"label": "Agent", "icon": "spark"}],
 "active": 3}
```

`*word*` in a title = the accent word (italic serif). Logos known to `fetch_logos.py`: premiere, aftereffects,
photoshop, illustrator, davinci; for anything else save the official SVG as `templates/logos/<name>.svg`.
Logos are trademarks - use them only to show the product being talked about.

Theme: `--theme <tokens.json | name>` or `ULTRA_THEME`; `--accent "#hex"` for a single card.

## Article rebuild

Rebuild the page cleanly instead of a raw screenshot: browser card with the real URL, site name, headline,
up to 4 lines; one key line gets a highlighter sweep while the rest dims; slight 3D tilt that settles while
slowly pushing in. Use the real headline and URL - and if the page itself is already in the screen recording
at that moment, show the recording instead (Real thing first).

```json
{"site": "The Verge", "url": "theverge.com/...", "logo": "V", "headline": "...", "lines": ["...", "..."], "highlight": 1}
```

## Relatable b-roll

For real-life actions or places ("doing my laundry", "watching videos"), use real stock footage timed to the
word from the voice transcript - not kinetic text. Premiere: `find_broll` (Mixkit, Wikimedia, Pexels with a
free key) -> pick from the numbered contact sheet -> `use_broll`. Cut on the word; a click on each new cut.

## Word-by-word captions

`captions/build.py` builds ONE transparent caption composition from a word-timed transcript of the clean
voice; render it to a single alpha video. (Hundreds of separate full-frame caption PNGs can exhaust the
editor's RAM on long edits - avoid that.)

```
python captions/build.py words.json out_dir --accent "#hex" --fixes fixes.json
npx hyperframes render out_dir -o captions.mov --fps 30
```

Style: clean white sans, words fade/blur in one by one, one accent phrase per line in italic serif, phrases
break on pauses and punctuation, fillers (uh, um) dropped. `fixes.json` corrects names/brands the
transcriber mishears and lists this video's accent phrases. Captions only on the main moments unless the
user wants them everywhere; never where a text graphic already shows the same words.

## Transitions

`transitions/transitions.py out_dir` writes alpha overlays: put them on a track above the cut, Normal blend,
with the cut on the full-white frame.

| Name | Motion | Use |
|---|---|---|
| White bloom (12 f) | exposure blows out from the centre, full white ~2 f, next scene resolves out of white with blur clearing | head -> full-screen graphic |
| Light-ray burst (14 f) | thin god-rays radiate, 2-3 f white flash, rays fade as the new layout appears | chapter changes, big reveals |
| Focus-pull cut | ~5 f defocus ramp, hard cut to a new framing that refocuses in ~3-4 f | head -> head (hides jump cuts) |
| Motion-blur slide | labels fade first, cards whip off left with horizontal blur, new cards enter staggered ~3 f | graphic -> graphic |
| Blur dissolve | outgoing goes soft and fades over ~8-10 f, incoming fades in sharp | gentle scene changes |

Most cuts stay hard cuts on speech beats; graphics enter with a quick scale/blur-in (0.2-0.3 s).

## Sound hits

- A click on cuts that change the picture; a whoosh/swish on full-screen graphics going in or out and on
  chapter changes, starting just before the cut; a sub boom or impact on big reveals.
- Remove the sound together with its graphic if the graphic is removed.
- Premiere: `add_sound_effects` (lands each file's transient on the frame), `add_sfx_on_cuts`.
  The repo ships no audio: add licensed sounds to `connectors/ultra-premiere-mcp/assets/sfx/<kit>/`.
- Music bed ducked about 12 dB under the voice (`duck_music`).

## Face and screen modes

When the user wants less talking head: face on screen ~40-50% (keep hook, intro, CTA on face); cover the
rest with full-screen articles, concept cards, real stock or screen clips (2-5 s each). In screen-recording
parts switch modes: screen only on clicks/typing, full-screen face when just explaining, cards on idea
lines, screen + small cam bubble otherwise. Mute any webcam audio that duplicates the voice.

## Always (technical, not style)

- Build in named layers (MAIN, BACKDROP, ZOOM, B-ROLL, SPOTLIGHT, GRAPHICS, CAPTIONS, LABELS; VOICE, MUSIC,
  SFX) and name every clip, so each effect can be switched off or fixed alone.
- Separate webcam files rarely start at the same moment as the screen recording, and can drift: measure the
  offset by cross-correlating both audio tracks (early and late windows) before placing webcam clips.
- After placing effects, render a few frames and look at them before calling it done.
