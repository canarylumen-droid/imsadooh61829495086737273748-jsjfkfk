import { useEffect, useState } from 'react';

interface TypingTextProps {
  text: string;
  speed?: number;
  className?: string;
  cursorClassName?: string;
}

export function TypingText({ text, speed = 50, className = '', cursorClassName = '' }: TypingTextProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (displayedText.length < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(text.slice(0, displayedText.length + 1));
      }, speed);
      return () => clearTimeout(timer);
    } else {
      setIsComplete(true);
    }
  }, [displayedText, text, speed]);

  return (
    <span className={className}>
      {displayedText}
      {!isComplete && (
        <span className={`inline-block animate-pulse ${cursorClassName}`}>|</span>
      )}
    </span>
  );
}
