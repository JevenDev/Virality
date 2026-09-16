(() => {
    const dock = document.querySelector('.tool-dock');
    const tablist = dock.querySelector('[role="tablist"]');
    const tabs = [...dock.querySelectorAll('[role="tab"]')];
    const pages = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
    const stack = document.querySelector('.page-stack');
    const mobile = matchMedia('(max-width: 640px)');
    const compact = matchMedia('(max-width: 1739px)');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const motions = tabs.map(() => ({ slot: 0 }));
    const musicAnchors = new Set(['', 'music', 'music-page', 'player', 'effects', 'library']);
    let selected = 0, initialized = false, transition;
    let itemHeight = 0, trackHeight = 0, unit = 16;
    let wheelDistance = 0, lastWheel = 0, lastWheelEvent = 0, touchStart = null;

    function wrap(value) {
        const count = tabs.length;
        return ((value + count / 2) % count + count) % count - count / 2;
    }
    function positionItem(index) {
        const slot = wrap(motions[index].slot);
        const distance = Math.abs(slot);
        let x = 0, y = 0;
        const scale = mobile.matches ? 1.06 - Math.min(distance, 1) * .12 : 1.14 - Math.min(distance, 2) * .17;
        let opacity = 1 - Math.min(distance, 2) * .25;
        if (mobile.matches) y = -Math.max(0, 1 - distance) * 5;
        else {
            const angle = slot * .47;
            const radius = Math.min(trackHeight * .45, 11 * unit);
            x = compact.matches ? Math.cos(angle) * 2 * unit - .8 * unit : Math.cos(angle) * 9 * unit - 5.4 * unit;
            y = (trackHeight - itemHeight) / 2 + Math.sin(angle) * radius;
            // wrapped items fade out at the end of the arc before reappearing at the other end
            if (distance > 2) opacity *= Math.max(0, 1 - (distance - 2) * 2);
        }
        tabs[index].style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
        tabs[index].style.opacity = String(opacity);
        tabs[index].style.zIndex = String(Math.round(10 - distance));
    }
    function arrange(animate) {
        tabs.forEach((tab, index) => {
            const target = wrap(index - selected);
            if (window.gsap) gsap.killTweensOf(motions[index]);
            motions[index].slot = wrap(motions[index].slot);
            if (animate && window.gsap && !reducedMotion.matches) {
                gsap.to(motions[index], {
                    slot: motions[index].slot + wrap(target - motions[index].slot),
                    duration: .65,
                    ease: 'power3.out',
                    onUpdate: () => positionItem(index),
                    onComplete: () => { motions[index].slot = target; positionItem(index); }
                });
            } else {
                motions[index].slot = target;
                positionItem(index);
            }
        });
    }
    function resize() {
        unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
        trackHeight = tablist.clientHeight;
        itemHeight = tabs[0].offsetHeight;
        tablist.setAttribute('aria-orientation', mobile.matches ? 'horizontal' : 'vertical');
        arrange(false);
    }
    function settlePages() {
        stack.style.removeProperty('height');
        stack.classList.remove('is-transitioning');
        pages.forEach((page, index) => {
            page.hidden = index !== selected;
            page.inert = index !== selected;
            page.style.removeProperty('opacity');
            page.style.removeProperty('transform');
            page.querySelectorAll('.coming-soon-content > *').forEach(element => {
                element.style.removeProperty('opacity');
                element.style.removeProperty('transform');
            });
        });
    }
    function selectTool(index, { animate = true, focus = false, updateHistory = true, anchor = '' } = {}) {
        index = (index + tabs.length) % tabs.length;
        if (initialized && index === selected) {
            if (focus) tabs[index].focus({ preventScroll: true });
            return;
        }
        const previous = initialized ? selected : -1;
        const startHeight = stack.getBoundingClientRect().height;
        const direction = previous < 0 || wrap(index - previous) >= 0 ? 1 : -1;
        transition?.kill();
        transition = null;
        if (window.gsap) gsap.killTweensOf(pages.flatMap(page => [page, ...page.querySelectorAll('.coming-soon-content > *')]));
        if (focus || (previous >= 0 && pages[previous].contains(document.activeElement))) tabs[index].focus({ preventScroll: true });
        selected = index;
        initialized = true;
        tabs.forEach((tab, i) => {
            tab.setAttribute('aria-selected', String(i === index));
            tab.tabIndex = i === index ? 0 : -1;
            pages[i].hidden = i !== index && i !== previous;
            pages[i].inert = i !== index;
        });
        if (updateHistory) history.pushState(null, '', `#${tabs[index].dataset.tool}`);
        arrange(animate);
        const finish = () => {
            settlePages();
            if (anchor && musicAnchors.has(anchor)) document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'instant' });
        };
        if (previous >= 0) window.scrollTo({ top: 0, behavior: 'instant' });
        if (!animate || reducedMotion.matches || !window.gsap || previous < 0) {
            finish();
            return;
        }
        stack.style.height = `${startHeight}px`;
        stack.classList.add('is-transitioning');
        transition = gsap.timeline({ onComplete: finish });
        transition.to(stack, { height: pages[index].offsetHeight, duration: .57, ease: 'power3.inOut' }, 0);
        transition.to(pages[previous], { opacity: 0, y: -direction * 16, duration: .2, ease: 'power2.in' }, 0);
        transition.fromTo(pages[index], { opacity: 0, y: direction * 22 }, { opacity: 1, y: 0, duration: .45, ease: 'power3.out' }, .12);
        const content = pages[index].querySelectorAll('.coming-soon-content > *');
        if (content.length) transition.fromTo(content, { opacity: 0, y: 16 }, {
            opacity: 1, y: 0, duration: .55, stagger: .07, ease: 'power3.out', clearProps: 'opacity,transform'
        }, .2);
    }
    function route(animate) {
        const anchor = location.hash.slice(1);
        const index = musicAnchors.has(anchor) ? 0 : tabs.findIndex(tab => tab.dataset.tool === anchor);
        if (index >= 0) selectTool(index, { animate, updateHistory: false, anchor });
    }
    tabs.forEach((tab, index) => tab.addEventListener('click', () => selectTool(index)));
    dock.querySelector('#dock-previous').addEventListener('click', () => selectTool(selected - 1, { focus: true }));
    dock.querySelector('#dock-next').addEventListener('click', () => selectTool(selected + 1, { focus: true }));
    dock.addEventListener('keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        let target;
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = selected - 1;
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = selected + 1;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = tabs.length - 1;
        else return;
        event.preventDefault();
        event.stopPropagation();
        selectTool(target, { focus: true });
    });
    dock.addEventListener('wheel', event => {
        if (event.ctrlKey || event.metaKey || mobile.matches) return;
        event.preventDefault();
        const now = performance.now();
        if (now - lastWheel < 320) return;
        if (now - lastWheelEvent > 180) wheelDistance = 0;
        lastWheelEvent = now;
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
        if (Math.sign(delta) !== Math.sign(wheelDistance)) wheelDistance = 0;
        wheelDistance += delta;
        if (Math.abs(wheelDistance) < 30) return;
        selectTool(selected + Math.sign(wheelDistance));
        lastWheel = now;
        wheelDistance = 0;
    }, { passive: false });
    dock.addEventListener('touchstart', event => {
        if (event.touches.length !== 1) { touchStart = null; return; }
        touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });
    dock.addEventListener('touchend', event => {
        if (!touchStart) return;
        const touch = event.changedTouches[0];
        const delta = mobile.matches ? touchStart.x - touch.clientX : touchStart.y - touch.clientY;
        touchStart = null;
        if (Math.abs(delta) >= 40) selectTool(selected + Math.sign(delta));
    }, { passive: true });
    dock.addEventListener('touchcancel', () => { touchStart = null; });
    document.querySelectorAll('.return-to-music').forEach(button => button.addEventListener('click', () => selectTool(0, { focus: true })));
    document.querySelector('.skip-link').addEventListener('click', () => selectTool(0, { animate: false, updateHistory: false }));
    window.addEventListener('hashchange', () => route(true));
    reducedMotion.addEventListener('change', () => {
        transition?.progress(1);
        arrange(false);
    });
    new ResizeObserver(resize).observe(tablist);
    resize();
    route(false);
    if (!initialized) selectTool(0, { animate: false, updateHistory: false });
})();
