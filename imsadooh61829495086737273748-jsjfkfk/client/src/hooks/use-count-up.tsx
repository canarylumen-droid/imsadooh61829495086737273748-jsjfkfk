import { useState, useEffect, useRef } from 'react';

interface UseCountUpOptions {
  start?: number;
  end: number;
  duration?: number;
  delay?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}

export function useCountUp({
  start = 0,
  end,
  duration = 1500,
  delay = 0,
  decimals = 0,
  suffix = '',
  prefix = ''
}: UseCountUpOptions): string {
  const [count, setCount] = useState(start);
  const startTime = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTime.current) {
          startTime.current = timestamp;
        }

        const progress = Math.min((timestamp - startTime.current) / duration, 1);
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        const currentValue = start + (end - start) * easeOutQuart;

        setCount(currentValue);

        if (progress < 1) {
          animationFrame.current = requestAnimationFrame(animate);
        }
      };

      animationFrame.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [start, end, duration, delay]);

  const formattedValue = count.toFixed(decimals);
  return `${prefix}${formattedValue}${suffix}`;
}

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  delay?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}

export function AnimatedNumber({
  value,
  duration = 1500,
  delay = 0,
  decimals = 0,
  suffix = '',
  prefix = '',
  className = ''
}: AnimatedNumberProps) {
  const displayValue = useCountUp({
    end: value,
    duration,
    delay,
    decimals,
    suffix,
    prefix
  });

  return <span className={className}>{displayValue}</span>;
}
