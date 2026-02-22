/**
 * Badge Component
 * 
 * Small labels for status indicators, tags, etc.
 * 
 * Styles: styles/badge.css
 */

import '../../styles/badge.css';

interface BadgeProps {
  children: React.ReactNode;
  color?: string;
  variant?: 'solid' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ 
  children, 
  color, 
  variant = 'solid',
  size = 'sm',
  className = '' 
}: BadgeProps) {
  const classes = [
    'ma-badge',
    `ma-badge--${size}`,
    !color ? 'ma-badge--default' : '',
    variant === 'outline' ? 'ma-badge--outline' : '',
    className,
  ].filter(Boolean).join(' ');
  
  const style = color 
    ? variant === 'solid' 
      ? { backgroundColor: color, color: 'white' }
      : { borderColor: color, color: color }
    : undefined;
  
  return (
    <span className={classes} style={style}>
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: 'connected' | 'disconnected' | 'recording' | 'ready' | 'setup' | 'finished';
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const statusText: Record<string, string> = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    recording: 'Recording',
    ready: 'Ready',
    setup: 'Setup',
    finished: 'Finished',
  };

  return (
    <span className={`ma-status-badge ma-status-badge--${status}`}>
      {statusText[status]}
    </span>
  );
}
