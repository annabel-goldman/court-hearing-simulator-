"""
Moot Court Main Application
Real-time speech recognition with judge interruptions for moot court practice.
"""

import argparse
import os
import numpy as np
import speech_recognition as sr
import whisper
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from queue import Queue
from time import sleep
from sys import platform

from context_manager import MootCourtContext
from judge_analyzer import JudgeAnalyzer
from moot_court_interruptor import judge_interrupt_check, handle_judge_interruption


def main():
    parser = argparse.ArgumentParser(description="Moot Court Practice with AI Judge")
    parser.add_argument(
        "--model",
        default="small",
        help="Whisper model to use",
        choices=["tiny", "base", "small", "medium", "large"],
    )
    parser.add_argument(
        "--non_english", action="store_true", help="Don't use the english model."
    )
    parser.add_argument(
        "--energy_threshold",
        default=2000,
        help="Energy level for mic to detect.",
        type=int,
    )
    parser.add_argument(
        "--record_timeout",
        default=0.5,
        help="How real time the recording is in seconds.",
        type=float,
    )
    parser.add_argument(
        "--phrase_timeout",
        default=3,
        help="How much empty space between recordings before we "
        "consider it a new line in the transcription.",
        type=float,
    )
    parser.add_argument(
        "--judge_personality",
        default="strict",
        choices=["strict", "lenient", "socratic"],
        help="Judge personality type",
    )
    parser.add_argument(
        "--interruption_frequency",
        default="medium",
        choices=["high", "medium", "low"],
        help="How frequently the judge interrupts",
    )
    if "linux" in platform:
        parser.add_argument(
            "--default_microphone",
            default="pulse",
            help="Default microphone name for SpeechRecognition. "
            "Run this with 'list' to view available Microphones.",
            type=str,
        )
    args = parser.parse_args()

    # Initialize context manager
    # TODO: Load from config file
    context = MootCourtContext(
        case_facts={
            "case_name": "Example v. Example",
            "court": "Federal Appellate Court",
        },
        legal_issues=["standing", "first_amendment"],
        user_position="petitioner"
    )

    # Initialize judge analyzer
    analyzer = JudgeAnalyzer(
        judge_personality=args.judge_personality,
        interruption_frequency=args.interruption_frequency
    )

    # The last time a recording was retrieved from the queue.
    phrase_time = None
    # Thread safe Queue for passing data from the threaded recording callback.
    data_queue = Queue()
    # We use SpeechRecognizer to record our audio because it has a nice feature where it can detect when speech ends.
    recorder = sr.Recognizer()
    recorder.energy_threshold = args.energy_threshold
    # Definitely do this, dynamic energy compensation lowers the energy threshold dramatically to a point where the SpeechRecognizer never stops recording.
    recorder.dynamic_energy_threshold = False

    source = sr.Microphone(sample_rate=16000)

    # Load / Download model
    model = args.model
    if args.model != "large" and not args.non_english:
        model = model + ".en"
    print("Loading Whisper model...")
    audio_model = whisper.load_model(model)

    record_timeout = args.record_timeout
    phrase_timeout = args.phrase_timeout

    with source:
        recorder.adjust_for_ambient_noise(source)

    def record_callback(_, audio: sr.AudioData) -> None:
        """
        Threaded callback function to receive audio data when recordings finish.
        audio: An AudioData containing the recorded bytes.
        """
        # Grab the raw bytes and push it into the thread safe queue.
        data = audio.get_raw_data()
        data_queue.put(data)

    # Create a background thread that will pass us raw audio bytes.
    # We could do this manually but SpeechRecognizer provides a nice helper.
    recorder.listen_in_background(
        source, record_callback, phrase_time_limit=record_timeout
    )

    # Cue the user that we're ready to go.
    print("\n" + "="*60)
    print("Moot Court Practice Session Started")
    print("="*60)
    print(f"Judge Personality: {args.judge_personality}")
    print(f"Interruption Frequency: {args.interruption_frequency}")
    print(f"Case: {context.case_facts.get('case_name', 'N/A')}")
    print(f"Your Position: {context.user_position}")
    print("\nModel loaded. Begin your argument...\n")

    full_transcript = ""
    interruption_in_progress = False

    while True:
        try:
            now = datetime.utcnow()
            # Pull raw recorded audio from the queue.
            if not data_queue.empty():
                phrase_complete = False
                # If enough time has passed between recordings, consider the phrase complete.
                # Clear the current working audio buffer to start over with the new data.
                if phrase_time and now - phrase_time > timedelta(
                    seconds=phrase_timeout
                ):
                    phrase_complete = True
                # This is the last time we received new audio data from the queue.
                phrase_time = now

                # Combine audio data from queue
                audio_data = b"".join(data_queue.queue)
                data_queue.queue.clear()

                # Convert in-ram buffer to something the model can use directly without needing a temp file.
                # Convert data from 16 bit wide integers to floating point with a width of 32 bits.
                # Clamp the audio stream frequency to a PCM wavelength compatible default of 32768hz max.
                audio_np = (
                    np.frombuffer(audio_data, dtype=np.int16).astype(np.float32)
                    / 32768.0
                )

                # Read the transcription.
                result = audio_model.transcribe(audio_np, fp16=False)
                text = result["text"].strip()

                if text != "":
                    print("HEARD: ", text)

                    # Update transcript
                    if full_transcript.split(" ")[-1] == text.split(" ")[0]:
                        text = " ".join(text.split(" ")[1:])
                    full_transcript += " " + text
                    full_transcript = "".join(
                        e for e in full_transcript if e.isalnum() or e.isspace()
                    )
                    
                    # Update context
                    context.update_transcript(text)
                    print("TRANSCRIPT: ", context.get_recent_transcript(max_chars=200))

                    # Check for judge interruption (only if not already interrupted)
                    if not interruption_in_progress:
                        with ThreadPoolExecutor(max_workers=1) as executor:
                            future = executor.submit(
                                judge_interrupt_check, 
                                context.full_transcript, 
                                context, 
                                analyzer
                            )
                            should_interrupt, question = future.result()
                            
                            if should_interrupt and question:
                                interruption_in_progress = True
                                print("\n" + "!"*60)
                                print("JUDGE INTERRUPTION!")
                                print("!"*60 + "\n")
                                
                                # Handle the interruption
                                handle_judge_interruption(question, context)
                                
                                # Wait a bit for TTS to finish, then reset flag
                                # In a real implementation, you'd want to wait for user response
                                sleep(3)  # Give time for question to be spoken
                                interruption_in_progress = False
                                
                                print("\nContinue your argument...\n")

                # Infinite loops are bad for processors, must sleep.
                sleep(0.05)
        except KeyboardInterrupt:
            break

    # Session summary
    print("\n" + "="*60)
    print("Session Ended")
    print("="*60)
    summary = context.get_session_summary()
    print(f"Duration: {summary['duration_seconds']:.1f} seconds")
    print(f"Total Interruptions: {summary['total_interruptions']}")
    print(f"Questions Asked: {summary['questions_asked']}")
    print(f"Questions Answered: {summary['questions_answered']}")
    print(f"Topics Discussed: {', '.join(summary['topics_discussed'])}")
    print("\nFull transcript saved in context.")


if __name__ == "__main__":
    main()

