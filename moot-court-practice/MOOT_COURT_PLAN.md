# Moot Court Interruption System - Implementation Plan

## Overview
Adapt the interrupting-cow framework to create a moot court practice system where a simulated judge (GPT-4) listens to your oral argument and interrupts when it has a question to ask.

## Key Differences from Original System

### Original System:
- **Predicts** what user will say next
- Interrupts when prediction **matches** user's speech
- Uses prediction to generate a response

### Moot Court System:
- **Analyzes** what user is currently saying
- Interrupts when judge **has a question** based on the argument
- Uses judge's reasoning to generate a question

## Architecture Changes

### 1. Core Logic Replacement

**Current Flow:**
```
whisper(audio) → transcript → predict_completion() → check_match() → interrupt
```

**New Flow:**
```
whisper(audio) → transcript → judge_analyze() → should_interrupt() → interrupt
```

### 2. New Components Needed

#### A. Judge Analysis Module (`judge_analyzer.py`)
- **Purpose**: Analyze the user's argument and determine if judge has a question
- **Input**: Current transcript, conversation history, case context
- **Output**: 
  - Boolean: Should interrupt?
  - Question (if interrupting)
  - Reasoning (optional, for debugging)

#### B. Context Manager (`context_manager.py`)
- **Purpose**: Maintain conversation history and case context
- **Stores**:
  - Full transcript of user's argument
  - Previous judge questions and user responses
  - Case facts, legal issues, user's position
  - Current topic/point being argued

#### C. Interruption Decision Logic (`interruption_logic.py`)
- **Purpose**: Determine when judge should interrupt
- **Factors to consider**:
  - Clarity of argument (unclear points → questions)
  - Logical gaps or weaknesses
  - Need for clarification
  - Natural pause points in speech
  - Time since last interruption (avoid too frequent)

### 3. Modified Components

#### A. `interruptor.py` → `moot_court_interruptor.py`
**Changes:**
- Remove: `find_converged_completion()`, `check_match()`, `llm()` (prediction)
- Add: `judge_should_interrupt()`, `generate_judge_question()`
- Modify: `thoughtocomplete()` → `judge_interrupt_check()`

**New Function Signature:**
```python
def judge_interrupt_check(transcript, context):
    """
    Check if judge should interrupt based on current transcript.
    
    Args:
        transcript: Current speech transcript
        context: ContextManager object with conversation history
    
    Returns:
        (should_interrupt: bool, question: str or None)
    """
```

#### B. `whisperrt.py` → `moot_court_main.py`
**Changes:**
- Rename for clarity
- Modify main loop to:
  - Pass context to interrupt check
  - Handle judge questions and user responses
  - Continue after interruption (don't break)
  - Track conversation state

### 4. Judge Prompt Engineering

#### System Prompt for Judge:
```
You are a federal appellate court judge presiding over a moot court argument.
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
- Use natural judicial language and tone
```

#### Question Generation Prompt:
```
Based on the advocate's argument so far:
[TRANSCRIPT]

And the conversation history:
[CONVERSATION_HISTORY]

Case context:
[CASE_CONTEXT]

Determine:
1. Should you interrupt now? (yes/no)
2. If yes, what is your question?

Consider:
- Is the current point unclear or confusing?
- Are there logical gaps in the argument?
- Do you need clarification on a specific claim?
- Is this a good natural pause point?
- Have you already asked about this topic recently?
```

## Implementation Steps

### Phase 1: Core Infrastructure
1. ✅ Create `context_manager.py`
   - Implement conversation history storage
   - Add case context initialization
   - Track current argument state

2. ✅ Create `judge_analyzer.py`
   - Implement `should_interrupt()` function
   - Implement `generate_question()` function
   - Add prompt templates for judge behavior

3. ✅ Create `moot_court_interruptor.py`
   - Adapt from `interruptor.py`
   - Replace prediction logic with judge analysis
   - Update interruption flow

### Phase 2: Integration
4. ✅ Create `moot_court_main.py`
   - Adapt from `whisperrt.py`
   - Integrate context manager
   - Update main loop for continuous conversation
   - Handle judge questions and user responses

5. ✅ Update TTS for judge voice
   - Use appropriate voice (e.g., "onyx" for authoritative judge)
   - Add judge introduction/interruption cues

### Phase 3: Configuration & Polish
6. ✅ Add configuration file
   - Case facts/context
   - Judge personality settings
   - Interruption frequency parameters
   - Legal issues to focus on

7. ✅ Add conversation management
   - Track Q&A pairs
   - Handle user responses to questions
   - Resume argument after interruption
   - Session summary/feedback

## Technical Details

### Interruption Decision Algorithm

```python
def should_interrupt(transcript, context):
    """
    Multi-factor decision for interruption:
    
    1. Analyze transcript for:
       - Unclear statements
       - Logical inconsistencies
       - Missing citations or support
       - Ambiguous legal terms
    
    2. Check timing:
       - Minimum time since last interruption
       - Natural pause in speech
       - Sentence/thought completion
    
    3. Check context:
       - Have we asked about this before?
       - Is this a critical point?
       - Is advocate still developing this point?
    
    4. Generate question if interrupting
    """
```

### Context Structure

```python
class MootCourtContext:
    case_facts: dict
    legal_issues: list
    user_position: str
    full_transcript: str
    judge_questions: list[dict]  # [{question, timestamp, user_response}]
    current_topic: str
    interruption_count: int
    last_interruption_time: datetime
```

### Judge Question Format

```python
{
    "should_interrupt": bool,
    "question": str,
    "reasoning": str,  # Why interrupting (for debugging)
    "topic": str,      # What part of argument
    "urgency": str     # "high", "medium", "low"
}
```

## Configuration Options

### Case Configuration (`case_config.json` or `.env`)
```json
{
    "case_name": "Example v. Example",
    "court_level": "federal_appellate",
    "legal_issues": ["standing", "first_amendment", "prior_restraint"],
    "user_role": "petitioner" or "respondent",
    "case_facts": "...",
    "key_precedents": ["Case1", "Case2"]
}
```

### Judge Configuration
```json
{
    "judge_personality": "strict" | "lenient" | "socratic",
    "interruption_frequency": "high" | "medium" | "low",
    "question_style": "probing" | "clarifying" | "challenging",
    "min_seconds_between_interruptions": 10,
    "max_interruptions_per_minute": 2
}
```

## Usage Flow

1. **Initialization**
   - Load case configuration
   - Initialize context manager
   - Set up judge persona
   - Start audio recording

2. **Main Loop**
   - Record and transcribe user speech
   - Update transcript in context
   - Check if judge should interrupt
   - If interrupting:
     - Generate judge question
     - Play interruption cue
     - Speak judge question
     - Wait for user response
     - Update context with Q&A
   - Continue listening

3. **Session End**
   - Generate feedback/summary
   - Save conversation log
   - Provide performance metrics

## Testing Strategy

1. **Unit Tests**
   - Judge analysis logic
   - Context management
   - Interruption timing

2. **Integration Tests**
   - Full conversation flow
   - Multiple interruptions
   - Context persistence

3. **User Testing**
   - Real moot court arguments
   - Judge question quality
   - Interruption timing naturalness

## Future Enhancements

1. **Multi-judge panel** - Multiple judges with different perspectives
2. **Time management** - Track argument time, warn when running out
3. **Performance scoring** - Rate advocate's responses
4. **Case library** - Multiple cases to practice with
5. **Recording/playback** - Review sessions later
6. **Adaptive difficulty** - Adjust judge strictness based on performance

## Files to Create/Modify

### New Files:
- `moot_court_interruptor.py` - Core interruption logic
- `judge_analyzer.py` - Judge analysis and question generation
- `context_manager.py` - Conversation and case context
- `moot_court_main.py` - Main application entry point
- `case_config.json` - Case configuration template
- `judge_config.json` - Judge personality configuration

### Modified Files:
- `interruptor.py` - Keep as reference, create new version
- `whisperrt.py` - Keep as reference, create new version

### Dependencies:
- All existing dependencies remain
- No new major dependencies needed
- May want to add `json` for configuration (already in stdlib)

## Next Steps

1. Start with `context_manager.py` - simplest component
2. Build `judge_analyzer.py` - core logic
3. Create `moot_court_interruptor.py` - adapt existing code
4. Integrate in `moot_court_main.py`
5. Test with sample arguments
6. Refine judge prompts and interruption logic
7. Add configuration system
8. Polish and user testing

