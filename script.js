let player;
let pitchShift = new Tone.PitchShift();
let reverb = new Tone.Reverb({ decay: 3, preDelay: 0.2 });
let isPlaying = false;
let duration = 0;
let waveformImage = null;
let isSeeking = false;
let startTime = 0;
let startOffset = 0;
let wasMuted = false;

(async () => {
    await reverb.generate();
})();

// buttons and sliders
const dropzone = document.getElementById('dropzone');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const speedSlider = document.getElementById('speedSlider');
const pitchSlider = document.getElementById('pitchSlider');
const reverbSlider = document.getElementById('reverbSlider');

// button presets
const slowedPreset = document.getElementById('slowedPreset');
const nightcorePreset = document.getElementById('nightcorePreset');
const defaultPreset = document.getElementById('defaultPreset');

// slider values
const speedValue = document.getElementById('speedValue');
const pitchValue = document.getElementById('pitchValue');
const reverbValue = document.getElementById('reverbValue');

const nowPlaying = document.getElementById('nowPlaying');
const progressBar = document.getElementById('progressBar');
const currentTimeDisplay = document.getElementById('currentTime');
const totalTimeDisplay = document.getElementById('totalTime');
const hoverTime = document.getElementById('hoverTime');

const canvas = document.getElementById('waveformCanvas');
const ctx = canvas.getContext('2d');

// draw and save static waveform as image
function drawStaticWaveform(buffer) {
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    for (let i = 0; i < canvas.width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
        }
        ctx.moveTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.strokeStyle = '#3f51b5';
    ctx.lineWidth = 1;
    ctx.stroke();

    waveformImage = new Image();
    waveformImage.src = canvas.toDataURL();
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

// update progress bar and timestamps while playing
function updateProgressOverlay() {
    if (player && isPlaying && duration > 0 && !isSeeking) {
        const elapsed = Tone.now() - startTime;
        const currentTime = startOffset + elapsed;
        const progressPercent = (currentTime / duration) * 100;
        progressBar.value = progressPercent;

        // update timestamps
        currentTimeDisplay.textContent = formatTime(currentTime);
    }
    requestAnimationFrame(updateProgressOverlay);
}

// drag & drop handlers
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.background = "#333";
});

dropzone.addEventListener('dragleave', () => {
    dropzone.style.background = "#1e1e1e";
});

dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.style.background = "#1e1e1e";

    const file = e.dataTransfer.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        nowPlaying.textContent = `Now Playing: ${file.name}`;

        if (player) {
        player.dispose();
        }

        player = new Tone.Player({
        url: url,
        loop: true,
        autostart: false,
        onload: () => {
            duration = player.buffer.duration;
            drawStaticWaveform(player.buffer);
            progressBar.value = 0;
            totalTimeDisplay.textContent = formatTime(duration);
            currentTimeDisplay.textContent = "0:00";
        }
        });

        if (pitchSlider.value == 0) {
        player.chain(reverb, Tone.Destination);
        } else {
        player.chain(pitchShift, reverb, Tone.Destination);
        pitchShift.pitch = parseInt(pitchSlider.value);
        }

        player.playbackRate = parseFloat(speedSlider.value);
        reverb.wet.value = parseFloat(reverbSlider.value);
    }
});

// play button
playButton.addEventListener('click', async () => {
    if (!player) {
        alert("Please drag and drop an audio file first!");
        return;
    }
    await Tone.start();
    startTime = Tone.now();
    startOffset = 0;
    player.start();
    isPlaying = true;
    updateProgressOverlay();
});

// stop button
stopButton.addEventListener('click', () => {
    if (player && isPlaying) {
        player.stop();
        isPlaying = false;
    }
});

// speed slider
speedSlider.addEventListener('input', () => {
    speedValue.textContent = speedSlider.value;
    if (player) {
        player.playbackRate = parseFloat(speedSlider.value);
    }
});

// pitch slider
pitchSlider.addEventListener('input', () => {
    pitchValue.textContent = pitchSlider.value;
    if (player) {
        const pitch = parseInt(pitchSlider.value);
        player.disconnect();
        if (pitch === 0) {
        player.chain(reverb, Tone.Destination);
        } else {
        player.chain(pitchShift, reverb, Tone.Destination);
        pitchShift.pitch = pitch;
        }
    }
});

// reverb slider
reverbSlider.addEventListener('input', () => {
    reverbValue.textContent = reverbSlider.value;
    if (reverb) {
        reverb.wet.value = parseFloat(reverbSlider.value);
    }
});

// click to seek on waveform
canvas.addEventListener('click', (e) => {
    if (player && duration > 0) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const seekPercent = Math.max(0, Math.min(1, x / canvas.width));
        const newTime = seekPercent * duration;

        player.stop();
        player.start("+0", newTime);
        startOffset = newTime;
        startTime = Tone.now();
        progressBar.value = seekPercent * 100;
        currentTimeDisplay.textContent = formatTime(newTime);
    }
});

// progress bar hover time preview
progressBar.addEventListener('mousemove', (e) => {
    if (duration > 0) {
        const rect = progressBar.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        const hoverSeconds = percent * duration;
        hoverTime.textContent = formatTime(hoverSeconds);
        hoverTime.style.visibility = 'visible';
        hoverTime.style.left = `${x}px`;
    }
});

progressBar.addEventListener('mouseleave', () => {
    hoverTime.style.visibility = 'hidden';
});

// mute while dragging
progressBar.addEventListener('mousedown', () => {
    if (player) {
        wasMuted = Tone.Destination.mute;
        Tone.Destination.mute = true;
        isSeeking = true;
    }
});

// progress bar input (while dragging, visual update only)
progressBar.addEventListener('input', (e) => {
    if (duration > 0) {
        const percent = e.target.value / 100;
        const newTime = percent * duration;
        currentTimeDisplay.textContent = formatTime(newTime);
    }
});

// seek & unmute when releasing the slider
progressBar.addEventListener('mouseup', (e) => {
    if (player && duration > 0) {
        const rect = progressBar.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, x / rect.width));
        const newTime = percent * duration;

        player.stop();
        player.start("+0", newTime);
        startOffset = newTime;
        startTime = Tone.now();
        currentTimeDisplay.textContent = formatTime(newTime);

        Tone.Destination.mute = wasMuted;
        isSeeking = false;
        updateProgressOverlay(); // Restart updating after seek
    }
});

// ---------------------------------------------------------
//                      PRESET CONFIG
// ---------------------------------------------------------

// slowed + reverb preset
slowedPreset.addEventListener('click', () => {
    speedSlider.value = 0.8;
    pitchSlider.value = 0;
    reverbSlider.value = 0.4;
    speedValue.textContent = "0.8";
    pitchValue.textContent = "0";
    reverbValue.textContent = "0.4";
  
    if (player) {
      player.playbackRate = 0.8;
      pitchShift.pitch = 0;
      reverb.wet.value = 0.4;
    }
});
  
// nightcore preset
nightcorePreset.addEventListener('click', () => {
    speedSlider.value = 1.25;
    pitchSlider.value = 0;
    reverbSlider.value = 0.25;
    speedValue.textContent = "1.25";
    pitchValue.textContent = "0";
    reverbValue.textContent = "0.25";

    if (player) {
        player.playbackRate = 1.25;
        pitchShift.pitch = 0;
        reverb.wet.value = 0.25;
    }
});
  
defaultPreset.addEventListener('click', () => {
    speedSlider.value = 1.0;
    pitchSlider.value = 0;
    reverbSlider.value = 0.0;
    speedValue.textContent = "1.0";
    pitchValue.textContent = "0";
    reverbValue.textContent = "0.0";

    if (player) {
        player.playbackRate = 1.0;
        pitchShift.pitch = 0;
        reverb.wet.value = 0.0;
    }
});