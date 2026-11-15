# Sound

Goal: the audio pass, done the way the user's style profile says (music style and level, effects, loudness). If the profile is silent, ask.

## Voice (technical, every edit)
- Put the clean voice on its own track in frame-accurate sync. Measure the sync from the sound (waveform match against the camera or screen-recording audio, e.g. the connector's `add_voice` / `sync_audio`), never from file names or guesses. If the match is weak, stop and tell the user.
- Cut the voice into the same pieces as the main video.
- Mute the video's own audio if it would double the voice.
- Captions are made from a transcript of this same voice file.

## Music
- Only music the user has a licence for. Write the track, source and any required credit line in `log.md`.
- Level and ducking under the voice: from the profile (e.g. `duck_music` with the user's numbers).
- Mute the bed while a clip with its own soundtrack plays, so two tracks never clash - tell the user where.

## Effects
- Which effects, where and how loud: from the profile. Effects need a licence too.

## Loudness
Normalize to the profile's target. ffmpeg example:
`ffmpeg -i in.mp4 -af loudnorm=I=<target>:TP=-1:LRA=11 -c:v copy out.mp4`

## Optional voice lines
If a text-to-speech tool is connected and the user wants generated lines, place them on their own track and tell the user which lines are synthetic.

Return at most 5 lines.
