import { t, useLocale } from '../i18n';
import { useEffect, useRef } from 'react';
import { Heart } from '@phosphor-icons/react';
import { useFavorite } from '../hooks/useFavorite';
import type { MediaItem } from '../types';

const sparks = Array.from({ length: 8 }, (_, index) => index * 45);

export function FavoriteButton({ item, iconOnly = false, short = false }: {
  item: MediaItem; iconOnly?: boolean; short?: boolean;
}) {
  useLocale();
  const { favorite, pending, error, toggle } = useFavorite(item);
  const iconRef = useRef<HTMLSpanElement>(null);
  const burstRef = useRef<HTMLSpanElement>(null);
  const clickEffect = useRef<Animation | null>(null);
  const sparkEffects = useRef<Animation[]>([]);
  const cancelSparks = () => {
    sparkEffects.current.forEach(animation => animation.cancel());
    sparkEffects.current = [];
  };
  useEffect(() => () => { clickEffect.current?.cancel(); cancelSparks(); }, [item.id]);
  useEffect(() => { if (!favorite || error) cancelSparks(); }, [favorite, error]);
  const label = favorite ? 'Remove from favorites' : 'Add to favorites';
  return <>
    <button type="button" className={`favorite-button${favorite ? ' saved liked' : ''}${short ? ' short-favorite' : ''}`}
      aria-label={label} title={label} aria-pressed={favorite} aria-busy={pending} disabled={pending}
      onClick={event => {
        if (pending) return;
        const icon = iconRef.current;
        const style = icon ? getComputedStyle(icon) : null;
        const transform = style?.transform || 'none';
        const opacity = style?.opacity || '1';
        const easing = style?.getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.23, 1, 0.32, 1)';
        clickEffect.current?.cancel();
        cancelSparks();
        if (event.detail > 0 && icon?.animate && style) {
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const frames = reduced
            ? [{ opacity }, { opacity: 0.6, offset: 0.4 }, { opacity: 1 }]
            : [{ transform }, { transform: favorite ? 'scale(0.9)' : 'scale(1.18)', offset: 0.4 }, { transform: 'scale(1)' }];
          try {
            clickEffect.current = icon.animate(frames, { duration: 160, easing });
            if (!favorite && !reduced && burstRef.current) {
              const radius = icon.offsetWidth / 2;
              Array.from(burstRef.current.children).forEach((spark, index) => {
                const ray = (distance: number) => `translate(-50%, -50%) rotate(${sparks[index]}deg) translateY(-${distance}px)`;
                sparkEffects.current.push(spark.animate([
                  { transform: ray(radius + 2), opacity: 1 },
                  { transform: ray(radius + 7), opacity: 1, offset: 0.8 },
                  { transform: ray(radius + 10), opacity: 0 }
                ], { duration: 160, easing }));
              });
            }
          } catch {
            // Visual feedback must never prevent saving.
            clickEffect.current?.cancel();
            clickEffect.current = null;
            cancelSparks();
          }
        }
        void toggle();
      }}>
      <span className="favorite-icon-wrap" aria-hidden="true">
        <span ref={iconRef} className="favorite-icon"><Heart weight={favorite ? 'fill' : 'regular'} /></span>
        <span ref={burstRef} className="favorite-burst">
          {sparks.map(angle => <span key={angle} className="favorite-spark" />)}
        </span>
      </span>
      {!iconOnly && <span>{favorite ? t("Saved") : t("Favorites")}</span>}
    </button>
    {error && <span className="favorite-error" role="alert">{t(error)}</span>}
  </>;
}
