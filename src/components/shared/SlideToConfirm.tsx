import { useState, useRef, useCallback } from 'react';

interface Props {
  onConfirm: () => Promise<void>;
  label?: string;
  disabled?: boolean;
}

type SliderState = 'idle' | 'dragging' | 'confirming' | 'success' | 'error';

export default function SlideToConfirm({ onConfirm, label = 'Slide to approve', disabled = false }: Props) {
  const [state, setState] = useState<SliderState>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const trackWidthRef = useRef(0);
  const thumbSize = 52;
  const trackHeight = 64;
  const threshold = 0.8;

  const getTrackWidth = () => {
    if (trackRef.current) return trackRef.current.getBoundingClientRect().width;
    return 300;
  };

  const startDrag = useCallback((clientX: number) => {
    if (disabled || state === 'confirming' || state === 'success') return;
    setState('dragging');
    startXRef.current = clientX;
    trackWidthRef.current = getTrackWidth();
  }, [disabled, state]);

  const moveDrag = useCallback((clientX: number) => {
    if (state !== 'dragging') return;
    const maxTravel = trackWidthRef.current - thumbSize - 12;
    const delta = clientX - startXRef.current;
    const p = Math.max(0, Math.min(1, delta / maxTravel));
    setProgress(p);
  }, [state]);

  const endDrag = useCallback(async () => {
    if (state !== 'dragging') return;
    if (progress >= threshold) {
      setProgress(1);
      setState('confirming');
      setStatusText('Signing…');
      try {
        await onConfirm();
        setState('success');
        setStatusText('Done!');
      } catch (e: any) {
        setState('error');
        setStatusText(e.message?.slice(0, 40) || 'Error');
        setTimeout(() => { setState('idle'); setProgress(0); setStatusText(''); }, 2000);
      }
    } else {
      setState('idle');
      setProgress(0);
    }
  }, [state, progress, onConfirm]);

  const onMouseDown = (e: React.MouseEvent) => { e.preventDefault(); startDrag(e.clientX); };
  const onMouseMove = (e: React.MouseEvent) => moveDrag(e.clientX);
  const onMouseUp = () => endDrag();
  const onMouseLeave = () => { if (state === 'dragging') endDrag(); };

  const onTouchStart = (e: React.TouchEvent) => startDrag(e.touches[0].clientX);
  const onTouchMove = (e: React.TouchEvent) => moveDrag(e.touches[0].clientX);
  const onTouchEnd = () => endDrag();

  const maxTravel = (trackRef.current?.getBoundingClientRect().width ?? 300) - thumbSize - 12;
  const thumbX = 6 + progress * maxTravel;

  const isActive = state === 'confirming' || state === 'success';
  const trackBg = state === 'success'
    ? 'var(--success)'
    : state === 'dragging' || state === 'confirming'
    ? `linear-gradient(90deg, var(--primary-from) ${progress * 100}%, #1E293B ${progress * 100}%)`
    : '#1E293B';

  const displayText = state === 'confirming' ? statusText
    : state === 'success' ? '✅ Done!'
    : state === 'error' ? `❌ ${statusText}`
    : label;

  return (
    <div
      ref={trackRef}
      className={`slide-track ${disabled ? 'slide-disabled' : ''}`}
      style={{ height: trackHeight, background: trackBg, position: 'relative', borderRadius: trackHeight / 2, overflow: 'hidden', userSelect: 'none', touchAction: 'none' }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Label */}
      <div className={`slide-label ${state === 'idle' ? 'slide-shimmer' : ''}`} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 600, pointerEvents: 'none', opacity: state === 'dragging' ? 1 - progress * 0.5 : 1 }}>
        {displayText}
      </div>

      {/* Thumb */}
      {!isActive ? (
        <div
          className="slide-thumb"
          style={{ position: 'absolute', top: (trackHeight - thumbSize) / 2, left: thumbX, width: thumbSize, height: thumbSize, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'not-allowed' : 'grab', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', transition: state === 'idle' ? 'left 0.3s ease' : 'none', zIndex: 2 }}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        >
          <span style={{ fontSize: 22, color: '#1E293B' }}>→</span>
        </div>
      ) : state === 'confirming' ? (
        <div style={{ position: 'absolute', top: (trackHeight - thumbSize) / 2, right: 6, width: thumbSize, height: thumbSize, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : null}
    </div>
  );
}
