import { useEffect, useState } from 'react';

export interface HeroSlide { url: string; alt: string }

/** Index of the slide after `url` (wraps); 0 when `url` is not in the list. */
export function nextSlideIndex(slides: HeroSlide[], url: string): number {
  const at = slides.findIndex((slide) => slide.url === url);
  return at < 0 ? 0 : (at + 1) % slides.length;
}

/**
 * Hero photo that crossfades (with a slow zoom) through `slides`. Pauses while hovered or focused, while the tab is hidden,
 * and never auto-advances for people who prefer reduced motion.
 * The shown photo is tracked by URL, so when the slide list changes (the catalogue finishing loading) the photo on screen stays put.
 */
export default function HeroSlider({ slides, intervalMs = 4500 }: { slides: HeroSlide[]; intervalMs?: number }) {
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const currentUrl = slides.some((slide) => slide.url === shownUrl) ? shownUrl! : slides[0]?.url ?? '';

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setShownUrl(slides[nextSlideIndex(slides, currentUrl)].url);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [slides, currentUrl, paused, intervalMs]);

  return (
    <div className="hero-slider"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {slides.map((slide, index) => (
        <img key={slide.url} className={`hero-slide${slide.url === currentUrl ? ' hero-slide--active' : ''}`}
          src={slide.url} alt={slide.alt} aria-hidden={slide.url === currentUrl ? undefined : true}
          loading={index === 0 ? 'eager' : 'lazy'} decoding="async" />
      ))}
    </div>
  );
}
