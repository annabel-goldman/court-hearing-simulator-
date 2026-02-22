/**
 * Reusable Card Component
 * 
 * Container with consistent styling for sections
 * 
 * Styles: styles/card.css
 */

import '../../styles/card.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'dark' | 'bordered';
}

interface CardHeaderProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = '', variant = 'default' }: CardProps) {
  const variantClass = variant !== 'default' ? `ma-card--${variant}` : '';
  return (
    <div className={`ma-card ${variantClass} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, action, className = '' }: CardHeaderProps) {
  return (
    <div className={`ma-card__header ${className}`}>
      <h2 className="ma-card__title">{children}</h2>
      {action && <div>{action}</div>}
    </div>
  );
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return <div className={`ma-card__content ${className}`}>{children}</div>;
}
