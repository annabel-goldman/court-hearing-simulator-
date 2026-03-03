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

GlobalWorkerOptions.workerSrc = workerSrc;

interface BriefUploadProps {
  onBriefsReady: (userBrief: BriefData, opposingBrief: BriefData) => void;
}

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

export function BriefUpload({ onBriefsReady }: BriefUploadProps) {
  const [userBrief, setUserBrief] = useState<BriefData | null>(null);
  const [opposingBrief, setOpposingBrief] = useState<BriefData | null>(null);
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

  const handleStart = useCallback(() => {
    if (!userBrief || !opposingBrief) return;
    setError(null);
    onBriefsReady(userBrief, opposingBrief);
  }, [userBrief, opposingBrief, onBriefsReady]);

  const canStart = userBrief && opposingBrief;

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

        {canStart && (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleStart}
          >
            Start
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
