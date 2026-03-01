/**
 * Brief Upload Component
 * 
 * Handles PDF upload and text extraction for both user and opposing briefs.
 * Uses shared UI components for consistent styling.
 */

import { useCallback, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BriefData } from '../types';
import { Button, Alert, Card, CardHeader, CardContent, FileUpload } from './ui';
import { SummaryDisplay } from './features';

GlobalWorkerOptions.workerSrc = workerSrc;

interface BriefUploadProps {
  onBriefsReady: (userBrief: BriefData, opposingBrief: BriefData) => void;
  onSummaryGenerated: (summary: string) => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: unknown) => (item as { str: string }).str)
      .join(' ');
    fullText += pageText + '\n';
  }
  
  return fullText.trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).length;
}

export function BriefUpload({ onBriefsReady, onSummaryGenerated }: BriefUploadProps) {
  const [userBrief, setUserBrief] = useState<BriefData | null>(null);
  const [opposingBrief, setOpposingBrief] = useState<BriefData | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = useCallback(async (file: File, type: 'user' | 'opposing') => {
    try {
      setError(null);
      const text = await extractTextFromPdf(file);
      const briefData: BriefData = { name: file.name, text };
      
      if (type === 'user') {
        setUserBrief(briefData);
      } else {
        setOpposingBrief(briefData);
      }
    } catch (err) {
      console.error('Failed to extract PDF text:', err);
      setError('Failed to read PDF. Please try a different file.');
    }
  }, []);

  const handleGenerateSummary = useCallback(async () => {
    if (!userBrief || !opposingBrief) return;

    setIsGeneratingSummary(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/multi-agent/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_brief: userBrief.text,
          opposing_brief: opposingBrief.text,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate summary');
      }

      const data = await response.json();
      setSummary(data.summary);
      onSummaryGenerated(data.summary);
      onBriefsReady(userBrief, opposingBrief);
    } catch (err) {
      console.error('Failed to generate summary:', err);
      setError('Failed to generate summary. Please try again.');
    } finally {
      setIsGeneratingSummary(false);
    }
  }, [userBrief, opposingBrief, onBriefsReady, onSummaryGenerated]);

  const canGenerateSummary = userBrief && opposingBrief && !summary;

  return (
    <Card>
      <CardHeader>Upload Briefs</CardHeader>
      <CardContent>
        {error && <Alert variant="error">{error}</Alert>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <FileUpload
            label="Petitioner's Brief"
            file={userBrief ? { 
              name: userBrief.name, 
              wordCount: countWords(userBrief.text) 
            } : null}
            onFileSelect={(file) => handleFileUpload(file, 'user')}
            onRemove={() => setUserBrief(null)}
          />

          <FileUpload
            label="Respondent's Brief"
            file={opposingBrief ? { 
              name: opposingBrief.name, 
              wordCount: countWords(opposingBrief.text) 
            } : null}
            onFileSelect={(file) => handleFileUpload(file, 'opposing')}
            onRemove={() => setOpposingBrief(null)}
          />
        </div>

        {canGenerateSummary && (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleGenerateSummary}
            isLoading={isGeneratingSummary}
          >
            Generate Brief Summary
          </Button>
        )}

        {summary && <SummaryDisplay summary={summary} />}
      </CardContent>
    </Card>
  );
}
