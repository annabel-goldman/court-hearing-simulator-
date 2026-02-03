"""
Judge Analyzer for Moot Court System
Analyzes advocate's argument and determines when judge should interrupt.
"""

from typing import Dict, Optional, Tuple
from openai import OpenAI
from dotenv import load_dotenv
import os
import json

load_dotenv()

openai_api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(
    api_key=openai_api_key,
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
)


class JudgeAnalyzer:
    """Analyzes arguments and generates judge questions."""
    
    def __init__(self, judge_personality: str = "strict", interruption_frequency: str = "medium"):
        """
        Initialize judge analyzer.
        
        Args:
            judge_personality: "strict", "lenient", or "socratic"
            interruption_frequency: "high", "medium", or "low"
        """
        self.judge_personality = judge_personality
        self.interruption_frequency = interruption_frequency
        self.model = "gpt-4"  # Using GPT-4 for judge analysis
        
        # Timing parameters based on frequency
        self.min_seconds_between = {
            "high": 5,
            "medium": 10,
            "low": 20
        }.get(interruption_frequency, 10)
    
    def _get_judge_system_prompt(self) -> str:
        """Get the system prompt for the judge based on personality."""
        base_prompt = """You are a federal appellate court judge presiding over a moot court argument.
Your role is to:
1. Listen carefully to the advocate's argument
2. Identify points that need clarification, have logical gaps, or raise questions
3. Interrupt naturally when you have a substantive question
4. Ask probing questions that test the advocate's understanding
5. Be respectful but challenging

Guidelines:
- Interrupt when the argument is unclear or you need clarification
- Interrupt when you spot a logical weakness or inconsistency
- Interrupt when you want to test the advocate's knowledge
- Don't interrupt too frequently (allow advocate to develop points)
- Questions should be substantive and relevant to the case
- Use natural judicial language and tone"""
        
        personality_additions = {
            "strict": "\n\nYou are a strict, demanding judge who challenges arguments rigorously and expects precise legal reasoning.",
            "lenient": "\n\nYou are a more lenient judge who gives advocates room to explain but still asks clarifying questions when needed.",
            "socratic": "\n\nYou use the Socratic method, asking questions to guide the advocate to discover weaknesses in their own argument."
        }
        
        return base_prompt + personality_additions.get(self.judge_personality, "")
    
    def should_interrupt(
        self, 
        transcript: str, 
        context_summary: str, 
        conversation_history: str,
        time_since_last: Optional[float]
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Determine if judge should interrupt and generate question if so.
        
        Args:
            transcript: Current transcript of advocate's argument
            context_summary: Case context summary
            conversation_history: Recent Q&A history
            time_since_last: Seconds since last interruption (None if no interruptions yet)
        
        Returns:
            Tuple of (should_interrupt: bool, question: str or None, reasoning: str or None)
        """
        # Check timing constraint
        if time_since_last is not None and time_since_last < self.min_seconds_between:
            return False, None, "Too soon since last interruption"
        
        # If transcript is very short, don't interrupt yet
        if len(transcript.strip().split()) < 10:
            return False, None, "Transcript too short"
        
        # Prepare the analysis prompt
        analysis_prompt = f"""Based on the advocate's argument so far:

TRANSCRIPT:
{transcript}

CASE CONTEXT:
{context_summary}

CONVERSATION HISTORY:
{conversation_history if conversation_history else "No previous questions yet."}

Determine:
1. Should you interrupt now? Consider:
   - Is the current point unclear or confusing?
   - Are there logical gaps in the argument?
   - Do you need clarification on a specific claim?
   - Is this a good natural pause point?
   - Have you already asked about this topic recently?
   - Has enough time passed since your last question? (Minimum: {self.min_seconds_between} seconds)

2. If yes, what is your question? Make it substantive and relevant.

Respond in JSON format:
{{
    "should_interrupt": true/false,
    "question": "Your question here" (or null if not interrupting),
    "reasoning": "Brief explanation of why interrupting or not",
    "topic": "What legal issue/topic this relates to"
}}"""

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_judge_system_prompt() + "\n\nIMPORTANT: Respond ONLY with valid JSON in this exact format: {\"should_interrupt\": true/false, \"question\": \"...\", \"reasoning\": \"...\", \"topic\": \"...\"}"},
                    {"role": "user", "content": analysis_prompt}
                ],
                temperature=0.7,
                max_tokens=300
            )
            
            # Parse JSON from response (may need to extract if wrapped in markdown)
            content = response.choices[0].message.content.strip()
            # Remove markdown code blocks if present
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content
            if content.startswith("```json"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content
            
            # Try to extract JSON if it's embedded in text
            import re
            json_match = re.search(r'\{[^{}]*"should_interrupt"[^{}]*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group(0)
            
            result = json.loads(content)
            
            should_interrupt = result.get("should_interrupt", False)
            question = result.get("question")
            reasoning = result.get("reasoning", "")
            topic = result.get("topic", "")
            
            return should_interrupt, question, reasoning
            
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON from judge response: {e}")
            if 'response' in locals():
                print(f"Response content: {response.choices[0].message.content[:200]}...")
            # Fallback: don't interrupt if we can't parse
            return False, None, f"JSON parse error: {str(e)}"
        except Exception as e:
            print(f"Error in judge analysis: {e}")
            return False, None, f"Error: {str(e)}"
    
    def generate_question_directly(self, transcript: str, context_summary: str) -> str:
        """
        Generate a question directly without the interrupt decision.
        Useful for testing or forced interruptions.
        
        Args:
            transcript: Current transcript
            context_summary: Case context
        
        Returns:
            Judge's question
        """
        prompt = f"""Based on this argument:

{transcript}

Case context:
{context_summary}

Generate a substantive judicial question that would help clarify or challenge the argument.
Be specific and relevant to the legal issues at hand."""

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_judge_system_prompt()},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=200
            )
            
            return response.choices[0].message.content.strip()
        except Exception as e:
            return f"Error generating question: {e}"


if __name__ == "__main__":
    # Basic testing
    print("Testing JudgeAnalyzer...")
    
    # Check if API key is set
    if not openai_api_key:
        print("WARNING: OPENAI_API_KEY not set. Some tests will fail.")
        print("Set OPENAI_API_KEY in .env file to test fully.")
    else:
        analyzer = JudgeAnalyzer(judge_personality="strict", interruption_frequency="medium")
        
        # Test with sample transcript
        test_transcript = """
        Your honor, I would like to address the issue of standing in this case.
        The plaintiff has a clear and concrete interest that is distinct from
        the general public. This interest arises from the direct harm they have
        suffered as a result of the defendant's actions.
        """
        
        test_context = """
        Case: First Amendment challenge to government regulation
        Legal Issues: standing, first_amendment, prior_restraint
        Advocate Position: petitioner
        """
        
        print("\nTesting should_interrupt()...")
        should, question, reasoning = analyzer.should_interrupt(
            transcript=test_transcript,
            context_summary=test_context,
            conversation_history="",
            time_since_last=None
        )
        
        print(f"Should interrupt: {should}")
        if question:
            print(f"Question: {question}")
        print(f"Reasoning: {reasoning}")
        
        print("\n[OK] Judge analyzer basic tests completed!")
        print("Note: Full testing requires valid API key and will make API calls.")

