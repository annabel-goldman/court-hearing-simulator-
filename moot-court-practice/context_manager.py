"""
Context Manager for Moot Court System
Maintains conversation history, case context, and argument state.
"""

from datetime import datetime
from typing import Dict, List, Optional


class MootCourtContext:
    """Manages context for a moot court argument session."""
    
    def __init__(self, case_facts: Optional[Dict] = None, legal_issues: Optional[List[str]] = None, 
                 user_position: Optional[str] = None):
        """
        Initialize context manager.
        
        Args:
            case_facts: Dictionary with case information
            legal_issues: List of legal issues in the case
            user_position: "petitioner" or "respondent"
        """
        self.case_facts = case_facts or {}
        self.legal_issues = legal_issues or []
        self.user_position = user_position or "petitioner"
        
        # Conversation tracking
        self.full_transcript = ""
        self.judge_questions: List[Dict] = []
        self.current_topic = ""
        self.interruption_count = 0
        self.last_interruption_time: Optional[datetime] = None
        
        # Session metadata
        self.session_start_time = datetime.now()
        self.topics_discussed: List[str] = []
    
    def update_transcript(self, new_text: str) -> None:
        """
        Add new text to the transcript.
        
        Args:
            new_text: New transcribed text to add
        """
        if new_text.strip():
            if self.full_transcript and not self.full_transcript.endswith(" "):
                self.full_transcript += " "
            self.full_transcript += new_text.strip()
    
    def add_judge_question(self, question: str, reasoning: str = "", topic: str = "") -> None:
        """
        Record a judge question and update interruption tracking.
        
        Args:
            question: The judge's question
            reasoning: Why the judge asked this question
            topic: What topic/issue this relates to
        """
        self.judge_questions.append({
            "question": question,
            "timestamp": datetime.now(),
            "reasoning": reasoning,
            "topic": topic,
            "user_response": None  # Will be filled when user responds
        })
        self.interruption_count += 1
        self.last_interruption_time = datetime.now()
        
        if topic and topic not in self.topics_discussed:
            self.topics_discussed.append(topic)
    
    def add_user_response(self, response: str) -> None:
        """
        Add user's response to the most recent judge question.
        
        Args:
            response: User's response text
        """
        if self.judge_questions:
            self.judge_questions[-1]["user_response"] = response
            self.update_transcript(response)
    
    def get_recent_transcript(self, max_chars: int = 1000) -> str:
        """
        Get the most recent portion of the transcript.
        
        Args:
            max_chars: Maximum characters to return
            
        Returns:
            Recent transcript text
        """
        if len(self.full_transcript) <= max_chars:
            return self.full_transcript
        return "..." + self.full_transcript[-max_chars:]
    
    def get_conversation_history(self, max_qa_pairs: int = 5) -> str:
        """
        Get formatted conversation history (Q&A pairs).
        
        Args:
            max_qa_pairs: Maximum number of recent Q&A pairs to include
            
        Returns:
            Formatted conversation history string
        """
        if not self.judge_questions:
            return "No questions asked yet."
        
        history_parts = []
        recent_questions = self.judge_questions[-max_qa_pairs:]
        
        for qa in recent_questions:
            history_parts.append(f"Judge: {qa['question']}")
            if qa['user_response']:
                history_parts.append(f"Advocate: {qa['user_response']}")
            else:
                history_parts.append("Advocate: [No response yet]")
        
        return "\n".join(history_parts)
    
    def get_case_context_summary(self) -> str:
        """
        Get a formatted summary of case context.
        
        Returns:
            Formatted case context string
        """
        parts = []
        
        if self.case_facts:
            parts.append("Case Facts:")
            for key, value in self.case_facts.items():
                parts.append(f"  {key}: {value}")
        
        if self.legal_issues:
            parts.append(f"\nLegal Issues: {', '.join(self.legal_issues)}")
        
        parts.append(f"\nAdvocate Position: {self.user_position}")
        
        return "\n".join(parts)
    
    def time_since_last_interruption(self) -> Optional[float]:
        """
        Get seconds since last interruption.
        
        Returns:
            Seconds since last interruption, or None if no interruptions yet
        """
        if self.last_interruption_time is None:
            return None
        return (datetime.now() - self.last_interruption_time).total_seconds()
    
    def get_session_summary(self) -> Dict:
        """
        Get a summary of the session.
        
        Returns:
            Dictionary with session statistics
        """
        duration = (datetime.now() - self.session_start_time).total_seconds()
        
        return {
            "duration_seconds": duration,
            "total_interruptions": self.interruption_count,
            "topics_discussed": self.topics_discussed,
            "transcript_length": len(self.full_transcript),
            "questions_asked": len(self.judge_questions),
            "questions_answered": sum(1 for q in self.judge_questions if q["user_response"] is not None)
        }


if __name__ == "__main__":
    # Basic testing
    print("Testing MootCourtContext...")
    
    # Create context
    context = MootCourtContext(
        case_facts={"case_name": "Test v. Test", "court": "Federal Appellate"},
        legal_issues=["standing", "first_amendment"],
        user_position="petitioner"
    )
    
    # Test transcript updates
    context.update_transcript("Your honor, I would like to address the issue of standing.")
    context.update_transcript("The plaintiff has a clear interest in this matter.")
    print(f"Transcript: {context.full_transcript}")
    
    # Test judge question
    context.add_judge_question(
        "Can you explain how the plaintiff's interest differs from a general public interest?",
        reasoning="Need clarification on standing",
        topic="standing"
    )
    print(f"Interruption count: {context.interruption_count}")
    print(f"Time since interruption: {context.time_since_last_interruption()}")
    
    # Test user response
    context.add_user_response("Yes, your honor. The plaintiff has a direct, concrete injury.")
    print(f"Conversation history:\n{context.get_conversation_history()}")
    
    # Test summary
    summary = context.get_session_summary()
    print(f"\nSession summary: {summary}")
    
    print("\n[OK] Context manager tests passed!")

