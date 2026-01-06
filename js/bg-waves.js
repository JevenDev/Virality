(() => {
    const canvas = document.getElementById('bg-waves');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    let w = 0, h = 0;
    let waves = [];
    let lastTime = 0;
    let accumulatedTime = 0;

    const config = {
        waveCount: 3,
        globalSpeed: 0.0004,
        complexity: 2
    };

    class BGWave {
        constructor(){ this.init(); }
        init(){
        this.phase = Math.random() * Math.PI * 2;
        this.amplitude = 40 + Math.random() * 40;
        this.frequency = 0.001 + Math.random() * 0.002;
        this.offsetY = h * 0.5 + (Math.random() - 0.5) * (h * 0.2);
        this.thickness = 120 + Math.random() * 80;
        }
        draw(elapsedTime){
        ctx.beginPath();

        const drift = elapsedTime * config.globalSpeed;

        for (let x = 0; x <= w; x += 5) {
            const y = this.offsetY
            + Math.sin(x * this.frequency + drift + this.phase) * this.amplitude
            + Math.sin(x * this.frequency * 1.5 + drift * 0.8) * (this.amplitude * 0.3);
            ctx.lineTo(x, y);
        }

        for (let x = w; x >= 0; x -= 5) {
            const y = this.offsetY
            + Math.sin(x * this.frequency + drift + this.phase) * this.amplitude
            + Math.sin(x * this.frequency * 1.5 + drift * 0.8) * (this.amplitude * 0.3)
            + this.thickness;
            ctx.lineTo(x, y);
        }

        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, this.offsetY - 100, 0, this.offsetY + this.thickness + 100);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fill();
        }
    }

    function resize(){
        const dpr = window.devicePixelRatio || 1;
        w = Math.floor(window.innerWidth);
        h = Math.floor(window.innerHeight);

        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        waves = Array.from({ length: config.waveCount }, () => new BGWave());
    }

    function animate(t){
        const dt = t - lastTime;
        lastTime = t;
        if (dt < 100) accumulatedTime += dt;

        ctx.clearRect(0, 0, w, h);
        waves.forEach(wv => wv.draw(accumulatedTime));

        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(animate);
})();