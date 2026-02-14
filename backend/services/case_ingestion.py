"""
Case Ingestion Service
Handles PDF processing and brief analysis.
"""

import io
import re
from typing import Dict, Any, List

from pypdf import PdfReader


class CaseIngestionService:
    """
    Processes uploaded PDFs and extracts structured legal content.
    
    Pipeline:
    1. Extract raw text from PDF
    2. Clean and normalize text
    3. Identify brief structure (sections, arguments, citations)
    4. Generate discrepancy map when comparing briefs
    """
    
    def __init__(self):
        self.section_patterns = [
            r"(?i)(question[s]?\s+presented|issues?\s+presented)",
            r"(?i)(statement\s+of\s+(?:the\s+)?(?:case|facts))",
            r"(?i)(summary\s+of\s+(?:the\s+)?argument)",
            r"(?i)(argument)",
            r"(?i)(conclusion)",
            r"(?i)(relief\s+requested)"
        ]
        
        self.citation_pattern = r"\d+\s+[A-Z][a-z]*\.?\s*(?:\d+[a-z]*\s*)?\d+"
    
    async def process_pdf(self, content: bytes, role: str = "appellant") -> Dict[str, Any]:
        """
        Process a PDF brief and extract structured content.
        
        Args:
            content: PDF file content as bytes
            role: 'appellant', 'appellee', or 'evidence'
            
        Returns:
            {
                "role": str,
                "raw_text": str,
                "cleaned_text": str,
                "sections": {...},
                "citations": [...],
                "word_count": int
            }
        """
        # Extract text from PDF
        raw_text = self._extract_text(content)
        
        # Clean the text
        cleaned_text = self._clean_text(raw_text)
        
        # Identify sections
        sections = self._identify_sections(cleaned_text)
        
        # Extract citations
        citations = self._extract_citations(cleaned_text)
        
        return {
            "role": role,
            "raw_text": raw_text,
            "cleaned_text": cleaned_text,
            "sections": sections,
            "citations": citations,
            "word_count": len(cleaned_text.split())
        }
    
    def _extract_text(self, content: bytes) -> str:
        """Extract raw text from PDF bytes."""
        try:
            pdf_file = io.BytesIO(content)
            reader = PdfReader(pdf_file)
            
            text_parts = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            
            return "\n\n".join(text_parts)
        except Exception as e:
            raise ValueError(f"Failed to extract PDF text: {e}")
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize extracted text."""
        # Remove excessive whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Fix hyphenation at line breaks
        text = re.sub(r'-\s+', '', text)
        
        # Remove page numbers
        text = re.sub(r'\b\d+\s*$', '', text, flags=re.MULTILINE)
        
        # Remove headers/footers (common patterns)
        text = re.sub(r'(?i)page\s+\d+\s+of\s+\d+', '', text)
        
        # Normalize quotes
        text = text.replace('"', '"').replace('"', '"')
        text = text.replace(''', "'").replace(''', "'")
        
        return text.strip()
    
    def _identify_sections(self, text: str) -> Dict[str, str]:
        """Identify major sections in the brief."""
        sections = {}
        
        for pattern in self.section_patterns:
            matches = list(re.finditer(pattern, text))
            if matches:
                section_name = matches[0].group(1).lower().strip()
                start = matches[0].end()
                
                # Find next section or end of text
                next_section_start = len(text)
                for other_pattern in self.section_patterns:
                    if other_pattern != pattern:
                        other_matches = list(re.finditer(other_pattern, text[start:]))
                        if other_matches:
                            potential_end = start + other_matches[0].start()
                            if potential_end < next_section_start:
                                next_section_start = potential_end
                
                section_content = text[start:next_section_start].strip()
                sections[section_name] = section_content[:5000]  # Limit size
        
        return sections
    
    def _extract_citations(self, text: str) -> List[str]:
        """Extract legal citations from text."""
        citations = re.findall(self.citation_pattern, text)
        # Deduplicate while preserving order
        seen = set()
        unique_citations = []
        for citation in citations:
            normalized = citation.strip()
            if normalized not in seen:
                seen.add(normalized)
                unique_citations.append(normalized)
        
        return unique_citations[:50]  # Limit to top 50
