# Virality
_BY JEVEN RANDHAWA_

# [See it in action](https://jevendev.github.io/Virality/)
<img width="1080" height="720" alt="image" src="https://github.com/user-attachments/assets/aaeeec02-6d6f-43b9-a2ba-f54d353f5d9f"/>

### ABOUT
Virality is a browser-based tool for editing and exporting audio with the **slowed + reverb** and **nightcore** effects. No installs, no fees, just drag a file in and start tweaking.

*  Preview audio instantly in the browser
*  Adjust speed, reverb mix, and reverb decay live
*  Apply built-in presets (Default, Slowed + Reverb, Nightcore) or create your own
*  Export to WAV or MP3 (single file or batch ZIP)
*  Custom waveform visualization with scrubbing + hover preview

---

### WHY DID YOU MAKE THIS ???
I got tired of sites that paywalled the basic feature of batch downloading more than 1 file. I wanted a simple, self-contained tool that didn’t require DAWs, plug-ins, or sketchy mobile apps. I’m a designer first, but I love music production and often experiment with slowed/nightcore edits. This project gave me a way to combine design + coding into something I can actually use.

---

### FEATURES
* **Drag & Drop**: Add single files or whole folders (with folder walk support)
* **Live Playback**: Scrub, hover preview, and global play/pause
* **Presets**: Default, Slowed + Reverb, Nightcore
* **Custom Presets**: Save your own sliders locally (Alt+Click to delete)
* **Export**: WAV (fast) or MP3 (with selectable bitrate), plus batch ZIP download
* **Waveform**: Lightweight bar-style visualization drawn on `<canvas>`

---

### TECHNICAL DETAILS
* **Core:** Vanilla JavaScript (modularized)
* **Audio:** Web Audio API + custom convolver reverb
* **Export:** OfflineAudioContext rendering + [JSZip](https://stuk.github.io/jszip/) + [lamejs](https://github.com/zhuker/lamejs)
* **Storage:** LocalStorage for user presets
* **Design:** Clean CSS grid layout with dark theme

---

### DESIGN NOTES
* **Font:** System UI stack
* **Colors:** Custom dark theme (black/grey panels, muted text, accent waveform)
* **UI:** Sticky top bar, bottom drop-pill, modular panels

---

### DISCLAIMER
All processing happens locally in your browser. Nothing is uploaded.
