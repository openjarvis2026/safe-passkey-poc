import { useState, useRef, useCallback } from 'react';

interface Props {
  onConfirm: () => Promise<void>;
  label?: string;
  disabled?: boolean;
  testId?: string;
}

type SliderState = 'idle' | 'dragging' | 'confirming' | 'success' | 'error';

export default function SlideToConfirm({ 
  onConfirm, 
  label = 'Slide to confirm', 
  disabled = false, 
  testId 
}: Props) {
  const [state, setState] = useState<SliderState>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const trackWidthRef = useRef(0);
  
  const thumbSize = 56;
  const trackHeight = 64;
  const threshold = 0.85;

  const getTrackWidth = () => {
    if (trackRef.current) return trackRef.current.getBoundingClientRect().width;
    return 300;
  };

  const startDrag = useCallback((clientX: number) => {
    if (disabled || state === 'confirming' || state === 'success') return;
    setState('dragging');
    startXRef.current = clientX;
    trackWidthRef.current = getTrackWidth();
    
    // Add haptic feedback on supported devices
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }, [disabled, state]);

  const moveDrag = useCallback((clientX: number) => {
    if (state !== 'dragging') return;
    const maxTravel = trackWidthRef.current - thumbSize - 8;
    const delta = clientX - startXRef.current;
    const p = Math.max(0, Math.min(1, delta / maxTravel));
    setProgress(p);
    
    // Haptic feedback at threshold
    if (p >= threshold && navigator.vibrate) {
      navigator.vibrate(20);
    }
  }, [state]);

  const endDrag = useCallback(async () => {
    if (state !== 'dragging') return;
    
    if (progress >= threshold) {
      setProgress(1);
      setState('confirming');
      setStatusText('Processing...');
      
      // Strong haptic feedback on confirmation
      if (navigator.vibrate) {
        navigator.vibrate([50, 100, 50]);
      }
      
      try {
        await onConfirm();
        setState('success');
        setStatusText('Completed!');
        
        // Success haptic feedback
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
        
        // Reset after success
        setTimeout(() => {
          setState('idle');
          setProgress(0);
          setStatusText('');
        }, 2000);
      } catch (e: any) {
        setState('error');
        setStatusText(e.message?.slice(0, 40) || 'Error occurred');
        
        // Error haptic feedback
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200, 100, 200]);
        }
        
        setTimeout(() => {
          setState('idle');
          setProgress(0);
          setStatusText('');
        }, 3000);
      }
    } else {
      setState('idle');
      setProgress(0);
    }
  }, [state, progress, onConfirm]);

  const onMouseDown = (e: React.MouseEvent) => { 
    e.preventDefault(); 
    startDrag(e.clientX); 
  };
  
  const onMouseMove = (e: React.MouseEvent) => moveDrag(e.clientX);
  const onMouseUp = () => endDrag();
  const onMouseLeave = () => { 
    if (state === 'dragging') endDrag(); 
  };

  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    startDrag(e.touches[0].clientX);
  };
  
  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    moveDrag(e.touches[0].clientX);
  };
  
  const onTouchEnd = () => endDrag();

  const maxTravel = (trackRef.current?.getBoundingClientRect().width ?? 300) - thumbSize - 8;
  const thumbX = 4 + progress * maxTravel;

  // Enhanced styling based on state
  const getTrackStyle = () => {
    const baseRadius = 'var(--radius-full)';
    
    if (disabled) {
      return {
        background: 'var(--card-bg)',
        border: '2px solid var(--border)',
        opacity: 0.4,
        borderRadius: baseRadius,
      };
    }
    
    if (state === 'success') {
      return {
        background: 'var(--accent)',
        border: '2px solid var(--accent)',
        borderRadius: baseRadius,
        boxShadow: '0 4px 20px rgba(16, 185, 129, 0.4)',
      };
    }
    
    if (state === 'error') {
      return {
        background: 'var(--danger)',
        border: '2px solid var(--danger)',
        borderRadius: baseRadius,
        boxShadow: '0 4px 20px rgba(239, 68, 68, 0.4)',
      };
    }
    
    if (state === 'confirming') {
      return {
        background: 'var(--primary-gradient)',
        border: '2px solid transparent',
        borderRadius: baseRadius,
        boxShadow: '0 4px 24px rgba(99, 102, 241, 0.5)',
        animation: 'pulse 2s infinite',
      };
    }
    
    if (state === 'dragging') {
      const gradientProgress = Math.min(progress * 1.2, 1);
      return {
        background: `linear-gradient(90deg, 
          var(--primary-from) 0%, 
          var(--primary-to) ${gradientProgress * 100}%, 
          var(--card-bg-light) ${gradientProgress * 100}%
        )`,
        border: '2px solid var(--primary-from)',
        borderRadius: baseRadius,
        boxShadow: progress >= threshold 
          ? '0 4px 24px rgba(99, 102, 241, 0.5), 0 0 0 2px rgba(99, 102, 241, 0.2)'
          : '0 4px 16px rgba(99, 102, 241, 0.3)',
      };
    }
    
    return {
      background: 'var(--card-bg)',
      border: '2px solid var(--border)',
      borderRadius: baseRadius,
      transition: 'all 0.2s ease',
    };
  };

  const getThumbStyle = () => {
    const baseStyle = {
      width: thumbSize,
      height: thumbSize,
      borderRadius: '50%',
      position: 'absolute' as const,
      top: 4,
      left: thumbX,
      zIndex: 2,
      cursor: disabled ? 'not-allowed' : state === 'dragging' ? 'grabbing' : 'grab',
      transition: state === 'idle' ? 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };

    if (state === 'success') {
      return {
        ...baseStyle,
        background: 'white',
        boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)',
        color: 'var(--accent)',
      };
    }
    
    if (state === 'error') {
      return {
        ...baseStyle,
        background: 'white',
        boxShadow: '0 4px 16px rgba(239, 68, 68, 0.3)',
        color: 'var(--danger)',
      };
    }
    
    if (progress >= threshold && state === 'dragging') {
      return {
        ...baseStyle,
        background: 'white',
        boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4), 0 0 0 3px rgba(99, 102, 241, 0.1)',
        transform: 'scale(1.05)',
        color: 'var(--primary-from)',
      };
    }
    
    return {
      ...baseStyle,
      background: 'white',
      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.15)',
      color: 'var(--text-secondary)',
    };
  };

  const getDisplayText = () => {
    if (state === 'confirming') return statusText;
    if (state === 'success') return '✓ Success!';
    if (state === 'error') return `✗ ${statusText}`;
    return label;
  };

  const getThumbIcon = () => {
    if (state === 'success') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    }
    
    if (state === 'error') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    }
    
    if (progress >= threshold && state === 'dragging') {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    }
    
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    );
  };

  return (
    <div
      ref={trackRef}
      className={`slide-track ${disabled ? 'slide-disabled' : ''}`}
      data-testid={testId}
      style={{
        height: trackHeight,
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        ...getTrackStyle(),
      }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Background Progress Fill */}
      {state === 'dragging' && progress < threshold && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${progress * 100}%`,
            background: 'rgba(99, 102, 241, 0.2)',
            borderRadius: 'inherit',
            transition: 'width 0.1s ease',
          }}
        />
      )}

      {/* Text Label */}
      <div 
        className={`slide-label ${state === 'idle' && !disabled ? 'slide-shimmer' : ''}`}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: state === 'success' || state === 'error' || state === 'confirming' ? 'white' : 'var(--text-primary)',
          fontSize: 16,
          fontWeight: 600,
          fontFamily: 'var(--font-body)',
          pointerEvents: 'none',
          opacity: state === 'dragging' && progress > 0.3 ? 1 - (progress - 0.3) * 1.4 : 1,
          transition: 'opacity 0.2s ease',
          textShadow: (state === 'success' || state === 'error' || state === 'confirming') 
            ? '0 1px 2px rgba(0, 0, 0, 0.2)' 
            : 'none',
        }}
      >
        {getDisplayText()}
      </div>

      {/* Thumb */}
      {state !== 'confirming' && (
        <div
          style={getThumbStyle()}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
        >
          {getThumbIcon()}
        </div>
      )}

      {/* Loading Spinner for Confirming State */}
      {state === 'confirming' && (
        <div style={{
          position: 'absolute',
          right: 8,
          top: 8,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}>
          <div className="spinner" style={{ width: 24, height: 24 }} />
        </div>
      )}

      {/* Threshold Indicator */}
      {state === 'dragging' && (
        <div style={{
          position: 'absolute',
          right: thumbSize + 8,
          top: 0,
          bottom: 0,
          width: 2,
          background: progress >= threshold ? 'var(--accent)' : 'rgba(255, 255, 255, 0.3)',
          transition: 'background 0.2s ease',
        }} />
      )}
    </div>
  );
}