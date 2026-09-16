(() => {
    const canvas = document.getElementById('bg-waves');
    const ctx = canvas.getContext('2d');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, frame = 0, lastTime = 0, elapsed = 0;
    function draw() {
        ctx.clearRect(0, 0, width, height);
        for (let layer = 0; layer < 3; layer++) {
            const base = height * (.38 + layer * .07);
            const phase = elapsed * .00012 + layer * .45;
            const wave = x => base + Math.sin(x / width * 4.5 + phase) * height * .09 + Math.cos(x / width * 2.8 + phase * .7) * height * .05;
            ctx.beginPath();
            for (let x = 0; x <= width + 8; x += 8) {
                if (x === 0) ctx.moveTo(x, wave(x)); else ctx.lineTo(x, wave(x));
            }
            ctx.strokeStyle = `rgba(210,240,255,${.12 - layer * .025})`;
            ctx.lineWidth = 1;
            ctx.stroke();
            for (let x = width + 8; x >= 0; x -= 8) ctx.lineTo(x, wave(x) + 100 + layer * 24);
            ctx.closePath();
            const gradient = ctx.createLinearGradient(0, base - 80, 0, base + 220);
            gradient.addColorStop(0, 'rgba(198,237,255,0)');
            gradient.addColorStop(.4, 'rgba(198,237,255,.07)');
            gradient.addColorStop(1, 'rgba(198,237,255,0)');
            ctx.fillStyle = gradient;
            ctx.fill();
        }
    }
    function animate(timestamp) {
        frame = 0;
        if (document.hidden || motion.matches) return;
        if (timestamp - lastTime >= 50) {
            elapsed += Math.min(timestamp - lastTime, 100);
            lastTime = timestamp;
            draw();
        }
        frame = requestAnimationFrame(animate);
    }
    function resume() {
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = performance.now();
        draw();
        if (!document.hidden && !motion.matches) frame = requestAnimationFrame(animate);
    }
    function resize() {
        const dpr = Math.min(devicePixelRatio || 1, 1.5);
        width = innerWidth;
        height = innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', resume);
    resize();
    resume();
})();
