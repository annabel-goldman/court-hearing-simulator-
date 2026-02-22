/**
 * Summary Display Component
 * 
 * Shows the generated case summary
 * 
 * Styles: styles/summary.css
 */

import '../../styles/summary.css';

interface SummaryDisplayProps {
  summary: string;
}

export function SummaryDisplay({ summary }: SummaryDisplayProps) {
  return (
    <div className="ma-summary">
      <h3 className="ma-summary__title">Case Summary</h3>
      <p className="ma-summary__text">{summary}</p>
    </div>
  );
}
