import { useEffect } from 'react';

/** Reveal final geometry once, with cleanup for preference changes and disposal. */
export function useFigureMotion(root, source, ready) {
  useEffect(() => {
    const canvas = root.current?.querySelector('.dv-canvas');
    const preference = globalThis.matchMedia?.('(prefers-reduced-motion: no-preference)');
    if (!ready || !canvas?.animate || !preference?.matches) return;
    const animations = [];
    let observer, revealed = false;
    const play = (element, frames, timing) => {
      if (element.animate) animations.push(element.animate(frames, {duration:460, easing:'cubic-bezier(.16,1,.3,1)', ...timing}));
    };
    const cancel = () => { observer?.disconnect(); animations.forEach(animation => animation.cancel()); animations.length = 0; };
    const preferenceChanged = () => { if (!preference.matches) cancel(); };
    const reveal = () => {
      if (revealed || !preference.matches) return;
      revealed = true;
      observer?.disconnect();
      play(canvas, [{opacity:.25, transform:'translateY(8px)'},{opacity:1, transform:'none'}], {duration:320});
      canvas.querySelectorAll('.dv-bar-fill').forEach((bar, i) => play(bar, [{transform:'scaleX(0)'},{transform:'scaleX(1)'}], {delay:Math.min(i * 35, 210), fill:'backwards'}));
      // A clipping reveal keeps dashed series and export geometry intact.
      canvas.querySelectorAll('.dv-line-path,.dv-flow-edge').forEach((path, i) => play(path, [{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0)'}], {delay:Math.min(i * 45, 180), duration:560, fill:'backwards'}));
      canvas.querySelectorAll('.dv-flow-node,.dv-metric').forEach((node, i) => play(node, [{opacity:0, transform:'translateY(5px)'},{opacity:1, transform:'none'}], {delay:Math.min(i * 40, 200), fill:'backwards'}));
    };
    preference.addEventListener?.('change', preferenceChanged);
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) reveal(); }, {threshold:.12});
      observer.observe(canvas);
    } else reveal();
    return () => { cancel(); preference.removeEventListener?.('change', preferenceChanged); };
  }, [root, source, ready]);
}
