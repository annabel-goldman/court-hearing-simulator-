"""
Test OpenAI API key and check quota availability.
"""

from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()

def test_openai_key():
    """Test if OpenAI API key is valid and has quota."""
    api_key = os.getenv("OPENAI_API_KEY")
    
    if not api_key:
        print("ERROR: OPENAI_API_KEY not found in .env file")
        print("Make sure you have a .env file with: OPENAI_API_KEY=your_key_here")
        return False
    
    print(f"Found API key: {api_key[:10]}...{api_key[-4:]}")
    print("Testing API connection...\n")
    
    try:
        client = OpenAI(api_key=api_key)
        
        # Make a minimal API call to test
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Say 'test' if you can read this."}
            ],
            max_tokens=5
        )
        
        result = response.choices[0].message.content
        print(f"SUCCESS! API key is valid and has quota.")
        print(f"Response: {result}")
        print("\nYou can use the moot court system!")
        return True
        
    except Exception as e:
        error_str = str(e)
        print(f"ERROR: {error_str}\n")
        
        if "insufficient_quota" in error_str or "429" in error_str:
            print("QUOTA ISSUE: Your API key has exceeded its quota or has no credits.")
            print("Solutions:")
            print("  1. Check your OpenAI account billing: https://platform.openai.com/account/billing")
            print("  2. Add payment method if needed")
            print("  3. Check usage limits in your account settings")
        elif "invalid_api_key" in error_str or "401" in error_str:
            print("AUTHENTICATION ISSUE: Your API key is invalid.")
            print("Solutions:")
            print("  1. Check that your API key is correct in .env file")
            print("  2. Get a new key from: https://platform.openai.com/api-keys")
        elif "rate_limit" in error_str:
            print("RATE LIMIT: You're hitting rate limits.")
            print("This usually means you have quota but are making too many requests.")
        else:
            print("UNKNOWN ERROR: Check the error message above for details.")
        
        return False


if __name__ == "__main__":
    print("="*60)
    print("OpenAI API Key Test")
    print("="*60)
    print()
    
    success = test_openai_key()
    
    print()
    print("="*60)
    if success:
        print("Status: READY TO USE")
    else:
        print("Status: NEEDS ATTENTION")
    print("="*60)

