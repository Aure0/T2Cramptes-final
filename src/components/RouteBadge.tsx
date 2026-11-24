import React from 'react';

interface RouteBadgeProps {
  shortName: string;
  color: string;
  textColor?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const RouteBadge: React.FC<RouteBadgeProps> = React.memo(({
  shortName,
  color,
  textColor = '#FFFFFF',
  size = 'sm',
  className = '',
}) => {
  const sizeClass =
    size === 'xs'
      ? 'h-5 min-w-5 px-1 text-[11px]'
      : size === 'md'
        ? 'h-7 min-w-7 px-2 text-sm'
        : 'h-6 min-w-6 px-1.5 text-xs';

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-display font-bold leading-none tracking-tight shrink-0 whitespace-nowrap select-none ring-1 ring-inset ring-white/15 shadow-xs ${sizeClass} ${className}`}
      style={{
        backgroundColor: color,
        color: textColor,
      }}
    >
      {shortName}
    </span>
  );
});

RouteBadge.displayName = 'RouteBadge';
