# Moot Court Practice System - Usage Guide

## Quick Start

1. **Set up environment variables** (create `.env` file):
   ```
   OPENAI_API_KEY=your_key_here
   ```

2. **Run the system**:
   ```bash
   conda activate interrupting-cow
   poetry run python moot_court_main.py
   ```

## Command Line Options

```bash
python moot_court_main.py [OPTIONS]
```

### Options:

- `--model`: Whisper model size (`tiny`, `base`, `small`, `medium`, `large`)
  - Default: `small`
  - Larger models = better accuracy but slower

- `--judge_personality`: Judge personality type
  - `strict`: Demanding, challenges arguments rigorously
  - `lenient`: More forgiving, gives room to explain
  - `socratic`: Uses Socratic method to guide discovery
  - Default: `strict`

- `--interruption_frequency`: How often judge interrupts
  - `high`: Interrupts frequently (every ~5 seconds minimum)
  - `medium`: Moderate interruptions (every ~10 seconds minimum)
  - `low`: Fewer interruptions (every ~20 seconds minimum)
  - Default: `medium`

- `--energy_threshold`: Microphone sensitivity (default: 2000)
- `--record_timeout`: Recording chunk duration in seconds (default: 0.5)
- `--phrase_timeout`: Pause duration before considering phrase complete (default: 3)

## Example Usage

```bash
# Basic usage
poetry run python moot_court_main.py

# With custom judge personality
poetry run python moot_court_main.py --judge_personality socratic --interruption_frequency high

# With larger Whisper model for better accuracy
poetry run python moot_court_main.py --model medium
```

## How It Works

1. **Start the system** - It will load the Whisper model and wait for you to begin
2. **Begin your argument** - Start speaking your moot court argument
3. **Judge listens** - The system transcribes your speech in real-time
4. **Judge interrupts** - When the judge has a question, it will:
   - Play an interruption cue ("Your honor, I have a question.")
   - Ask the question via text-to-speech
5. **Continue** - After the question, continue your argument
6. **Session summary** - When you stop (Ctrl+C), see a summary of the session

## Configuration

### Case Configuration

Create `case_config.json` (see `case_config.json.example`):
- Case facts
- Legal issues
- Your role (petitioner/respondent)
- Key precedents

### Judge Configuration

Create `judge_config.json` (see `judge_config.json.example`):
- Judge personality
- Interruption frequency
- Question style

## Tips

1. **Speak clearly** - Better transcription = better judge questions
2. **Pause naturally** - Natural pauses help the judge find good interruption points
3. **Respond to questions** - After a judge question, you can respond and continue
4. **Check your microphone** - Make sure your mic is working before starting

## Troubleshooting

- **No interruptions?** Check that your OPENAI_API_KEY is set and has quota
- **Poor transcription?** Try a larger Whisper model (`--model medium` or `--model large`)
- **Too many interruptions?** Lower the frequency: `--interruption_frequency low`
- **Microphone not working?** Check system audio settings and microphone permissions

## Architecture

- `context_manager.py` - Manages conversation history and case context
- `judge_analyzer.py` - Analyzes arguments and generates judge questions
- `moot_court_interruptor.py` - Handles interruption logic and TTS
- `moot_court_main.py` - Main application with speech recognition

## Next Steps

- Add case configuration loading
- Add user response handling after judge questions
- Add session recording/playback
- Add performance scoring

