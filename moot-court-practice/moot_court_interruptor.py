"""
Moot Court Interruptor
Adapts the original interruption logic for moot court judge interruptions.
"""

from concurrent.futures import ThreadPoolExecutor
import threading
import io
import soundfile as sf
import sounddevice as sd
from openai import OpenAI
from dotenv import load_dotenv
import os
from typing import Tuple, Optional

from context_manager import MootCourtContext
from judge_analyzer import JudgeAnalyzer

load_dotenv()

openai_api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(
    api_key=openai_api_key,
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
)


def tts(response: str, voice: str = "onyx") -> None:
    """
    Convert text to speech and play it.
    
    Args:
        response: Text to speak
        voice: Voice to use (default: "onyx" for authoritative judge voice)
    """
    try:
        spoken_response = client.audio.speech.create(
            model="tts-1", voice=voice, response_format="opus", input=response
        )

        buffer = io.BytesIO()
        for chunk in spoken_response.iter_bytes(chunk_size=4096):
            buffer.write(chunk)
        buffer.seek(0)

        with sf.SoundFile(buffer, "r") as sound_file:
            data = sound_file.read(dtype="int16")
            sd.play(data, sound_file.samplerate)
            sd.wait()
    except Exception as e:
        print(f"Error in TTS: {e}")


def tts_from_future(future) -> None:
    """
    Play TTS from a future result.
    
    Args:
        future: Future object containing the text to speak
    """
    try:
        text_to_speak = future.result()
        tts(text_to_speak, "onyx")
    except Exception as e:
        print(f"Error in TTS from future: {e}")


def judge_interrupt_check(
    transcript: str, 
    context: MootCourtContext, 
    analyzer: JudgeAnalyzer
) -> Tuple[bool, Optional[str]]:
    """
    Check if judge should interrupt based on current transcript.
    
    Args:
        transcript: Current speech transcript
        context: MootCourtContext object with conversation history
        analyzer: JudgeAnalyzer instance
    
    Returns:
        Tuple of (should_interrupt: bool, question: str or None)
    """
    # Get context information for judge analysis
    recent_transcript = context.get_recent_transcript(max_chars=1500)
    case_context = context.get_case_context_summary()
    conversation_history = context.get_conversation_history(max_qa_pairs=3)
    time_since_last = context.time_since_last_interruption()
    
    # Ask judge analyzer if we should interrupt
    should_interrupt, question, reasoning = analyzer.should_interrupt(
        transcript=recent_transcript,
        context_summary=case_context,
        conversation_history=conversation_history,
        time_since_last=time_since_last
    )
    
    if should_interrupt and question:
        print(f"JUDGE INTERRUPTION: {question}")
        print(f"Reasoning: {reasoning}")
        
        # Record the question in context
        topic = reasoning.split(":")[0] if ":" in reasoning else "general"
        context.add_judge_question(question, reasoning=reasoning, topic=topic)
        
        return True, question
    
    return False, None


def handle_judge_interruption(
    question: str, 
    context: MootCourtContext,
    play_interruption_cue: bool = True
) -> None:
    """
    Handle a judge interruption: play cue and question.
    
    Args:
        question: The judge's question
        context: MootCourtContext object
        play_interruption_cue: Whether to play "Your honor" cue
    """
    # Play interruption cue
    if play_interruption_cue:
        interruption_cue = "Your honor, I have a question."
        threading.Thread(
            target=tts,
            args=(interruption_cue, "onyx")
        ).start()
        # Small delay before question
        import time
        time.sleep(0.5)
    
    # Generate and play the question in a separate thread
    with ThreadPoolExecutor() as executor:
        future = executor.submit(lambda: question)  # Question is already generated
        threading.Thread(target=tts_from_future, args=(future,)).start()


if __name__ == "__main__":
    # Basic testing
    print("Testing MootCourtInterruptor...")
    
    # Create context and analyzer
    context = MootCourtContext(
        case_facts={"case_name": "Test v. Test"},
        legal_issues=["standing"],
        user_position="petitioner"
    )
    
    analyzer = JudgeAnalyzer(judge_personality="strict", interruption_frequency="medium")
    
    # Simulate transcript
    context.update_transcript(
        "Your honor, I would like to address the issue of standing. "
        "The plaintiff has a clear and concrete interest in this matter."
    )
    
    print(f"Transcript: {context.full_transcript}")
    print("\nTesting judge_interrupt_check()...")
    print("Note: This will make an API call if OPENAI_API_KEY is set.")
    
    should, question = judge_interrupt_check(context.full_transcript, context, analyzer)
    
    print(f"Should interrupt: {should}")
    if question:
        print(f"Question: {question}")
    
    print("\n[OK] Interruptor basic tests completed!")
    print("Note: Full testing requires valid API key and will make API calls.")

