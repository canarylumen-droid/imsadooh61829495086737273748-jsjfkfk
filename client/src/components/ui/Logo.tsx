import React from "react";

export const Logo = ({ className = "h-8 w-8", textClassName = "text-lg font-bold" }: { className?: string; textClassName?: string }) => {
  return (
    <div className="flex items-center gap-2 select-none">
      <div className={`relative ${className}`}>
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <path d="M20 7L30 28H10L20 7Z" stroke="#06b6d4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20" cy="19" r="2.5" fill="#06b6d4" />
        </svg>
      </div>
      <span className={`${textClassName} tracking-tight text-foreground`}>
        Audnix
      </span>
    </div>
  );
};
