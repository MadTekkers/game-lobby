import { useLayoutEffect, useRef } from "react";

/** Shrinks font-size (down to `min` px) until the text fits its parent box without overflow.
 *  Single words never break mid-word; multi-word text may wrap at spaces/hyphens. */
export function FitText({ text, max = 16, min = 10, className }: { text: string; max?: number; min?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; const parent = el?.parentElement; if (!el || !parent) return;
    const fit = () => {
      const cs = getComputedStyle(parent);
      const w = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let size = max; el.style.fontSize = size + "px"; el.style.transform = ""; el.style.letterSpacing = ""; el.style.maxWidth = "";
      // fits if the longest unbreakable token fits the width and the whole block fits the height
      while (size > min && (el.scrollWidth > w + 0.5 || (h > 0 && el.scrollHeight > h + 0.5))) { size -= 0.5; el.style.fontSize = size + "px"; }
      // still too wide at the minimum size: tighten tracking, then condense horizontally (never clip or break mid-word)
      if (el.scrollWidth > w + 0.5) { el.style.letterSpacing = "-0.04em"; }
      if (el.scrollWidth > w + 0.5) { el.style.maxWidth = "none"; el.style.flex = "none"; const natural = el.getBoundingClientRect().width; el.style.transform = `scaleX(${((w - 1) / natural).toFixed(3)})`; }
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(parent);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [text, max, min]);
  return <span ref={ref} className={`fit-text ${className || ""}`}>{text}</span>;
}
