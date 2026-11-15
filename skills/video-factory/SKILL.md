---
name: video-factory
description: Turn raw recordings, long YouTube videos and podcasts into finished videos and Instagram Reels, driving Adobe Premiere Pro and After Effects (plus ffmpeg, Whisper and Remotion/HyperFrames). It ships with no built-in editing style - it learns each user's style, script and plan preferences from their reference videos and feedback and stores them in a style profile. A small agent team - Researcher, Editor, Motion Designer, Sound, Designer, Copywriter, Reviewer, Manager - picks moments, cuts, adds motion, mixes, makes reel versions, writes copy, reviews, exports and schedules Instagram posts behind an approval gate. Use whenever the user wants to edit, cut, caption or finish a video in Premiere or After Effects, repurpose long videos into reels/shorts, teach the assistant their editing style, or run a short-form content pipeline, even if they do not say "skill".
---

# Video Factory

A pipeline for two kinds of job:

- **Edit** - finish one video (16:9 or 9:16) in Premiere, with motion pieces from After Effects or Remotion/HyperFrames.
- **Reels** - turn long videos or podcasts into a batch of Instagram Reels, then schedule and post them.

**This skill has no style of its own.** How the user likes to cut, zoom, caption, highlight, animate, mix, write hooks and plan a video lives in their **style profile**, which the skill builds by learning from the user (see `references/style-training.md`). Never fill gaps with your own taste: if the profile does not say, ask, or offer 2-3 options and let the user choose - then save the answer.

## Style profile

- Location: `style-profile.md` in the user's chosen folder (default `~/.video-factory/style-profile.md`; one per brand or channel if they have several). Template: `references/style-profile-template.md`.
- Read it at the start of every job. Every role follows it.
- It grows through training: reference videos, past edits, and the user's feedback ("zooms too fast", "I like this caption"). Each rule records where it came from.
- Ask before changing an existing rule. Never write tokens, passwords or private data into it.

## The team

| # | Role | Job | Reads | Writes |
|---|------|-----|-------|--------|
| 0 | Trainer | Learns the user's style from references and feedback | `references/style-training.md` | `style-profile.md` |
| 1 | Researcher | Finds the moments worth using, b-roll and facts | `references/researcher.md` | `01_research.json` |
| 2 | Editor | Builds the edit in Premiere | `references/editor.md` | `02_edit/`, `edit_plan.json` |
| 3 | Motion Designer | Animated shots in After Effects or Remotion/HyperFrames | `references/motion.md` | `02_edit/motion/` |
| 4 | Sound | Voice sync, music, effects, loudness | `references/sound.md` | entries in `edit_plan.json` |
| 5 | Designer | The reel versions and covers | `references/designer.md` | `03_versions/` |
| 6 | Copywriter | Hooks, captions, titles, hashtags | `references/copywriter.md` | `04_copy.json` |
| 7 | Reviewer | Checks the result against the profile | `references/reviewer.md` | notes in `log.md` |
| 8 | Manager | Runs the pipeline, schedules, posts, routes changes | `references/manager.md` | `05_schedule.json`, `log.md` |

Read only the reference file for the role you are playing right now, plus the style profile.

If subagents are available, run each role as its own agent and pass **file paths, never file contents or transcripts**. A small fast model is enough for Researcher and Sound; use a mid model for Editor, Copywriter, Reviewer, Manager and Trainer, and the strongest model for Motion Designer. Start agents in parallel when they do not depend on each other.

## Workflow

```
(first time) Trainer builds the style profile
Intake -> Researcher -> (user picks) -> Plan -> (user OK) -> Editor + Motion + Sound -> Reviewer -> fixes
       -> [Edit job] export -> done
       -> [Reels job] Designer -> Copywriter -> Manager -> (user approves) -> post
Any feedback along the way -> Trainer updates the profile (after asking)
```

1. **Profile.** Load the style profile. If there is none, offer a short training session first (a few minutes with 1-3 reference videos). The user may skip it; then ask about style as each decision comes up.
2. **Intake.** Ask once, only what you cannot infer: source files or links, job type, format, target length, music and its licence, and for reels: how many, posting days, timezone, language.
3. **Tool check.** Discover which tools this session really has (see Tools). Never invent tool names.
4. **Selects.** Transcribe, then the Researcher ranks moments using the user's own idea of a good moment (from the profile). Show a table; the user picks.
5. **Plan.** Write `edit_plan.json` in the structure the user prefers (profile). Show a short summary and wait for OK.
6. **Build, review, fix.** Max 2 fix rounds, then report what is left.
7. **Finish.** Edit job: export, give the path. Reels job: versions, copy, review sheet, and wait for "approved" before scheduling or posting.

## Hand-off contract

```
jobs/<yyyy-mm-dd>_<slug>/
  01_research.json
  02_edit/ (edit_plan.json, transcript.json, captions.srt, master.mp4, motion/, broll/)
  03_versions/ (one file per version, covers/)
  04_copy.json
  05_schedule.json
  log.md
```

`edit_plan.json` is the single source of truth for the cut. Every change goes into the plan first, then only the affected parts are rebuilt. All times come from word-level timestamps, never guesses.

## Tools

Discover what is connected before the first run and map it to roles. If something is missing, say so and use the fallback.

| Need | Preferred | Fallback |
|------|-----------|----------|
| Premiere timeline | A Premiere MCP connector (for example tools like `premiere_status`, `get_sequence`, `build_selects`, `remove_silence`, `render_frame`, `review_sequence`, `export_video`) | ffmpeg-only edit, told to the user |
| After Effects | An After Effects MCP connector (for example `create-composition`, `run-script`, `setLayerKeyframe`, `setLayerExpression`, `apply-effect`, `get-results`, `run-bridge-test`) | Remotion or HyperFrames |
| Transcript with word times | Whisper (local) or the connector's transcribe tool | YouTube transcript |
| Download | `yt-dlp` (own content or content you have rights to) | user supplies the file |
| Cutting, reframing, burned-in captions | ffmpeg | - |
| Batch / templated motion | Remotion or HyperFrames | After Effects |
| Posting | Instagram Graph API (`references/manager.md`) | user posts by hand |

Use only the tool names the session really lists; the names above are examples.

## Hard rules

- **No built-in style.** Every creative choice comes from the style profile or the user. If neither says, ask.
- **Rights.** Own content: fine. Someone else's footage: say it risks copyright claims and takedowns; recommend permission, creators who allow clipping, or heavy transformation with credit (credit alone does not make it legal). Music, stock and sound effects need a licence that allows the use. Record each decision in `log.md`.
- **Approval gates.** The user picks the moments, approves the plan, and approves before any post or schedule.
- **Never edit the user's original sequence or project.** Build new sequences.
- **Fixable edits.** Keep each kind of element (cuts, zooms, b-roll, graphics, captions, music, sfx) on its own named track or clip so the user can switch it off or fix it - unless the user's profile says otherwise.
- **Voice sync is measured, never guessed.** Captions come from a transcript of the same voice.
- **Platform specs** (not style): Reels are 9:16 1080x1920, H.264/AAC, and keep text out of the top ~250 px and bottom ~420 px. Check current platform limits if unsure.
- **Be honest.** Weak moments, failed tools and fixes that did not work get reported, not hidden.
- **Changes.** Find the owning role, update its file, re-run only what comes after it. If the change is a taste preference, offer to save it to the profile.

## Change-request routing

| User says | Owner | Re-run after |
|-----------|-------|--------------|
| "cut earlier/later", "remove that part" | Editor | Designer, Copywriter (if the hook changed) |
| "different zoom / caption / highlight" | Editor (+ Trainer if it is a lasting preference) | Designer |
| "change the title / card / animation" | Motion Designer | Editor, Designer |
| "music too loud", "different song" | Sound | Designer |
| "change a version's look" | Designer | none |
| "better hook / caption" | Copywriter | none |
| "post at a different time" | Manager | none |
| "different clip entirely" | Researcher | all |
| "always do it like this", "I don't like X" | Trainer | whatever the rule affects |

## Output at the end of each run

- Edit job: output path, length, tracks used, what failed or was skipped, and any new preferences saved to the profile.
- Reels job: a review sheet per reel - cover, hook, caption, versions, scheduled time, risk flags - then ask for approval.
