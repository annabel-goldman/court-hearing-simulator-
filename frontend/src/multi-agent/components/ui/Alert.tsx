/**
 * Alert Component
 * 
 * For displaying error, warning, success, and info messages
 * 
 * Styles: styles/alert.css
 */

import '../../styles/alert.css';

type AlertVariant = 'error' | 'warning' | 'success' | 'info';

interface AlertProps {
  children: React.ReactNode;
  variant?: AlertVariant;
  className?: string;
}

export function Alert({ children, variant = 'error', className = '' }: AlertProps) {
  return (
    <div className={`ma-alert ma-alert--${variant} ${className}`}>
      {children}
    </div>
  );
}
