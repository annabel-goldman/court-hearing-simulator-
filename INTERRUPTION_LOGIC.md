# Judge Interruption Logic

This document explains how the Judge Engine decides when and how to interrupt an advocate during the simulation.

## 1. Data Provided to the Interruptor

The "interruptor" (the `JudgeEngine`) receives the following context to make its decision:

### Session Context
*   **Judge Personality**: One of `strict`, `lenient`, or `socratic`. This determines the tone and aggressiveness of the judge.
    *   *Reference*: `backend/services/judge_engine.py:162-166`
*   **Interruption Frequency**: Sets the minimum time between questions (`high`: 5s, `medium`: 10s, `low`: 20s).
    *   *Reference*: `backend/services/judge_engine.py:125-129`

### Real-time Argument Data
When `should_interrupt` is called, it receives:
*   **Rolling Transcript**: The engine analyzes the most recent **1500 characters** of what the advocate has said.
    *   *Reference*: `backend/services/judge_engine.py:73-76` & `196`
*   **Case Context**: A summary including case facts, legal issues, and the advocate's position (e.g., petitioner).
    *   *Reference*: `backend/services/judge_engine.py:92-101` & `197`
*   **Conversation History**: The last **3 questions** asked by the judge to avoid repetition and maintain flow.
    *   *Reference*: `backend/services/judge_engine.py:78-90` & `198`

---

## 2. How the Decision to Interrupt is Made

The decision process involves a "Hard Constraint" layer and an "AI Reasoning" layer.

### Layer 1: Hard Constraints (Pre-filtering)
Before calling the AI, the system checks:
1.  **Proceeding Status**: Interruptions only happen when the simulation phase is `PROCEEDING`.
    *   *Reference*: `backend/main.py:208`
2.  **Global Cool-down**: A hard-coded **15-second** minimum must pass between interruptions.
    *   *Reference*: `backend/main.py:211`
3.  **Frequency Settings**: The engine checks its own `min_seconds_between` (5-20s) based on user configuration.
    *   *Reference*: `backend/services/judge_engine.py:189-190`
4.  **Minimum Speech**: The advocate must have spoken at least **10 words** before the judge will consider interrupting.
    *   *Reference*: `backend/services/judge_engine.py:193-194`

### Layer 2: AI Reasoning (GPT-4)
If hard constraints pass, the engine asks GPT-4 to analyze the transcript. The AI decides to interrupt based on:
*   **Clarity**: Is the current point unclear or confusing?
*   **Logical Gaps**: Are there weaknesses or inconsistencies in the argument?
*   **Need for Detail**: Does a specific claim require deeper explanation?
*   **Natural Pauses**: Is this a good moment to jump in without being too disruptive?
    *   *Reference*: `backend/services/judge_engine.py:212-218` (AI Prompt)

---

## 3. How a Question is Chosen

The question is generated dynamically by the AI in the same step as the interruption decision.

*   **Dynamic Synthesis**: The AI doesn't just pick from a list; it synthesizes a question that directly addresses the advocate's **most recent statements** (the last 1500 chars).
    *   *Reference*: `backend/services/judge_engine.py:220`
*   **Guidance from Personality**: The question's "bite" is influenced by the judge's personality (e.g., "strict" judges ask more demanding questions).
    *   *Reference*: `backend/services/judge_engine.py:144-168`
*   **Contextual Relevance**: The question must be "substantive and relevant" to the case facts and legal issues provided in the context.
    *   *Reference*: `backend/services/judge_engine.py:220`
*   **Avoiding Repetition**: The AI is explicitly told which topics have been covered and what questions were already asked.
    *   *Reference*: `backend/services/judge_engine.py:217`

---

## 4. How the Brief Summary is Constructed

The system has transitioned from a naive truncation approach to a semantically aware AI summary.

### AI-Generated Judicial Summary
*   **GPT-4 Summarization**: When both briefs are uploaded, the system sends the first **4000 characters** of each to GPT-4.
*   **Senior Law Clerk Persona**: The AI is instructed to act as a senior law clerk, identifying:
    1. The core legal dispute.
    2. The appellant's primary argument.
    3. The appellee's primary response.
    4. Key precedents.
    *   *Reference*: `backend/services/judge_engine.py:129-165` (summarize_briefs method)

### Frontend Integration
*   **Home Page Trigger**: The summary is generated automatically when the user clicks "Enter Courtroom" after uploading both briefs.
    *   *Reference*: `frontend/src/pages/Home.tsx:103-125`
*   **Judge Admin Tool**: Administrators can manually trigger and preview the judicial summary during testing.
    *   *Reference*: `frontend/src/pages/JudgeAdmin.tsx:121-140`
*   **Fallback**: If the AI summary fails to generate, the system falls back to the legacy truncation (first 500 characters of each brief).
    *   *Reference*: `frontend/src/pages/CourtroomPage.tsx:174`
