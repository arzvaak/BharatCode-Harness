import { useEffect, useState } from 'react';

/** Zoom is relative to viewport width. Fit includes height; max reaches native geometry. */
export function diagramScaleBounds(svgWidth, svgHeight, viewportWidth, viewportHeight = 580) {
  if (!(svgWidth > 0 && svgHeight > 0 && viewportWidth > 0)) return { fit:1, max:3 };
  return { fit:Math.min(1, viewportHeight * svgWidth / (svgHeight * viewportWidth)), max:Math.max(3, svgWidth / viewportWidth) };
}

export function useDiagramViewport(root, source, width, ready) {
  const [zoom, setZoom] = useState(1), [bounds, setBounds] = useState({fit:1, max:3});
  const resetScroll = () => {
    const canvas = root.current?.querySelector('.dv-canvas');
    if (canvas) { canvas.scrollTop = 0; canvas.scrollLeft = 0; }
  };
  useEffect(() => {
    const canvas = root.current?.querySelector('.dv-canvas');
    const box = canvas?.querySelector('svg')?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const next = box ? diagramScaleBounds(box[2], box[3], canvas.clientWidth || width) : {fit:1, max:3};
    setBounds(next); setZoom(next.fit); resetScroll();
  }, [root, source, width, ready]);
  return { zoom, bounds, zoomIn:() => setZoom(value => Math.min(bounds.max, value * 1.25)), zoomOut:() => setZoom(value => Math.max(bounds.fit, value / 1.25)), fit:() => {setZoom(bounds.fit); resetScroll();} };
}
