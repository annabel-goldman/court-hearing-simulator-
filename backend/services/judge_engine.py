"""
Judge Engine for Courtroom Simulation
Based on moot-court-practice JudgeAnalyzer - analyzes arguments and generates questions.
"""

import os
import json
import re
from typing import Dict, List, Optional, Tuple
from datetime import datetime

from dotenv import load_dotenv

# Load environment variables from the root .env file
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))

# Lazy-load OpenAI client to avoid errors when API key is not set
_openai_client = None

def get_openai_client():
    """Get or create the OpenAI client."""
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print("WARNING: OPENAI_API_KEY not set. Judge engine will use mock responses.")
            return None
        from openai import AsyncOpenAI
        _openai_client = AsyncOpenAI(
            api_key=api_key,
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        )
    return _openai_client


class MootCourtContext:
    """Manages context for a courtroom session. Based on moot-court-practice context_manager."""
    
    def __init__(self, case_facts: Optional[Dict] = None, legal_issues: Optional[List[str]] = None,
                 user_position: Optional[str] = None):
        self.case_facts = case_facts or {}
        self.legal_issues = legal_issues or []
        self.user_position = user_position or "petitioner"
        
        self.full_transcript = ""
        self.judge_questions: List[Dict] = []
        self.current_topic = ""
        self.interruption_count = 0
        self.last_interruption_time: Optional[datetime] = None
        self.session_start_time = datetime.now()
        self.topics_discussed: List[str] = []
    
    def update_transcript(self, new_text: str) -> None:
        if new_text.strip():
            if self.full_transcript and not self.full_transcript.endswith(" "):
                self.full_transcript += " "
            self.full_transcript += new_text.strip()
    
    def add_judge_question(self, question: str, reasoning: str = "", topic: str = "") -> None:
        self.judge_questions.append({
            "question": question,
            "timestamp": datetime.now(),
            "reasoning": reasoning,
            "topic": topic,
            "user_response": None
        })
        self.interruption_count += 1
        self.last_interruption_time = datetime.now()
        
        if topic and topic not in self.topics_discussed:
            self.topics_discussed.append(topic)
    
    def get_recent_transcript(self, max_chars: int = 1500) -> str:
        if len(self.full_transcript) <= max_chars:
            return self.full_transcript
        return "..." + self.full_transcript[-max_chars:]
    
    def get_conversation_history(self, max_qa_pairs: int = 3) -> str:
        if not self.judge_questions:
            return "No questions asked yet."
        
        history_parts = []
        recent_questions = self.judge_questions[-max_qa_pairs:]
        
        for qa in recent_questions:
            history_parts.append(f"Judge: {qa['question']}")
            if qa['user_response']:
                history_parts.append(f"Advocate: {qa['user_response']}")
        
        return "\n".join(history_parts)
    
    def get_case_context_summary(self) -> str:
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
        if self.last_interruption_time is None:
            return None
        return (datetime.now() - self.last_interruption_time).total_seconds()


class JudgeEngine:
    """
    Judge question engine based on moot-court-practice JudgeAnalyzer.
    Analyzes arguments and decides when to interrupt with questions.
    """
    
    def __init__(
        self, 
        judge_personality: str = "strict",
        interruption_frequency: str = "medium"
    ):
        self.judge_personality = judge_personality
        self.interruption_frequency = interruption_frequency
        self.model = "gpt-4"
        
        # Timing parameters based on frequency
        self.min_seconds_between = {
            "high": 5,
            "medium": 10,
            "low": 20
        }.get(interruption_frequency, 10)
        
        # Session contexts (keyed by session_id)
        self.contexts: Dict[str, MootCourtContext] = {}
    
    def get_or_create_context(self, session_id: str, config: Optional[Dict] = None) -> MootCourtContext:
        """Get existing context or create new one for session."""
        if session_id not in self.contexts:
            self.contexts[session_id] = MootCourtContext(
                case_facts=config.get('case_facts', {}) if config else {},
                legal_issues=config.get('legal_issues', []) if config else [],
                user_position=config.get('user_position', 'petitioner') if config else 'petitioner'
            )
        return self.contexts[session_id]
    
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
    
    async def should_interrupt(
        self,
        session_id: str,
        transcript: str,
        config: Optional[Dict] = None,
        custom_system_prompt: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Determine if judge should interrupt and generate question if so.
        Based on moot-court-practice JudgeAnalyzer.should_interrupt()
        
        Returns:
            Tuple of (should_interrupt: bool, question: str or None, reasoning: str or None)
        """
        context = self.get_or_create_context(session_id, config)
        context.update_transcript(transcript)
        
        time_since_last = context.time_since_last_interruption()
        
        # Check timing constraint
        if time_since_last is not None and time_since_last < self.min_seconds_between:
            return False, None, "Too soon since last interruption"
        
        # If transcript is very short, don't interrupt yet
        if len(context.full_transcript.strip().split()) < 10:
            return False, None, "Transcript too short"
        
        recent_transcript = context.get_recent_transcript(max_chars=1500)
        case_context = context.get_case_context_summary()
        conversation_history = context.get_conversation_history(max_qa_pairs=3)
        
        analysis_prompt = f"""Based on the advocate's argument so far:

TRANSCRIPT:
{recent_transcript}

CASE CONTEXT:
{case_context}

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
            client = get_openai_client()
            if not client:
                print("WARNING: OpenAI client not available, returning mock response")
                return False, None, "OpenAI API key not configured"
            
            # Use custom prompt if provided, otherwise use default
            system_prompt = custom_system_prompt or self._get_judge_system_prompt()
            
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt + "\n\nIMPORTANT: Respond ONLY with valid JSON."},
                    {"role": "user", "content": analysis_prompt}
                ],
                temperature=0.7,
                max_tokens=300
            )
            
            content = response.choices[0].message.content.strip()
            
            # Remove markdown code blocks if present
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content
            if content.startswith("```json"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]) if len(lines) > 2 else content
            
            # Try to extract JSON
            json_match = re.search(r'\{[^{}]*"should_interrupt"[^{}]*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group(0)
            
            result = json.loads(content)
            
            should_interrupt = result.get("should_interrupt", False)
            question = result.get("question")
            reasoning = result.get("reasoning", "")
            topic = result.get("topic", "")
            
            if should_interrupt and question:
                context.add_judge_question(question, reasoning=reasoning, topic=topic)
            
            return should_interrupt, question, reasoning
            
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON from judge response: {e}")
            return False, None, f"JSON parse error: {str(e)}"
        except Exception as e:
            print(f"Error in judge analysis: {e}")
            return False, None, f"Error: {str(e)}"
    
    async def summarize_briefs(
        self,
        appellant_text: str,
        appellee_text: str,
        system_prompt: Optional[str] = None
    ) -> str:
        """Generate a concise judicial summary of both briefs."""
        default_system = "You are an expert legal summarizer."
        
        prompt = f"""You are a senior law clerk summarizing two opposing legal briefs for an appellate judge.
Provide a concise summary (max 300 words) that captures:
1. The core legal dispute.
2. The appellant's primary argument.
3. The appellee's primary response.
4. The key precedents involved.

APPELLANT BRIEF TEXT:
{appellant_text[:4000]}

APPELLEE BRIEF TEXT:
{appellee_text[:4000]}

Format as a professional judicial summary."""

        try:
            client = get_openai_client()
            if not client:
                return "Judicial summary unavailable (API key not set)."
            
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt or default_system},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3, # Low temperature for factual summary
                max_tokens=500
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            print(f"Error summarizing briefs: {e}")
            return f"Error generating summary: {str(e)}"

    async def generate_seed_questions(
        self,
        appellant_brief: str,
        appellee_brief: str,
        system_prompt: Optional[str] = None
    ) -> List[Dict]:
        """Generate initial seed questions from briefs."""
        prompt = f"""Analyze these legal briefs and generate 5-8 substantive judicial questions.

APPELLANT BRIEF:
{appellant_brief[:3000]}

APPELLEE BRIEF:
{appellee_brief[:3000]}

Generate questions that:
1. Probe weak points in both arguments
2. Address conflicts between the briefs
3. Test understanding of key legal principles
4. Challenge logical gaps

Return as JSON array:
[
    {{"question": "...", "target": "appellant/appellee/both", "topic": "...", "difficulty": "easy/medium/hard"}},
    ...
]"""

        try:
            client = get_openai_client()
            if not client:
                print("WARNING: OpenAI client not available for seed questions")
                return []
            
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt or self._get_judge_system_prompt()},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=1000
            )
            
            content = response.choices[0].message.content.strip()
            print(f"[SeedQuestions] Raw OpenAI response:\n{content[:500]}...")
            
            # Extract JSON array from markdown code blocks if present
            if "```" in content:
                lines = content.split("\n")
                json_lines = []
                in_json = False
                for line in lines:
                    if line.startswith("```"):
                        in_json = not in_json
                    elif in_json:
                        json_lines.append(line)
                if json_lines:
                    content = "\n".join(json_lines)
                    print(f"[SeedQuestions] Extracted from code block:\n{content[:300]}...")
            
            # Try to find JSON array in the content
            if not content.strip().startswith("["):
                # Try to find array in the content
                start_idx = content.find("[")
                end_idx = content.rfind("]")
                if start_idx != -1 and end_idx != -1:
                    content = content[start_idx:end_idx + 1]
                    print(f"[SeedQuestions] Extracted array:\n{content[:300]}...")
            
            questions = json.loads(content)
            print(f"[SeedQuestions] Parsed {len(questions) if isinstance(questions, list) else 0} questions")
            return questions if isinstance(questions, list) else []
            
        except json.JSONDecodeError as e:
            print(f"[SeedQuestions] JSON parse error: {e}")
            print(f"[SeedQuestions] Content was: {content[:500] if content else 'None'}")
            return []
        except Exception as e:
            print(f"[SeedQuestions] Error generating seed questions: {e}")
            return []
    
    async def synthesize_question(
        self,
        transcript: str,
        seed_questions: List[str],
        brief_summary: str,
        asked_questions: List[str] = [],
        system_prompt: Optional[str] = None
    ) -> Dict:
        """Synthesize a new question based on recent transcript and seed questions."""
        prompt = f"""Based on the advocate's recent argument, generate a relevant judicial question.

RECENT TRANSCRIPT:
{transcript[-1500:]}

AVAILABLE SEED QUESTIONS (use as inspiration, don't repeat exactly):
{chr(10).join(f'- {q}' for q in seed_questions[:5])}

ALREADY ASKED (don't repeat):
{chr(10).join(f'- {q}' for q in asked_questions[-3:])}

BRIEF SUMMARY:
{brief_summary[:500]}

Generate a substantive question. Return JSON:
{{"should_interrupt": true/false, "question": "...", "reasoning": "..."}}"""

        try:
            client = get_openai_client()
            if not client:
                print("WARNING: OpenAI client not available for question synthesis")
                return {"should_interrupt": False, "question": None, "reasoning": "OpenAI API key not configured"}
            
            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt or self._get_judge_system_prompt()},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=200
            )
            
            content = response.choices[0].message.content.strip()
            
            # Extract JSON
            json_match = re.search(r'\{[^{}]*\}', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(0))
            
            return {"should_interrupt": False, "question": None, "reasoning": "Parse error"}
            
        except Exception as e:
            print(f"Error synthesizing question: {e}")
            return {"should_interrupt": False, "question": None, "reasoning": str(e)}
