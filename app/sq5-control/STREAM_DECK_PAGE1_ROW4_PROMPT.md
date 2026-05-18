# Prompt: SQ5 Mute Buttons In Companion

Configure Bitfocus Companion for the For You SQ5 bridge.

Context:

- Bridge base URL: `http://127.0.0.1:3105`
- Use HTTP, not OSC.
- Companion should poll `GET /api/streamdeck/state` every 0.5 to 1 second for feedback.
- In the JSON state, `true` means muted and `false` means unmuted.
- Use dynamic feedback so button color/text updates when the SQ-5, website, TouchDesigner, or another controller changes mute state.

Task:

On page 1, row 4, buttons 4 through 8:

```text
Button 4: Brent mute/unmute toggle
Button 5: Megan mute/unmute toggle
Button 6: Booi mute/unmute toggle
Button 7: All mics mute/unmute toggle for Brent + Megan + Booi
Button 8: Main mute/unmute toggle for Main LR
```

Actions:

```text
Button 4 press: POST http://127.0.0.1:3105/api/streamdeck/brent/toggle
Button 5 press: POST http://127.0.0.1:3105/api/streamdeck/megan/toggle
Button 6 press: POST http://127.0.0.1:3105/api/streamdeck/booi/toggle
Button 7 press: POST http://127.0.0.1:3105/api/streamdeck/allmics/toggle
Button 8 press: POST http://127.0.0.1:3105/api/streamdeck/main/toggle
```

Feedback fields from `GET /api/streamdeck/state`:

```text
Button 4 uses JSON field: brent
Button 5 uses JSON field: megan
Button 6 uses JSON field: booi
Button 7 uses JSON fields: allMics and allMicsMixed
Button 8 uses JSON field: main
```

Feedback styling:

```text
If muted is true:
  text: MUTED
  background: red
  foreground: white

If muted is false:
  text: ON
  background: dark green or dark grey
  foreground: white

For Button 7 only:
  if allMicsMixed is true:
    text: MIXED
    background: amber/orange
    foreground: black
```

Suggested labels:

```text
Button 4: BRENT
Button 5: MEGAN
Button 6: BOOI
Button 7: ALL MICS
Button 8: MAIN
```

Verification:

1. Press each button once and confirm the SQ-5 mute state changes.
2. Change mute state from the SQ-5 or SQ5 web page.
3. Confirm the Companion button feedback updates within about 1 second.
4. For Button 7, mute only one of Brent/Megan/Booi and confirm the button shows MIXED.
