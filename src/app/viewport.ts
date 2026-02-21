const APP_VH_VAR = '--app-vh';

const readViewportHeight = (): number => {
  const visual = window.visualViewport?.height;
  if (typeof visual === 'number' && Number.isFinite(visual) && visual > 0) {
    return Math.round(visual);
  }
  const inner = window.innerHeight;
  return Number.isFinite(inner) && inner > 0 ? Math.round(inner) : 0;
};

export const installViewportHeightVar = (): (() => void) => {
  let rafId = 0;

  const apply = (): void => {
    rafId = 0;
    const next = readViewportHeight();
    if (next <= 0) {
      return;
    }
    document.documentElement.style.setProperty(APP_VH_VAR, `${next}px`);
  };

  const scheduleApply = (): void => {
    if (rafId !== 0) {
      return;
    }
    rafId = window.requestAnimationFrame(apply);
  };

  apply();
  window.addEventListener('resize', scheduleApply, { passive: true });
  window.addEventListener('orientationchange', scheduleApply, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleApply, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleApply, { passive: true });

  return () => {
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    window.removeEventListener('resize', scheduleApply);
    window.removeEventListener('orientationchange', scheduleApply);
    window.visualViewport?.removeEventListener('resize', scheduleApply);
    window.visualViewport?.removeEventListener('scroll', scheduleApply);
  };
};

