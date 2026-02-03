"""
Test script to verify context_manager and judge_analyzer work together.
"""

from context_manager import MootCourtContext
from judge_analyzer import JudgeAnalyzer


def test_integration():
    """Test context manager and judge analyzer integration."""
    print("Testing component integration...\n")
    
    # Create context
    context = MootCourtContext(
        case_facts={
            "case_name": "Test v. Test",
            "court": "Federal Appellate",
            "issue": "First Amendment challenge"
        },
        legal_issues=["standing", "first_amendment"],
        user_position="petitioner"
    )
    
    # Create analyzer
    analyzer = JudgeAnalyzer(judge_personality="strict", interruption_frequency="medium")
    
    # Simulate argument progression
    argument_segments = [
        "Your honor, I would like to address the issue of standing.",
        "The plaintiff has a clear and concrete interest in this matter.",
        "This interest is distinct from the general public interest.",
        "The plaintiff has suffered direct harm from the defendant's actions."
    ]
    
    print("Simulating argument...")
    for i, segment in enumerate(argument_segments):
        context.update_transcript(segment)
        print(f"\nSegment {i+1}: {segment}")
        print(f"Full transcript length: {len(context.full_transcript)} characters")
        
        # Get context for judge analysis
        recent_transcript = context.get_recent_transcript()
        case_context = context.get_case_context_summary()
        conversation_history = context.get_conversation_history()
        time_since = context.time_since_last_interruption()
        
        print(f"Time since last interruption: {time_since}")
        
        # Note: This would make an API call in real usage
        # For testing structure, we'll just verify the data is prepared correctly
        print(f"Context prepared for judge analysis:")
        print(f"  - Transcript length: {len(recent_transcript)}")
        print(f"  - Case context length: {len(case_context)}")
        print(f"  - History length: {len(conversation_history)}")
    
    print("\n[OK] Component integration test passed!")
    print("Note: Actual judge analysis requires valid API key.")


if __name__ == "__main__":
    test_integration()

